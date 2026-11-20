import ChannelAutocomplete, {
  type ChannelAutocompleteSuggestion,
} from './ChannelAutocomplete';

import {
  KICK_CHANNEL_SEARCH_DEBOUNCE_MS,
  normalizeKickChannelSearchQuery,
  parseKickChannelSuggestions,
} from '@/lib/kickChannelSearch';

type KickChannelAutocompleteProps = {
  id: string;
  name: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
};

function formatFollowers(value: number): string {
  return `${new Intl.NumberFormat('en-US', {
    notation: value >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)} followers`;
}

/*
 * Live viewers and category for a live Kick result. Kick's channel API answers
 * browsers (it blocks server IPs, which is why the viewer counter also reads it
 * from the browser), so this runs here: only for live results, at most one
 * request per channel per minute, short timeout, and any failure just leaves
 * the details off.
 */
type KickLiveDetails = { viewers?: number; category?: string };
const KICK_LIVE_CACHE_TTL_MS = 60_000;
const KICK_LIVE_TIMEOUT_MS = 2_500;
const kickLiveCache = new Map<string, { at: number; value: KickLiveDetails | null }>();

export async function kickLiveDetails(slug: string, signal?: AbortSignal): Promise<KickLiveDetails | null> {
  if (!/^[a-z0-9_-]{1,80}$/.test(slug)) return null;
  const cached = kickLiveCache.get(slug);
  if (cached && Date.now() - cached.at < KICK_LIVE_CACHE_TTL_MS) return cached.value;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, KICK_LIVE_TIMEOUT_MS);
  try {
    const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const livestream = body && typeof body === 'object' ? (body as Record<string, unknown>).livestream : null;
    if (!livestream || typeof livestream !== 'object') return null;
    const stream = livestream as Record<string, unknown>;
    const viewers = stream.viewer_count;
    const categories = Array.isArray(stream.categories) ? stream.categories : [];
    const first = categories[0] && typeof categories[0] === 'object' ? (categories[0] as Record<string, unknown>) : null;
    const value: KickLiveDetails = {
      ...(typeof viewers === 'number' && Number.isSafeInteger(viewers) && viewers >= 0 ? { viewers } : {}),
      ...(first && typeof first.name === 'string' && first.name.trim() ? { category: first.name.trim().slice(0, 80) } : {}),
    };
    kickLiveCache.delete(slug);
    kickLiveCache.set(slug, { at: Date.now(), value });
    while (kickLiveCache.size > 200) {
      const oldest = kickLiveCache.keys().next();
      if (oldest.done) break;
      kickLiveCache.delete(oldest.value);
    }
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function __resetKickLiveDetailsCacheForTests(): void {
  kickLiveCache.clear();
}

async function searchKickChannels(
  query: string,
  signal: AbortSignal,
): Promise<ChannelAutocompleteSuggestion[]> {
  const response = await fetch(
    `/api/kick/channel-search?${new URLSearchParams({
      q: query,
    })}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(
      'Kick channel search failed.',
    );
  }

  const parsed =
    parseKickChannelSuggestions(
      await response.json(),
    );

  if (!parsed) {
    throw new Error(
      'Invalid Kick channel search response.',
    );
  }

  const live = await Promise.all(
    parsed.map((suggestion) => (
      suggestion.is_live ? kickLiveDetails(suggestion.slug, signal) : Promise.resolve(null)
    )),
  );

  return parsed.map((suggestion, index) => ({
    value: suggestion.slug,
    displayName: suggestion.display_name,
    thumbnailUrl:
      suggestion.thumbnail_url ?? undefined,
    isLive: suggestion.is_live,
    meta: `@${suggestion.slug}`,
    secondary: formatFollowers(
      suggestion.followers_count,
    ),
    ...(live[index]?.viewers !== undefined ? { viewers: live[index]!.viewers } : {}),
    ...(live[index]?.category ? { category: live[index]!.category } : {}),
  }));
}

export default function KickChannelAutocomplete({
  id,
  name,
  placeholder,
  value,
  onValueChange,
}: KickChannelAutocompleteProps) {
  return (
    <ChannelAutocomplete
      id={id}
      name={name}
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
      platform="kick"
      platformLabel="Kick"
      debounceMs={
        KICK_CHANNEL_SEARCH_DEBOUNCE_MS
      }
      normalizeQuery={
        normalizeKickChannelSearchQuery
      }
      search={searchKickChannels}
    />
  );
}
