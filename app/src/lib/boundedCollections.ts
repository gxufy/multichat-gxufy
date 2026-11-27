/*
 * A Map and a Set that keep at most `limit` entries and forget the ones written
 * longest ago. The overlay remembers a few things per chatter (mention colour
 * and paint, "already spoke this session", "cosmetics already asked for");
 * on a long stream in a big channel plain collections grow for hours. These
 * keep memory flat: a chatter who is forgotten and speaks again is simply
 * looked up or noted again.
 *
 * When the limit is passed, the oldest tenth goes in one pass. Forgetting one
 * entry per write would walk past every earlier deletion each time (the
 * engine keeps them as holes until it compacts), which gets slow in busy chat.
 */
function evictCount(size: number, limit: number): number {
  return size > limit ? size - limit + Math.ceil(limit / 10) : 0;
}

export class BoundedMap<K, V> extends Map<K, V> {
  readonly limit: number;

  constructor(limit: number) {
    super();
    this.limit = Math.max(1, Math.floor(limit));
  }

  override set(key: K, value: V): this {
    /* Writing again moves the key to the newest end. */
    if (this.has(key)) super.delete(key);
    super.set(key, value);
    let excess = evictCount(this.size, this.limit);
    if (excess > 0) {
      for (const oldest of this.keys()) {
        if (excess-- <= 0) break;
        super.delete(oldest);
      }
    }
    return this;
  }
}

export class BoundedSet<T> extends Set<T> {
  readonly limit: number;

  constructor(limit: number) {
    super();
    this.limit = Math.max(1, Math.floor(limit));
  }

  override add(value: T): this {
    if (this.has(value)) super.delete(value);
    super.add(value);
    let excess = evictCount(this.size, this.limit);
    if (excess > 0) {
      for (const oldest of this.values()) {
        if (excess-- <= 0) break;
        super.delete(oldest);
      }
    }
    return this;
  }
}

/** Chatters remembered for @mention colours and paints. */
export const MENTION_MEMORY_LIMIT = 20_000;
/** Chatters remembered as "already spoke" / "cosmetics already asked for". */
export const CHATTER_MEMORY_LIMIT = 50_000;
