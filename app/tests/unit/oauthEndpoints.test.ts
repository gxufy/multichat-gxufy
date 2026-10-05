/* OAuth start and callback — cookie binding, state, and redirect safety.
 *
 * The Twitch helpers are mocked because none of what is being tested involves
 * Twitch: the questions are which destination the browser is sent to, whether the
 * temporary cookies are cleared on every exit path, and whether an attacker who
 * controls the callback URL or the cookie can move the redirect off-site.
 *
 * The token exchange, token validation, profile cross-check, and encrypted
 * storage are left exactly as they were and are asserted only to still be called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const exchange = vi.fn();
const validate = vi.fn();
const profile = vi.fn();
const save = vi.fn();

vi.mock('@/lib/server/twitchOAuth', () => ({
  exchangeTwitchAuthorizationCode: (...a: unknown[]) => exchange(...a),
}));
vi.mock('@/lib/server/twitchTokenValidation', () => ({
  validateTwitchAccessToken: (...a: unknown[]) => validate(...a),
}));
vi.mock('@/lib/server/twitchUserProfile', () => ({
  getTwitchUserProfile: (...a: unknown[]) => profile(...a),
}));
vi.mock('@/lib/server/twitchConnectionStore', () => ({
  saveTwitchConnection: (...a: unknown[]) => save(...a),
}));

/* Imported through vi.mock's hoisting, so the mocks above are in place first.
   Static imports would be evaluated before the mock factories register. */
import startHandler from '@/pages/api/twitch/oauth/start';
import callbackHandler from '@/pages/api/twitch/oauth/callback';

/** A recording response double exposing only what these routes use. */
function makeRes() {
  const headers: Record<string, string | string[]> = {};
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    redirectedTo: undefined as string | undefined,
    setHeader(k: string, v: string | string[]) {
      headers[k] = v;
    },
    getHeader(k: string) {
      return headers[k];
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    redirect(code: number, location: string) {
      res.statusCode = code;
      res.redirectedTo = location;
      return res;
    },
  };
  return res;
}

const req = (over: Partial<NextApiRequest> = {}) =>
  ({ method: 'GET', query: {}, headers: {}, ...over }) as unknown as NextApiRequest;

const run = (h: typeof startHandler, r: NextApiRequest) => {
  const res = makeRes();
  h(r, res as unknown as NextApiResponse);
  return res;
};

const cookies = (res: ReturnType<typeof makeRes>) => {
  const v = res.getHeader('Set-Cookie');
  return Array.isArray(v) ? v : v === undefined ? [] : [v];
};

const cookieNamed = (res: ReturnType<typeof makeRes>, name: string) =>
  cookies(res).find((c) => c.startsWith(`${name}=`));

/* The bound destination, decoded. Asserted by equality rather than substring
   because `%2Fmultichat` is a substring of `%2Ftools%2Fmultichat` — a containment
   check would pass for the retired path when the canonical one was expected. */
const boundReturn = (res: ReturnType<typeof makeRes>) =>
  decodeURIComponent(cookieNamed(res, 'twitch_oauth_return')!.split(';')[0].split('=')[1]);

/** The state value the start route just issued. */
const issuedState = (res: ReturnType<typeof makeRes>) =>
  cookieNamed(res, 'twitch_oauth_state')!.split(';')[0].split('=')[1];

beforeEach(() => {
  /* The whole configuration contract, because the start route now refuses on any
     absent key rather than only the two it dereferences — a deployment missing the
     encryption key or the Supabase credentials would otherwise take a user's
     consent and fail on the way back. REQUIRED_TWITCH_OAUTH_ENV owns the list. */
  process.env.TWITCH_CLIENT_ID = 'test-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
  process.env.TWITCH_REDIRECT_URI = 'https://example.com/api/twitch/oauth/callback';
  process.env.TWITCH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'test-service-role-key';
  exchange.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  validate.mockResolvedValue({
    userId: '1',
    login: 'streamer',
    expiresIn: 3600,
    scopes: ['moderator:read:chat_messages'],
  });
  profile.mockResolvedValue({ userId: '1', login: 'streamer', displayName: 'Streamer' });
  save.mockResolvedValue({ connectionId: '11111111-2222-4333-8444-555555555555' });
});

describe('start — destination binding', () => {
  it('issues both cookies, HttpOnly and scoped to the oauth path', () => {
    const res = run(startHandler, req());
    expect(cookies(res)).toHaveLength(2);
    for (const c of cookies(res)) {
      expect(c).toContain('HttpOnly');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/api/twitch/oauth');
    }
  });

  it('stores the canonical generator destination', () => {
    const res = run(startHandler, req({ query: { returnTo: '/multichat' } }));
    expect(boundReturn(res)).toBe('/multichat');
  });

  /* The two retired paths stay allowlisted so an authorization begun against the
     old code still completes; each of those pages forwards the fragment on. */
  it.each(['/classic/multichat', '/tools/multichat'])(
    'stores the retired destination %s when it is the one asked for',
    (retired) => {
      const res = run(startHandler, req({ query: { returnTo: retired } }));
      expect(boundReturn(res)).toBe(retired);
    },
  );

  it('falls back to the canonical generator when no destination is requested', () => {
    const res = run(startHandler, req());
    expect(boundReturn(res)).toBe('/multichat');
  });

  it.each([
    'https://evil.example.com',
    '//evil.example.com',
    '%2F%2Fevil.example.com',
    '/multichat?x=1',
    '/multichat#viewer-counter',
    '/api/twitch/oauth/start',
    'javascript:alert(1)',
  ])('refuses %s and stores the default instead', (candidate) => {
    const res = run(startHandler, req({ query: { returnTo: candidate } }));
    expect(boundReturn(res)).toBe('/multichat');
    expect(cookieNamed(res, 'twitch_oauth_return')).not.toContain('evil.example.com');
  });

  it('refuses a repeated returnTo parameter', () => {
    const res = run(
      startHandler,
      req({ query: { returnTo: ['/classic/multichat', '/multichat'] } }),
    );
    expect(boundReturn(res)).toBe('/multichat');
  });

  it('never reflects the requested destination into the Twitch redirect', () => {
    const res = run(startHandler, req({ query: { returnTo: 'https://evil.example.com' } }));
    expect(res.redirectedTo).toContain('https://id.twitch.tv/oauth2/authorize');
    expect(res.redirectedTo).not.toContain('evil.example.com');
    expect(res.redirectedTo).not.toContain('returnTo');
  });

  it('keeps a cryptographically sized random state, fresh per request', () => {
    const a = issuedState(run(startHandler, req()));
    const b = issuedState(run(startHandler, req()));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('still sends state to Twitch and never the client secret', () => {
    const res = run(startHandler, req());
    const url = new URL(res.redirectedTo!);
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'moderator:read:chat_messages',
      'moderation:read',
      'channel:read:vips',
      'channel:read:subscriptions',
    ]);
    expect(res.redirectedTo).not.toContain('client_secret');
  });

  it('rejects non-GET', () => {
    const res = run(startHandler, req({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
  });

  it('reports misconfiguration without naming the missing variable value', () => {
    /* Silenced rather than left to print: the route now logs the absent key
       names deliberately, and oauthConfig.test.ts is what asserts that log's
       contents. Here it would only be noise on a passing run. */
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.TWITCH_CLIENT_ID;
    const res = run(startHandler, req());
    expect(res.statusCode).toBe(500);
    /* A stable machine-readable code, so support can be told to look for exactly
       this string rather than for prose that may be reworded. */
    expect(res.body).toEqual({ error: 'oauth_not_configured' });
    expect(JSON.stringify(res.body)).not.toContain('test-client-id');
    logged.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
/* Callback                                                            */
/* ------------------------------------------------------------------ */

const STATE = 'a'.repeat(64);

/** A callback request whose state matches its cookie. */
const cbReq = (returnCookie?: string, over: Partial<NextApiRequest> = {}) =>
  req({
    query: { code: 'auth-code', state: STATE },
    headers: {
      cookie: [
        `twitch_oauth_state=${STATE}`,
        returnCookie === undefined
          ? null
          : `twitch_oauth_return=${encodeURIComponent(returnCookie)}`,
      ]
        .filter(Boolean)
        .join('; '),
    },
    ...over,
  });

const runCb = async (r: NextApiRequest) => {
  const res = makeRes();
  await callbackHandler(r, res as unknown as NextApiResponse);
  return res;
};

describe('callback — redirect destination', () => {
  it('returns to the canonical generator when that was bound at start', async () => {
    const res = await runCb(cbReq('/multichat'));
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo!.startsWith('/multichat#')).toBe(true);
  });

  it.each(['/classic/multichat', '/tools/multichat'])(
    'returns to the retired route %s when that was bound at start',
    async (retired) => {
      const res = await runCb(cbReq(retired));
      expect(res.redirectedTo!.startsWith(`${retired}#`)).toBe(true);
    },
  );

  it('falls back to the canonical generator when the return cookie is absent', async () => {
    const res = await runCb(cbReq(undefined));
    expect(res.redirectedTo!.startsWith('/multichat#')).toBe(true);
  });

  it.each([
    'https://evil.example.com',
    '//evil.example.com',
    '/multichat?x=1',
    '/multichat#viewer-counter',
    'javascript:alert(1)',
    '',
  ])('revalidates a tampered return cookie (%s) to the default', async (tampered) => {
    const res = await runCb(cbReq(tampered));
    expect(res.redirectedTo!.startsWith('/multichat#')).toBe(true);
    /* The default is a bare path plus one fragment, so a tampered destination
       cannot have survived as a second `#` or a query. */
    expect(res.redirectedTo!.split('#')).toHaveLength(2);
    expect(res.redirectedTo).not.toContain('?');
    expect(res.redirectedTo).not.toContain('evil.example.com');
  });

  it('ignores a returnTo in the callback query string entirely', async () => {
    const res = await runCb(
      cbReq('/multichat', {
        query: {
          code: 'auth-code',
          state: STATE,
          returnTo: 'https://evil.example.com',
        },
      }),
    );
    expect(res.redirectedTo!.startsWith('/multichat#')).toBe(true);
    expect(res.redirectedTo).not.toContain('evil.example.com');
  });

  it('recovers from a malformed percent-encoded return cookie', async () => {
    const res = await runCb(
      req({
        query: { code: 'auth-code', state: STATE },
        headers: {
          cookie: `twitch_oauth_state=${STATE}; twitch_oauth_return=%E0%A4%A`,
        },
      }),
    );
    expect(res.redirectedTo!.startsWith('/multichat#')).toBe(true);
  });

  it('puts the connection id in the fragment, never the query', async () => {
    const res = await runCb(cbReq('/multichat'));
    const [path, fragment] = res.redirectedTo!.split('#');
    expect(path).not.toContain('twitchConnectionId');
    expect(path).not.toContain('?');
    expect(fragment).toContain('twitchConnectionId=');
    expect(fragment).toContain('twitch=streamer');
    expect(res.redirectedTo!.split('#')).toHaveLength(2);
  });
});

describe('callback — state and cookie hygiene', () => {
  it('clears both cookies on success', async () => {
    const res = await runCb(cbReq('/multichat'));
    expect(cookies(res)).toHaveLength(2);
    for (const c of cookies(res)) expect(c).toContain('Max-Age=0');
  });

  it('clears both cookies on a state mismatch', async () => {
    const res = await runCb(
      req({
        query: { code: 'c', state: 'b'.repeat(64) },
        headers: { cookie: `twitch_oauth_state=${STATE}` },
      }),
    );
    expect(res.statusCode).toBe(400);
    for (const c of cookies(res)) expect(c).toContain('Max-Age=0');
  });

  it('refuses a state of matching length but different value', async () => {
    const res = await runCb(
      req({
        query: { code: 'c', state: 'a'.repeat(63) + 'b' },
        headers: { cookie: `twitch_oauth_state=${STATE}` },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.redirectedTo).toBeUndefined();
  });

  it('refuses when the state cookie is missing entirely', async () => {
    const res = await runCb(req({ query: { code: 'c', state: STATE }, headers: {} }));
    expect(res.statusCode).toBe(400);
  });

  it('refuses when only the return cookie is present', async () => {
    const res = await runCb(
      req({
        query: { code: 'c', state: STATE },
        headers: { cookie: 'twitch_oauth_return=%2Ftools%2Fmultichat' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.redirectedTo).toBeUndefined();
  });

  it('reads the state cookie regardless of ordering', async () => {
    const res = await runCb(
      req({
        query: { code: 'c', state: STATE },
        headers: {
          cookie: `other=1; twitch_oauth_return=%2Fmultichat; twitch_oauth_state=${STATE}`,
        },
      }),
    );
    expect(res.redirectedTo!.startsWith('/multichat#')).toBe(true);
  });

  it('refuses a repeated state or code parameter', async () => {
    for (const query of [
      { code: 'c', state: [STATE, STATE] },
      { code: ['c', 'c'], state: STATE },
    ]) {
      const res = await runCb(
        req({ query, headers: { cookie: `twitch_oauth_state=${STATE}` } }),
      );
      expect(res.statusCode).toBe(400);
    }
  });

  it('refuses a provider error without exposing its description', async () => {
    const res = await runCb(
      req({
        query: { error: 'access_denied', error_description: 'user said no', state: STATE },
        headers: { cookie: `twitch_oauth_state=${STATE}` },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('user said no');
    expect(JSON.stringify(res.body)).not.toContain('access_denied');
  });

  it('never exposes the code, state, or connection id in an error body', async () => {
    exchange.mockRejectedValue(new Error('boom'));
    const res = await runCb(cbReq('/multichat'));
    expect(res.statusCode).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('auth-code');
    expect(body).not.toContain(STATE);
    expect(body).toContain('Twitch connection failed.');
  });

  it('marks every response uncacheable', async () => {
    const res = await runCb(cbReq('/multichat'));
    expect(res.getHeader('Cache-Control')).toBe('no-store');
  });

  it('rejects non-GET', async () => {
    const res = await runCb(req({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
  });
});

describe('callback — existing Twitch verification is untouched', () => {
  it('still exchanges, validates, fetches the profile, and stores', async () => {
    await runCb(cbReq('/multichat'));
    expect(exchange).toHaveBeenCalledWith('auth-code');
    expect(validate).toHaveBeenCalledWith('a');
    expect(profile).toHaveBeenCalledWith('a', '1');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('still refuses when the profile user id disagrees with validation', async () => {
    profile.mockResolvedValue({ userId: '2', login: 'streamer', displayName: 'S' });
    const res = await runCb(cbReq('/multichat'));
    expect(res.statusCode).toBe(500);
    expect(save).not.toHaveBeenCalled();
  });

  it('still refuses when the profile login disagrees with validation', async () => {
    profile.mockResolvedValue({ userId: '1', login: 'someone-else', displayName: 'S' });
    const res = await runCb(cbReq('/multichat'));
    expect(res.statusCode).toBe(500);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not redirect when storage fails', async () => {
    save.mockRejectedValue(new Error('db down'));
    const res = await runCb(cbReq('/multichat'));
    expect(res.statusCode).toBe(500);
    expect(res.redirectedTo).toBeUndefined();
  });
});
