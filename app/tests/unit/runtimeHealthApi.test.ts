import { describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import runtimeHealthHandler from '@/pages/api/runtime/health';
import { runtimeProcessStats } from '@/lib/server/runtimeMetrics';

class MockResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value));
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.body = value;
    return this;
  }
}

function invoke(
  method = 'GET',
  query: Record<string, string | string[]> = {},
): MockResponse {
  const req = { method, query } as unknown as NextApiRequest;
  const res = new MockResponse();
  runtimeHealthHandler(req, res as unknown as NextApiResponse);
  return res;
}

describe('/api/runtime/health public liveness response', () => {
  it('returns only a minimal uncacheable JSON status', () => {
    const response = invoke();

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');

    const serialized = JSON.stringify(response.body).toLowerCase();
    for (const privateField of [
      'uptime',
      'memory',
      'eventloop',
      'process',
      'hub',
      'channel',
      'subscriber',
      'capacity',
      'limit',
      'environment',
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it('does not reveal active or inactive YouTube channel state through queries', () => {
    const activeLooking = invoke('GET', { youtube: 'known-active-channel' });
    const inactiveLooking = invoke('GET', { youtube: 'known-inactive-channel' });
    const repeated = invoke('GET', { youtube: ['one', 'two'] });

    for (const response of [activeLooking, inactiveLooking, repeated]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect([...response.headers.entries()]).toEqual([
        ['cache-control', 'no-store'],
        ['content-type', 'application/json; charset=utf-8'],
      ]);
    }
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) (
    'rejects %s deterministically with the public response headers',
    (method) => {
      const response = invoke(method, { youtube: 'channel' });

      expect(response.statusCode).toBe(405);
      expect(response.body).toEqual({ error: 'Method not allowed.' });
      expect(response.headers.get('allow')).toBe('GET');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    },
  );
});

describe('internal runtime metrics', () => {
  it('keeps process diagnostics available to trusted server-side callers', () => {
    const stats = runtimeProcessStats();

    expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(stats.memoryMiB).toEqual(expect.objectContaining({
      rss: expect.any(Number),
      heapUsed: expect.any(Number),
      heapTotal: expect.any(Number),
      external: expect.any(Number),
    }));
    expect(stats.eventLoopDelayMs).toEqual(expect.objectContaining({
      mean: expect.any(Number),
      max: expect.any(Number),
      p99: expect.any(Number),
    }));
  });
});
