/* GET /api/audience?twitch=x&youtube=y&tiktok=z
 *
 * Public, neutral-name alias for the existing viewer-count API. The generator
 * and third-party widget hosts can use this route without navigating an iframe
 * to /counter or depending on an endpoint name that privacy filter lists may
 * classify too broadly.
 *
 * Kick remains client-side for the same reason documented by /api/viewers:
 * Kick blocks the server IPs used by this deployment.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import viewersHandler from './viewers';

export default async function audienceHandler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  /* Viewer counts are public data. Allow read-only browser widgets hosted on
     other origins (for example Pogly) to consume this endpoint directly. */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  await viewersHandler(req, res);
}
