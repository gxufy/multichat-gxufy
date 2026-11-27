/* /api/v1/badges: the public FlossChat badge list for other chat clients. */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '@/api/v1/badges';
import { SupporterStore, __closeSupporterStoresForTests } from '@/lib/server/supporterStore';

let dir = '';
let storePath = '';

async function call(method = 'GET', query: Record<string, string> = {}) {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: any;
  const req = { method, query, headers: {} } as unknown as ApiRequest;
  const res = {
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
    end() { return this; },
  } as unknown as ApiResponse;
  await handler(req, res);
  return { statusCode, body, headers };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-public-'));
  storePath = path.join(dir, 'supporters.db');
  vi.stubEnv('GXUFY_SUPPORTER_STORE_PATH', storePath);
});

afterEach(() => {
  vi.unstubAllEnvs();
  __closeSupporterStoresForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('/api/v1/badges', () => {
  it('lists the badge with absolute image URLs in four sizes and who wears it', async () => {
    const store = new SupporterStore(storePath);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'r', recipient: { id: '123', login: 'viewer', displayName: 'Viewer' }, amountCents: 500 });
    await store.markCompleted('ORDER1', 'CAPTURE1');
    await store.recordCreated({ orderId: 'ORDER2', reference: 'r2', recipient: { id: '456', login: 'shy', displayName: 'Shy' }, amountCents: 500 });
    await store.markCompleted('ORDER2', 'CAPTURE2');
    await store.setBadgeWorn('456', false);

    const out = await call();
    expect(out.statusCode).toBe(200);
    expect(out.headers['access-control-allow-origin']).toBe('*');
    expect(out.headers['cache-control']).toBe('public, max-age=60');
    expect(out.body.provider).toBe('FlossChat');
    expect(out.body.badges.map((b: { id: string }) => b.id)).toEqual(['owner', 'founder', 'top-suvy', 'suvy', 'supporter']);
    const badge = out.body.badges.find((b: { id: string }) => b.id === 'supporter');
    expect(badge.title).toBe('Sanctioned');
    expect(badge.urls).toEqual({
      '1x': 'https://flosschat.app/badges/gxufy/supporter/1x.webp',
      '2x': 'https://flosschat.app/badges/gxufy/supporter/2x.webp',
      '3x': 'https://flosschat.app/badges/gxufy/supporter/3x.webp',
      '4x': 'https://flosschat.app/badges/gxufy/supporter/4x.webp',
    });
    expect(badge.staticUrls['1x']).toBe('https://flosschat.app/badges/gxufy/supporter/1x.png');
    /* One badge each: 123 wears Sanctioned (Founder too is theirs, not picked);
       456 took theirs off, so is listed nowhere. */
    expect(badge.users).toEqual(['123']);
    expect(out.body.badges.find((b: { id: string }) => b.id === 'founder').users).toEqual([]);
    expect(out.body.badges.flatMap((b: { users: string[] }) => b.users)).not.toContain('456');
    expect(out.body.badges.find((b: { id: string }) => b.id === 'owner').users).toEqual(['204219574']);
    expect(out.body.badges.find((b: { id: string }) => b.id === 'owner').urls['4x']).toBe('https://flosschat.app/badges/gxufy/owner/4x.webp');
  });

  it('filters by one Twitch user ID', async () => {
    expect((await call('GET', { user: '204219574' })).body.badges.map((b: { id: string; users: string[] }) => [b.id, b.users])).toEqual([['owner', ['204219574']]]);
    expect((await call('GET', { user: '777' })).body.badges).toEqual([]);
    expect((await call('GET', { user: 'not-a-number' })).statusCode).toBe(400);
  });

  it('is read-only and answers CORS preflight', async () => {
    expect((await call('POST')).statusCode).toBe(405);
    const preflight = await call('OPTIONS');
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
  });
});
