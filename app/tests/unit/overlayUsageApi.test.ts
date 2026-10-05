import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/overlay/usage';
import {
  parseOverlayUsagePayload,
  resetOverlayUsageDeliveryForTests,
} from '@/lib/server/overlayUsage';

class MockResponse {
  statusCode = 200;
  body: unknown;
  ended = false;
  headers = new Map<string, string>();

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.body = value;
    return this;
  }

  end() {
    this.ended = true;
    return this;
  }
}

async function invoke(method: string, body?: unknown): Promise<MockResponse> {
  const req = { method, body } as NextApiRequest;
  const res = new MockResponse();
  await handler(req, res as unknown as NextApiResponse);
  return res;
}

const validPayload = {
  overlay: 'multichat',
  channels: [
    { platform: 'twitch', channel: '@GXUFY' },
    { platform: 'youtube', channel: '@Agent00' },
  ],
};

describe('/api/overlay/usage', () => {
  beforeEach(() => {
    resetOverlayUsageDeliveryForTests();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('rejects unsupported %s requests', async (method) => {
    const response = await invoke(method, validPayload);
    expect(response.statusCode).toBe(405);
    expect(response.body).toEqual({ error: 'Method not allowed.' });
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('strictly validates shape, platform names, uniqueness, and channel bounds', async () => {
    const invalidPayloads = [
      null,
      {},
      { overlay: 'other', channels: validPayload.channels },
      { ...validPayload, token: 'sensitive' },
      { ...validPayload, channels: [] },
      { ...validPayload, channels: [{ platform: 'discord', channel: 'gxufy' }] },
      { ...validPayload, channels: [{ platform: 'twitch', channel: 'a'.repeat(26) }] },
      { ...validPayload, channels: [{ platform: 'twitch', channel: 'gxufy', cookie: 'secret' }] },
      { ...validPayload, channels: [
        { platform: 'twitch', channel: 'one' },
        { platform: 'twitch', channel: 'two' },
      ] },
    ];

    for (const payload of invalidPayloads) {
      const response = await invoke('POST', payload);
      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid request.' });
    }
  });

  it('normalizes provider-safe values without retaining arbitrary fields', () => {
    expect(parseOverlayUsagePayload(validPayload)).toEqual({
      overlay: 'multichat',
      channels: [
        { platform: 'twitch', channel: 'GXUFY' },
        { platform: 'youtube', channel: 'Agent00' },
      ],
    });
  });

  it('is a harmless no-op when the private webhook environment variable is absent', async () => {
    const outbound = vi.spyOn(globalThis, 'fetch');
    const response = await invoke('POST', validPayload);
    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('posts compact sanitized content with Discord mentions disabled', async () => {
    vi.stubEnv(
      'GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL',
      'https://discord.com/api/webhooks/test-id/test-token',
    );
    const outbound = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const response = await invoke('POST', {
      overlay: 'multichat',
      channels: [
        { platform: 'twitch', channel: '@everyone' },
        { platform: 'kick', channel: 'kick-streamer' },
        { platform: 'tiktok', channel: '@tiktok' },
      ],
    });

    expect(response.statusCode).toBe(204);
    expect(outbound).toHaveBeenCalledTimes(1);
    const [url, init] = outbound.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/test-id/test-token');
    const discordBody = JSON.parse(String(init?.body));
    expect(discordBody).toEqual({
      content: [
        'GXUFY MultiChat started',
        'Twitch: everyone',
        'Kick: kick-streamer',
        'TikTok: tiktok',
      ].join('\n'),
      allowed_mentions: { parse: [] },
    });
    expect(discordBody.content).not.toContain('@everyone');
  });

  it('does not expose an upstream failure or webhook credential in its response', async () => {
    const webhook = 'https://discord.com/api/webhooks/private-id/private-token';
    vi.stubEnv('GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL', webhook);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(`failed ${webhook}`));

    const response = await invoke('POST', validPayload);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain('private-token');
  });

  it('dedupes the same normalized set on the server as a second safety layer', async () => {
    vi.stubEnv(
      'GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL',
      'https://discord.com/api/webhooks/test-id/test-token',
    );
    const outbound = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    expect((await invoke('POST', validPayload)).statusCode).toBe(204);
    expect((await invoke('POST', validPayload)).statusCode).toBe(204);
    expect(outbound).toHaveBeenCalledTimes(1);
  });
});
