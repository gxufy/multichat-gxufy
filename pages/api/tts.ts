import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const text = (req.query.text as string ?? '').trim();
  const voice = (req.query.voice as string ?? 'Brian').trim();
  if (!text) return res.status(400).end();

  try {
    const upstream = await fetch(
      `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!upstream.ok) return res.status(upstream.status).end();

    const buffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch {
    res.status(500).end();
  }
}
