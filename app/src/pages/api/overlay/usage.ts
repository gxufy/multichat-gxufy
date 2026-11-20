import type { NextApiRequest, NextApiResponse } from 'next';
import { queueAbuseRateLimit } from '../../../lib/server/abuseDiscord';
import { resolveNodeClientKey } from '../../../lib/server/clientIdentity';
import {
  admitOverlayUsageClient,
  deliverOverlayUsage,
  parseOverlayUsagePayload,
} from '../../../lib/server/overlayUsage';

export const config = {
  api: {
    bodyParser: { sizeLimit: '2kb' },
  },
};

/* Overlays post from our own pages; anything else is not a real overlay. */
const ALLOWED_ORIGINS = new Set([
  'https://flosschat.app',
  'https://www.flosschat.app',
  'https://gxufy.com',
  'https://www.gxufy.com',
  'https://multichat-gxufy.com',
  'https://www.multichat-gxufy.com',
]);

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return process.env.NODE_ENV === 'development' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(origin);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  if (!originAllowed(origin)) return res.status(403).json({ error: 'Forbidden.' });

  const payload = parseOverlayUsagePayload(req.body);
  if (!payload) return res.status(400).json({ error: 'Invalid request.' });

  const clientKey = resolveNodeClientKey(req);
  if (!admitOverlayUsageClient(clientKey)) {
    queueAbuseRateLimit({ clientIp: clientKey, area: 'overlay-usage', retryAfterSeconds: 600 });
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many requests.' });
  }

  await deliverOverlayUsage(payload);
  return res.status(204).end();
}
