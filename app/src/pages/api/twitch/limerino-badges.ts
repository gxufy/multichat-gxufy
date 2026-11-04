import type { NextApiRequest, NextApiResponse } from 'next';
import { loadLimerinoBadges } from '@/lib/server/limerinoBadges';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    res.status(200).json(await loadLimerinoBadges());
  } catch {
    res.status(502).json({ error: 'Unable to load Limerino badges.' });
  }
}
