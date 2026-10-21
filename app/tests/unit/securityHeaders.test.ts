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

  it('applies one centralized rule to application and API paths', () => {
    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('/:path*');
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
