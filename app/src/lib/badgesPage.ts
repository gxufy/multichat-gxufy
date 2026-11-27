/*
 * The badges page's rules: reading /api/auth/me, the sign-in link, the owner
 * tools' lists and labels, and which badges the live preview shows.
 *
 * Used by the badges page (web/src/lib/badges). Browser-safe.
 */
import type { BadgeListSize } from '@/lib/communityBadges';
import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import { isSupporterTierId, type SupporterTierId } from '@/lib/supporterTiers';

export type BadgesUser = { id: string; login: string; displayName: string; avatarUrl?: string };
export type BadgesBadge = { id: string; title: string; url: string; owned: boolean; worn: boolean };
export type MeState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; user: BadgesUser; badges: BadgesBadge[]; owner?: boolean };

/** Where Twitch sign-in sends the visitor back: this page, or the generator
 * with the Badges popup open again. */
export function signInHref(next: string): string {
  return `/api/auth/twitch/login?next=${encodeURIComponent(next)}`;
}

export function parseMe(body: unknown): MeState {
  if (!body || typeof body !== 'object') return { kind: 'unavailable' };
  const b = body as { user?: unknown; badges?: unknown; owner?: unknown };
  if (!b.user) return { kind: 'signed-out' };
  const u = b.user as Partial<BadgesUser>;
  if (typeof u.id !== 'string' || typeof u.login !== 'string' || typeof u.displayName !== 'string') {
    return { kind: 'unavailable' };
  }
  const badges = Array.isArray(b.badges)
    ? (b.badges as Partial<BadgesBadge>[]).filter((x): x is BadgesBadge => (
      typeof x.id === 'string' && typeof x.title === 'string' && typeof x.url === 'string'
      && typeof x.owned === 'boolean' && typeof x.worn === 'boolean'
    ))
    : [];
  return {
    kind: 'signed-in',
    user: {
      id: u.id,
      login: u.login,
      displayName: u.displayName,
      ...(typeof u.avatarUrl === 'string' ? { avatarUrl: u.avatarUrl } : {}),
    },
    badges,
    ...(b.owner === true ? { owner: true } : {}),
  };
}

/* Owner only: reload open overlays right away, every one or just the ones
   showing a given channel. */
export const OWNER_REFRESH_PLATFORMS: readonly { value: string; label: string }[] = [
  { value: 'any', label: 'Any platform' },
  { value: 'twitch', label: 'Twitch' },
  { value: 'kick', label: 'Kick' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
];

export type GivenBadgeRow = {
  id: string;
  login: string;
  displayName: string;
  givenAt: string;
  /** Which tier was given (Sanctioned for rows from before tiers). */
  tier?: SupporterTierId;
};

/** The given-badges list from /api/badges/give, keeping only well-formed rows. */
export function parseGivenBadges(value: unknown): GivenBadgeRow[] {
  const list = (value as { given?: unknown } | null)?.given;
  if (!Array.isArray(list)) return [];
  return list
    .filter((row): row is GivenBadgeRow => (
      typeof row === 'object' && row !== null
      && typeof (row as GivenBadgeRow).id === 'string'
      && typeof (row as GivenBadgeRow).login === 'string'
      && typeof (row as GivenBadgeRow).displayName === 'string'
      && typeof (row as GivenBadgeRow).givenAt === 'string'
    ))
    .map(({ id, login, displayName, givenAt, tier }) => ({
      id,
      login,
      displayName,
      givenAt,
      ...(isSupporterTierId(tier) ? { tier } : {}),
    }));
}

/** A Founder given from Owner tools (/api/badges/give `founders`). */
export type GivenFounderRow = { id: string; login: string; displayName: string; givenAt: string };

/** The given Founders from /api/badges/give, keeping only well-formed rows. */
export function parseGivenFounders(value: unknown): GivenFounderRow[] {
  const list = (value as { founders?: unknown } | null)?.founders;
  if (!Array.isArray(list)) return [];
  return list
    .filter((row): row is GivenFounderRow => (
      typeof row === 'object' && row !== null
      && typeof (row as GivenFounderRow).id === 'string'
      && typeof (row as GivenFounderRow).login === 'string'
      && typeof (row as GivenFounderRow).displayName === 'string'
      && typeof (row as GivenFounderRow).givenAt === 'string'
    ))
    .map(({ id, login, displayName, givenAt }) => ({ id, login, displayName, givenAt }));
}

/** Founder spots still open, from /api/badges/give, or null when not given. */
export function parseFounderSlotsLeft(value: unknown): number | null {
  const left = (value as { founderSlotsLeft?: unknown } | null)?.founderSlotsLeft;
  return typeof left === 'number' && Number.isInteger(left) && left >= 0 ? left : null;
}

/** "1.4 MB" / "820 KB". */
export function formatListBytes(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const BADGE_LIST_NAMES: Record<string, string> = {
  'api.chatterino.com/badges': 'Chatterino',
  'chatterinohomies.com/api/badges/list': 'Chatterino Homies (custom)',
  'itzalex.github.io/badges': 'Chatterino Homies',
  'itzalex.github.io/badges2': 'Chatterino Homies (list 2)',
  'api.moltorino.com/v2/badges': 'Moltorino',
  'bluzyrino-badge-registry.blu901-55.workers.dev/v1/badges': 'Bluzyrino',
  'solrino-badges.solrino-badge-server.workers.dev/v2/badges': 'Solrino',
  'api.frankerfacez.com/v1/badges': 'FrankerFaceZ',
  'api.frankerfacez.com/v1/badges/ids': 'FrankerFaceZ (holders)',
  'api.betterttv.net/3/cached/badges': 'BetterTTV',
  'api.betterttv.net/3/cached/badges/twitch': 'BetterTTV (Twitch)',
  'turteg-api.xslash.ovh/v1/ffz/badges': 'Turteg',
  'devpoland.xyz/api/roles': 'PolandBot',
  'api.folhinhabot.com/plus': 'Folhinha',
  'api.chatlee.lol/api/chatlee/badges/chatterino': 'Chatlee',
  'unii.molto.lol/badges': 'UChat and YAUTC',
  '/api/twitch/limerino-badges': 'Limerino',
  '/api/twitch/bchat-badges': 'bChat',
  '/api/twitch/badgehq-badges': 'BadgeHQ',
  '/api/twitch/dankchat-badges': 'DankChat',
  '/api/twitch/chatty-badges': 'Chatty',
  '/api/twitch/chatsen-badges': 'Chatsen',
  '/api/twitch/ffzap-badges': 'FFZ:AP',
  '/api/twitch/enhancer-badges': 'Enhancer',
};

/** A plain name for a badge list address (its address when unknown). */
export function badgeListName(list: string): string {
  return BADGE_LIST_NAMES[list] ?? list;
}

/** 'ok' below 75% of the limit, 'watch' from 75%, 'act' from 90% or over. */
export function badgeListLevel(row: BadgeListSize): 'ok' | 'watch' | 'act' {
  const share = row.bytes === null ? 1 : row.bytes / row.cap;
  return share >= 0.9 ? 'act' : share >= 0.75 ? 'watch' : 'ok';
}

/** Preview identity without our own badge, so wearing/taking it off is what decides. */
export function withoutFlossChatBadge(identity: PreviewIdentityResponse | null): PreviewIdentityResponse | null {
  if (!identity?.communityBadges?.length) return identity;
  return {
    ...identity,
    communityBadges: identity.communityBadges.filter((badge) => !/gxufy/i.test(badge.type)),
  };
}

export function signInNote(flag: string | null): string {
  if (flag === 'cancelled') return 'Sign-in was cancelled.';
  if (flag === 'failed') return 'Sign-in did not work. Please try again.';
  return '';
}
