/* The SQLite supporter store: grants, refunds, wear/take off, the one-time
 * purchase notice, the dev JSON carry-over and the daily backups. */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_KEEP,
  SupporterStore,
  __closeSupporterStoresForTests,
  backupSupporterStore,
  openSupporterStore,
  supporterStorePath,
} from '@/lib/server/supporterStore';
import { purchaseNoticeBody, sendPurchaseNotice } from '@/lib/server/supporterDiscord';

const VIEWER = { id: '123', login: 'viewer', displayName: 'Viewer' };
let dir = '';
let file = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fc-store-'));
  file = path.join(dir, 'supporters.db');
});

afterEach(() => {
  __closeSupporterStoresForTests();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('supporter store', () => {
  it('defaults to .data/supporters.db only under npm run dev', () => {
    expect(supporterStorePath({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toMatch(/\.data[\\/]supporters\.db$/);
    expect(supporterStorePath({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBeNull();
    expect(supporterStorePath({ NODE_ENV: 'production', GXUFY_SUPPORTER_STORE_PATH: file } as NodeJS.ProcessEnv)).toBe(file);
  });

  it('records, grants once, and keeps the record across a restart', async () => {
    const store = new SupporterStore(file);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'ref', recipient: VIEWER, kind: 'self', amountCents: 500 });
    await store.recordCreated({ orderId: 'ORDER1', reference: 'other', recipient: null, amountCents: 1 });
    expect((await store.getOrder('ORDER1'))).toMatchObject({ status: 'created', kind: 'self', reference: 'ref', amountCents: 500 });
    expect(await store.supporterIds()).toEqual([]);

    const done = await store.markCompleted('ORDER1', 'CAPTURE1');
    expect(done).toMatchObject({ status: 'completed', captureId: 'CAPTURE1', recipient: VIEWER });
    const firstCompletedAt = done!.completedAt;
    expect((await store.markCompleted('ORDER1', 'CAPTURE1'))!.completedAt).toBe(firstCompletedAt);

    __closeSupporterStoresForTests();
    const reopened = new SupporterStore(file);
    expect(await reopened.supporterIds()).toEqual(['123']);
    expect(await reopened.getOrder('ORDER1')).toMatchObject({ status: 'completed', captureId: 'CAPTURE1' });
  });

  it('never lets one capture complete two orders', async () => {
    const store = new SupporterStore(file);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'a', recipient: VIEWER, amountCents: 500 });
    await store.recordCreated({ orderId: 'ORDER2', reference: 'b', recipient: { ...VIEWER, id: '456' }, amountCents: 500 });
    await store.markCompleted('ORDER1', 'CAPTURE1');
    expect(await store.markCompleted('ORDER2', 'CAPTURE1')).toBeNull();
    expect(await store.supporterIds()).toEqual(['123']);
    expect(await store.markCompleted('NOPE', 'CAPTURE9')).toBeNull();
  });

  it('claims the purchase notice exactly once, and only for completed orders', async () => {
    const store = new SupporterStore(file);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'a', recipient: VIEWER, amountCents: 500 });
    expect(await store.claimPurchaseNotice('ORDER1')).toBe(false);
    await store.markCompleted('ORDER1', 'CAPTURE1');
    expect(await store.claimPurchaseNotice('ORDER1')).toBe(true);
    expect(await store.claimPurchaseNotice('ORDER1')).toBe(false);
    __closeSupporterStoresForTests();
    expect(await new SupporterStore(file).claimPurchaseNotice('ORDER1')).toBe(false);
  });

  it('a reversal takes the badge back and is idempotent', async () => {
    const store = new SupporterStore(file);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'a', recipient: VIEWER, amountCents: 500 });
    await store.markCompleted('ORDER1', 'CAPTURE1');
    expect(await store.markReversed('CAPTURE1')).toMatchObject({ status: 'reversed' });
    expect(await store.markReversed('CAPTURE1')).toMatchObject({ status: 'reversed' });
    expect(await store.markReversed('UNKNOWN')).toBeNull();
    expect(await store.supporterIds()).toEqual([]);
    expect(await store.markCompleted('ORDER1', 'CAPTURE1')).toMatchObject({ status: 'reversed' });
  });

  it('notes the first try at taking a payment and each PayPal check, without moving the revision', async () => {
    const store = new SupporterStore(file);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'a', recipient: VIEWER, amountCents: 500 });
    await store.recordCreated({ orderId: 'ORDER2', reference: 'b', recipient: VIEWER, amountCents: 500 });
    const revision = await store.revision();
    const since = new Date('2026-01-01T00:00:00Z');
    expect(await store.payPalRecheckCandidates(since, since)).toEqual([]);

    await store.markCaptureTried('ORDER1', new Date('2026-11-23T10:00:00Z'));
    await store.markCaptureTried('ORDER1', new Date('2026-11-23T11:00:00Z'));
    expect(await store.payPalRecheckCandidates(since, since)).toEqual([{
      orderId: 'ORDER1', status: 'created', captureId: null, completedAt: null,
      captureTriedAt: '2026-11-23T10:00:00.000Z', checkedAt: null,
    }]);
    expect(await store.payPalRecheckCandidates(since, new Date('2026-11-23T10:30:00Z'))).toEqual([]);

    await store.markCompleted('ORDER2', 'CAPTURE2');
    await store.markCaptureTried('ORDER2');
    await store.markPayPalChecked('ORDER2', new Date('2026-11-23T12:00:00Z'));
    const after = await store.payPalRecheckCandidates(since, since);
    expect(after.find((c) => c.orderId === 'ORDER2')).toMatchObject({
      status: 'completed', captureId: 'CAPTURE2', captureTriedAt: null, checkedAt: '2026-11-23T12:00:00.000Z',
    });
    expect(await store.payPalRecheckCandidates(new Date(Date.now() + 60_000), since)).toHaveLength(1);

    await store.markReversed('CAPTURE2');
    expect((await store.payPalRecheckCandidates(since, since)).map((c) => c.orderId)).toEqual(['ORDER1']);
    /* Only the grant and the refund moved it. */
    expect(await store.revision()).toBe(`${file}|${Number(revision.split('|')[1]) + 2}`);
  });

  it('adds the PayPal check columns to an existing database in place', async () => {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as {
      DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
    };
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE orders (order_id TEXT PRIMARY KEY, reference TEXT NOT NULL, recipient_id TEXT,
      recipient_login TEXT, recipient_display TEXT, kind TEXT NOT NULL DEFAULT 'none', amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'completed', 'reversed')), capture_id TEXT UNIQUE,
      created_at TEXT NOT NULL, completed_at TEXT, reversed_at TEXT, notified_at TEXT, tier TEXT)`);
    old.exec(`INSERT INTO orders (order_id, reference, recipient_id, recipient_login, recipient_display, kind, amount_cents,
      status, capture_id, created_at, completed_at) VALUES ('ORDER1', 'a', '123', 'viewer', 'Viewer', 'gift', 500,
      'completed', 'CAPTURE1', '2026-11-23T21:54:00.000Z', '2026-11-23T21:55:09.325Z')`);
    old.close();

    const store = new SupporterStore(file);
    expect(await store.supporterIds()).toEqual(['123']);
    expect(await store.payPalRecheckCandidates(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'))).toEqual([{
      orderId: 'ORDER1', status: 'completed', captureId: 'CAPTURE1', completedAt: '2026-11-23T21:55:09.325Z',
      captureTriedAt: null, checkedAt: null,
    }]);
  });

  it('wear / take off, with a revision that changes only on real changes', async () => {
    const store = new SupporterStore(file);
    const r0 = await store.revision();
    expect(r0.startsWith(`${file}|`)).toBe(true);
    await store.setBadgeWorn('123', false);
    const r1 = await store.revision();
    expect(r1).not.toBe(r0);
    expect(await store.hiddenIds()).toEqual(['123']);
    await store.setBadgeWorn('123', false);
    expect(await store.revision()).toBe(r1);
    await store.setBadgeWorn('123', true);
    expect(await store.hiddenIds()).toEqual([]);
    expect(await store.revision()).not.toBe(r1);
  });

  it('remembers the one badge picked; picking shows it again, and only real changes move the revision', async () => {
    const store = new SupporterStore(file);
    await store.setBadgeWorn('123', false);
    const r0 = await store.revision();
    await store.selectBadge('123', 'founder');
    expect(await store.selections()).toEqual(new Map([['123', 'founder']]));
    expect(await store.hiddenIds()).toEqual([]);
    const r1 = await store.revision();
    expect(r1).not.toBe(r0);
    await store.selectBadge('123', 'founder');
    expect(await store.revision()).toBe(r1);
    await store.selectBadge('123', 'suvy');
    expect(await store.selections()).toEqual(new Map([['123', 'suvy']]));
    expect(await store.revision()).not.toBe(r1);
  });

  it('carries over the earlier dev JSON store once, without re-announcing its purchases', async () => {
    writeFileSync(path.join(dir, 'supporters.json'), JSON.stringify({
      version: 1,
      orders: {
        OLD1: { orderId: 'OLD1', reference: 'r', recipient: VIEWER, amountCents: 500, status: 'completed', captureId: 'CAP1', createdAt: '2026-11-01T00:00:00.000Z', completedAt: '2026-11-01T00:01:00.000Z' },
        OLD2: { orderId: 'OLD2', reference: 'r2', recipient: null, amountCents: 500, status: 'created', createdAt: '2026-11-01T00:00:00.000Z' },
      },
      captures: { CAP1: 'OLD1' },
      hidden: { '999': true },
    }));
    const store = new SupporterStore(file);
    expect(await store.supporterIds()).toEqual(['123']);
    expect(await store.hiddenIds()).toEqual(['999']);
    expect(await store.claimPurchaseNotice('OLD1')).toBe(false);
    expect(await store.getOrder('OLD2')).toMatchObject({ status: 'created', kind: 'none' });
  });

  it('keeps one backup per day and only the newest copies', async () => {
    const store = new SupporterStore(file);
    await store.recordCreated({ orderId: 'ORDER1', reference: 'a', recipient: VIEWER, amountCents: 500 });
    const first = backupSupporterStore(file, new Date('2026-11-01T12:00:00Z'));
    expect(first && existsSync(first)).toBe(true);
    expect(backupSupporterStore(file, new Date('2026-11-01T23:00:00Z'))).toBeNull();
    for (let day = 2; day <= BACKUP_KEEP + 3; day += 1) {
      backupSupporterStore(file, new Date(Date.UTC(2026, 10, day, 12)));
    }
    const copies = readdirSync(path.join(dir, 'backups')).sort();
    expect(copies).toHaveLength(BACKUP_KEEP);
    expect(copies[copies.length - 1]).toBe('supporters-2026-11-17.db');
    __closeSupporterStoresForTests();
    const restored = new SupporterStore(path.join(dir, 'backups', copies[copies.length - 1]!));
    expect(await restored.getOrder('ORDER1')).toMatchObject({ orderId: 'ORDER1' });
  });

  it('makes the daily copy where badges are sold, not in an app that only reads the store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reader = openSupporterStore({ NODE_ENV: 'production', GXUFY_SUPPORTER_STORE_PATH: file, GXUFY_SUPPORTER_STORE_BACKUPS: 'off' } as NodeJS.ProcessEnv);
    expect(await reader!.revision()).toBeTruthy();
    expect(existsSync(path.join(dir, 'backups'))).toBe(false);
    const seller = openSupporterStore({ NODE_ENV: 'production', GXUFY_SUPPORTER_STORE_PATH: file } as NodeJS.ProcessEnv);
    expect(seller).not.toBeNull();
    expect(readdirSync(path.join(dir, 'backups'))).toHaveLength(1);
  });
});

describe('purchase notice', () => {
  const order = {
    orderId: 'ORDER1', reference: 'r', recipient: VIEWER, kind: 'self' as const, amountCents: 500,
    status: 'completed' as const, captureId: 'CAP1', createdAt: '2026-11-01T00:00:00.000Z', completedAt: '2026-11-01T00:01:00.000Z',
  };

  it('stays quiet without a valid Discord webhook', async () => {
    let called = false;
    const fetcher = (() => { called = true; return Promise.resolve(new Response(null, { status: 204 })); }) as typeof fetch;
    expect(await sendPurchaseNotice(order, {} as NodeJS.ProcessEnv, fetcher)).toBe('unconfigured');
    expect(await sendPurchaseNotice(order, { GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL: 'https://evil.example/api/webhooks/1/2' } as unknown as NodeJS.ProcessEnv, fetcher)).toBe('unconfigured');
    expect(called).toBe(false);
  });

  it('labels self, gift and support-only purchases and never pings anyone', () => {
    expect(JSON.stringify(purchaseNoticeBody(order))).toContain('For themselves');
    expect(JSON.stringify(purchaseNoticeBody(order))).toContain('New FlossChat Sanctioned badge');
    expect(JSON.stringify(purchaseNoticeBody({ ...order, tier: 'top-suvy' }))).toContain('New FlossChat Top Suvy badge');
    expect(JSON.stringify(purchaseNoticeBody({ ...order, kind: 'gift' }))).toContain('Gift');
    const none = purchaseNoticeBody({ ...order, kind: 'none', recipient: null });
    expect(JSON.stringify(none)).toContain('Support only');
    expect(JSON.stringify(none)).not.toContain('Twitch ID');
    expect(purchaseNoticeBody({ ...order, recipient: { id: '1', login: '@everyone', displayName: '@here' } }).allowed_mentions).toEqual({ parse: [] });
  });
});
