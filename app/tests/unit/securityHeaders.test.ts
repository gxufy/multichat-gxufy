import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };
type NextConfig = { poweredByHeader?: boolean; headers?: () => Promise<HeaderRule[]> };
type NextConfigFactory = (phase: string) => NextConfig;

const require = createRequire(import.meta.url);
const createNextConfig = require('../../next.config.js') as NextConfigFactory;

let config: NextConfig;
let rules: HeaderRule[];
let headers: Map<string, string>;

beforeAll(async () => {
  config = createNextConfig('phase-production-build');
  expect(config.headers).toBeTypeOf('function');
  rules = await config.headers!();
  headers = new Map(rules[0]?.headers.map(({ key, value }) => [key, value]));
});

describe('baseline HTTP security headers', () => {
  it('disables the native Next.js X-Powered-By header', () => {
    expect(config.poweredByHeader).toBe(false);
  });

  it('applies one centralized rule to every path, plus no-framing for two pages', () => {
    expect(rules.map((rule) => rule.source)).toEqual(['/:path*', '/', '/support']);
  });

  it('sets the safe baseline values', () => {
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('X-DNS-Prefetch-Control')).toBe('off');
    expect(headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('disables only browser capabilities the application does not use', () => {
    expect(headers.get('Permissions-Policy')?.split(', ')).toEqual([
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ]);
  });

  it('does not introduce framing, CSP, or cross-origin isolation restrictions', () => {
    expect(headers.has('Content-Security-Policy')).toBe(false);
    expect(headers.has('X-Frame-Options')).toBe(false);
    expect(headers.has('Cross-Origin-Opener-Policy')).toBe(false);
    expect(headers.has('Cross-Origin-Embedder-Policy')).toBe(false);
    expect(headers.has('Cross-Origin-Resource-Policy')).toBe(false);
  });

  it('leaves route-specific response and streaming headers to their routes', () => {
    for (const key of [
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Origin',
      'Cache-Control',
      'Connection',
      'Content-Length',
      'Content-Type',
      'Retry-After',
      'X-Accel-Buffering',
    ]) {
      expect(headers.has(key)).toBe(false);
    }
  });
});

describe('framing protection', () => {
  it('keeps the homepage and payment page out of other sites, but not the overlay', async () => {
    const rules = await createNextConfig('phase-production-build').headers!();
    const keysFor = (source: string) => rules.filter((rule) => rule.source === source).flatMap((rule) => rule.headers.map((h) => `${h.key}: ${h.value}`));
    for (const page of ['/', '/support']) {
      expect(keysFor(page)).toContain('X-Frame-Options: SAMEORIGIN');
      expect(keysFor(page).some((h) => h.includes("frame-ancestors 'self'"))).toBe(true);
    }
    expect(rules.filter((rule) => rule.source === '/multichat')).toHaveLength(0);
    const global = keysFor('/:path*');
    expect(global.some((h) => h.startsWith('X-Frame-Options'))).toBe(false);
  });
});
