/* GET /api/overlay/stream?s=<key>|<lastEventId>|<path>?<query> (repeatable)
 *
 * All of one overlay's server streams in one server-sent-events response: the
 * owner's commands, Kick, YouTube and TikTok, each still served by its own
 * route handler (see lib/server/overlayStreamMux). One connection per overlay
 * instead of four, so overlays and pages from the same site never wait for a
 * free connection. The separate routes stay for overlays opened before this.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import overlayLive from './live';
import kickRealtime from '../kick/realtime';
import youtubeStream from '../youtube/stream';
import tiktokChat from '../tiktok/chat';
import {
  OVERLAY_STREAM_KEEPALIVE_MS,
  OVERLAY_STREAM_MOVE_DELAY_MS,
  overlayStreamFrame,
  parseOverlayStreamSubs,
  startOverlayStreamSubs,
  type OverlayStreamHandler,
  type OverlayStreamPath,
} from '../../lib/server/overlayStreamMux';
import {
  createSharedSseAdmissionLimiter,
  sharedSseClientKey,
} from '../../lib/server/sharedSseAdmission';
import { onStreamsMove } from '../../lib/server/drain';

export const config = { api: { responseLimit: false } };

const HANDLERS: Readonly<Record<OverlayStreamPath, OverlayStreamHandler>> = {
  '/api/overlay/live': overlayLive,
  '/api/kick/realtime': kickRealtime,
  '/api/youtube/stream': youtubeStream,
  '/api/tiktok/chat': tiktokChat,
};

const admissionLimiter = createSharedSseAdmissionLimiter();

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const subs = parseOverlayStreamSubs(req.query.s);
  if (!subs) return res.status(400).json({ error: 'Invalid streams.' });

  const admission = admissionLimiter.consume(sharedSseClientKey(req));
  if (!admission.allowed) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many stream requests.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  let stopSubs: () => void = () => {};
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let cancelMove: () => void = () => {};

  const close = () => {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    keepalive = null;
    cancelMove();
    stopSubs();
    try {
      if (!res.writableEnded) res.end();
    } catch { /* already closed */ }
  };
  const out = (chunk: string) => {
    if (closed) return;
    try {
      res.write(chunk);
    } catch {
      close();
    }
  };

  req.once('close', close);
  res.once('close', close);
  res.once('error', close);

  stopSubs = startOverlayStreamSubs(req, subs, HANDLERS, out);
  if (closed) return;
  keepalive = setInterval(() => out(': ping\n\n'), OVERLAY_STREAM_KEEPALIVE_MS);
  /* Registered after the sub-streams, so their own handover messages go out
     first; then the browser reconnects (to the other server copy) at once. */
  cancelMove = onStreamsMove(() => {
    out(overlayStreamFrame('*', '.move', '', String(OVERLAY_STREAM_MOVE_DELAY_MS)));
    close();
  });
}

export function resetOverlayStreamAdmissionForTests(): void {
  admissionLimiter.reset();
}
