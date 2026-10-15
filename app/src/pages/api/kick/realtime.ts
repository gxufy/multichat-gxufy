import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import {
  subscribeKickRealtime,
  type KickRealtimeHubEvent,
} from '../../../lib/server/kickRealtimeHub';

import {
  createSharedSseAdmissionLimiter,
  SHARED_SSE_CAPACITY_RETRY_AFTER_SECONDS,
  sharedSseClientKey,
} from '../../../lib/server/sharedSseAdmission';

export const config = {
  api: {
    responseLimit: false,
  },
};

const admissionLimiter =
  createSharedSseAdmissionLimiter();

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value)
    ? value[0]
    : value;
}

export function kickRealtimePositiveInteger(
  value: string | string[] | undefined,
): number | null {
  const raw = firstValue(value);

  if (
    typeof raw !== 'string' ||
    !/^\d+$/.test(raw)
  ) {
    return null;
  }

  const number = Number(raw);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

export function kickRealtimeAfterSequence(
  req: Pick<
    NextApiRequest,
    'query' | 'headers'
  >,
): number | null {
  /*
   * Native EventSource automatically sends Last-Event-ID when it reconnects.
   * `after=` is also accepted so tests/manual clients can exercise recovery.
   */
  const header = firstValue(
    req.headers['last-event-id'],
  );

  const query = firstValue(
    req.query.after,
  );

  const raw =
    typeof header === 'string' &&
    header.trim()
      ? header
      : query;

  if (
    typeof raw !== 'string' ||
    !/^\d+$/.test(raw)
  ) {
    return null;
  }

  const number = Number(raw);

  return (
    Number.isSafeInteger(number) &&
    number >= 0
  )
    ? number
    : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res
      .status(405)
      .json({
        error: 'Method not allowed.',
      });
  }

  const channelId =
    kickRealtimePositiveInteger(
      req.query.channelId,
    );

  const chatroomId =
    kickRealtimePositiveInteger(
      req.query.chatroomId,
    );

  if (
    channelId === null ||
    chatroomId === null
  ) {
    return res
      .status(400)
      .json({
        error: 'Invalid Kick realtime ids.',
      });
  }

  const admission =
    admissionLimiter.consume(
      sharedSseClientKey(req),
    );

  if (!admission.allowed) {
    res.setHeader(
      'Cache-Control',
      'private, no-store',
    );

    res.setHeader(
      'Retry-After',
      String(
        admission.retryAfterSeconds,
      ),
    );

    return res
      .status(429)
      .json({
        error:
          'Too many stream requests.',
      });
  }

  const afterSequence =
    kickRealtimeAfterSequence(req);

  let streaming = false;

  const pending: Array<{
    data: KickRealtimeHubEvent;
    serialized: string;
  }> = [];

  const send = (
    data: KickRealtimeHubEvent,
    serialized: string,
  ) => {
    if (!streaming) {
      pending.push({
        data,
        serialized,
      });

      return;
    }

    if (data.type === 'event') {
      /*
       * EventSource remembers this value and sends it back as
       * Last-Event-ID if the SSE transport reconnects.
       */
      res.write(
        `id: ${data.sequence}\n`,
      );
    }

    res.write(
      `data: ${serialized}\n\n`,
    );
  };

  let unsubscribe: () => void;

  try {
    unsubscribe =
      subscribeKickRealtime(
        channelId,
        chatroomId,
        send,
        afterSequence,
      );
  } catch {
    res.setHeader(
      'Cache-Control',
      'private, no-store',
    );

    res.setHeader(
      'Retry-After',
      String(
        SHARED_SSE_CAPACITY_RETRY_AFTER_SECONDS,
      ),
    );

    return res
      .status(503)
      .json({
        error:
          'Kick stream temporarily unavailable.',
      });
  }

  let keepalive:
    | ReturnType<typeof setInterval>
    | null = null;

  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;

    cleaned = true;

    req.off(
      'close',
      cleanup,
    );

    req.off(
      'aborted',
      cleanup,
    );

    res.off(
      'close',
      cleanup,
    );

    res.off(
      'error',
      cleanup,
    );

    res.off(
      'finish',
      cleanup,
    );

    if (keepalive) {
      clearInterval(keepalive);
    }

    keepalive = null;

    unsubscribe();

    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      // Already closed.
    }
  };

  req.once(
    'close',
    cleanup,
  );

  req.once(
    'aborted',
    cleanup,
  );

  res.once(
    'close',
    cleanup,
  );

  res.once(
    'error',
    cleanup,
  );

  res.once(
    'finish',
    cleanup,
  );

  try {
    res.writeHead(
      200,
      {
        'Content-Type':
          'text/event-stream',
        'Cache-Control':
          'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    );

    res.flushHeaders?.();

    /*
     * Tell EventSource to reconnect quickly if the HTTP stream itself
     * is interrupted. Upstream Kick reconnection remains owned by the hub.
     */
    res.write(
      'retry: 2000\n\n',
    );

    streaming = true;

    for (
      const item of pending
    ) {
      send(
        item.data,
        item.serialized,
      );
    }

    pending.length = 0;

    if (cleaned) return;

    keepalive =
      setInterval(
        () => {
          try {
            res.write(
              ': ping\n\n',
            );
          } catch {
            cleanup();
          }
        },
        15_000,
      );
  } catch {
    cleanup();
  }
}

export function resetKickRealtimeSseAdmissionForTests(): void {
  admissionLimiter.reset();
}
