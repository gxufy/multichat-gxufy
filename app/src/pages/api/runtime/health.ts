import type { NextApiRequest, NextApiResponse } from 'next';
import { isDraining, isHeld } from '@/lib/server/drain';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  /* During a deploy's handover this copy reports unhealthy, so Caddy sends new
     visitors to the other copy (see lib/server/drain). */
  if (isDraining()) return res.status(503).json({ status: 'draining' });
  /* A new copy that is running but not yet checked by the deploy. */
  if (isHeld()) return res.status(503).json({ status: 'held' });

  return res.status(200).json({ status: 'ok' });
}
