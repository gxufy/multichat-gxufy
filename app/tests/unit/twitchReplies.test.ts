import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { formatTwitchVisibleUsername } from '@/lib/connectors/twitch';

vi.mock('@/lib/twitchProfileClient', () => ({ fetchTwitchProfile: vi.fn(async () => null) }));

vi.mock('@/lib/twitchEmotes', () => ({ loadFFZRoomBadges: vi.fn(async () => ({})), loadFFZRoomUserBadges: vi.fn(async () => new Map()) }));

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
});

describe('Twitch visible username formatting', () => {
  it.each([
    ['someuser', 'SomeUser', 'SomeUser'],
    ['ordinary', 'ordinary', 'ordinary'],
    ['ascii_login', '表示名', 'ascii_login (表示名)'],
    ['login', '', 'login (Unknown)'],
    ['', 'Display', 'Unknown (Display)'],
    ['', '', 'Unknown'],
  ])('formats login %j and display name %j as %j', (login, displayName, expected) => {
    expect(formatTwitchVisibleUsername(login, displayName)).toBe(expected);
  });
});
