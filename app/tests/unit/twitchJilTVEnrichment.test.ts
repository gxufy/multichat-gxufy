// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchConnector } from '@/lib/connectors/twitch';
import { __resetJilTVCosmeticsClientForTests } from '@/lib/jiltvCosmetics';
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

const PAINT = { id: 'p1', name: 'Molten Gold', texture: 'https://cdn.jiltv.app/paints/gold.webp', shadows: [] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeSocket.last = null;
  __resetJilTVCosmeticsClientForTests();
  vi.stubGlobal('WebSocket', FakeSocket);
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/jiltv/cosmetics')) {
      return new Response(JSON.stringify({ paints: { jilence: PAINT } }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const LINE = '@badges=;display-name=Jilence;id=j1;user-id=438697907 :jilence!j@j PRIVMSG #streamer :hi';

function connect(jiltvCosmetics?: boolean) {
  const seen: UnifiedMessage[] = [];
  const updates: UnifiedMessage[] = [];
  const connector = createTwitchConnector({
    channel: 'streamer',
    onMessage: (message) => seen.push(message),
    onMessageUpdate: (message) => updates.push(message),
    onDelete: vi.fn(),
    onStatus: vi.fn(),
    ...(jiltvCosmetics === undefined ? {} : { jiltvCosmetics }),
  });
  connector.start();
  FakeSocket.last!.onopen?.();
  FakeSocket.last!.onmessage?.({ data: `${LINE}\r\n` });
  return { connector, seen, updates };
}

const jiltvCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/jiltv/'));

describe('Twitch connector and JilTV cosmetics', () => {
  it('never asks for JilTV cosmetics with the default (off) gate', async () => {
    const { connector, seen } = connect();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(jiltvCalls()).toHaveLength(0);
    connector.stop();
  });

  it('adds the paint the chatter wears in this channel to the shown message when the gate is on', async () => {
    const { connector, seen, updates } = connect(true);
    expect(seen[0]!.jiltvPaint).toBeUndefined();
    await vi.waitFor(() => expect(updates.some((m) => m.jiltvPaint)).toBe(true));
    const latest = [...updates].reverse().find((m) => m.jiltvPaint)!;
    expect(latest.jiltvPaint).toMatchObject({ id: 'p1', texture: PAINT.texture });
    expect(latest.badges.some((badge) => badge.type.includes('jiltv'))).toBe(false);
    expect(jiltvCalls()).toHaveLength(1);
    expect(String(jiltvCalls()[0]![0])).toBe('/api/jiltv/cosmetics?logins=jilence&channel=streamer');
    connector.stop();
  });
});
