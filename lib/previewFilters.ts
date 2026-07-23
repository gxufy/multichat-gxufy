/** Shared filtering helpers used by both the production overlay and the
 * generator preview.  Keeps blacklist / bot / moderation rules in one place.
 */
import type { UnifiedMessage } from './types';

/* ── Known bots — matches pages/multichat.tsx ─────────────────────────── */

const KNOWN_BOTS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'moobot',
  'titlechange_bot', 'supibot', 'pajbot', 'huwobot',
  'oshbt', 'spanixbot', 'potatbotat', 'streamqbot', 'twirapp',
  'fossabot', 'wizebot', 'botisimo', 'sery_bot', 'soundalerts',
]);

/* ── Configuration type (minimal subset needed for filtering) ──────────── */

export interface FilterConfig {
  botNames: string;
  userBL: string;
  prefixBL: string;
  showSystemMsgs: boolean;
  showRedeems: boolean;
  modAction: boolean;
}

const DEFAULT_FILTER_CONFIG: FilterConfig = {
  botNames: '',
  userBL: '',
  prefixBL: '',
  showSystemMsgs: true,
  showRedeems: true,
  modAction: true,
};

/* ── Filtered message result ───────────────────────────────────────────── */

export enum FilterResult {
  /** Message passes all filters — display it. */
  Pass = 'pass',
  /** Blocked by user blacklist or known-bot list. */
  UserBlocked = 'userBlocked',
  /** Blocked by message-prefix blacklist. */
  PrefixBlocked = 'prefixBlocked',
  /** System/redeem message suppressed by config. */
  ContentFiltered = 'contentFiltered',
}

export interface FilterDecision {
  result: FilterResult;
  /** The username that triggered the block (for UI feedback). */
  username?: string;
}

/* ── Core filter function ─────────────────────────────────────────────── */

/** Evaluate a UnifiedMessage against blacklist / bot / moderation rules.
 *
 * Returns PASS when the message should be displayed, or a reason it was
 * filtered so the preview can show a toast / indicator. */
export function filterMessage(
  um: UnifiedMessage,
  cfg: Partial<FilterConfig>,
): FilterDecision {
  const c = { ...DEFAULT_FILTER_CONFIG, ...cfg };

  /* 1. Bot name check — known bots + configured bots + user blacklist */
  const u = um.username.toLowerCase();
  const extraBots = new Set(
    (c.botNames || '').split(',').flatMap((b: string) => b.trim().split(' ')).filter(Boolean).map((b: string) => b.toLowerCase()),
  );
  const userBlacklist = new Set(
    (c.userBL || '').split(/\s+/).filter(Boolean).map((u: string) => u.toLowerCase()),
  );

  if (KNOWN_BOTS.has(u) || extraBots.has(u) || userBlacklist.has(u)) {
    return { result: FilterResult.UserBlocked, username: um.username };
  }

  /* 2. Prefix blacklist — only for chat messages */
  if (um.kind === 'chat' && c.prefixBL) {
    const prefixes = c.prefixBL.split(/\s+/).filter(Boolean);
    if (prefixes.some(p => um.text.startsWith(p))) {
      return { result: FilterResult.PrefixBlocked };
    }
  }

  /* 3. System / redeem content filter */
  if (um.kind === 'system' && !c.showSystemMsgs) {
    return { result: FilterResult.ContentFiltered };
  }
  if (um.redeem && !c.showRedeems) {
    return { result: FilterResult.ContentFiltered };
  }

  return { result: FilterResult.Pass };
}

/* ── Moderation action guard ───────────────────────────────────────────── */

/** Whether a moderation action (delete / clear) should be applied. */
export function allowModAction(cfg: Partial<FilterConfig>): boolean {
  return (cfg.modAction ?? true) !== false;
}

/* ── Mention tracking context ──────────────────────────────────────────── */

/** Lightweight mention context builder — tracks chatters and their display colors.
 *
 * Mirrors the production `mentionCtx` shape from render.ts. */
export interface SimMentionCtx {
  enabled: boolean;
  colors: Map<string, string>;
}

export function makeMentionCtx(enabled: boolean): SimMentionCtx {
  return { enabled, colors: new Map() };
}

/** Register a chatter so that @mentions in future messages get colored. */
export function registerChatter(ctx: SimMentionCtx, username: string, color: string): void {
  if (!ctx.enabled) return;
  ctx.colors.set(username.toLowerCase(), color);
}
