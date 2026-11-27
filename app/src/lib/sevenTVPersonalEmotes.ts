/* Personal 7TV emotes: the few emotes a 7TV subscriber can use in any chat.
 *
 * They arrive on the channel's 7TV event stream, not from the channel's set:
 *   entitlement.create  kind EMOTE_SET  links a chatter (by platform id) to a set
 *   emote_set.create    announces that set
 *   emote_set.update    pushes / pulls / renames the set's emotes
 *   entitlement.delete / emote_set.delete undo the above
 *
 * This store keeps those sets and, for every chatter that wears one, a flat
 * list of their personal emotes in `byUser` (keyed `${platform}:${userId}`,
 * like cosmetics entitlements). Every change replaces that chatter's list with
 * a new array, so memoised lookups notice it. Each call returns the chatter
 * keys whose emotes changed, so the overlay can redraw only their messages.
 *
 * Bounded: a long stream sees many chatters, so the oldest sets and chatters
 * are forgotten past the limits.
 */
import { applySevenTVEmoteSetUpdate, mapSevenTVEmote, type SevenTVEmote } from './kick';

export const PERSONAL_EMOTE_MAX_SETS = 3_000;
export const PERSONAL_EMOTE_MAX_USERS = 5_000;

type Platform = 'kick' | 'twitch';

function connectionKeys(user: unknown, platform: Platform): string[] {
  const wanted = platform === 'kick' ? 'KICK' : 'TWITCH';
  const connections = (user as { connections?: unknown })?.connections;
  if (!Array.isArray(connections)) return [];
  const keys: string[] = [];
  for (const connection of connections) {
    const id = (connection as { id?: unknown })?.id;
    if ((connection as { platform?: unknown })?.platform !== wanted) continue;
    if (typeof id !== 'string' && typeof id !== 'number') continue;
    const text = String(id);
    if (text) keys.push(`${platform}:${text}`);
  }
  return keys;
}

function touch<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value as K;
    map.delete(oldest);
  }
}

export class SevenTVPersonalEmoteStore {
  /** `${platform}:${userId}` → that chatter's personal emotes (new array on change). */
  readonly byUser: Record<string, SevenTVEmote[]> = {};

  private readonly sets = new Map<string, SevenTVEmote[]>();
  private readonly owners = new Map<string, string[]>();

  constructor(
    private readonly maxSets = PERSONAL_EMOTE_MAX_SETS,
    private readonly maxUsers = PERSONAL_EMOTE_MAX_USERS,
  ) {}

  /** entitlement.create / entitlement.delete with kind EMOTE_SET. */
  entitlement(created: boolean, object: unknown, platform: Platform): string[] {
    const setId = (object as { ref_id?: unknown })?.ref_id;
    if (typeof setId !== 'string' || !setId) return [];
    const changed: string[] = [];
    for (const key of connectionKeys((object as { user?: unknown })?.user, platform)) {
      const current = this.owners.get(key) ?? [];
      const has = current.includes(setId);
      if (created && has) continue;
      if (!created && !has) continue;
      const next = created ? [...current, setId] : current.filter((id) => id !== setId);
      if (next.length) touch(this.owners, key, next, this.maxUsers);
      else this.owners.delete(key);
      if (created && !this.sets.has(setId)) touch(this.sets, setId, [], this.maxSets);
      if (this.recompute(key)) changed.push(key);
    }
    this.prune();
    return changed;
  }

  /** emote_set.create: remember the set (with any emotes it already carries). */
  createSet(body: unknown): string[] {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== 'string' || !id) return [];
    const inline = (body as { object?: { emotes?: unknown } })?.object?.emotes;
    const emotes = Array.isArray(inline)
      ? inline.filter((e) => e && (e as { name?: unknown }).name && (e as { id?: unknown }).id).map(mapSevenTVEmote)
      : null;
    if (!emotes && this.sets.has(id)) return [];
    touch(this.sets, id, emotes ?? this.sets.get(id) ?? [], this.maxSets);
    return this.recomputeOwnersOf(id);
  }

  /** emote_set.update for a set that is not the channel's own. */
  updateSet(body: unknown): string[] {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== 'string' || !id) return [];
    touch(this.sets, id, applySevenTVEmoteSetUpdate(this.sets.get(id) ?? [], body), this.maxSets);
    return this.recomputeOwnersOf(id);
  }

  /** emote_set.delete */
  deleteSet(body: unknown): string[] {
    const id = (body as { id?: unknown })?.id;
    if (typeof id !== 'string' || !this.sets.delete(id)) return [];
    return this.recomputeOwnersOf(id);
  }

  private recomputeOwnersOf(setId: string): string[] {
    const changed: string[] = [];
    for (const [key, setIds] of this.owners) {
      if (setIds.includes(setId) && this.recompute(key)) changed.push(key);
    }
    return changed;
  }

  /** Rebuild one chatter's flat list; true when it changed. */
  private recompute(key: string): boolean {
    const emotes: SevenTVEmote[] = [];
    const seen = new Set<string>();
    for (const setId of this.owners.get(key) ?? []) {
      for (const emote of this.sets.get(setId) ?? []) {
        if (seen.has(emote.name)) continue;
        seen.add(emote.name);
        emotes.push(emote);
      }
    }
    const before = this.byUser[key];
    if (!emotes.length) {
      if (!before) return false;
      delete this.byUser[key];
      return true;
    }
    if (before && before.length === emotes.length
      && before.every((emote, index) => emote.name === emotes[index].name && emote.image === emotes[index].image)) {
      return false;
    }
    this.byUser[key] = emotes;
    return true;
  }

  /** Drop derived entries for chatters the owner map has forgotten. */
  private prune(): void {
    const keys = Object.keys(this.byUser);
    if (keys.length <= this.maxUsers) return;
    for (const key of keys) if (!this.owners.has(key)) delete this.byUser[key];
  }
}

const COMBINED = new WeakMap<SevenTVEmote[], WeakMap<SevenTVEmote[], SevenTVEmote[]>>();

/** The channel's catalog plus one chatter's personal emotes. The channel's
 *  emotes come first, so on a name clash the channel's emote is the one shown
 *  (the renderer keeps the first emote of a name). Memoised by both arrays. */
export function withPersonalEmotes(channel: SevenTVEmote[], personal: SevenTVEmote[] | undefined): SevenTVEmote[] {
  if (!personal?.length) return channel;
  let byPersonal = COMBINED.get(channel);
  if (!byPersonal) {
    byPersonal = new WeakMap();
    COMBINED.set(channel, byPersonal);
  }
  const cached = byPersonal.get(personal);
  if (cached) return cached;
  const combined = [...channel, ...personal];
  byPersonal.set(personal, combined);
  return combined;
}
