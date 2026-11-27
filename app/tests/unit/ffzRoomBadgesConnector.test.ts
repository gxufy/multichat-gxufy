import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchConnector } from '@/lib/connectors/twitch';
import type { UnifiedMessage } from '@/lib/types';

const resolve = vi.hoisted(() => vi.fn());
const roomUsers = vi.hoisted(() => vi.fn());
vi.mock('@/lib/communityBadges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/communityBadges')>()),
  resolveTwitchCommunityBadges: resolve,
}));
vi.mock('@/lib/twitchEmotes', () => ({
  loadFFZRoomBadges: vi.fn(async () => ({})),
  loadFFZRoomUserBadges: roomUsers,
}));
vi.mock('@/lib/twitchProfileClient', () => ({ fetchTwitchProfile: vi.fn(async () => null) }));

class FakeSocket {
  static last: FakeSocket;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor() { FakeSocket.last = this; }
  send(value: string) { this.sent.push(value); }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  resolve.mockReset();
  resolve.mockResolvedValue([]);
  roomUsers.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function start() {
  const messages: UnifiedMessage[] = [];
  const connector = createTwitchConnector({
    channel: 'local',
    onMessage: (message) => messages.push(message),
    onMessageUpdate: vi.fn(),
    onDelete: vi.fn(),
    onStatus: vi.fn(),
  });
  connector.start();
  return { socket: FakeSocket.last, messages, connector };
}

const roomState = '@room-id=100 :tmi.twitch.tv ROOMSTATE #local\r\n';
const privmsg = (id: string, userId: string, login: string, sourceRoom?: string) =>
  `@room-id=100;${sourceRoom ? `source-room-id=${sourceRoom};` : ''}display-name=${login};id=${id};user-id=${userId} :${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #local :hi\r\n`;

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
}

describe('FFZ channel badges in the Twitch connector', () => {
  it('passes the channel’s FFZ badges for a chatter, by id or login', async () => {
    roomUsers.mockResolvedValue(new Map([
      ['id:71', ['2']],
      ['login:loginbot', ['2', '5']],
    ]));
    const { socket } = start();
    socket.onmessage?.({ data: roomState });
    expect(roomUsers).toHaveBeenCalledWith('100');
    socket.onmessage?.({ data: privmsg('a', '71', 'idbot') });
    socket.onmessage?.({ data: privmsg('b', '72', 'LoginBot') });
    socket.onmessage?.({ data: privmsg('c', '73', 'viewer') });
    await settle();
    const byUser = Object.fromEntries(resolve.mock.calls.map(([identity]) => [identity.userId, identity.ffzRoomBadgeIds]));
    expect(byUser).toEqual({ '71': ['2'], '72': ['2', '5'], '73': undefined });
  });

  it('does not give this channel’s badges to a Shared Chat partner’s chatters', async () => {
    roomUsers.mockResolvedValue(new Map([['id:71', ['2']]]));
    const { socket } = start();
    socket.onmessage?.({ data: roomState });
    socket.onmessage?.({ data: privmsg('a', '71', 'bot', '100') });
    socket.onmessage?.({ data: privmsg('b', '71', 'bot', '200') });
    await settle();
    const given = resolve.mock.calls.map(([identity]) => identity.ffzRoomBadgeIds);
    /* The partner-room message does not wait for the room, so it may resolve first. */
    expect(given).toHaveLength(2);
    expect(given).toEqual(expect.arrayContaining([['2'], undefined]));
  });

  it('does not hold the other badges for long when FFZ is slow', async () => {
    vi.useFakeTimers();
    roomUsers.mockReturnValue(new Promise(() => { /* never answers */ }));
    const { socket } = start();
    socket.onmessage?.({ data: roomState });
    socket.onmessage?.({ data: privmsg('a', '71', 'bot') });
    await vi.advanceTimersByTimeAsync(1_400);
    expect(resolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0].ffzRoomBadgeIds).toBeUndefined();
  });

  it('works the same when the room answer fails', async () => {
    roomUsers.mockRejectedValue(new Error('down'));
    const { socket } = start();
    socket.onmessage?.({ data: roomState });
    socket.onmessage?.({ data: privmsg('a', '71', 'bot') });
    await settle();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][0].ffzRoomBadgeIds).toBeUndefined();
  });
});
