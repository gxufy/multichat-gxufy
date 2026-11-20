/* The SQLite supporter store: grants, refunds, wear/take off, the one-time
 * purchase notice, the dev JSON carry-over and the daily backups. */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_KEEP,
  SupporterStore,
  __closeSupporterStoresForTests,
  backupSupporterStore,
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
    expect(JSON.stringify(purchaseNoticeBody({ ...order, kind: 'gift' }))).toContain('Gift');
    const none = purchaseNoticeBody({ ...order, kind: 'none', recipient: null });
    expect(JSON.stringify(none)).toContain('Support only');
    expect(JSON.stringify(none)).not.toContain('Twitch ID');
    expect(purchaseNoticeBody({ ...order, recipient: { id: '1', login: '@everyone', displayName: '@here' } }).allowed_mentions).toEqual({ parse: [] });
  });
});
