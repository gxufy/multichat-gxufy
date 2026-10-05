import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedMessage } from '@/lib/types';

/* Kick's connector needs a Pusher surface even though these tests only exercise
 * its startup history path. */
class FakePusherChannel {
  bind() { return this; }
}

class FakePusher {
  connection = { state: 'connected', bind: () => {} };
  subscribe() { return new FakePusherChannel(); }
  channel() { return new FakePusherChannel(); }
  disconnect() {}
  connect() {}
}

vi.mock('pusher-js', () => ({ default: FakePusher }));

vi.mock('@/lib/kick', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  getKickChannel: vi.fn(async () => ({
    id: 7,
    user_id: 77,
    chatroom: { id: 700 },
    user: { id: 77, username: 'streamer' },
    subscriber_badges: [],
  })),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connector startup history baseline', () => {
  it('Kick ignores pre-start history but preserves a row that happened during bootstrap', async () => {
    const { createKickConnector } = await import('@/lib/connectors/kick');
    const messages: UnifiedMessage[] = [];

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          /* Kick returns newest first; fetchKickHistory reverses into display order. */
          messages: [
            {
              id: 'kick-after-start',
              content: 'arrived while loading',
              created_at: new Date(10_100).toISOString(),
              sender: { id: 2, username: 'new', identity: { color: '#fff', badges: [] } },
            },
            {
              id: 'kick-before-start',
              content: 'old history',
              created_at: new Date(9_000).toISOString(),
              sender: { id: 1, username: 'old', identity: { color: '#fff', badges: [] } },
            },
          ],
        },
      }),
    } as Response)));

    const connector = createKickConnector({
      channel: 'streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onPin: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    await vi.advanceTimersByTimeAsync(1);

    expect(messages.map(message => message.id)).toEqual(['kick-after-start']);
    connector.stop();
  });

  it('YouTube never queues the old first continuation behind genuinely new chat', async () => {
    const { createYouTubeConnector } = await import('@/lib/connectors/youtube');
    const messages: UnifiedMessage[] = [];
    let chatPolls = 0;

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
      if (url.includes('/api/youtube/live')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ videoId: 'v', apiKey: 'k', clientVersion: '2', continuation: 'c0' }),
        } as Response;
      }

      const data = chatPolls++ === 0
        ? {
            continuationContents: {
              liveChatContinuation: {
                actions: [
                  {
                    addChatItemAction: {
                      item: {
                        liveChatTextMessageRenderer: {
                          id: 'youtube-before-start',
                          authorName: { simpleText: 'old' },
                          authorExternalChannelId: 'UC-old',
                          timestampUsec: '9000000',
                          message: { simpleText: 'old history' },
                        },
                      },
                    },
                  },
                  {
                    addChatItemAction: {
                      item: {
                        liveChatTextMessageRenderer: {
                          id: 'youtube-after-start',
                          authorName: { simpleText: 'new' },
                          authorExternalChannelId: 'UC-new',
                          timestampUsec: '10100000',
                          message: { simpleText: 'new chat' },
                        },
                      },
                    },
                  },
                ],
                continuations: [{ timedContinuationData: { continuation: 'c1', timeoutMs: 1000 } }],
              },
            },
          }
        : {
            continuationContents: {
              liveChatContinuation: {
                actions: [],
                continuations: [{ timedContinuationData: { continuation: 'c2', timeoutMs: 1000 } }],
              },
            },
          };

      return { ok: true, status: 200, json: async () => data } as Response;
    }));

    const connector = createYouTubeConnector({
      channel: 'streamer',
      onMessage: message => messages.push(message),
      onDelete: vi.fn(),
      onPin: vi.fn(),
      onStatus: vi.fn(),
    });
    connector.start();
    await vi.advanceTimersByTimeAsync(1_200);

    expect(messages.map(message => message.id)).toEqual(['youtube-after-start']);
    connector.stop();
  });
});
