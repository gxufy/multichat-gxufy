import type { NextApiRequest, NextApiResponse } from 'next';
import {
  TTS_AUDIO_MAX_BYTES,
  TTS_METADATA_MAX_BYTES,
  TtsAdmissionError,
  createTtsAdmissionController,
  fetchTrustedTtsAudio,
  readBoundedAudioResponse,
  readBoundedResponseBody,
  ttsClientKey,
  withTtsAbortTimeout,
} from '../../lib/server/ttsSecurity';

export const config = { api: { responseLimit: 5_242_880 } };

export const TTS_TEXT_MAX_CHARS = 550;
export const TTS_VOICE_MAX_CHARS = 64;
export const TTS_STREAM_ELEMENTS_TIMEOUT_MS = 5_000;
export const TTS_STREAMLABS_SYNTHESIS_TIMEOUT_MS = 5_000;
export const TTS_STREAMLABS_AUDIO_TIMEOUT_MS = 8_000;

const DEFAULT_VOICE = 'Brian';
const VOICE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const admission = createTtsAdmissionController();

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Rejected upstream responses are best-effort cancellations.
  }
}

async function tryStreamElements(text: string, voice: string): Promise<Buffer | null> {
  try {
    return await withTtsAbortTimeout(TTS_STREAM_ELEMENTS_TIMEOUT_MS, async (signal) => {
      const response = await fetch(
        `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://lazypy.ro/',
            Origin: 'https://lazypy.ro',
            Accept: 'audio/mpeg, audio/*',
          },
          redirect: 'manual',
          signal,
        },
      );
      if (!response.ok) {
        await discardBody(response);
        return null;
      }
      return (await readBoundedAudioResponse(response, TTS_AUDIO_MAX_BYTES)).bytes;
    });
  } catch {
    return null;
  }
}

async function tryStreamlabs(text: string, voice: string): Promise<string | null> {
  try {
    return await withTtsAbortTimeout(
      TTS_STREAMLABS_SYNTHESIS_TIMEOUT_MS,
      async (signal) => {
        const response = await fetch('https://streamlabs.com/polly/speak', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Referer: 'https://lazypy.ro/',
            Origin: 'https://lazypy.ro',
          },
          body: new URLSearchParams({ voice, text, service: 'polly' }).toString(),
          redirect: 'manual',
          signal,
        });
        if (!response.ok) {
          await discardBody(response);
          return null;
        }

        const contentType = (response.headers.get('content-type') ?? '')
          .split(';', 1)[0]
          .trim()
          .toLowerCase();
        if (contentType !== 'application/json') {
          await discardBody(response);
          return null;
        }

        const body = await readBoundedResponseBody(response, TTS_METADATA_MAX_BYTES);
        const data = JSON.parse(body.toString('utf8')) as { speak_url?: unknown };
        return typeof data?.speak_url === 'string' ? data.speak_url : null;
      },
    );
  } catch {
    return null;
  }
}

function validatedInput(req: NextApiRequest): { text: string; voice: string } | null {
  if (typeof req.query.text !== 'string') return null;
  const text = req.query.text.trim();
  if (!text || text.length > TTS_TEXT_MAX_CHARS) return null;

  const rawVoice = req.query.voice;
  if (rawVoice !== undefined && typeof rawVoice !== 'string') return null;
  const voice = (rawVoice ?? DEFAULT_VOICE).trim();
  if (!voice
    || voice.length > TTS_VOICE_MAX_CHARS
    || !VOICE_PATTERN.test(voice)) {
    return null;
  }

  return { text, voice };
}

function setResponseHeaders(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  setResponseHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const input = validatedInput(req);
  if (!input) {
    res.status(400).json({ error: 'Invalid TTS request.' });
    return;
  }

  let release: (() => void) | undefined;
  try {
    release = admission.acquire(ttsClientKey(req));
  } catch (error) {
    if (error instanceof TtsAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many TTS requests.'
          : 'TTS temporarily unavailable.',
      });
      return;
    }
    res.status(503).json({ error: 'TTS temporarily unavailable.' });
    return;
  }

  try {
    const streamElementsAudio = await tryStreamElements(input.text, input.voice);
    if (streamElementsAudio) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(streamElementsAudio.byteLength));
      res.status(200).send(streamElementsAudio);
      return;
    }

    const streamlabsUrl = await tryStreamlabs(input.text, input.voice);
    if (streamlabsUrl) {
      try {
        const { bytes } = await fetchTrustedTtsAudio(streamlabsUrl, {
          timeoutMs: TTS_STREAMLABS_AUDIO_TIMEOUT_MS,
          maximumBytes: TTS_AUDIO_MAX_BYTES,
        });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', String(bytes.byteLength));
        res.status(200).send(bytes);
        return;
      } catch {
        // The client will use browser speech when the trusted fallback fails.
      }
    }

    res.status(503).json({ error: 'TTS unavailable.' });
  } catch {
    res.status(503).json({ error: 'TTS unavailable.' });
  } finally {
    release();
  }
}

export function ttsResourceStatsForTests() {
  return admission.statsForTests();
}

export function resetTtsResourcesForTests(): void {
  admission.reset();
}
