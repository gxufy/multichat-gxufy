/* The Twitch OAuth configuration contract.
 *
 * Two things are being protected here, and they pull in opposite directions:
 * an operator has to be able to find out which variable they forgot, and a
 * client must not be able to find out anything at all. So the assertions come
 * in pairs — the log names the absent keys, and the response body names
 * nothing.
 *
 * The env values used below are deliberately distinctive strings rather than
 * realistic ones, because most of these tests work by asserting that the value
 * does *not* appear somewhere. A realistic-looking value could pass by
 * coincidence; `SECRET-VALUE-…` cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OAUTH_NOT_CONFIGURED,
  REQUIRED_TWITCH_OAUTH_ENV,
  TWITCH_OAUTH_CALLBACK_PATH,
  TWITCH_OAUTH_LEGACY_CALLBACK,
  TWITCH_OAUTH_LOCAL_CALLBACK,
  TWITCH_OAUTH_PRODUCTION_CALLBACK,
  missingTwitchOAuthEnv,
  readTwitchOAuthStartConfig,
  reportTwitchOAuthMisconfiguration,
  twitchOAuthCallbackUrl,
  twitchRedirectUriPathLooksWrong,
  type TwitchOAuthEnvKey,
} from '@/lib/server/oauthConfig';

/* Values chosen so a leak is unmistakable: each contains SECRET-VALUE, which no
   error code, key name, or URL path in this module legitimately contains. */
const COMPLETE: Record<TwitchOAuthEnvKey, string> = {
  TWITCH_CLIENT_ID: 'SECRET-VALUE-client-id',
  TWITCH_CLIENT_SECRET: 'SECRET-VALUE-client-secret',
  TWITCH_REDIRECT_URI: TWITCH_OAUTH_PRODUCTION_CALLBACK,
  TWITCH_TOKEN_ENCRYPTION_KEY: 'SECRET-VALUE-'.padEnd(64, 'a'),
  SUPABASE_URL: 'https://SECRET-VALUE.supabase.co',
  SUPABASE_SECRET_KEY: 'SECRET-VALUE-service-role',
};

/** Everything the contract names, restored between tests. */
const saved: Partial<Record<TwitchOAuthEnvKey, string | undefined>> = {};

beforeEach(() => {
  for (const key of REQUIRED_TWITCH_OAUTH_ENV) {
    saved[key] = process.env[key];
    process.env[key] = COMPLETE[key];
  }
});

afterEach(() => {
  for (const key of REQUIRED_TWITCH_OAUTH_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* The contract itself                                                 */
/* ------------------------------------------------------------------ */

describe('the required set', () => {
  it('names every variable the OAuth round trip reads, and no others', () => {
    /* Pinned deliberately. The point of this module is that the list is
       derived from the code once and then fixed — a new entry should be a
       decision someone made, visible in this diff, not a silent addition. */
    expect([...REQUIRED_TWITCH_OAUTH_ENV]).toEqual([
      'TWITCH_CLIENT_ID',
      'TWITCH_CLIENT_SECRET',
      'TWITCH_REDIRECT_URI',
      'TWITCH_TOKEN_ENCRYPTION_KEY',
      'SUPABASE_URL',
      'SUPABASE_SECRET_KEY',
    ]);
  });

  it('lists no duplicates', () => {
    expect(new Set(REQUIRED_TWITCH_OAUTH_ENV).size).toBe(
      REQUIRED_TWITCH_OAUTH_ENV.length,
    );
  });

  it('reports nothing missing when all of it is set', () => {
    expect(missingTwitchOAuthEnv()).toEqual([]);
  });
});

describe('each individually absent setting', () => {
  it.each(REQUIRED_TWITCH_OAUTH_ENV)('detects a deleted %s', (key) => {
    delete process.env[key];
    expect(missingTwitchOAuthEnv()).toEqual([key]);
  });

  it.each(REQUIRED_TWITCH_OAUTH_ENV)('detects an empty %s', (key) => {
    process.env[key] = '';
    expect(missingTwitchOAuthEnv()).toEqual([key]);
  });

  /* A hosting panel that holds the key with a blank value is misconfigured in
     exactly the way a missing key is, and reporting it differently would send
     an operator looking for a variable their dashboard shows as present. */
  it.each(REQUIRED_TWITCH_OAUTH_ENV)('treats a whitespace-only %s as absent', (key) => {
    process.env[key] = '   \t ';
    expect(missingTwitchOAuthEnv()).toEqual([key]);
  });

  it('reports several at once, in contract order', () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.TWITCH_CLIENT_ID;
    expect(missingTwitchOAuthEnv()).toEqual(['TWITCH_CLIENT_ID', 'SUPABASE_SECRET_KEY']);
  });

  it('reports the whole set when nothing is configured at all', () => {
    for (const key of REQUIRED_TWITCH_OAUTH_ENV) delete process.env[key];
    expect(missingTwitchOAuthEnv()).toEqual([...REQUIRED_TWITCH_OAUTH_ENV]);
  });
});

/* ------------------------------------------------------------------ */
/* Start configuration                                                 */
/* ------------------------------------------------------------------ */

describe('readTwitchOAuthStartConfig', () => {
  it('returns the two public authorize values when the contract holds', () => {
    const result = readTwitchOAuthStartConfig();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe(COMPLETE.TWITCH_CLIENT_ID);
    expect(result.config.redirectUri).toBe(TWITCH_OAUTH_PRODUCTION_CALLBACK);
  });

  /* The client secret has no route into the authorize redirect: it is not on
     the returned type, and asserting the shape is what keeps a later edit from
     "helpfully" adding it. */
  it('never returns the client secret', () => {
    const result = readTwitchOAuthStartConfig();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.config).sort()).toEqual(['clientId', 'redirectUri']);
    expect(JSON.stringify(result.config)).not.toContain('client-secret');
  });

  it('trims a value pasted with surrounding whitespace', () => {
    /* A trailing newline from a copied secret would otherwise be sent to Twitch
       verbatim and refused, with nothing on screen to explain why. */
    process.env.TWITCH_CLIENT_ID = `  ${COMPLETE.TWITCH_CLIENT_ID}\n`;
    const result = readTwitchOAuthStartConfig();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.clientId).toBe(COMPLETE.TWITCH_CLIENT_ID);
  });

  /* Fail-early: a deployment missing the encryption key or the Supabase
     credentials can take a user's consent and then have nowhere to put the
     tokens. Refusing before the redirect turns that into one clear refusal. */
  it.each(REQUIRED_TWITCH_OAUTH_ENV)(
    'refuses when %s is absent, even if the authorize URL could be built',
    (key) => {
      delete process.env[key];
      const result = readTwitchOAuthStartConfig();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.missing).toEqual([key]);
    },
  );
});

/* ------------------------------------------------------------------ */
/* Callback URL                                                        */
/* ------------------------------------------------------------------ */

describe('callback URL', () => {
  it('is the path this repository actually serves', () => {
    /* pages/api/twitch/oauth/callback.ts — the constant and the file layout have
       to agree, and Twitch compares the whole URL byte for byte. */
    expect(TWITCH_OAUTH_CALLBACK_PATH).toBe('/api/twitch/oauth/callback');
  });

  it('is exactly the canonical production URL', () => {
    expect(TWITCH_OAUTH_PRODUCTION_CALLBACK).toBe(
      'https://gxufy.com/api/twitch/oauth/callback',
    );
  });

  it('is exactly the legacy compatibility URL', () => {
    /* multichat-gxufy.com stays registered on the Twitch application through the
       cutover so a rollback needs no console change. */
    expect(TWITCH_OAUTH_LEGACY_CALLBACK).toBe(
      'https://multichat-gxufy.com/api/twitch/oauth/callback',
    );
  });

  it('is exactly the local development URL', () => {
    expect(TWITCH_OAUTH_LOCAL_CALLBACK).toBe(
      'http://localhost:3000/api/twitch/oauth/callback',
    );
  });

  it('is https in production and never carries a query or fragment', () => {
    const url = new URL(TWITCH_OAUTH_PRODUCTION_CALLBACK);
    expect(url.protocol).toBe('https:');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('does not double the slash when an origin has a trailing one', () => {
    expect(twitchOAuthCallbackUrl('https://gxufy.com/')).toBe(
      TWITCH_OAUTH_PRODUCTION_CALLBACK,
    );
    expect(twitchOAuthCallbackUrl('https://gxufy.com///')).toBe(
      TWITCH_OAUTH_PRODUCTION_CALLBACK,
    );
  });

  it('accepts the production redirect URI as correctly shaped', () => {
    expect(twitchRedirectUriPathLooksWrong()).toBe(false);
  });

  it('accepts the legacy redirect URI as correctly shaped, so a rollback needs no code change', () => {
    /* The path check is origin-agnostic: it validates the suffix, not the host.
       That is deliberate — during the cutover TWITCH_REDIRECT_URI may point at
       either the primary or the legacy callback, and reverting to the legacy one
       must not trip the operator warning. */
    process.env.TWITCH_REDIRECT_URI = TWITCH_OAUTH_LEGACY_CALLBACK;
    expect(twitchRedirectUriPathLooksWrong()).toBe(false);
  });

  it('accepts the local redirect URI as correctly shaped', () => {
    process.env.TWITCH_REDIRECT_URI = TWITCH_OAUTH_LOCAL_CALLBACK;
    expect(twitchRedirectUriPathLooksWrong()).toBe(false);
  });

  it.each([
    'https://multichat-gxufy.com',
    'https://multichat-gxufy.com/',
    'https://multichat-gxufy.com/api/twitch/oauth/start',
    'https://multichat-gxufy.com/api/twitch/oauth/callback/',
    'https://multichat-gxufy.com/multichat',
  ])('flags %s as the wrong path', (value) => {
    process.env.TWITCH_REDIRECT_URI = value;
    expect(twitchRedirectUriPathLooksWrong()).toBe(true);
  });

  it('says nothing about the path when the variable is absent entirely', () => {
    /* That case is already covered by the missing-variable report; claiming a
       path problem too would send an operator chasing a second fault. */
    delete process.env.TWITCH_REDIRECT_URI;
    expect(twitchRedirectUriPathLooksWrong()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* What the log says, and what it does not                             */
/* ------------------------------------------------------------------ */

describe('operator diagnostics', () => {
  const captureLog = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('names every absent key so an operator can act on it', () => {
    const log = captureLog();
    reportTwitchOAuthMisconfiguration('start', [
      'TWITCH_CLIENT_ID',
      'SUPABASE_SECRET_KEY',
    ]);
    const output = log.mock.calls.flat().join(' ');
    expect(output).toContain('TWITCH_CLIENT_ID');
    expect(output).toContain('SUPABASE_SECRET_KEY');
  });

  it('identifies which route refused', () => {
    const log = captureLog();
    reportTwitchOAuthMisconfiguration('callback', ['TWITCH_CLIENT_ID']);
    expect(log.mock.calls.flat().join(' ')).toContain('callback');
  });

  it('carries the same stable code the client is given', () => {
    const log = captureLog();
    reportTwitchOAuthMisconfiguration('start', ['TWITCH_CLIENT_ID']);
    expect(log.mock.calls.flat().join(' ')).toContain(OAUTH_NOT_CONFIGURED);
  });

  /* The whole point of the split: names are useful and safe, values are not. */
  it('logs no environment value, for any key', () => {
    const log = captureLog();
    reportTwitchOAuthMisconfiguration('start', [...REQUIRED_TWITCH_OAUTH_ENV]);
    const output = log.mock.calls.flat().join(' ');
    expect(output).not.toContain('SECRET-VALUE');
    for (const key of REQUIRED_TWITCH_OAUTH_ENV) {
      expect(output).not.toContain(COMPLETE[key]);
    }
  });

  it('logs no value even for keys that are present while others are absent', () => {
    const log = captureLog();
    delete process.env.TWITCH_CLIENT_ID;
    reportTwitchOAuthMisconfiguration('start', missingTwitchOAuthEnv());
    expect(log.mock.calls.flat().join(' ')).not.toContain('SECRET-VALUE');
  });

  it('stays silent when the contract is satisfied and the path is right', () => {
    const log = captureLog();
    reportTwitchOAuthMisconfiguration('start', []);
    expect(log).not.toHaveBeenCalled();
  });

  it('warns about a wrong redirect path even when nothing is missing', () => {
    const log = captureLog();
    process.env.TWITCH_REDIRECT_URI = 'https://multichat-gxufy.com';
    reportTwitchOAuthMisconfiguration('start', []);
    const output = log.mock.calls.flat().join(' ');
    expect(output).toContain('TWITCH_REDIRECT_URI');
    expect(output).toContain(TWITCH_OAUTH_CALLBACK_PATH);
  });

  it('does not print the misconfigured redirect value itself', () => {
    const log = captureLog();
    process.env.TWITCH_REDIRECT_URI = 'https://SECRET-VALUE.example.com';
    reportTwitchOAuthMisconfiguration('start', []);
    expect(log.mock.calls.flat().join(' ')).not.toContain('SECRET-VALUE');
  });
});

/* ------------------------------------------------------------------ */
/* The public error code                                               */
/* ------------------------------------------------------------------ */

describe('the public error code', () => {
  it('is the stable string support can be told to look for', () => {
    expect(OAUTH_NOT_CONFIGURED).toBe('oauth_not_configured');
  });

  it('names no variable and no value', () => {
    expect(OAUTH_NOT_CONFIGURED).not.toContain('TWITCH');
    expect(OAUTH_NOT_CONFIGURED).not.toContain('SUPABASE');
    expect(OAUTH_NOT_CONFIGURED).not.toContain('SECRET');
  });
});
