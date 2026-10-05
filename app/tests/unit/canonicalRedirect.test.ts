/* Selective canonicalization — the legacy-host → gxufy.com decision.
 *
 * Two properties are load-bearing and pull against each other. Every configured
 * overlay URL sitting in an OBS scene collection must be served exactly where it
 * was asked for — moving one blacks out a live stream — while the website's own
 * pages should be nudged to the primary domain. The tests are grouped by which of
 * those two a case belongs to, because that is the distinction the whole module
 * exists to draw.
 *
 * The decision is a pure function of (host, pathname, query, search), so no
 * request object is constructed here. The host is the pivot: only the legacy
 * compatibility hosts canonicalize, and a request already on gxufy.com, on
 * localhost, or on any unrecognised Host is left exactly where it is.
 */
import { describe, expect, it } from 'vitest';
import { canonicalRedirectTarget } from '@/lib/canonicalRedirect';
import type { ParsedUrlQuery } from 'querystring';

const LEGACY = 'multichat-gxufy.com';
const LEGACY_WWW = 'www.multichat-gxufy.com';

/** A convenience wrapper — most cases carry no query. */
const target = (
  host: string | undefined,
  pathname: string,
  query: ParsedUrlQuery = {},
  search = '',
) => canonicalRedirectTarget(host, pathname, query, search);

/* ------------------------------------------------------------------ */
/* Overlays and APIs — never redirected (Section 3 compatibility)      */
/* ------------------------------------------------------------------ */

describe('configured overlays on the legacy host are served in place', () => {
  it('never redirects a channel-carrying /multichat', () => {
    expect(target(LEGACY, '/multichat', { kick: 'samplechannel' }, '?kick=samplechannel')).toBeNull();
    expect(target(LEGACY, '/multichat', { twitch: 'a', youtube: 'b' })).toBeNull();
  });

  it('never redirects a channel-carrying root overlay URL', () => {
    expect(target(LEGACY, '/', { kick: 'samplechannel' }, '?kick=samplechannel')).toBeNull();
  });

  it('never redirects the /counter overlay', () => {
    expect(target(LEGACY, '/counter')).toBeNull();
    expect(target(LEGACY, '/counter', { twitch: 'a' }, '?twitch=a')).toBeNull();
  });

  it('never redirects an API route', () => {
    for (const path of [
      '/api/viewers',
      '/api/twitch/oauth/start',
      '/api/twitch/oauth/callback',
      '/api/twitch/pins',
      '/api/tiktok/stream',
      '/api/youtube/live',
    ]) {
      expect(target(LEGACY, path)).toBeNull();
    }
  });

  it('treats an empty channel value as no channel, so bare /multichat still canonicalizes', () => {
    /* `?kick=` is an unfilled generator field, not an overlay. The single routing
       authority decides this, so the answer matches what the page would render. */
    expect(target(LEGACY, '/multichat', { kick: '' }, '?kick=')).toBe(
      'https://gxufy.com/multichat?kick=',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Website pages — canonicalized (Section 4)                           */
/* ------------------------------------------------------------------ */

describe('website pages on the legacy host are canonicalized', () => {
  it('forwards the bare generator', () => {
    expect(target(LEGACY, '/multichat')).toBe('https://gxufy.com/multichat');
  });

  it('forwards the bare landing page', () => {
    expect(target(LEGACY, '/')).toBe('https://gxufy.com/');
  });

  it('forwards the retired redirect stubs', () => {
    expect(target(LEGACY, '/tools/multichat')).toBe(
      'https://gxufy.com/tools/multichat',
    );
    expect(target(LEGACY, '/tools/counter')).toBe(
      'https://gxufy.com/tools/counter',
    );
    expect(target(LEGACY, '/classic/multichat')).toBe(
      'https://gxufy.com/classic/multichat',
    );
  });

  it('preserves a non-channel query string across the forward', () => {
    expect(target(LEGACY, '/multichat', { tab: 'counter' }, '?tab=counter')).toBe(
      'https://gxufy.com/multichat?tab=counter',
    );
  });

  it('canonicalizes from the www legacy host too', () => {
    expect(target(LEGACY_WWW, '/multichat')).toBe('https://gxufy.com/multichat');
  });

  it('tolerates a port on the legacy Host header', () => {
    expect(target('multichat-gxufy.com:443', '/')).toBe('https://gxufy.com/');
  });
});

/* ------------------------------------------------------------------ */
/* Unknown paths — left as they are                                    */
/* ------------------------------------------------------------------ */

describe('paths that are not the website’s own pages are left alone', () => {
  it('does not redirect an unknown path, so a 404 stays a 404', () => {
    expect(target(LEGACY, '/does-not-exist')).toBeNull();
    expect(target(LEGACY, '/multichat/extra')).toBeNull();
    expect(target(LEGACY, '/tools/unknown')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Host safety (Section 7)                                             */
/* ------------------------------------------------------------------ */

describe('only the legacy hosts ever canonicalize', () => {
  it('leaves a request already on the canonical host in place', () => {
    /* The redirect target would equal the request, so acting would loop. */
    expect(target('gxufy.com', '/multichat')).toBeNull();
    expect(target('www.gxufy.com', '/')).toBeNull();
  });

  it('leaves localhost and Vercel previews in place', () => {
    expect(target('localhost:3000', '/multichat')).toBeNull();
    expect(target('multichat-gxufy.vercel.app', '/multichat')).toBeNull();
  });

  it('never reflects an unknown or forged Host into a redirect', () => {
    /* An arbitrary Host must not become a redirect target, and must not be
       treated as legacy either — the safe default is to serve in place. */
    for (const host of ['evil.example.com', 'gxufy.com.evil.com', '', undefined]) {
      expect(target(host, '/multichat')).toBeNull();
      expect(target(host, '/')).toBeNull();
    }
  });

  it('builds the target from the fixed canonical origin, never the Host', () => {
    /* Even a Host that embeds another origin cannot steer the target: the legacy
       host is what gates the redirect, and the origin is a constant. */
    const out = target(LEGACY, '/multichat');
    expect(out).toBe('https://gxufy.com/multichat');
    expect(out).not.toContain('multichat-gxufy.com');
  });
});
