/* GET /api/overlay/live — the owner's refresh signals, pushed to open overlays.
 *
 * Server-sent events. On connect the overlay gets the current refresh state
 * (event `state`), then every change the moment it happens, plus a keep-alive
 * comment every 25 seconds. `?c=platform:channel` (repeatable) names the
 * channels the overlay shows, so it also gets the owner's commands for them.
 * See lib/server/overlayLiveHub.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  addOverlayLiveSink,
  overlayLiveHasRoom,
  parseOverlayChannelParams,
  removeOverlayLiveSink,
} from '@/lib/server/overlayLiveHub';
import {
  createSharedSseAdmissionLimiter,
  sharedSseClientKey,
} from '@/lib/server/sharedSseAdmission';
import { onStreamsMove } from '@/lib/server/drain';

export const config = {
  api: {
    responseLimit: false,
  },
};

const admissionLimiter = createSharedSseAdmissionLimiter();

export function __resetOverlayLiveLimitForTests(): void {
  admissionLimiter.reset();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const clientKey = sharedSseClientKey(req);
  const admission = admissionLimiter.consume(clientKey);
  if (!admission.allowed) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many connections. Try again shortly.' });
  }
  if (!overlayLiveHasRoom(clientKey)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '30');
    return res.status(503).json({ error: 'Too many open connections.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  /* Reconnect quickly if the stream drops (a deploy restarts the server). */
  res.write('retry: 3000\n\n');

  const sink = res;
  /* A deploy is handing over to the other server copy: end the stream with a
     short retry, so the browser reconnects (to the new copy) in half a second.
     Works for overlays already open, since EventSource reconnects by itself. */
  const cancelMove = onStreamsMove(() => {
    try {
      res.write('retry: 500\n\n');
      res.end();
    } catch { /* already closed */ }
  });
  const close = () => {
    cancelMove();
    removeOverlayLiveSink(sink);
  };
  req.on('close', close);
  res.on('close', close);
  await addOverlayLiveSink(sink, clientKey, parseOverlayChannelParams(req.query.c));
}
