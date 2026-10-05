import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeTwitchAuthorizationCode } from '@/lib/server/twitchOAuth';

const ALL_SCOPES = [
  'moderator:read:chat_messages',
  'moderation:read',
  'channel:read:vips',
  'channel:read:subscriptions',
];

function tokenResponse(scopes: string[]) {
  return {
    ok: true,
    text: async () =>
      JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: scopes,
        token_type: 'bearer',
      }),
  } as Response;
}

beforeEach(() => {
  process.env.TWITCH_CLIENT_ID = 'test-client';
  process.env.TWITCH_CLIENT_SECRET = 'test-secret';
  process.env.TWITCH_REDIRECT_URI = 'https://example.test/oauth/callback';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Twitch OAuth required scopes', () => {
  it('accepts a new authorization carrying all required scopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => tokenResponse(ALL_SCOPES)),
    );

    await expect(
      exchangeTwitchAuthorizationCode('test-code'),
    ).resolves.toMatchObject({
      scopes: ALL_SCOPES,
      tokenType: 'bearer',
    });
  });

  it.each([
    'moderator:read:chat_messages',
    'moderation:read',
    'channel:read:vips',
    'channel:read:subscriptions',
  ])('rejects a new authorization missing %s', async (missing) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        tokenResponse(ALL_SCOPES.filter((scope) => scope !== missing)),
      ),
    );

    await expect(
      exchangeTwitchAuthorizationCode('test-code'),
    ).rejects.toThrow('Twitch authorization failed.');
  });
});