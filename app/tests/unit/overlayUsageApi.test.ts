import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/overlay/usage';
import {
  deliverOverlayUsage,
  formatOverlayUsageDiscordContent,
  parseOverlayUsagePayload,
  resetOverlayUsageDeliveryForTests,
  type OverlayUsagePayload,
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

const validPayload: OverlayUsagePayload = {
  eventId: '11111111-1111-4111-8111-111111111111',
  overlay: 'multichat',
  action: 'opened',
  instanceId: 'aabbccdd',
  channels: [
    { platform: 'twitch', channel: '@GXUFY' },
    { platform: 'youtube', channel: '@Agent00' },
  ],
};

const refreshedPayload: OverlayUsagePayload = {
  ...validPayload,
  eventId: '22222222-2222-4222-8222-222222222222',
  action: 'refreshed',
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

  it('strictly validates event, action, overlay shape, platforms, uniqueness, and bounds', async () => {
    const invalidPayloads = [
      null,
      {},
      { overlay: 'other', channels: validPayload.channels },
      { ...validPayload, eventId: 'not-a-uuid' },
      { ...validPayload, action: 'started' },
      { ...validPayload, instanceId: 'too-long-instance' },
      { ...validPayload, token: 'sensitive' },
      { ...validPayload, channels: [] },
      { ...validPayload, channels: [{ platform: 'discord', channel: 'gxufy' }] },
      { ...validPayload, channels: [{ platform: 'twitch', channel: 'a'.repeat(26) }] },
      { ...validPayload, channels: [{ platform: 'twitch', channel: 'gxufy', cookie: 'secret' }] },
      { ...validPayload, channels: [
        { platform: 'twitch', channel: 'one' },
        { platform: 'twitch', channel: 'two' },
      ] },
      { ...validPayload, combined: true },
      { ...validPayload, overlay: 'counter' },
      { ...validPayload, overlay: 'counter', combined: 'true' },
    ];

    for (const payload of invalidPayloads) {
      const response = await invoke('POST', payload);
      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid request.' });
    }
  });

  it('normalizes provider-safe values without retaining arbitrary fields', () => {
    expect(parseOverlayUsagePayload(validPayload)).toEqual({
      eventId: validPayload.eventId,
      overlay: 'multichat',
      action: 'opened',
      instanceId: 'aabbccdd',
      channels: [
        { platform: 'twitch', channel: 'GXUFY' },
        { platform: 'youtube', channel: 'Agent00' },
      ],
    });
  });

  it('formats the approved MultiChat and counter Discord messages', () => {
    expect(formatOverlayUsageDiscordContent({
      ...refreshedPayload,
      channels: [
        { platform: 'twitch', channel: 'GXUFY' },
        { platform: 'youtube', channel: 'Agent00' },
      ],
    })).toBe([
      '🟣 GXUFY MultiChat refreshed',
      'Twitch: GXUFY',
      'YouTube: Agent00',
      'Instance: aabbccdd',
    ].join('\n'));

    expect(formatOverlayUsageDiscordContent({
      eventId: '33333333-3333-4333-8333-333333333333',
      overlay: 'counter',
      action: 'opened',
      channels: [{ platform: 'kick', channel: 'gxufy' }],
      combined: true,
      instanceId: '11223344',
    })).toBe([
      '👁 GXUFY Viewer Counter opened',
      'Kick: gxufy',
      'Mode: Combined',
      'Instance: 11223344',
    ].join('\n'));
  });

  it('is a harmless no-op when the private webhook environment variable is absent', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outbound = vi.spyOn(globalThis, 'fetch');
    const response = await invoke('POST', validPayload);
    expect(response.statusCode).toBe(204);
    expect(response.ended).toBe(true);
    expect(outbound).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('Discord overlay-usage delivery is not configured.');
  });

  it('distinguishes unconfigured delivery without leaking malformed credentials', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outbound = vi.fn();
    const malformed = 'https://discord.com/api/webhooks/private-id/private-token#fragment';
    expect(await deliverOverlayUsage(validPayload, { webhookUrl: malformed, fetch: outbound })).toBe('unconfigured');
    expect(await deliverOverlayUsage(validPayload, { webhookUrl: '', fetch: outbound })).toBe('unconfigured');
    expect(outbound).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-token');
  });

  it('dedupes only the same event id and delivers a new refresh with identical channels', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/test-id/test-token';
    const success = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deliverOverlayUsage(validPayload, { webhookUrl, fetch: success, now: 10_000 })).toBe('delivered');
    expect(await deliverOverlayUsage(validPayload, { webhookUrl, fetch: success, now: 10_001 })).toBe('deduped');
    expect(await deliverOverlayUsage(refreshedPayload, { webhookUrl, fetch: success, now: 10_002 })).toBe('delivered');
    expect(success).toHaveBeenCalledTimes(2);
  });

  it('keeps the global delivery limiter bounded while allowing distinct page events', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/test-id/test-token';
    const success = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    for (let index = 0; index < 31; index += 1) {
      const eventId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      const result = await deliverOverlayUsage(
        { ...validPayload, eventId },
        { webhookUrl, fetch: success, now: 20_000 + index },
      );
      expect(result).toBe(index < 30 ? 'delivered' : 'deduped');
    }
    expect(success).toHaveBeenCalledTimes(30);
  });

  it('returns failed without exposing network errors, response bodies, or webhook credentials', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const webhookUrl = 'https://discord.com/api/webhooks/test-id/test-token';
    const rejectedToken = 'never-print-this-token';
    const rejected = vi.fn().mockRejectedValue(new Error(rejectedToken));
    expect(await deliverOverlayUsage(validPayload, { webhookUrl, fetch: rejected })).toBe('failed');
    expect(error).toHaveBeenLastCalledWith('Discord overlay-usage delivery failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain(rejectedToken);

    resetOverlayUsageDeliveryForTests();
    const nonSuccess = vi.fn().mockResolvedValue(new Response('private response body', { status: 503 }));
    expect(await deliverOverlayUsage(validPayload, { webhookUrl, fetch: nonSuccess })).toBe('failed');
    expect(JSON.stringify(error.mock.calls)).not.toContain('private response body');
    expect(JSON.stringify(error.mock.calls)).not.toContain('test-token');
  });

  it.each([404, 410, 429])('treats Discord status %s as non-fatal without retrying', async (status) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const webhookUrl = 'https://discord.com/api/webhooks/test-id/test-token';
    const failed = vi.fn().mockResolvedValue(new Response('private details', { status }));
    expect(await deliverOverlayUsage(validPayload, { webhookUrl, fetch: failed, now: 30_000 + status }))
      .toBe('failed');
    expect(failed).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Discord overlay-usage delivery failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain('private details');
  });

  it('posts sanitized content with Discord mentions disabled', async () => {
    vi.stubEnv(
      'GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL',
      'https://discord.com/api/webhooks/test-id/test-token',
    );
    const outbound = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const response = await invoke('POST', {
      ...validPayload,
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
        '🟣 GXUFY MultiChat opened',
        'Twitch: everyone',
        'Kick: kick-streamer',
        'TikTok: tiktok',
        'Instance: aabbccdd',
      ].join('\n'),
      allowed_mentions: { parse: [] },
    });
    expect(discordBody.content).not.toContain('@everyone');
  });
});
