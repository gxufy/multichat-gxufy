/* The domain contract — the one place every origin and callback string is fixed.
 *
 * These are compile-time facts about where the site lives, so the tests read as
 * a specification of those facts: the primary origin is gxufy.com, the legacy
 * compatibility origin is multichat-gxufy.com, the callbacks derive from them,
 * and the host helpers classify a Host header without ever letting an unknown one
 * through as a redirect target.
 *
 * The module is imported for its browser-safety too: it must carry no secret and
 * touch neither process.env nor the network, so a value that looked like a secret
 * appearing in it would be a real regression. That is asserted directly.
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_HOST,
  CANONICAL_ORIGIN,
  CANONICAL_OAUTH_CALLBACK,
  CANONICAL_WWW_HOST,
  CANONICAL_WWW_ORIGIN,
  KNOWN_HOSTS,
  LEGACY_HOSTS,
  LEGACY_OAUTH_CALLBACK,
  LEGACY_ORIGIN,
  LOCAL_OAUTH_CALLBACK,
  LOCAL_ORIGIN,
  OAUTH_CALLBACK_PATH,
  isCanonicalHost,
  isLegacyHost,
  oauthCallbackUrl,
  stripPort,
} from '@/lib/domains.mjs';

describe('origins', () => {
  it('makes gxufy.com the canonical primary origin', () => {
    expect(CANONICAL_ORIGIN).toBe('https://gxufy.com');
  });

  it('keeps multichat-gxufy.com as the legacy compatibility origin', () => {
    expect(LEGACY_ORIGIN).toBe('https://multichat-gxufy.com');
  });

  it('names the www and local origins', () => {
    expect(CANONICAL_WWW_ORIGIN).toBe('https://www.gxufy.com');
    expect(LOCAL_ORIGIN).toBe('http://localhost:3000');
  });

  it('is https for both production origins', () => {
    expect(new URL(CANONICAL_ORIGIN).protocol).toBe('https:');
    expect(new URL(LEGACY_ORIGIN).protocol).toBe('https:');
  });

  it('stores each origin without a trailing slash', () => {
    for (const origin of [
      CANONICAL_ORIGIN,
      CANONICAL_WWW_ORIGIN,
      LEGACY_ORIGIN,
      LOCAL_ORIGIN,
    ]) {
      expect(origin.endsWith('/')).toBe(false);
    }
  });
});

describe('oauth callbacks', () => {
  it('serves the callback path this repository actually has', () => {
    expect(OAUTH_CALLBACK_PATH).toBe('/api/twitch/oauth/callback');
  });

  it('derives the primary callback from the canonical origin', () => {
    expect(CANONICAL_OAUTH_CALLBACK).toBe(
      'https://gxufy.com/api/twitch/oauth/callback',
    );
  });

  it('keeps a legacy callback for rollback', () => {
    expect(LEGACY_OAUTH_CALLBACK).toBe(
      'https://multichat-gxufy.com/api/twitch/oauth/callback',
    );
  });

  it('derives the local callback', () => {
    expect(LOCAL_OAUTH_CALLBACK).toBe(
      'http://localhost:3000/api/twitch/oauth/callback',
    );
  });

  it('never carries a query or fragment on a production callback', () => {
    const url = new URL(CANONICAL_OAUTH_CALLBACK);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('does not double the slash when an origin has a trailing one', () => {
    expect(oauthCallbackUrl('https://gxufy.com/')).toBe(CANONICAL_OAUTH_CALLBACK);
    expect(oauthCallbackUrl('https://gxufy.com///')).toBe(CANONICAL_OAUTH_CALLBACK);
  });
});

describe('host classification', () => {
  it('recognises the canonical host in apex and www form', () => {
    expect(isCanonicalHost('gxufy.com')).toBe(true);
    expect(isCanonicalHost('www.gxufy.com')).toBe(true);
    expect(CANONICAL_HOST).toBe('gxufy.com');
    expect(CANONICAL_WWW_HOST).toBe('www.gxufy.com');
  });

  it('recognises the legacy hosts in apex and www form', () => {
    expect(isLegacyHost('multichat-gxufy.com')).toBe(true);
    expect(isLegacyHost('www.multichat-gxufy.com')).toBe(true);
    expect(LEGACY_HOSTS).toEqual([
      'multichat-gxufy.com',
      'www.multichat-gxufy.com',
    ]);
  });

  it('does not confuse the two domains for each other', () => {
    expect(isLegacyHost('gxufy.com')).toBe(false);
    expect(isCanonicalHost('multichat-gxufy.com')).toBe(false);
  });

  it('tolerates a port and case on the Host header', () => {
    expect(isCanonicalHost('GXUFY.COM:443')).toBe(true);
    expect(isLegacyHost('Multichat-Gxufy.com:80')).toBe(true);
    expect(stripPort('gxufy.com:3000')).toBe('gxufy.com');
  });

  it('treats an unknown or empty host as neither', () => {
    for (const host of ['evil.example.com', '', undefined]) {
      expect(isCanonicalHost(host)).toBe(false);
      expect(isLegacyHost(host)).toBe(false);
    }
  });

  it('lists every host the app knowingly answers on', () => {
    expect(KNOWN_HOSTS).toEqual([
      'gxufy.com',
      'www.gxufy.com',
      'multichat-gxufy.com',
      'www.multichat-gxufy.com',
      'localhost',
      '127.0.0.1',
    ]);
  });
});

describe('browser safety', () => {
  it('carries no value that looks like a secret', async () => {
    /* The module is imported by browser code; a secret reaching it would ship to
       the client. Read the source and assert only public domain strings appear —
       nothing shaped like a key, token, or credential. */
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const path = join(process.cwd(), 'src', 'lib', 'domains.mjs');
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/SECRET|TOKEN|PASSWORD|CLIENT_SECRET|api[_-]?key/i);
  });
});
