import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchConnector } from '@/lib/connectors/twitch';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { buildParsedMessage, type MessageCosmetics } from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

const profile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/twitchProfileClient', () => ({ fetchTwitchProfile: profile }));
vi.mock('@/lib/twitchEmotes', () => ({ loadFFZRoomBadges: vi.fn(async () => ({})) }));

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

const NO_COSMETICS: MessageCosmetics = {
  emotes: { kick: [], twitch: [] },
  badges: [],
  paints: [],
  entitlements: {},
  channel: null,
};

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  profile.mockReset();
  profile.mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function startConnector() {
  const messages: UnifiedMessage[] = [];
  const onMessageUpdate = vi.fn();
  const value = createTwitchConnector({
    channel: 'local',
    onMessage: message => messages.push(message),
    onMessageUpdate,
    onDelete: vi.fn(),
    onPin: vi.fn(),
    onStatus: vi.fn(),
    shouldEnrichSourceChannel: () => true,
  });
  value.start();
  return { value, messages, onMessageUpdate, socket: FakeSocket.last };
}

const irc = (id: string, sourceRoomId?: string, roomId = '100') =>
  `@room-id=${roomId};${sourceRoomId ? `source-room-id=${sourceRoomId};` : ''}display-name=Author;id=${id};user-id=9 :author!a@a PRIVMSG #local :hello\r\n`;

describe('Twitch Shared Chat connector', () => {
  it('retains the local source room and marks only differing partner rooms as Shared Chat', () => {
    const { messages, socket } = startConnector();
    socket.onmessage?.({ data: irc('plain') });
    socket.onmessage?.({ data: irc('same', '100') });
    socket.onmessage?.({ data: irc('shared', '200') });

    expect(messages.map((message) => message.sourceChannel)).toEqual([
      undefined,
      { roomId: '100' },
      { roomId: '200' },
    ]);
    expect(messages.map((message) => message.sharedChat ?? false)).toEqual([false, false, true]);
  });

  it('enriches the configured streamers own source room so its avatar can render', async () => {
    profile.mockResolvedValue({
      roomId: '100',
      displayName: 'Local',
      profileImageUrl: 'https://cdn.example/local.png',
    });
    const { socket, onMessageUpdate } = startConnector();
    socket.onmessage?.({ data: irc('local-avatar', '100') });
    await Promise.resolve();
    await Promise.resolve();
    expect(onMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'local-avatar',
      sourceChannel: expect.objectContaining({
        roomId: '100',
        profileImageUrl: 'https://cdn.example/local.png',
      }),
    }));
  });

  it('delivers immediately and continues PING/later chat while profile lookup is pending', async () => {
    let resolve!: (value: any) => void;
    profile.mockImplementation((roomId: string) =>
      roomId === '200'
        ? new Promise(result => { resolve = result; })
        : Promise.resolve(null),
    );
    const { messages, socket, onMessageUpdate } = startConnector();
    socket.onmessage?.({ data: irc('partner', '200') });
    expect(messages).toHaveLength(1);
    expect(onMessageUpdate).not.toHaveBeenCalled();
    socket.onmessage?.({ data: 'PING :tmi.twitch.tv\r\n' + irc('later') });
    expect(socket.sent).toContain('PONG :tmi.twitch.tv');
    expect(messages.map(message => message.id)).toEqual(['partner', 'later']);
    resolve({ roomId: '200', displayName: 'Partner', profileImageUrl: 'https://cdn.example/avatar.png' });
    await Promise.resolve();
    await Promise.resolve();
    expect(onMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'partner',
      sourceChannel: expect.objectContaining({ displayName: 'Partner' }),
    }));
  });

  it('suppresses an enrichment that resolves after stop', async () => {
    let resolve!: (value: any) => void;
    profile.mockImplementation(() => new Promise(result => { resolve = result; }));
    const { value, socket, onMessageUpdate } = startConnector();
    socket.onmessage?.({ data: irc('partner', '200') });
    value.stop();
    resolve({ roomId: '200', displayName: 'Partner' });
    await Promise.resolve();
    await Promise.resolve();
    expect(onMessageUpdate).not.toHaveBeenCalled();
  });
});

describe('Twitch Shared Chat renderer', () => {
  it('renders the source streamer marker on chat rows', () => {
    const config = MultichatQuerySchema.parse({ twitch: 'local', animation: 'none', sharedChatEnabled: '1' });
    const raw: UnifiedMessage = {
      platform: 'twitch', id: 'm1', senderId: '9', username: 'Author', color: '#fff',
      badges: [], text: 'hello', emotes: [], timestamp: 1, kind: 'chat', sharedChat: true,
      sourceChannel: {
        roomId: '200',
        displayName: 'Partner',
        profileImageUrl: 'https://cdn.example/avatar.png',
      },
    };
    const parsed = buildParsedMessage(raw, config, NO_COSMETICS, { enabled: true, colors: new Map() }, 1);
    const { container } = render(
      <ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()} pinnedMessage={null} showLoader={false} />,
    );
    const source = screen.getByTestId('twitch-shared-source');
    expect(source.textContent).toBe('');
    expect(source.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/avatar.png');
    expect(source.querySelectorAll('img')).toHaveLength(1);
    expect(container.textContent).not.toContain('Partner');
  });

  it('renders no source avatar when Shared Chat is explicitly disabled', () => {
    const config = MultichatQuerySchema.parse({ twitch: 'local', animation: 'none', sharedChatEnabled: 'false' });
    const raw: UnifiedMessage = {
      platform: 'twitch', id: 'm2', senderId: '9', username: 'Author', color: '#fff',
      badges: [], text: 'hello', emotes: [], timestamp: 1, kind: 'chat',
      sourceChannel: { roomId: '200', displayName: 'Partner', profileImageUrl: 'https://cdn.example/avatar.png' },
      sharedChat: true,
    };
    const parsed = buildParsedMessage(raw, config, NO_COSMETICS, { enabled: true, colors: new Map() }, 1);
    render(<ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()} pinnedMessage={null} showLoader={false} />);
    expect(screen.queryByTestId('twitch-shared-source')).toBeNull();
  });
});
