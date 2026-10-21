export const BTTV_PRO_SOCKET_URL =
  'wss://sockets.betterttv.net/ws';

export const BTTV_PRO_TIMEOUT_MS = 2_500;

export type PreviewBttvProIdentity = {
  readonly userId: string;
};

type WebSocketLike = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
};

export type PreviewBttvProOptions = {
  readonly timeoutMs?: number;
  readonly createSocket?: (url: string) => WebSocketLike;
};

function validUserId(value: string): boolean {
  return /^\d{1,25}$/.test(value);
}

function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;

  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Look up BTTV Pro for many Twitch users using ONE websocket.
 *
 * The returned map contains only users for whom BTTV explicitly returned
 * pro=true plus a valid HTTPS badge URL.
 */
export function loadPreviewBttvProBadges(
  identities: readonly PreviewBttvProIdentity[],
  options: PreviewBttvProOptions = {},
): Promise<ReadonlyMap<string, string>> {
  const userIds = [
    ...new Set(
      identities
        .map((identity) => identity.userId.trim())
        .filter(validUserId),
    ),
  ];

  if (!userIds.length) {
    return Promise.resolve(new Map());
  }

  const timeoutMs =
    options.timeoutMs ?? BTTV_PRO_TIMEOUT_MS;

  const createSocket =
    options.createSocket
    ?? ((url: string) => new WebSocket(url));

  return new Promise((resolve) => {
    const results = new Map<string, string>();
    const answered = new Set<string>();
    let socket: WebSocketLike;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;

      clearTimeout(timer);

      for (const userId of userIds) {
        try {
          socket.send(JSON.stringify({
            name: 'part_channel',
            data: {
              name: `twitch:${userId}`,
            },
          }));
        } catch {
          // Socket may already be gone.
        }
      }

      try {
        socket.close();
      } catch {
        // Ignore close failures.
      }

      resolve(results);
    };

    try {
      socket = createSocket(BTTV_PRO_SOCKET_URL);
    } catch {
      resolve(results);
      return;
    }

    const timer = setTimeout(
      finish,
      Math.max(1, timeoutMs),
    );

    socket.onopen = () => {
      for (const userId of userIds) {
        const channel = `twitch:${userId}`;

        try {
          socket.send(JSON.stringify({
            name: 'join_channel',
            data: {
              name: channel,
            },
          }));

          socket.send(JSON.stringify({
            name: 'broadcast_me',
            data: {
              provider: 'twitch',
              providerId: userId,
              channel,
            },
          }));
        } catch {
          finish();
          return;
        }
      }
    };

    socket.onmessage = (event) => {
      if (finished || typeof event.data !== 'string') return;

      try {
        const message = JSON.parse(event.data);

        if (
          message?.name !== 'lookup_user'
          || message?.data?.providerId === undefined
        ) {
          return;
        }

        const userId = String(
          message.data.providerId,
        );

        if (!userIds.includes(userId)) return;

        answered.add(userId);

        if (
          message.data?.pro === true
          && httpsUrl(message.data?.badge?.url)
        ) {
          results.set(
            userId,
            message.data.badge.url,
          );
        }

        if (answered.size === userIds.length) {
          finish();
        }
      } catch {
        // Ignore unrelated or malformed websocket frames.
      }
    };

    socket.onerror = () => finish();
    socket.onclose = () => finish();
  });
}
