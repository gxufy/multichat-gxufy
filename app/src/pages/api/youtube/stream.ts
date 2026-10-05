import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeChatChannel } from '../../../lib/channelValidation';
import { subscribeYouTube } from '../../../lib/server/youtubeHub';
import {
  createSharedSseAdmissionLimiter,
  SHARED_SSE_CAPACITY_RETRY_AFTER_SECONDS,
  sharedSseClientKey,
} from '../../../lib/server/sharedSseAdmission';

export const config = { api: { responseLimit: false } };

const admissionLimiter = createSharedSseAdmissionLimiter();

export function youtubeSseSince(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function shouldSendYouTubeSseEvent(
  data: { type?: string; timestamp?: unknown },
  since: number | null,
): boolean {
  if (since === null || data.type !== 'actions') return true;
  const timestamp = Number(data.timestamp);
  return !Number.isFinite(timestamp) || timestamp <= 0 || timestamp >= since;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const channel = normalizeChatChannel('youtube', req.query.channel);
  if (!channel) return res.status(400).json({ error: 'invalid channel' });
  const since = youtubeSseSince(req.query.since);

  const admission = admissionLimiter.consume(sharedSseClientKey(req));
  if (!admission.allowed) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many stream requests.' });
  }

  let streaming = false;
  const pending: Array<{ data: any; serialized: string }> = [];
  const send = (data: any, serialized: string) => {
    if (!shouldSendYouTubeSseEvent(data, since)) return;
    if (!streaming) {
      pending.push({ data, serialized });
      return;
    }
    res.write(`data: ${serialized}\n\n`);
  };

  let unsubscribe: () => void;
  try {
    unsubscribe = subscribeYouTube(channel, send);
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

export function resetYouTubeSseAdmissionForTests(): void {
  admissionLimiter.reset();
}
