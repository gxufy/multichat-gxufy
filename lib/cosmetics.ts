/* 7TV cosmetics via GQL — UChat's approach (ref-uchat cosmetics.ts).
 *
 * The EventAPI only reliably streams cosmetics for users who become
 * present AFTER we connect; presence bootstraps are flaky. UChat instead
 * asks GQL for each chatter's style directly. userByConnection resolves a
 * platform user id (TWITCH/KICK) straight to { style { paint badge } } —
 * deterministic, no session choreography.
 *
 * Senders queue as their first message arrives; a debounced batch query
 * (GQL alias batching) fetches up to 40 users at once. Results land in
 * the same paints/badges/entitlements stores the EventAPI path fills, so
 * rendering is source-agnostic.
 */
import type { SevenTVBadge, SevenTVPaint, Entitlements } from './kick';

const PAINT_FIELDS = 'id name function color angle shape image_url repeat stops { at color } shadows { x_offset y_offset radius color }';

export interface CosmeticsStores {
  paints: SevenTVPaint[];
  badges: SevenTVBadge[];
  entitlements: Entitlements;
}

export interface CosmeticsFetcher {
  /** queue a chatter for cosmetics lookup (no-op if already seen) */
  want(platform: 'kick' | 'twitch', senderId: string): void;
  stop(): void;
}

export function createCosmeticsFetcher(
  stores: CosmeticsStores,
  onApplied: (keys: string[]) => void,
): CosmeticsFetcher {
  const seen = new Set<string>();
  const queue: Array<{ platform: 'kick' | 'twitch'; senderId: string }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function flush() {
    timer = null;
    if (stopped || !queue.length) return;
    const batch = queue.splice(0, 40);
    if (queue.length) schedule();

    // one aliased query per batch: u0: userByConnection(...) { ... }
    const parts = batch.map((b, i) =>
      `u${i}: userByConnection(platform: ${b.platform.toUpperCase()}, id: ${JSON.stringify(b.senderId)}) { style { paint { ${PAINT_FIELDS} } badge { id tooltip host { url } } } }`
    );
    let data: any;
    try {
      const r = await fetch('https://7tv.io/v3/gql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `query { ${parts.join(' ')} }` }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      data = (await r.json())?.data;
    } catch {
      // allow retry on next sighting
      for (const b of batch) seen.delete(`${b.platform}:${b.senderId}`);
      return;
    }
    if (!data) return;

    const applied: string[] = [];
    batch.forEach((b, i) => {
      const style = data[`u${i}`]?.style;
      if (!style) return;
      const key = `${b.platform}:${b.senderId}`;
      const ent: { badge?: string; paint?: string } = { ...stores.entitlements[key] };

      const paint = style.paint;
      if (paint?.id) {
        if (!stores.paints.some(p => p.id === paint.id)) {
          stores.paints.push({
            id: paint.id,
            func: paint.function,
            angle: paint.angle,
            color: paint.color,
            repeat: !!paint.repeat,
            shadows: paint.shadows ?? [],
            stops: paint.stops ?? [],
            image_url: paint.image_url,
            shape: paint.shape,
          });
        }
        ent.paint = paint.id;
      }
      const badge = style.badge;
      if (badge?.id) {
        if (!stores.badges.some(x => x.id === badge.id)) {
          const host = badge.host?.url;
          stores.badges.push({
            id: badge.id,
            image: host ? `https:${host}/3x` : `https://cdn.7tv.app/badge/${badge.id}/3x`,
          });
        }
        ent.badge = badge.id;
      }
      if (ent.paint || ent.badge) {
        stores.entitlements[key] = ent;
        applied.push(key);
      }
    });
    if (applied.length) onApplied(applied);
  }

  function schedule() {
    if (!timer) timer = setTimeout(flush, 400);
  }

  return {
    want(platform, senderId) {
      if (stopped || !senderId) return;
      const key = `${platform}:${senderId}`;
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({ platform, senderId });
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
