/* POST /api/youtube/chat — proxy one get_live_chat poll.
 * Body: { apiKey, clientVersion, continuation }
 * Returns the raw InnerTube JSON; parsing happens client-side.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const { apiKey, clientVersion, continuation } = req.body ?? {};
  if (typeof apiKey !== 'string' || typeof clientVersion !== 'string' || typeof continuation !== 'string') {
    return res.status(400).json({ error: 'missing fields' });
  }

  const r = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Cookie': 'SOCS=CAI',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion } },
        continuation,
      }),
    }
  );
  if (!r.ok) return res.status(502).json({ error: `innertube: ${r.status}` });
  res.status(200).json(await r.json());
}
