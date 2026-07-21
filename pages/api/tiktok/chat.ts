/* GET /api/tiktok/chat?user=<uniqueId> — Server-Sent Events stream.
 *
 * Thin subscriber onto the shared TikTok hub (lib/tiktokHub): ONE
 * upstream TikTok connection per unique channel regardless of how many
 * overlays watch it, 30s linger on last-viewer disconnect. Requires a
 * long-lived Node process (`next start`) — not serverless-compatible.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { subscribe } from '../../../lib/tiktokHub';

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = (req.query.user as string || '').trim().replace(/^@/, '');
  if (!user || !/^[A-Za-z0-9._]{1,50}$/.test(user)) {
    return res.status(400).json({ error: 'invalid user' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* noop */ }
  }, 15000);

  const unsubscribe = subscribe(user.toLowerCase(), send);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
    try { res.end(); } catch { /* already closed */ }
  });
}
