import { afterEach, describe, expect, it } from 'vitest';
import type { NextApiRequest } from 'next';
import {
  createSharedSseAdmissionLimiter,
  sharedSseClientKey,
} from '@/lib/server/sharedSseAdmission';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
});

function request(
  remoteAddress: string,
  headers: NextApiRequest['headers'] = {},
): NextApiRequest {
  return { headers, socket: { remoteAddress } } as unknown as NextApiRequest;
}

describe('shared SSE admission limiting', () => {
  it('trusts Vercel client IP headers only inside a Vercel runtime', () => {
    delete process.env.VERCEL;
    const req = request('::ffff:127.0.0.1', {
      'x-forwarded-for': '203.0.113.10',
      'x-vercel-forwarded-for': '198.51.100.20',
      'x-real-ip': '198.51.100.21',
    });
    expect(sharedSseClientKey(req)).toBe('127.0.0.1');

    process.env.VERCEL = '1';
    expect(sharedSseClientKey(req)).toBe('203.0.113.10');
  });

  it('permits normal reconnects and rejects only excessive rapid admissions', () => {
    const limiter = createSharedSseAdmissionLimiter({
      windowMs: 60_000,
      maxRequests: 3,
      maxClients: 10,
    });
    expect(limiter.consume('client', 0).allowed).toBe(true);
    expect(limiter.consume('client', 1).allowed).toBe(true);
    expect(limiter.consume('client', 2).allowed).toBe(true);
    expect(limiter.consume('client', 3)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('expires stale entries and restores admission after the window', () => {
    const limiter = createSharedSseAdmissionLimiter({
      windowMs: 1_000,
      maxRequests: 1,
      maxClients: 10,
    });
    expect(limiter.consume('client', 0).allowed).toBe(true);
    expect(limiter.consume('client', 999).allowed).toBe(false);
    expect(limiter.consume('client', 1_000).allowed).toBe(true);
  });

  it('bounds its own client storage while continuing to admit new keys', () => {
    const limiter = createSharedSseAdmissionLimiter({
      windowMs: 60_000,
      maxRequests: 2,
      maxClients: 2,
    });
    expect(limiter.consume('one', 0).allowed).toBe(true);
    expect(limiter.consume('two', 0).allowed).toBe(true);
    expect(limiter.consume('three', 0).allowed).toBe(true);
    expect(limiter.entryCountForTests()).toBe(2);
  });
});
