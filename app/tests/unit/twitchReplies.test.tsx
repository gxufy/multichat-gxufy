import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { createTwitchConnector } from '@/lib/connectors/twitch';
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

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function receive(line: string): UnifiedMessage {
  const messages: UnifiedMessage[] = [];
  const connector = createTwitchConnector({
    channel: 'local',
    onMessage: message => messages.push(message),
    onDelete: vi.fn(),
    onPin: vi.fn(),
    onStatus: vi.fn(),
    shouldEnrichSourceChannel: () => false,
  });
  connector.start();
  FakeSocket.last.onmessage?.({ data: `${line}\r\n` });
  expect(messages).toHaveLength(1);
  connector.stop();
  return messages[0];
}

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
    expect(message.username).toBe('ReplyGuy');
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
    render(
      <ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()}
        pinnedMessage={null} showLoader={false} />,
    );
    expect(screen.getByText('ParentUser').parentElement?.textContent).toContain('quoted message');
    expect(screen.getByText('answer')).toBeTruthy();
  });
});
