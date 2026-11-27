import { createHash } from 'crypto';
import { isOwner, OWNER_TWITCH_IDS } from './owner';
import { openSupporterStore } from './supporterStore';
import {
  FOUNDER_LIMIT,
  isSupporterTierId,
  SUPPORTER_TIERS,
  supporterTier,
  tierForCents,
  tierPrices,
  type SupporterStanding,
} from '../supporterTiers';

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

/*
 * FlossChat's own badges, in the order they show in chat: Owner, Founder,
 * then the supporter tier (supporterTiers.ts). All of them are the owner's
 * hand art: Sanctioned is the original, the others are its tier versions.
 */
const definition = (id: string, title: string, url: string): GxufyBadgeDefinition => ({
  id,
  title,
  url,
  host: `/badges/gxufy/${id}`,
  files: SIZED_FILES(96),
  userIds: [],
});

const GXUFY_BADGES: readonly GxufyBadgeDefinition[] = [
  { ...definition('owner', 'Owner', '/badges/gxufy/owner-hand.webp'), userIds: [...OWNER_TWITCH_IDS] },
  definition('founder', 'Founder', '/badges/gxufy/founder-hand.webp'),
  definition('top-suvy', supporterTier('top-suvy').name, '/badges/gxufy/top-suvy-hand.webp'),
  definition('suvy', supporterTier('suvy').name, '/badges/gxufy/suvy-hand.webp'),
  definition('supporter', supporterTier('supporter').name, '/badges/gxufy/supporter-hand.webp'),
];

/** The top tier: the owner's account holds it, and so every tier below it. */
const TOP_TIER = SUPPORTER_TIERS[SUPPORTER_TIERS.length - 1]!.id;

/**
 * What an account holds. The owner's account holds every FlossChat badge
 * (Owner, Founder and each tier) without paying. That takes none of the
 * Founder spots, which count paid badges only; and with every tier held,
 * there is nothing left to buy for it.
 */
function holdingsFor(twitchId: string, credit: number, founder: boolean): Pick<SupporterStanding, 'owner' | 'tier' | 'founder'> {
  return isOwner(twitchId)
    ? { owner: true, tier: TOP_TIER, founder: true }
    : { owner: false, tier: tierForCents(credit), founder };
}

/** What one Twitch account holds (tier, Founder, Owner) and what moving up costs. */
export async function supporterStanding(
  twitchId: string,
  store = openSupporterStore(),
): Promise<SupporterStanding> {
  if (isOwner(twitchId)) {
    return { ...holdingsFor(twitchId, 0, true), prices: tierPrices(supporterTier(TOP_TIER).priceCents) };
  }
  let credit = 0;
  let founder = false;
  try {
    if (store) {
      credit = await store.creditFor(twitchId);
      founder = (await store.founderIds(FOUNDER_LIMIT)).includes(twitchId);
    }
  } catch {
    credit = 0;
    founder = false;
  }
  return { ...holdingsFor(twitchId, credit, founder), prices: tierPrices(credit) };
}

/** Whether this Twitch id holds any FlossChat badge (a tier, Founder or Owner). */
export async function ownsSupporterBadge(
  twitchId: string,
  store = openSupporterStore(),
): Promise<boolean> {
  const standing = await supporterStanding(twitchId, store);
  return standing.tier !== null || standing.founder || standing.owner;
}

/** A badge id someone can pick to wear: Owner, Founder or a tier. */
export function isWearableBadgeId(value: unknown): value is string {
  return value === 'owner' || value === 'founder' || isSupporterTierId(value);
}

/** The FlossChat badges an account holds, in the order one is shown when
    they haven't picked: Owner, then their tier, then Founder, then the tiers
    below theirs (reaching a tier keeps the ones before it: a Top Suvy can
    wear Suvy or Sanctioned too). */
export function heldBadgeIds(standing: Pick<SupporterStanding, 'owner' | 'tier' | 'founder'>): string[] {
  const reached = standing.tier
    ? SUPPORTER_TIERS.slice(0, SUPPORTER_TIERS.findIndex((tier) => tier.id === standing.tier) + 1).map((tier) => tier.id).reverse()
    : [];
  return [
    ...(standing.owner ? ['owner'] : []),
    ...reached.slice(0, 1),
    ...(standing.founder ? ['founder'] : []),
    ...reached.slice(1),
  ];
}

/** One badge at a time: the one they picked (if they still hold it), else the
    first they hold; none when they took it off. */
export function shownBadgeId(held: readonly string[], picked: string | undefined, takenOff: boolean): string | null {
  if (takenOff || !held.length) return null;
  return picked && held.includes(picked) ? picked : held[0];
}

/** The badge this account shows in chat right now (or null). */
export async function wornBadgeId(
  twitchId: string,
  store = openSupporterStore(),
): Promise<string | null> {
  const held = heldBadgeIds(await supporterStanding(twitchId, store));
  let picked: string | undefined;
  let off = false;
  try {
    if (store) {
      picked = (await store.selections()).get(twitchId);
      off = (await store.hiddenIds()).includes(twitchId);
    }
  } catch {
    picked = undefined;
    off = false;
  }
  return shownBadgeId(held, picked, off);
}

type Cached = {
  revision: string;
  at: number;
  /** What overlays show: each account under the one badge it wears. */
  badges: GxufyBadgeDefinition[];
  /** Who holds each badge, worn or not. */
  holders: Record<string, string[]>;
  version: string;
};
/* Rebuilt anyway after this long, in case two writes ever share a timestamp. */
const MAX_CACHE_MS = 30_000;
let cached: Cached | null = null;

function versionOf(badges: GxufyBadgeDefinition[]): string {
  return createHash('sha256').update(JSON.stringify(badges)).digest('base64url').slice(0, 16);
}

async function build(store: ReturnType<typeof openSupporterStore>): Promise<Omit<Cached, 'revision' | 'at' | 'version'>> {
  let credits = new Map<string, number>();
  let founders: string[] = [];
  let hidden: string[] = [];
  let picks = new Map<string, string>();
  try {
    if (store) {
      [credits, founders, hidden, picks] = await Promise.all([
        store.credits(), store.founderIds(FOUNDER_LIMIT), store.hiddenIds(), store.selections(),
      ]);
    }
  } catch {
    credits = new Map();
    founders = [];
    hidden = [];
    picks = new Map();
  }
  const founderSet = new Set(founders);
  const off = new Set(hidden);
  const accounts = new Set<string>([...OWNER_TWITCH_IDS, ...founders, ...credits.keys()]);
  const holders: Record<string, string[]> = Object.fromEntries(GXUFY_BADGES.map((badge) => [badge.id, [] as string[]]));
  const shown: Record<string, string[]> = Object.fromEntries(GXUFY_BADGES.map((badge) => [badge.id, [] as string[]]));
  for (const id of accounts) {
    const held = heldBadgeIds(holdingsFor(id, credits.get(id) ?? 0, founderSet.has(id)));
    for (const badge of held) holders[badge].push(id);
    const wears = shownBadgeId(held, picks.get(id), off.has(id));
    if (wears) shown[wears].push(id);
  }
  return {
    badges: GXUFY_BADGES.map((badge) => ({ ...badge, userIds: [...new Set(shown[badge.id])].sort() })),
    holders: Object.fromEntries(Object.entries(holders).map(([id, ids]) => [id, [...new Set(ids)].sort()])),
  };
}

async function current(store = openSupporterStore()): Promise<Cached> {
  let revision = 'none';
  try {
    revision = store ? await store.revision() : 'none';
  } catch {
    revision = `error:${Date.now()}`;
  }
  if (cached && cached.revision === revision && Date.now() - cached.at < MAX_CACHE_MS) return cached;
  const { badges, holders } = await build(store);
  cached = { revision, at: Date.now(), badges, holders, version: versionOf(badges) };
  return cached;
}

/**
 * Every FlossChat badge with the accounts that show it in chat. One badge per
 * account at a time: the one they picked on /badges, else Owner, their tier,
 * Founder in that order; none for anyone who took it off. Holding is Owner
 * (fixed), Founder (the first FOUNDER_LIMIT paid supporters) and each tier by
 * what was paid (plus tiers given free); the owner's account holds them all. Re-read only when the store file
 * changes. If the store can't be read, the Owner badge still answers.
 */
export async function getGxufyBadges(
  store = openSupporterStore(),
): Promise<GxufyBadgeDefinition[]> {
  return (await current(store)).badges;
}

/** Who holds each badge, worn or not (badge id -> Twitch ids). */
export async function getGxufyHolders(
  store = openSupporterStore(),
): Promise<Record<string, string[]>> {
  return (await current(store)).holders;
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
