/*
 * A chatter's own badge layout (Moltorino v2): which kinds of badges they hid
 * and the order they put them in, applied to their badges on every overlay.
 * The streamer's own badge layout still comes first: a kind the streamer hid
 * stays hidden, and a chatter without a layout keeps the overlay's order.
 *
 * Kinds are Moltorino's slot keys (see ViewerBadgeLayout in ./types). Twitch's
 * own badges split into four kinds by badge set: roles (`ta`), subscriber
 * (`ts`), predictions (`tp`) and every other Twitch badge (`tv`). A badge with
 * no kind (a provider Moltorino has no slot for) is never hidden by a layout
 * and keeps its place in front of the sorted ones, as Moltorino draws it.
 */
import type { UnifiedBadge, ViewerBadgeLayout } from './types';

/** Every badge kind a layout can name, in Moltorino's default order. */
export const VIEWER_BADGE_SLOTS = [
  'ta', 'ts', 'tv', 'tp', 'c', 'ff', 'fa', 'bt', 'bl', 'jc', 'wy', 'bh', 'm', '7', 'hc', 'hs',
] as const;
export type ViewerBadgeSlot = (typeof VIEWER_BADGE_SLOTS)[number];

const SLOTS = new Set<string>(VIEWER_BADGE_SLOTS);
const TWITCH_ROLE_SETS = new Set(['staff', 'admin', 'global_mod', 'lead_moderator', 'moderator', 'vip', 'broadcaster']);
const TWITCH_SUBSCRIBER_SETS = new Set(['subscriber', 'founder']);
const TWITCH_PREDICTION_SETS = new Set(['predictions']);

/** Our community-badge providers (`community:<provider>:…`) that have a kind. */
const PROVIDER_SLOT: Readonly<Record<string, ViewerBadgeSlot>> = {
  chatterino: 'c',
  ffz: 'ff',
  ffzap: 'fa',
  bttv: 'bt',
  bluzyrino: 'bl',
  jilchat: 'jc',
  badgehq: 'bh',
  moltorino: 'm',
  '7tv': '7',
  'custom-homies': 'hc',
  homies: 'hs',
};

/** The kind of one of Twitch's own badges, by badge set id. */
export function twitchBadgeSlot(setId: string): ViewerBadgeSlot {
  const set = setId.trim().toLowerCase();
  if (TWITCH_ROLE_SETS.has(set)) return 'ta';
  if (TWITCH_SUBSCRIBER_SETS.has(set)) return 'ts';
  if (TWITCH_PREDICTION_SETS.has(set)) return 'tp';
  return 'tv';
}

/** The kind of a badge on a Twitch message, or null for a badge with none. */
export function viewerBadgeSlot(badge: Pick<UnifiedBadge, 'type'>): ViewerBadgeSlot | null {
  const type = badge.type.trim().toLowerCase();
  if (type.startsWith('community:')) return PROVIDER_SLOT[type.split(':', 3)[1] ?? ''] ?? null;
  return twitchBadgeSlot(type);
}

/** One key as a kind: a slot key, or a legacy `t:<set>` key as its Twitch kind. */
function slotOf(raw: unknown): ViewerBadgeSlot | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (SLOTS.has(key)) return key as ViewerBadgeSlot;
  const twitchSet = /^t:([a-z0-9_-]{1,48})$/.exec(key)?.[1];
  return twitchSet ? twitchBadgeSlot(twitchSet) : null;
}

const MAX_KEYS = 64;

function slots(raw: unknown): ViewerBadgeSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewerBadgeSlot[] = [];
  for (const value of raw.slice(0, MAX_KEYS)) {
    const slot = slotOf(value);
    if (slot && !out.includes(slot)) out.push(slot);
  }
  return out;
}

/** A layout from a provider's `order` / `hidden` lists, or null when it
 * changes nothing (no valid order and nothing hidden). */
export function viewerBadgeLayoutFrom(order: unknown, hidden: unknown): ViewerBadgeLayout | null {
  const layout = { order: slots(order), hidden: slots(hidden) };
  return layout.order.length || layout.hidden.length ? layout : null;
}

/**
 * The chatter's badges after their layout: kinds they hid are left out; when
 * they chose an order, badges without a kind come first (in the overlay's
 * order), then the rest in the chatter's order, kinds they did not place
 * after those in the default order. Equal kinds keep the overlay's order.
 */
export function applyViewerBadgeLayout<T>(
  items: readonly { slot: ViewerBadgeSlot | null; value: T }[],
  layout: ViewerBadgeLayout,
): T[] {
  const hidden = new Set(layout.hidden);
  const shown = items.filter((item) => item.slot === null || !hidden.has(item.slot));
  if (!layout.order.length) return shown.map((item) => item.value);
  const rank = (slot: ViewerBadgeSlot | null): number => {
    if (slot === null) return -1;
    const chosen = layout.order.indexOf(slot);
    return chosen >= 0 ? chosen : layout.order.length + VIEWER_BADGE_SLOTS.indexOf(slot);
  };
  return shown
    .map((item, index) => ({ item, index, rank: rank(item.slot) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item.value);
}
