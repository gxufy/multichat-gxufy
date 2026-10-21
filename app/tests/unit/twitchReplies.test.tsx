import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { createTwitchConnector, formatTwitchVisibleUsername } from '@/lib/connectors/twitch';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { buildParsedMessage, type MessageCosmetics } from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

vi.mock('@/lib/twitchProfileClient', () => ({ fetchTwitchProfile: vi.fn(async () => null) }));
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

const REPLY_EMOTE_COSMETICS: MessageCosmetics = {
  ...NO_COSMETICS,
  emotes: {
    ...NO_COSMETICS.emotes,
    twitch: [{
      name: 'GOOSE',
      image: 'https://cdn.example/goose.webp',
      height: 32,
      width: 32,
      zeroWidth: false,
      upscale: false,
    }],
  },
};

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function receiveMany(lines: readonly string[]): UnifiedMessage[] {
  const messages: UnifiedMessage[] = [];
  const connector = createTwitchConnector({
    channel: 'local',
    onMessage: message => messages.push(message),
    onDelete: vi.fn(),
    onStatus: vi.fn(),
    shouldEnrichSourceChannel: () => false,
  });
  connector.start();
  for (const line of lines) {
    FakeSocket.last.onmessage?.({ data: `${line}\r\n` });
  }
  connector.stop();
  return messages;
}

function receive(line: string): UnifiedMessage {
  const messages = receiveMany([line]);
  expect(messages).toHaveLength(1);
  return messages[0]!;
}

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

describe('Twitch native replies', () => {
  it('normalizes Twitch reply-parent tags into the same reply model Kick renders', () => {
    const message = receive(
      '@display-name=ReplyGuy;id=child;room-id=100;user-id=9;reply-parent-msg-id=parent;reply-parent-user-id=42;reply-parent-user-login=parentlogin;reply-parent-display-name=ParentUser;reply-parent-msg-body=hello\\sworld :reply!r@r PRIVMSG #local :my reply',
    );
    expect(message.reply).toEqual({
      username: 'ParentUser',
      text: 'hello world',
      messageId: 'parent',
      senderId: '42',
    });
    expect(message.senderId).toBe('9');
    expect(message.senderUsername).toBe('reply');
    expect(message.senderDisplayName).toBe('ReplyGuy');
    expect(message.username).toBe('reply (ReplyGuy)');
  });

  it('renders community emotes inside the full reply preview', () => {
    const raw = receive(
      '@display-name=ReplyGuy;id=child-emote;room-id=100;user-id=9;reply-parent-msg-id=parent-emote;reply-parent-user-id=42;reply-parent-display-name=ParentUser;reply-parent-msg-body=GOOSE :reply!r@r PRIVMSG #local :answer',
    );
    const config = MultichatQuerySchema.parse({
      twitch: 'local',
      animation: 'none',
    });
    const parsed = buildParsedMessage(
      raw,
      config,
      REPLY_EMOTE_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );
    const { container } = render(
      <ChatOverlay
        config={config}
        messages={[parsed]}
        fadingIds={new Set()}
        showLoader={false}
      />,
    );

    const emote = container.querySelector(
      'img.ck-emote[alt="GOOSE"]',
    ) as HTMLImageElement | null;

    expect(emote).toBeTruthy();
    expect(emote?.src).toContain('cdn.example/goose.webp');
  });

  it('reuses native Twitch emotes when the replied-to parent was observed', () => {
    const messages = receiveMany([
      '@display-name=Parent;emotes=25:0-4;id=parent-native;room-id=100;user-id=42 :parent!p@p PRIVMSG #local :Kappa',
      '@display-name=ReplyGuy;id=child-native;room-id=100;user-id=9;reply-parent-msg-id=parent-native;reply-parent-user-id=42;reply-parent-display-name=Parent;reply-parent-msg-body=Kappa :reply!r@r PRIVMSG #local :answer',
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[1]!.reply?.emotes).toEqual(
      messages[0]!.emotes,
    );

    const config = MultichatQuerySchema.parse({
      twitch: 'local',
      animation: 'none',
    });
    const parsed = buildParsedMessage(
      messages[1]!,
      config,
      NO_COSMETICS,
      { enabled: true, colors: new Map() },
      1,
    );
    const { container } = render(
      <ChatOverlay
        config={config}
        messages={[parsed]}
        fadingIds={new Set()}
        showLoader={false}
      />,
    );

    const emote = container.querySelector(
      'img.ck-emote[alt="Kappa"]',
    ) as HTMLImageElement | null;

    expect(emote).toBeTruthy();
    expect(emote?.src).toContain('/emoticons/v2/25/');
  });
  it('leaves ordinary Twitch chat without a reply preview', () => {
    const message = receive(
      '@display-name=Plain;id=plain;room-id=100;user-id=9 :plain!p@p PRIVMSG #local :hello',
    );
    expect(message.reply).toBeUndefined();
  });

  it('uses the existing universal Kick-style reply renderer for Twitch', () => {
    const raw = receive(
      '@display-name=ReplyGuy;id=child2;room-id=100;user-id=9;reply-parent-msg-id=parent2;reply-parent-user-id=42;reply-parent-display-name=ParentUser;reply-parent-msg-body=quoted\\smessage :reply!r@r PRIVMSG #local :answer',
    );
    const config = MultichatQuerySchema.parse({ twitch: 'local', animation: 'none' });
    const parsed = buildParsedMessage(raw, config, NO_COSMETICS, { enabled: true, colors: new Map() }, 1);
    const { container } = render(
      <ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()}
 showLoader={false} />,
    );
    expect(container.textContent).toContain('ParentUser quoted message');
    expect(screen.getByText('answer')).toBeTruthy();
  });
});
