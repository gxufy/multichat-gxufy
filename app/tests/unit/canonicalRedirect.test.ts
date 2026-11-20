/* Selective canonicalization — which domain a request is forwarded to.
 *
 * Two properties are load-bearing and pull against each other. Every configured
 * overlay URL sitting in an OBS scene collection must be served exactly where it
 * was asked for — moving one blacks out a live stream — while the website's own
 * pages should be nudged to the primary domain. The tests are grouped by which of
 * those two a case belongs to, because that is the distinction the whole module
 * exists to draw.
 *
 * The decision is a pure function of (host, pathname, query, search), so no
 * request object is constructed here. The host is the pivot: tool pages on
 * gxufy.com and the legacy host forward to flosschat.app, the gxufy.com homepage
 * stays put, and localhost or any unrecognised Host is left exactly where it is.
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
      'https://flosschat.app/?kick=',
    );
  });
});

/* ------------------------------------------------------------------ */
/* Website pages — canonicalized (Section 4)                           */
/* ------------------------------------------------------------------ */

describe('website pages on the legacy host are canonicalized', () => {
  it('forwards the bare generator', () => {
    expect(target(LEGACY, '/multichat')).toBe('https://flosschat.app/');
  });

  it('forwards the bare landing page', () => {
    expect(target(LEGACY, '/')).toBe('https://gxufy.com/');
  });

  it('forwards the retired redirect stubs', () => {
    expect(target(LEGACY, '/tools/multichat')).toBe(
      'https://flosschat.app/tools/multichat',
    );
    expect(target(LEGACY, '/tools/counter')).toBe(
      'https://flosschat.app/tools/counter',
    );
    expect(target(LEGACY, '/classic/multichat')).toBe(
      'https://flosschat.app/classic/multichat',
    );
  });

  it('preserves a non-channel query string across the forward', () => {
    expect(target(LEGACY, '/multichat', { tab: 'counter' }, '?tab=counter')).toBe(
      'https://flosschat.app/?tab=counter',
    );
  });

  it('canonicalizes from the www legacy host too', () => {
    expect(target(LEGACY_WWW, '/multichat')).toBe('https://flosschat.app/');
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
/* gxufy.com — homepage stays, tools forward                            */
/* ------------------------------------------------------------------ */

describe('gxufy.com keeps its homepage and forwards its tool pages', () => {
  it('serves the homepage in place', () => {
    expect(target('gxufy.com', '/')).toBeNull();
    expect(target('gxufy.com', '/', { ref: 'x' }, '?ref=x')).toBeNull();
  });

  it('forwards the bare generator and the other tool pages to flosschat.app', () => {
    expect(target('gxufy.com', '/multichat')).toBe('https://flosschat.app/');
    expect(target('gxufy.com', '/multichat', { tab: 'counter' }, '?tab=counter')).toBe(
      'https://flosschat.app/?tab=counter',
    );
    expect(target('gxufy.com', '/badges')).toBe('https://flosschat.app/badges');
    expect(target('gxufy.com', '/support', { paypal: 'return' }, '?paypal=return')).toBe(
      'https://flosschat.app/support?paypal=return',
    );
    expect(target('gxufy.com', '/tools/counter')).toBe('https://flosschat.app/tools/counter');
  });

  it('serves every overlay URL already in OBS scenes in place', () => {
    expect(target('gxufy.com', '/multichat', { kick: 'a' }, '?kick=a')).toBeNull();
    expect(target('gxufy.com', '/', { twitch: 'a' }, '?twitch=a')).toBeNull();
    expect(target('gxufy.com', '/counter', { kick: 'a' }, '?kick=a')).toBeNull();
    expect(target('gxufy.com', '/audience')).toBeNull();
    expect(target('gxufy.com', '/api/tiktok/stream')).toBeNull();
    expect(target('gxufy.com', '/api/auth/twitch/login')).toBeNull();
  });

  it('leaves unknown paths alone', () => {
    expect(target('gxufy.com', '/does-not-exist')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* flosschat.app — the tools' own domain                                */
/* ------------------------------------------------------------------ */

describe('flosschat.app: the root is the generator', () => {
  it('serves the bare root in place (next.config.js shows the generator there)', async () => {
    expect(target('flosschat.app', '/')).toBeNull();
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const config = (require('../../next.config.js') as (phase: string) => {
      rewrites: () => Promise<{ beforeFiles: Array<Record<string, unknown>> }>;
    })('phase-production-server');
    const { beforeFiles } = await config.rewrites();
    expect(beforeFiles).toEqual([{
      source: '/',
      has: [{ type: 'host', value: 'flosschat.app' }],
      missing: ['channel', 'kick', 'twitch', 'youtube', 'tiktok'].map((key) => ({ type: 'query', key })),
      destination: '/multichat',
    }]);
    const { MULTICHAT_CHANNEL_PARAMS } = await import('@/lib/multichatRouting');
    expect((beforeFiles[0]!.missing as Array<{ key: string }>).map((m) => m.key)).toEqual([...MULTICHAT_CHANNEL_PARAMS]);
  });

  it('sends a bare /multichat to the root, keeping the query', () => {
    expect(target('flosschat.app', '/multichat')).toBe('https://flosschat.app/');
    expect(target('flosschat.app', '/multichat', { badges: '1' }, '?badges=1')).toBe(
      'https://flosschat.app/?badges=1',
    );
  });

  it('keeps every overlay URL exactly as it is', () => {
    expect(target('flosschat.app', '/multichat', { twitch: 'a' }, '?twitch=a')).toBeNull();
    expect(target('flosschat.app', '/', { kick: 'a' }, '?kick=a')).toBeNull();
  });

  it('never redirects its other pages, overlays or APIs', () => {
    for (const path of ['/badges', '/support', '/counter', '/audience', '/api/viewers', '/tools/counter']) {
      expect(target('flosschat.app', path)).toBeNull();
    }
  });

});

/* ------------------------------------------------------------------ */
/* Host safety (Section 7)                                             */
/* ------------------------------------------------------------------ */

describe('host safety', () => {
  it('leaves localhost and Vercel previews in place', () => {
    expect(target('localhost:3000', '/multichat')).toBeNull();
    expect(target('localhost:3000', '/')).toBeNull();
    expect(target('multichat-gxufy.vercel.app', '/multichat')).toBeNull();
  });

  it('never reflects an unknown or forged Host into a redirect', () => {
    /* An arbitrary Host must not become a redirect target, and must not be
       treated as a known host either — the safe default is to serve in place. */
    for (const host of ['evil.example.com', 'gxufy.com.evil.com', 'flosschat.app.evil.com', '', undefined]) {
      expect(target(host, '/multichat')).toBeNull();
      expect(target(host, '/')).toBeNull();
    }
  });

  it('builds the target from fixed origins, never the Host', () => {
    const out = target(LEGACY, '/multichat');
    expect(out).toBe('https://flosschat.app/');
    expect(out).not.toContain('multichat-gxufy.com');
  });

  it('never forwards to a URL that would forward again', () => {
    const hosts = ['gxufy.com', 'www.gxufy.com', LEGACY, LEGACY_WWW, 'flosschat.app'];
    const paths = ['/', '/multichat', '/badges', '/support', '/tools/multichat', '/tools/counter', '/classic/multichat', '/counter'];
    for (const host of hosts) {
      for (const path of paths) {
        const first = target(host, path);
        if (!first) continue;
        const url = new URL(first);
        expect(target(url.host, url.pathname, {}, url.search)).toBeNull();
      }
    }
  });
});
