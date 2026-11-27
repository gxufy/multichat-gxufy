/* Kick refuses our server's channel/history requests (502), but answers the
 * viewer's browser. So the browser asks Kick first and the server proxy is
 * only the backup. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKickChannel } from '@/lib/kick';
import { fetchKickHistory } from '@/lib/connectors/kick';

const CHANNEL = {
  id: 5417122,
  user_id: 1,
  slug: 'deenthegreat',
  chatroom: { id: 5389830 },
  subscriber_badges: [],
  user: { id: 1, username: 'DeenTheGreat' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('Kick lookups: browser first, server backup', () => {
  it('asks kick.com directly first and stops there when it answers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => json(CHANNEL));
    vi.stubGlobal('fetch', fetchMock);
    const channel = await getKickChannel('deenthegreat');
    expect(channel?.chatroom.id).toBe(5389830);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://kick.com/api/v2/channels/deenthegreat',
    ]);
  });

  it('falls back to the server proxy when the browser cannot reach Kick', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => (
      String(input).startsWith('https://kick.com/') ? Promise.reject(new TypeError('Failed to fetch')) : json(CHANNEL)
    ));
    vi.stubGlobal('fetch', fetchMock);
    const channel = await getKickChannel('deenthegreat');
    expect(channel?.id).toBe(5417122);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://kick.com/api/v2/channels/deenthegreat',
      '/api/kick/channel?channel=deenthegreat',
    ]);
  });

  it('history: kick.com first, then the server', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return String(input).startsWith('https://kick.com/') ? json({}, 403) : json({ data: { messages: [] } });
    }));
    await fetchKickHistory(CHANNEL as never);
    expect(urls).toEqual([
      'https://kick.com/api/v2/channels/5417122/messages',
      '/api/kick/history?channelId=5417122',
    ]);
  });
});
