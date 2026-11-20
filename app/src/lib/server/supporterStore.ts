/*
 * Who has paid for the FlossChat supporter badge.
 *
 * A SQLite database (Node's built-in `node:sqlite`, no extra package). Every
 * change runs in one transaction, so a payment is either fully recorded or not
 * at all, and two requests for the same capture can never grant twice.
 *
 * Under `npm run dev` it defaults to .data/supporters.db next to where the
 * server runs (git-ignored). In production the location must be set explicitly
 * with GXUFY_SUPPORTER_STORE_PATH (outside the deploy folder); without it the
 * store is off and checkout refuses.
 *
 * Backups: once a day the database is copied (VACUUM INTO) to a `backups`
 * folder next to it, keeping the newest BACKUP_KEEP copies.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  OVERLAY_REFRESH_PLATFORMS,
  type OverlayOwnerCommand,
  type OverlayRefreshTarget,
} from '../overlayRefreshWatcher';

export type SupportRecipient = { id: string; login: string; displayName: string };

/** A badge the owner gave from Owner tools, with no payment. */
export type GivenBadge = SupportRecipient & { givenAt: string };

/** self: bought for the signed-in account. gift: for a Twitch name. none: support only. */
export type SupportOrderKind = 'self' | 'gift' | 'none';

export type SupportOrderRecord = {
  orderId: string;
  reference: string;
  recipient: SupportRecipient | null;
  kind: SupportOrderKind;
  amountCents: number;
  status: 'created' | 'completed' | 'reversed';
  captureId?: string;
  createdAt: string;
  completedAt?: string;
  reversedAt?: string;
};

export const BACKUP_KEEP = 14;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LEGACY_JSON_NAME = 'supporters.json';

/* "Refresh one channel" requests are kept just long enough for every open
   overlay to see one (they ask about once a minute). */
export const OVERLAY_REFRESH_TARGET_TTL_MS = 10 * 60_000;
export const OVERLAY_REFRESH_TARGETS_MAX = 20;
/* Commands sent from Owner tools run on overlays that are open at the time, so
   they are kept only briefly. */
export const OVERLAY_OWNER_COMMAND_TTL_MS = 2 * 60_000;
export const OVERLAY_OWNER_COMMANDS_MAX = 20;

function liveOwnerCommands(raw: string, now: number): OverlayOwnerCommand[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { id, platform, channel, text, at } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof text !== 'string' || !text) return [];
    if (typeof platform !== 'string' || !(OVERLAY_REFRESH_PLATFORMS as readonly string[]).includes(platform)) return [];
    if (typeof channel !== 'string' || !channel) return [];
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= now - OVERLAY_OWNER_COMMAND_TTL_MS) return [];
    return [{ id, platform: platform as OverlayOwnerCommand['platform'], channel, text, at }];
  });
}

function liveRefreshTargets(raw: string, now: number): OverlayRefreshTarget[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { platform, channel, at } = item as Record<string, unknown>;
    if (typeof platform !== 'string' || !(OVERLAY_REFRESH_PLATFORMS as readonly string[]).includes(platform)) return [];
    if (typeof channel !== 'string' || !channel) return [];
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= now - OVERLAY_REFRESH_TARGET_TTL_MS) return [];
    return [{ platform: platform as OverlayRefreshTarget['platform'], channel, at }];
  });
}

export function supporterStorePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.GXUFY_SUPPORTER_STORE_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  if (env.NODE_ENV !== 'development') return null;
  return path.resolve(process.cwd(), '.data', 'supporters.db');
}

/* ------------------------------------------------------------------ */
/* SQLite plumbing                                                     */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Statement = {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
};
type Database = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
type SqliteModule = { DatabaseSync: new (file: string) => Database };

/*
 * Loaded at runtime rather than imported, so the bundler never has to know the
 * module, and a Node without it turns the store off instead of crashing.
 */
function loadSqlite(): SqliteModule | null {
  try {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    return (getBuiltin?.('node:sqlite') as SqliteModule | undefined) ?? null;
  } catch {
    return null;
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    reference TEXT NOT NULL,
    recipient_id TEXT,
    recipient_login TEXT,
    recipient_display TEXT,
    kind TEXT NOT NULL DEFAULT 'none',
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created', 'completed', 'reversed')),
    capture_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    reversed_at TEXT,
    notified_at TEXT
  );
  CREATE INDEX IF NOT EXISTS orders_recipient ON orders (recipient_id, status);
  CREATE TABLE IF NOT EXISTS hidden (twitch_id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS given (
    twitch_id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    display TEXT NOT NULL,
    given_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO meta (key, value) VALUES ('revision', '0');
`;

/* One connection per file, shared across Next's route modules (globalThis). */
type Shared = { connections: Map<string, Database>; backupTimers: Map<string, ReturnType<typeof setInterval>> };
const shared: Shared = ((globalThis as Record<string, unknown>).__flosschatSupporterDb ??= {
  connections: new Map(),
  backupTimers: new Map(),
}) as Shared;

function connect(file: string): Database {
  const open = shared.connections.get(file);
  if (open) return open;
  const sqlite = loadSqlite();
  if (!sqlite) throw new Error('node:sqlite is not available in this Node version');
  mkdirSync(path.dirname(file), { recursive: true });
  const isNew = !existsSync(file);
  const db = new sqlite.DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  if (isNew) importLegacyJson(db, file);
  shared.connections.set(file, db);
  return db;
}

function transaction<T>(db: Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function bumpRevision(db: Database): void {
  db.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'revision'").run();
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toRecord(row: Row): SupportOrderRecord {
  const recipientId = str(row.recipient_id);
  const kind = str(row.kind);
  return {
    orderId: String(row.order_id),
    reference: String(row.reference),
    recipient: recipientId
      ? { id: recipientId, login: str(row.recipient_login) ?? '', displayName: str(row.recipient_display) ?? '' }
      : null,
    kind: kind === 'self' || kind === 'gift' ? kind : 'none',
    amountCents: Number(row.amount_cents),
    status: row.status as SupportOrderRecord['status'],
    ...(str(row.capture_id) ? { captureId: str(row.capture_id) } : {}),
    createdAt: String(row.created_at),
    ...(str(row.completed_at) ? { completedAt: str(row.completed_at) } : {}),
    ...(str(row.reversed_at) ? { reversedAt: str(row.reversed_at) } : {}),
  };
}

/*
 * One-time carry-over from the earlier JSON store (only ever used under
 * `npm run dev`): when a new database is created next to a supporters.json,
 * its orders and taken-off badges are copied in. The JSON file is left as is.
 */
function importLegacyJson(db: Database, file: string): void {
  const legacy = path.join(path.dirname(file), LEGACY_JSON_NAME);
  if (path.resolve(legacy) === path.resolve(file) || !existsSync(legacy)) return;
  let data: {
    orders?: Record<string, Partial<SupportOrderRecord>>;
    hidden?: Record<string, true>;
  };
  try {
    data = JSON.parse(readFileSync(legacy, 'utf8'));
  } catch {
    return;
  }
  transaction(db, () => {
    const insert = db.prepare(`INSERT OR IGNORE INTO orders
      (order_id, reference, recipient_id, recipient_login, recipient_display, kind, amount_cents,
       status, capture_id, created_at, completed_at, reversed_at, notified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const order of Object.values(data.orders ?? {})) {
      if (!order?.orderId || !order.reference || !order.status || !order.createdAt) continue;
      insert.run(
        order.orderId, order.reference,
        order.recipient?.id ?? null, order.recipient?.login ?? null, order.recipient?.displayName ?? null,
        order.recipient ? 'gift' : 'none', order.amountCents ?? 0, order.status,
        order.captureId ?? null, order.createdAt, order.completedAt ?? null, order.reversedAt ?? null,
        /* Already-imported purchases are never announced again. */
        order.status === 'created' ? null : new Date().toISOString(),
      );
    }
    const hide = db.prepare('INSERT OR IGNORE INTO hidden (twitch_id) VALUES (?)');
    for (const id of Object.keys(data.hidden ?? {})) hide.run(id);
    bumpRevision(db);
  });
}

/* ------------------------------------------------------------------ */
/* Backups                                                             */
/* ------------------------------------------------------------------ */

function backupDir(file: string): string {
  return path.join(path.dirname(file), 'backups');
}

/**
 * Copy the database to backups/<name>-YYYY-MM-DD.db (once per day) and keep
 * only the newest BACKUP_KEEP copies. Returns the backup path, or null when
 * today's copy already exists.
 */
export function backupSupporterStore(file: string, now = new Date()): string | null {
  const db = connect(file);
  const dir = backupDir(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const target = path.join(dir, `${base}-${now.toISOString().slice(0, 10)}.db`);
  if (existsSync(target)) return null;
  db.prepare('VACUUM INTO ?').run(target);
  const copies = readdirSync(dir)
    .filter((name) => name.startsWith(`${base}-`) && name.endsWith('.db'))
    .sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - BACKUP_KEEP))) {
    unlinkSync(path.join(dir, old));
  }
  return target;
}

function scheduleBackups(file: string): void {
  if (shared.backupTimers.has(file) || process.env.NODE_ENV === 'test') return;
  const run = () => {
    try {
      backupSupporterStore(file);
    } catch (error) {
      console.error('Supporter store backup failed:', error instanceof Error ? error.message : error);
    }
  };
  const timer = setInterval(run, BACKUP_INTERVAL_MS);
  timer.unref?.();
  shared.backupTimers.set(file, timer);
  run();
}

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* ------------------------------------------------------------------ */

export class SupporterStore {
  constructor(private readonly file: string) {}

  private get db(): Database {
    return connect(this.file);
  }

  async getOrder(orderId: string): Promise<SupportOrderRecord | null> {
    const row = this.db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
    return row ? toRecord(row) : null;
  }

  async recordCreated(
    order: Omit<SupportOrderRecord, 'status' | 'createdAt' | 'kind'> & { kind?: SupportOrderKind },
  ): Promise<void> {
    const db = this.db;
    transaction(db, () => {
      const result = db.prepare(`INSERT OR IGNORE INTO orders
        (order_id, reference, recipient_id, recipient_login, recipient_display, kind, amount_cents, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?)`).run(
        order.orderId,
        order.reference,
        order.recipient?.id ?? null,
        order.recipient?.login ?? null,
        order.recipient?.displayName ?? null,
        order.kind ?? (order.recipient ? 'gift' : 'none'),
        order.amountCents,
        new Date().toISOString(),
      );
      if (Number(result.changes) > 0) bumpRevision(db);
    });
  }

  /** Idempotent: the same capture id never grants twice. */
  async markCompleted(orderId: string, captureId: string): Promise<SupportOrderRecord | null> {
    const db = this.db;
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
      if (!row) return null;
      const owner = db.prepare('SELECT order_id FROM orders WHERE capture_id = ?').get(captureId);
      if (owner && owner.order_id !== orderId) return null;
      if (row.status === 'created') {
        db.prepare(`UPDATE orders SET status = 'completed', capture_id = ?, completed_at = ?
          WHERE order_id = ? AND status = 'created'`).run(captureId, new Date().toISOString(), orderId);
        bumpRevision(db);
      }
      return toRecord(db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId)!);
    });
  }

  /**
   * True exactly once per completed order — the caller then sends the
   * purchase notice. A second capture call, a retry or a restart gets false.
   */
  async claimPurchaseNotice(orderId: string): Promise<boolean> {
    const db = this.db;
    return transaction(db, () => Number(db.prepare(`UPDATE orders SET notified_at = ?
      WHERE order_id = ? AND status = 'completed' AND notified_at IS NULL`)
      .run(new Date().toISOString(), orderId).changes) === 1);
  }

  /** Refunded / reversed / denied capture: the badge comes off. */
  async markReversed(captureId: string): Promise<SupportOrderRecord | null> {
    const db = this.db;
    return transaction(db, () => {
      const row = db.prepare('SELECT * FROM orders WHERE capture_id = ?').get(captureId);
      if (!row) return null;
      if (row.status !== 'reversed') {
        db.prepare("UPDATE orders SET status = 'reversed', reversed_at = ? WHERE capture_id = ?")
          .run(new Date().toISOString(), captureId);
        bumpRevision(db);
      }
      return toRecord(db.prepare('SELECT * FROM orders WHERE capture_id = ?').get(captureId)!);
    });
  }

  /** Wear (true) or take off (false) the badge for this Twitch id. */
  async setBadgeWorn(twitchId: string, worn: boolean): Promise<void> {
    const db = this.db;
    transaction(db, () => {
      const result = worn
        ? db.prepare('DELETE FROM hidden WHERE twitch_id = ?').run(twitchId)
        : db.prepare('INSERT OR IGNORE INTO hidden (twitch_id) VALUES (?)').run(twitchId);
      if (Number(result.changes) > 0) bumpRevision(db);
    });
  }

  /** Twitch ids whose badge is currently taken off. */
  async hiddenIds(): Promise<string[]> {
    return this.db.prepare('SELECT twitch_id FROM hidden ORDER BY twitch_id').all().map((row) => String(row.twitch_id));
  }

  /**
   * Changes whenever anything is written (grant, refund, wear/take off), so
   * the badge list can be cached until then. Includes the file path, so two
   * stores never share a cached list.
   */
  async revision(): Promise<string> {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'revision'").get();
    return `${this.file}|${row ? String(row.value) : '0'}`;
  }

  /** The owner's "refresh all overlays" stamp (ms), 0 when never sent. */
  async overlayRefreshToken(): Promise<number> {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'overlay_refresh'").get();
    const value = row ? Number(row.value) : 0;
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  /** Store a new refresh stamp; never goes backwards. Returns the stamp in force. */
  async setOverlayRefreshToken(at: number): Promise<number> {
    const db = this.db;
    return transaction(db, () => {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'overlay_refresh'").get();
      const current = row ? Number(row.value) : 0;
      const next = Math.max(Number.isSafeInteger(current) ? current : 0, Math.floor(at));
      db.prepare("INSERT INTO meta (key, value) VALUES ('overlay_refresh', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(next));
      return next;
    });
  }

  /** The owner's recent "refresh one channel" requests, newest last. */
  async overlayRefreshTargets(now: number): Promise<OverlayRefreshTarget[]> {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'overlay_refresh_targets'").get();
    return liveRefreshTargets(row ? String(row.value) : '', now);
  }

  /** Record a "refresh one channel"; keeps only recent ones. Returns the list in force. */
  async addOverlayRefreshTarget(
    target: Omit<OverlayRefreshTarget, 'at'>,
    at: number,
  ): Promise<OverlayRefreshTarget[]> {
    const db = this.db;
    return transaction(db, () => {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'overlay_refresh_targets'").get();
      const kept = liveRefreshTargets(row ? String(row.value) : '', at)
        .filter((old) => !(old.platform === target.platform && old.channel === target.channel));
      const next = [...kept, { ...target, at: Math.floor(at) }].slice(-OVERLAY_REFRESH_TARGETS_MAX);
      db.prepare("INSERT INTO meta (key, value) VALUES ('overlay_refresh_targets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(next));
      return next;
    });
  }

  /** Commands sent from Owner tools in the last two minutes, oldest first. */
  async overlayOwnerCommands(now: number): Promise<OverlayOwnerCommand[]> {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'overlay_owner_commands'").get();
    return liveOwnerCommands(row ? String(row.value) : '', now);
  }

  /** Record a command for one channel's overlays. Returns it as stored. */
  async addOverlayOwnerCommand(
    command: Omit<OverlayOwnerCommand, 'id' | 'at'>,
    at: number,
  ): Promise<OverlayOwnerCommand> {
    const db = this.db;
    const added: OverlayOwnerCommand = { id: randomUUID(), ...command, at: Math.floor(at) };
    return transaction(db, () => {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'overlay_owner_commands'").get();
      const next = [...liveOwnerCommands(row ? String(row.value) : '', at), added].slice(-OVERLAY_OWNER_COMMANDS_MAX);
      db.prepare("INSERT INTO meta (key, value) VALUES ('overlay_owner_commands', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(next));
      return added;
    });
  }

  /** Twitch ids that own the badge: a completed, not-reversed payment, or
      a badge given from Owner tools. */
  async supporterIds(): Promise<string[]> {
    return this.db.prepare(`SELECT recipient_id AS id FROM orders
        WHERE status = 'completed' AND recipient_id IS NOT NULL
      UNION SELECT twitch_id FROM given
      ORDER BY 1`)
      .all().map((row) => String(row.id));
  }

  /** Badges given from Owner tools, newest first. */
  async givenBadges(): Promise<GivenBadge[]> {
    return this.db.prepare('SELECT twitch_id, login, display, given_at FROM given ORDER BY given_at DESC, twitch_id')
      .all().map((row) => ({
        id: String(row.twitch_id),
        login: String(row.login),
        displayName: String(row.display),
        givenAt: String(row.given_at),
      }));
  }

  /** Give the badge to this Twitch account, free. Giving it again keeps the
      first date; the name is refreshed in case the account was renamed. */
  async giveBadge(recipient: SupportRecipient, at: Date = new Date()): Promise<GivenBadge> {
    const db = this.db;
    return transaction(db, () => {
      db.prepare(`INSERT INTO given (twitch_id, login, display, given_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(twitch_id) DO UPDATE SET login = excluded.login, display = excluded.display`)
        .run(recipient.id, recipient.login, recipient.displayName, at.toISOString());
      bumpRevision(db);
      const row = db.prepare('SELECT given_at FROM given WHERE twitch_id = ?').get(recipient.id);
      return { ...recipient, givenAt: String(row?.given_at ?? at.toISOString()) };
    });
  }

  /** Take back a badge given from Owner tools. A paid badge is not touched
      (that goes back only through a PayPal refund). True if one was removed. */
  async takeBackGivenBadge(twitchId: string): Promise<boolean> {
    const db = this.db;
    return transaction(db, () => {
      const result = db.prepare('DELETE FROM given WHERE twitch_id = ?').run(twitchId);
      const removed = Number(result.changes) > 0;
      if (removed) bumpRevision(db);
      return removed;
    });
  }
}

export function openSupporterStore(env: NodeJS.ProcessEnv = process.env): SupporterStore | null {
  const file = supporterStorePath(env);
  if (!file) return null;
  if (!loadSqlite()) {
    console.error('Supporter store is off: this Node version has no node:sqlite (needs Node 22.13+).');
    return null;
  }
  scheduleBackups(file);
  return new SupporterStore(file);
}

/** Tests only: close every open database so temp folders can be removed. */
export function __closeSupporterStoresForTests(): void {
  for (const timer of shared.backupTimers.values()) clearInterval(timer);
  shared.backupTimers.clear();
  for (const db of shared.connections.values()) db.close();
  shared.connections.clear();
}
