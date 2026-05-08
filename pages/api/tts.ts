import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { responseLimit: false } };

async function tryStreamElements(text: string, voice: string): Promise<Buffer | null> {
  // Try with realistic browser headers including Referer from lazypy.ro
  const res = await fetch(
    `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://lazypy.ro/',
        'Origin': 'https://lazypy.ro',
        'Accept': 'audio/mpeg, audio/*, */*',
      },
    }
  );
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('audio')) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function tryStreamlabs(text: string, voice: string): Promise<string | null> {
  // Streamlabs returns a real URL valid for ~5 min, 550 char limit
  const body = new URLSearchParams({ voice, text, service: 'polly' });
  const res = await fetch('https://streamlabs.com/polly/speak', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://lazypy.ro/',
      'Origin': 'https://lazypy.ro',
    },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.speak_url ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const text = ((req.query.text as string) ?? '').trim().slice(0, 550);
  const voice = ((req.query.voice as string) ?? 'Brian').trim();
  if (!text) return res.status(400).end();

  try {
    // 1. Try StreamElements directly
    const seAudio = await tryStreamElements(text, voice);
    if (seAudio) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(seAudio);
    }

    // 2. Fallback: Streamlabs (returns a URL, redirect to it)
    const slUrl = await tryStreamlabs(text, voice);
    if (slUrl) {
      // Fetch the audio from the Streamlabs URL and pipe it
      const audioRes = await fetch(slUrl);
      if (audioRes.ok) {
        const buf = Buffer.from(await audioRes.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(buf);
      }
    }

    return res.status(503).json({ error: 'TTS unavailable' });
  } catch {
    return res.status(500).end();
  }
}
