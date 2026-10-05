/* GET /api/tiktok/chat?user=<uniqueId>&since=<overlayStartMs> — Server-Sent Events stream.
 *
 * Thin subscriber onto the shared TikTok hub: one upstream connection per
 * unique channel, a 30s linger, delete-aware recovery, and a serialized payload
 * shared across every subscriber instead of JSON-stringifying per overlay.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeChatChannel } from '../../../lib/channelValidation';
import { subscribe } from '../../../lib/tiktokHub';
import {
  createSharedSseAdmissionLimiter,
  SHARED_SSE_CAPACITY_RETRY_AFTER_SECONDS,
  sharedSseClientKey,
} from '../../../lib/server/sharedSseAdmission';

export const config = { api: { responseLimit: false } };

const admissionLimiter = createSharedSseAdmissionLimiter();

export function tikTokSseSince(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function shouldSendTikTokSseEvent(data: object, since: number | null): boolean {
  if (since === null) return true;
  const timestamp = Number((data as { timestamp?: unknown }).timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return true;
  return timestamp >= since;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const user = normalizeChatChannel('tiktok', req.query.user);
  if (!user) return res.status(400).json({ error: 'invalid user' });
  const since = tikTokSseSince(req.query.since);

  const admission = admissionLimiter.consume(sharedSseClientKey(req));
  if (!admission.allowed) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many stream requests.' });
  }

  let streaming = false;
  const pending: Array<{ data: object; serialized: string }> = [];
  const send = (data: object, serialized: string) => {
    if (!shouldSendTikTokSseEvent(data, since)) return;
    if (!streaming) {
      pending.push({ data, serialized });
      return;
    }
    res.write(`data: ${serialized}\n\n`);
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = subscribe(user, send);
  } catch {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Retry-After', String(SHARED_SSE_CAPACITY_RETRY_AFTER_SECONDS));
    return res.status(503).json({ error: 'Stream temporarily unavailable.' });
  }

  let keepalive: ReturnType<typeof setInterval> | null = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    req.off('close', cleanup);
    req.off('aborted', cleanup);
    res.off('close', cleanup);
    res.off('error', cleanup);
    res.off('finish', cleanup);
    if (keepalive) clearInterval(keepalive);
    keepalive = null;
    unsubscribe();
    try {
      if (!res.writableEnded) res.end();
    } catch { /* already closed */ }
  };

  req.once('close', cleanup);
  req.once('aborted', cleanup);
  res.once('close', cleanup);
  res.once('error', cleanup);
  res.once('finish', cleanup);

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    streaming = true;
    for (const event of pending) send(event.data, event.serialized);
    pending.length = 0;
    if (cleaned) return;
    keepalive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { cleanup(); }
    }, 15_000);
  } catch {
    cleanup();
  }
}

export function resetTikTokSseAdmissionForTests(): void {
  admissionLimiter.reset();
}
