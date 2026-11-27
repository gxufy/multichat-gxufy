import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  BTTV_PRO_SOCKET_URL,
  loadPreviewBttvProBadges,
} from '@/features/multichat/previewBttvPro';

describe('Preview BTTV Pro lookup', () => {
  it('uses one socket for multiple Twitch users and keeps only explicit Pro owners', async () => {
    const sent: unknown[] = [];
    let socketCount = 0;

    class FakeSocket {
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor(readonly url: string) {
        socketCount += 1;

        queueMicrotask(() => {
          this.onopen?.(new Event('open'));
        });
      }

      send(data: string): void {
        const message = JSON.parse(data);
        sent.push(message);

        if (message.name !== 'broadcast_me') return;

        const userId = String(
          message.data.providerId,
        );

        queueMicrotask(() => {
          this.onmessage?.({
            data: JSON.stringify({
              name: 'lookup_user',
              data: userId === '204219574'
                ? {
                    providerId: userId,
                    pro: true,
                    badge: {
                      url: 'https://cdn.betterttv.net/badge/pro.webp',
                    },
                  }
                : {
                    providerId: userId,
                    pro: false,
                  },
            }),
          } as MessageEvent);
        });
      }

      close(): void {}
    }

    const result = await loadPreviewBttvProBadges(
      [
        { userId: '204219574' },
        { userId: '204497246' },
      ],
      {
        timeoutMs: 100,
        createSocket: (url) => new FakeSocket(url),
      },
    );

    expect(socketCount).toBe(1);

    expect(result.get('204219574')).toBe(
      'https://cdn.betterttv.net/badge/pro.webp',
    );

    expect(result.has('204497246')).toBe(false);

    expect(
      sent.filter(
        (entry: any) => entry.name === 'broadcast_me',
      ),
    ).toHaveLength(2);

    expect(BTTV_PRO_SOCKET_URL).toBe(
      'wss://sockets.betterttv.net/ws',
    );
  });
});
