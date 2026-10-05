import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTwitchConnector } from '@/lib/connectors/twitch';

class FakeSocket {
  static created: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { FakeSocket.created.push(this); }
  send(value: string) { this.sent.push(value); }
  close() {}
}

beforeEach(() => {
  FakeSocket.created = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
});

afterEach(() => vi.unstubAllGlobals());

describe('Twitch connector provider boundary', () => {
  it('normalizes #/@ prefixes before the IRC JOIN', () => {
    const connector = createTwitchConnector({
      channel: '#Some_User',
      onMessage: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), onStatus: vi.fn(),
    });
    connector.start();
    const socket = FakeSocket.created[0];
    socket.onopen?.();
    expect(socket.sent).toContain('JOIN #some_user');
    connector.stop();
  });

  it('rejects control-character injection before badge fetch or WebSocket creation', () => {
    const onStatus = vi.fn();
    const connector = createTwitchConnector({
      channel: 'safe\r\nJOIN #other',
      onMessage: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), onStatus,
    });
    connector.start();
    expect(onStatus).toHaveBeenCalledWith('error', 'Invalid Twitch channel');
    expect(fetch).not.toHaveBeenCalled();
    expect(FakeSocket.created).toHaveLength(0);
    connector.stop();
  });
});
