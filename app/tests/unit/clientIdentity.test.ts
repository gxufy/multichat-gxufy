import { afterEach, describe, expect, it } from 'vitest';
import type { NextApiRequest } from 'next';
import {
  CADDY_CLIENT_IP_HEADER,
  normalizeClientIp,
  resolveNodeClientKey,
  resolveWebClientKey,
} from '@/lib/server/clientIdentity';
import {
  createSharedSseAdmissionLimiter,
  sharedSseClientKey,
} from '@/lib/server/sharedSseAdmission';
import {
  createViewerAdmissionLimiter,
  viewerClientKey,
} from '@/lib/server/viewerResourceControl';
import {
  createTtsAdmissionController,
  ttsClientKey,
} from '@/lib/server/ttsSecurity';
import {
  createFixedProviderAdmissionController,
  fixedProviderClientKey,
} from '@/lib/server/fixedProviderProxy';
import {
  createTwitchPinsAdmissionController,
  twitchPinsClientKey,
} from '@/lib/server/twitchPinsSecurity';

const originalVercel = process.env.VERCEL;
const originalTrustedCaddy = process.env.TRUST_CADDY_PROXY;

function restoreEnvironment(): void {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalTrustedCaddy === undefined) delete process.env.TRUST_CADDY_PROXY;
  else process.env.TRUST_CADDY_PROXY = originalTrustedCaddy;
}

function directMode(): void {
  delete process.env.VERCEL;
  delete process.env.TRUST_CADDY_PROXY;
}

function nodeRequest(
  remoteAddress: string | undefined,
  headers: NextApiRequest['headers'] = {},
): NextApiRequest {
  return { headers, socket: { remoteAddress } } as unknown as NextApiRequest;
}

function webRequest(headers: Record<string, string> = {}): Request {
  return { headers: new Headers(headers) } as Request;
}

afterEach(restoreEnvironment);

describe('client IP normalization', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:0DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeClientIp(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    ' 203.0.113.7',
    '203.0.113.7 ',
    '203.0.113.7, 198.51.100.2',
    '203.0.113.7:443',
    '[2001:db8::1]',
    'fe80::1%eth0',
    '999.0.0.1',
    '127.1',
    '0x7f000001',
    '0177.0.0.1',
    'client.example',
  ])('rejects non-canonical single-address input %j', (input) => {
    expect(normalizeClientIp(input)).toBe('');
  });
});

describe('Node request client identity', () => {
  it('uses the direct socket and ignores every forged forwarding header', () => {
    directMode();
    const request = nodeRequest('203.0.113.10', {
      'x-forwarded-for': '198.51.100.1',
      'x-real-ip': '198.51.100.2',
      'x-vercel-forwarded-for': '198.51.100.3',
      [CADDY_CLIENT_IP_HEADER]: '198.51.100.4',
    });
    expect(resolveNodeClientKey(request)).toBe('203.0.113.10');
  });

  it.each(['true', 'yes', '01', 'enabled']) (
    'does not enable Caddy trust for malformed flag %s',
    (flag) => {
      directMode();
      process.env.TRUST_CADDY_PROXY = flag;
      expect(resolveNodeClientKey(nodeRequest('127.0.0.1', {
        [CADDY_CLIENT_IP_HEADER]: '203.0.113.11',
      }))).toBe('127.0.0.1');
    },
  );

  it('ignores the dedicated header from a non-loopback peer even in Caddy mode', () => {
    directMode();
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveNodeClientKey(nodeRequest('198.51.100.20', {
      [CADDY_CLIENT_IP_HEADER]: '203.0.113.12',
      'x-forwarded-for': '203.0.113.13',
    }))).toBe('198.51.100.20');
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'trusts one valid dedicated address behind loopback peer %s',
    (peer) => {
      directMode();
      process.env.TRUST_CADDY_PROXY = '1';
      expect(resolveNodeClientKey(nodeRequest(peer, {
        [CADDY_CLIENT_IP_HEADER]: '2001:0DB8:0:0:0:0:0:20',
        'x-forwarded-for': '198.51.100.30',
      }))).toBe('2001:db8::20');
    },
  );

  it.each([
    undefined,
    '',
    '   ',
    '203.0.113.20, 198.51.100.40',
    '203.0.113.20:443',
    'not-an-ip',
    ['203.0.113.20', '198.51.100.40'],
  ])('falls back to the proxy socket for invalid dedicated value %j', (value) => {
    directMode();
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveNodeClientKey(nodeRequest('::ffff:127.0.0.1', {
      [CADDY_CLIENT_IP_HEADER]: value,
      'x-forwarded-for': '203.0.113.99',
    }))).toBe('127.0.0.1');
  });

  it('uses only Vercel-overwritten X-Forwarded-For and gives Vercel precedence', () => {
    process.env.VERCEL = '1';
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveNodeClientKey(nodeRequest('127.0.0.1', {
      'x-forwarded-for': '203.0.113.30',
      'x-vercel-forwarded-for': '198.51.100.31',
      'x-real-ip': '198.51.100.32',
      [CADDY_CLIENT_IP_HEADER]: '198.51.100.33',
    }))).toBe('203.0.113.30');
  });

  it('fails a malformed Vercel identity back to the socket, not other headers', () => {
    process.env.VERCEL = '1';
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveNodeClientKey(nodeRequest('::ffff:127.0.0.1', {
      'x-forwarded-for': '203.0.113.30, 198.51.100.31',
      'x-real-ip': '198.51.100.32',
      [CADDY_CLIENT_IP_HEADER]: '198.51.100.33',
    }))).toBe('127.0.0.1');
  });

  it('uses a bounded unknown identity when no valid socket is available', () => {
    directMode();
    expect(resolveNodeClientKey(nodeRequest(undefined, {
      'x-forwarded-for': '203.0.113.40',
    }))).toBe('unknown');
  });
});

describe('App Router client identity', () => {
  it('ignores every forwarding header in direct mode', () => {
    directMode();
    expect(resolveWebClientKey(webRequest({
      'x-forwarded-for': '203.0.113.50',
      'x-real-ip': '203.0.113.51',
      [CADDY_CLIENT_IP_HEADER]: '203.0.113.52',
    }))).toBe('unknown');
  });

  it('uses only a valid dedicated header in explicitly enabled Caddy mode', () => {
    directMode();
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveWebClientKey(webRequest({
      [CADDY_CLIENT_IP_HEADER]: '::ffff:203.0.113.53',
      'x-forwarded-for': '198.51.100.54',
    }))).toBe('203.0.113.53');
  });

  it.each([
    '',
    '   ',
    '203.0.113.50, 198.51.100.51',
    '203.0.113.50:443',
    'invalid',
  ])('fails malformed Caddy value %j to the bounded unknown key', (value) => {
    directMode();
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveWebClientKey(webRequest({
      [CADDY_CLIENT_IP_HEADER]: value,
      'x-forwarded-for': '198.51.100.60',
    }))).toBe('unknown');
  });

  it('preserves Vercel precedence and ignores the Caddy flag there', () => {
    process.env.VERCEL = '1';
    process.env.TRUST_CADDY_PROXY = '1';
    expect(resolveWebClientKey(webRequest({
      'x-forwarded-for': '2001:0db8:0:0:0:0:0:60',
      [CADDY_CLIENT_IP_HEADER]: '198.51.100.61',
      'x-real-ip': '198.51.100.62',
    }))).toBe('2001:db8::60');
  });
});

describe('cross-helper parity and client bucket isolation', () => {
  it('derives one canonical Caddy identity in every affected helper', () => {
    directMode();
    process.env.TRUST_CADDY_PROXY = '1';
    const node = nodeRequest('::1', {
      [CADDY_CLIENT_IP_HEADER]: '::ffff:203.0.113.70',
    });
    const web = webRequest({ [CADDY_CLIENT_IP_HEADER]: '203.0.113.70' });

    expect([
      sharedSseClientKey(node),
      viewerClientKey(node),
      ttsClientKey(node),
      fixedProviderClientKey(node),
      twitchPinsClientKey(web),
    ]).toEqual(Array(5).fill('203.0.113.70'));
  });

  it('keeps two Caddy clients in independent buckets across representative controls', () => {
    directMode();
    process.env.TRUST_CADDY_PROXY = '1';
    const keyA = resolveNodeClientKey(nodeRequest('127.0.0.1', {
      [CADDY_CLIENT_IP_HEADER]: '203.0.113.80',
    }));
    const keyB = resolveNodeClientKey(nodeRequest('127.0.0.1', {
      [CADDY_CLIENT_IP_HEADER]: '203.0.113.81',
    }));
    expect(keyA).not.toBe(keyB);

    const sse = createSharedSseAdmissionLimiter({ maxRequests: 1, maxClients: 2 });
    expect(sse.consume(keyA, 0).allowed).toBe(true);
    expect(sse.consume(keyA, 1).allowed).toBe(false);
    expect(sse.consume(keyB, 1).allowed).toBe(true);

    const viewer = createViewerAdmissionLimiter({ maxWork: 1, maxClients: 2 });
    expect(viewer.consume(keyA, 1, 0).allowed).toBe(true);
    expect(viewer.consume(keyA, 1, 1).allowed).toBe(false);
    expect(viewer.consume(keyB, 1, 1).allowed).toBe(true);

    const tts = createTtsAdmissionController({
      maxConcurrent: 2,
      maxRequests: 1,
      maxClients: 2,
    });
    tts.acquire(keyA, 0)();
    expect(() => tts.acquire(keyA, 1)).toThrow();
    tts.acquire(keyB, 1)();

    const fixed = createFixedProviderAdmissionController({
      maxConcurrent: 2,
      maxWork: 1,
      maxClients: 2,
    });
    fixed.acquire(keyA, 1, 0)();
    expect(() => fixed.acquire(keyA, 1, 1)).toThrow();
    fixed.acquire(keyB, 1, 1)();

    const pins = createTwitchPinsAdmissionController({
      maxConcurrent: 2,
      maxRequests: 1,
      maxClients: 2,
    });
    pins.acquire(keyA, 0)();
    expect(() => pins.acquire(keyA, 1)).toThrow();
    pins.acquire(keyB, 1)();
  });
});
