import { createHash } from 'crypto';
import { openSupporterStore } from './supporterStore';

import type { LimerinoBadgeFile } from '../limerinoBadges';

export type GxufyBadgeDefinition = {
  id: string;
  title: string;
  /** Single large image (support page, previews). */
  url: string;
  /**
   * Sized set, same shape as Limerino's: `${host}/${file.name}`. The overlay
   * picks the size that fits the badge slot and screen, like Limerino badges.
   */
  host?: string;
  files?: LimerinoBadgeFile[];
  userIds: string[];
};

const SIZED_FILES = (frames: number): LimerinoBadgeFile[] => ([18, 36, 54, 72] as const).flatMap((width, index) => [
  { name: `${index + 1}x.webp`, staticName: `${index + 1}x.png`, width, height: width, frameCount: frames, format: 'WEBP' as const },
  { name: `${index + 1}x.png`, width, height: width, frameCount: 1, format: 'PNG' as const },
]);

const GXUFY_BADGES: GxufyBadgeDefinition[] = [
  {
    id: 'supporter',
    title: 'FlossChat Supporter',
    url: '/badges/gxufy/supporter-hand.webp',
    host: '/badges/gxufy/supporter',
    files: SIZED_FILES(96),
    userIds: ['204219574'],
  },
];

/** Whether this Twitch id owns the FlossChat badge (fixed list or paid). */
export async function ownsSupporterBadge(
  twitchId: string,
  store = openSupporterStore(),
): Promise<boolean> {
  if (GXUFY_BADGES.some((badge) => badge.id === 'supporter' && badge.userIds.includes(twitchId))) return true;
  try {
    return store ? (await store.supporterIds()).includes(twitchId) : false;
  } catch {
    return false;
  }
}

type Cached = { revision: string; at: number; badges: GxufyBadgeDefinition[]; version: string };
/* Rebuilt anyway after this long, in case two writes ever share a timestamp. */
const MAX_CACHE_MS = 30_000;
let cached: Cached | null = null;

function versionOf(badges: GxufyBadgeDefinition[]): string {
  return createHash('sha256').update(JSON.stringify(badges)).digest('base64url').slice(0, 16);
}

async function build(store: ReturnType<typeof openSupporterStore>): Promise<GxufyBadgeDefinition[]> {
  let paid: string[] = [];
  let hidden: string[] = [];
  try {
    if (store) [paid, hidden] = await Promise.all([store.supporterIds(), store.hiddenIds()]);
  } catch {
    paid = [];
    hidden = [];
  }
  if (!paid.length && !hidden.length) return GXUFY_BADGES;
  const off = new Set(hidden);
  return GXUFY_BADGES.map((badge) => (
    badge.id === 'supporter'
      ? { ...badge, userIds: [...new Set([...badge.userIds, ...paid])].filter((id) => !off.has(id)) }
      : badge
  ));
}

async function current(store = openSupporterStore()): Promise<Cached> {
  let revision = 'none';
  try {
    revision = store ? await store.revision() : 'none';
  } catch {
    revision = `error:${Date.now()}`;
  }
  if (cached && cached.revision === revision && Date.now() - cached.at < MAX_CACHE_MS) return cached;
  const badges = await build(store);
  cached = { revision, at: Date.now(), badges, version: versionOf(badges) };
  return cached;
}

/**
 * The fixed list plus everyone with a completed (not refunded) payment of $5 or more,
 * minus anyone who took the badge off. Re-read only when the store file
 * changes. If the store can't be read, the fixed list still answers.
 */
export async function getGxufyBadges(
  store = openSupporterStore(),
): Promise<GxufyBadgeDefinition[]> {
  return (await current(store)).badges;
}

/** A short fingerprint of the list; overlays poll it to notice changes fast. */
export async function getGxufyBadgesVersion(
  store = openSupporterStore(),
): Promise<string> {
  return (await current(store)).version;
}

export function __resetGxufyBadgesCacheForTests(): void {
  cached = null;
}
