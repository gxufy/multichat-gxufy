/* POST /api/auth/logout -> 204, session cookie cleared. */
import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSession, isSameOriginRequest } from '@/lib/server/session';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Forbidden.' });
  clearSession(res);
  return res.status(204).end();
}
