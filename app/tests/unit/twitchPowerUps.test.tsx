// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { TWITCH_CHANNEL_POINTS_LABEL, createTwitchConnector, twitchMessageEffectLabel } from '@/lib/connectors/twitch';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { buildMessageFilter, buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(value: string) { this.sent.push(value); }
  close() {}
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function receive(line: string): UnifiedMessage {
  const seen: UnifiedMessage[] = [];
  const connector = createTwitchConnector({
    channel: 'streamer',
    onMessage: (message) => seen.push(message),
    onDelete: vi.fn(),
    onStatus: vi.fn(),
  });
  connector.start();
  FakeSocket.last!.onopen?.();
  FakeSocket.last!.onmessage?.({ data: `${line}\r\n` });
  connector.stop();
  expect(seen).toHaveLength(1);
  return seen[0]!;
}

describe('Twitch Bits power-ups', () => {
  it('marks a "Gigantify an Emote" message', () => {
    const message = receive('@badges=;display-name=Viewer;emotes=25:4-8;id=g1;msg-id=gigantified-emote-message;user-id=u1 :viewer!v@v PRIVMSG #streamer :wow Kappa');
    expect(message.gigantifiedEmote).toBe(true);
    expect(message.kind).toBe('chat');
  });

  it('ignores the gigantify tag when the message has no emote', () => {
    const message = receive('@badges=;display-name=Viewer;id=g2;msg-id=gigantified-emote-message;user-id=u1 :viewer!v@v PRIVMSG #streamer :no emote');
    expect(message.gigantifiedEmote).toBeUndefined();
  });

  it('shows a message effect like a highlighted message with its name', () => {
    const message = receive('@animation-id=rainbow-eclipse;badges=;display-name=Viewer;id=a1;msg-id=animated-message;user-id=u1 :viewer!v@v PRIVMSG #streamer :hello');
    expect(message.redeem).toBe('Message effect: Rainbow Eclipse');
    expect(twitchMessageEffectLabel(undefined)).toBe('Message effect');
    expect(twitchMessageEffectLabel('<script>')).toBe('Message effect');
  });

  it('labels a channel-points reward "Channel Points", never its raw reward id', () => {
    const rewardId = '8c4876ec-43c4-4f9f-86d8-9c0a95c922a5';
    const message = receive(`@badges=;custom-reward-id=${rewardId};display-name=Viewer;id=r1;user-id=u1 :viewer!v@v PRIVMSG #streamer :play my song`);
    expect(message.redeem).toBe(TWITCH_CHANNEL_POINTS_LABEL);
    const config = MultichatQuerySchema.parse({ twitch: 'streamer', animation: 'none' });
    const parsed = buildParsedMessage(message, config, NO_COSMETICS, { enabled: true, colors: new Map() }, 1);
    const { container } = render(
      <ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()} showLoader={false} />,
    );
    expect(container.textContent).toContain('Channel Points');
    expect(container.textContent).not.toContain(rewardId);
    expect(container.textContent).toContain('play my song');
  });

  it('keeps "Highlight my message" as a plain highlight', () => {
    const message = receive('@badges=;display-name=Viewer;id=h1;msg-id=highlighted-message;user-id=u1 :viewer!v@v PRIVMSG #streamer :look at me');
    expect(message.redeem).toBe('highlighted');
  });

  it('hides channel-points rewards when redeems are turned off', () => {
    const message = receive('@badges=;custom-reward-id=abc;display-name=Viewer;id=r2;user-id=u1 :viewer!v@v PRIVMSG #streamer :hi');
    const config = MultichatQuerySchema.parse({ twitch: 'streamer', showRedeems: 'false' });
    expect(buildMessageFilter(config)(message)).toBe(false);
  });

  it('renders the gigantified flag on the chat body in the overlay', () => {
    const message = receive('@badges=;display-name=Viewer;emotes=25:4-8;id=g3;msg-id=gigantified-emote-message;user-id=u1 :viewer!v@v PRIVMSG #streamer :wow Kappa');
    const config = MultichatQuerySchema.parse({ twitch: 'streamer', animation: 'none' });
    const parsed = buildParsedMessage(message, config, NO_COSMETICS, { enabled: true, colors: new Map() }, 1);
    expect(parsed.gigantifiedEmote).toBe(true);
    const { container } = render(
      <ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()} showLoader={false} />,
    );
    expect(container.querySelector('.ck-body.ck-gigantified')).not.toBeNull();
  });
});
