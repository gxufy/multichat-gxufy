/* POST /api/youtube/chat — compatibility proxy for one get_live_chat poll.
 * Production MultiChat uses the shared SSE hub, but older/direct-polling clients
 * keep this endpoint so existing overlay URLs do not depend on a migration.
 */
import { createHash } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FixedProviderAdmissionError,
  fixedProviderClientKey,
  runFixedProviderWork,
} from '../../../lib/server/fixedProviderProxy';
import { fetchYouTubeChat } from '../../../lib/server/youtubeUpstream';

export const YOUTUBE_CHAT_API_KEY_MAX_CHARS = 128;
export const YOUTUBE_CHAT_CLIENT_VERSION_MAX_CHARS = 64;
export const YOUTUBE_CHAT_CONTINUATION_MAX_CHARS = 8_192;

function validChatInput(value: unknown): value is {
  apiKey: string;
  clientVersion: string;
  continuation: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { apiKey, clientVersion, continuation } = value as Record<string, unknown>;
  return typeof apiKey === 'string'
    && /^[A-Za-z0-9_-]+$/.test(apiKey)
    && apiKey.length <= YOUTUBE_CHAT_API_KEY_MAX_CHARS
    && typeof clientVersion === 'string'
    && /^[A-Za-z0-9._-]+$/.test(clientVersion)
    && clientVersion.length <= YOUTUBE_CHAT_CLIENT_VERSION_MAX_CHARS
    && typeof continuation === 'string'
    && continuation.length >= 1
    && continuation.length <= YOUTUBE_CHAT_CONTINUATION_MAX_CHARS
    && !/[\u0000-\u001f\u007f]/.test(continuation);
}

function workKey(apiKey: string, clientVersion: string, continuation: string): string {
  const digest = createHash('sha256')
    .update(apiKey)
    .update('\0')
    .update(clientVersion)
    .update('\0')
    .update(continuation)
    .digest('hex');
  return `youtube-chat:${digest}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!validChatInput(req.body)) {
    return res.status(400).json({ error: 'missing fields' });
  }
  const { apiKey, clientVersion, continuation } = req.body;

  try {
    const body = await runFixedProviderWork({
      key: workKey(apiKey, clientVersion, continuation),
      clientKey: fixedProviderClientKey(req),
      run: () => fetchYouTubeChat(apiKey, clientVersion, continuation),
    });
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many YouTube chat requests.'
          : 'YouTube chat temporarily unavailable.',
      });
    }
    return res.status(502).json({ error: 'YouTube chat poll failed' });
  }
}
