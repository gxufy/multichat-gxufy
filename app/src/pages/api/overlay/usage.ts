import type { NextApiRequest, NextApiResponse } from 'next';
import { deliverOverlayUsage, parseOverlayUsagePayload } from '../../../lib/server/overlayUsage';

export const config = {
  api: {
    bodyParser: { sizeLimit: '2kb' },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const payload = parseOverlayUsagePayload(req.body);
  if (!payload) return res.status(400).json({ error: 'Invalid request.' });

  await deliverOverlayUsage(payload);
  return res.status(204).end();
}
