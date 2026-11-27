import { previewBadgeRenderOptions } from '@/lib/limerinoBadges';
import {
  EMPTY_SEVENTV_IDENTITY_RESOURCES,
  type PreviewIdentityResponse,
} from './previewIdentity';
import {
  SEVENTV_V4_GQL,
  SEVENTV_V4_MAX_USERS_PER_QUERY,
  SEVENTV_V4_PREVIEW_STYLE_FIELDS,
  parseSevenTVV4Badge,
  parseSevenTVV4Paint,
} from '@/lib/cosmetics';
import { parseBadgeMap } from '@/lib/connectors/twitch';
import {
  communityBadgeProviderFailures,
  moltorinoBadgeLayoutFor,
  resolveTwitchCommunityBadgesWithoutJilChat,
  resolveTwitchJilChatBadgesDetailed,
} from '@/lib/communityBadges';
import {
  JILTV_COSMETICS_ENABLED,
  lookupJilTVPaint,
  type JilTVPaintView,
} from '@/lib/jiltvCosmetics';
import type { SevenTVBadge, SevenTVPaint } from '@/lib/kick';
import type { UnifiedBadge, ViewerBadgeLayout } from '@/lib/types';

/*
 * Live cosmetics for the generator's Preview Data roster.
 *
 * The bundled preview catalog stays the synchronous first paint. After that,
 * the preview asks the same sources the live OBS overlay uses for the current
 * equipped 7TV paint/badge and community badges, keyed by each identity's
 * immutable Twitch user ID:
 *
 *   - 7TV: one browser-side v4 GQL batch, exactly like lib/cosmetics.ts does
 *     for live chatters. No Gxufy server work or fixed-provider admission.
 *   - Community badges: the production resolver without JilChat, matching the
 *     existing preview fast path. JilChat stays out of the roster refresh so a
 *     generator visit never spends the JilChat traffic-guard budget.
 *   - Per-user "shown" badges the global lists cannot express: JilChat's
 *     visible badge, through the existing JilChat traffic guard. (Enhancer's
 *     shown badges come from its global list, like in live chat.)
 *   - Twitch worn badge: the global badge each identity currently displays,
 *     from IVR (already used server-side by preview-identity/support-user),
 *     one batched request by immutable user ID.
 *   - Twitch badge art: the global badge image map from /api/twitch/badges
 *     (the endpoint the live overlay uses), so each identity's worn Twitch
 *     badge actually has an image to render.
 *   - JilTV paint (its own release gate, off unless the build enables it):
 *     the live overlay's lookup and traffic guard, the whole roster in one
 *     request, so the preview shows the paint the overlay would.
 *
 * Failures never erase last-known-good catalog data.
 */

export const PREVIEW_LIVE_COSMETICS_DELAY_MS = 1_200;
/** 7TV's per-query complexity ceiling allows at most this many users. */
export const PREVIEW_LIVE_SEVENTV_BATCH_SIZE = SEVENTV_V4_MAX_USERS_PER_QUERY;
export const PREVIEW_LIVE_TWITCH_BADGES_URL = '/api/twitch/badges';
export const PREVIEW_LIVE_IVR_USER_URL = 'https://api.ivr.fi/v2/twitch/user';
/** Users per IVR batch request. */
export const PREVIEW_LIVE_IVR_BATCH_SIZE = 25;
export const PREVIEW_LIVE_SEVENTV_TIMEOUT_MS = 8_000;
export const PREVIEW_LIVE_MAX_IDENTITIES = 64;

/**
 * `undefined` means "unknown, keep the catalog value";
 * `null` means 7TV confirmed nothing is equipped.
 */
export type PreviewLiveSevenTVStyle = {
  readonly paint: SevenTVPaint | null | undefined;
  readonly badge: SevenTVBadge | null | undefined;
};

export type PreviewLiveCosmetics = {
  readonly sevenTV: ReadonlyMap<string, PreviewLiveSevenTVStyle>;
  readonly communityBadges: ReadonlyMap<string, readonly UnifiedBadge[]>;
  /**
   * Community providers that failed during this refresh; their catalog badges
   * are kept rather than dropped (last-known-good).
   */
  readonly communityFailedProviders?: ReadonlySet<string>;
  /** Badge layouts people set in Moltorino, by Twitch user id. */
  readonly viewerBadgeLayouts?: ReadonlyMap<string, ViewerBadgeLayout>;
  /**
   * The single badge a user shows per provider where only a per-user lookup
   * knows it. An empty array is an authoritative "shows none"; a missing key
   * keeps whatever the community resolver/catalog had.
   */
  readonly shownProviderBadges?: ReadonlyMap<string, ReadonlyMap<ShownProvider, readonly UnifiedBadge[]>>;
  /**
   * Twitch global badge(s) each user currently displays, keyed by user ID.
   * An empty array means "wears none"; a missing key means unknown.
   */
  readonly twitchWornBadges?: ReadonlyMap<string, readonly UnifiedBadge[]>;
  /** Twitch global badge art keyed `set/version`; empty when unavailable. */
  readonly twitchBadgeArt?: Readonly<Record<string, string>>;
  /** The JilTV paint each user wears, by user ID (only those wearing one). */
  readonly jiltvPaints?: ReadonlyMap<string, JilTVPaintView>;
};

export type ShownProvider = 'jilchat';

export type PreviewLiveIdentity = {
  readonly userId: string;
  readonly login: string;
  readonly displayName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validUserIds(userIds: readonly string[]): string[] {
  return [...new Set(userIds.map((id) => id.trim()).filter((id) => /^\d{1,25}$/.test(id)))]
    .slice(0, PREVIEW_LIVE_MAX_IDENTITIES);
}

function styleFromUser(user: unknown): PreviewLiveSevenTVStyle | null {
  /* A null user is 7TV's answer for "this Twitch account has no 7TV account". */
  if (user === null) return { paint: null, badge: null };
  if (!isRecord(user) || !isRecord(user.style)) return null;
  const rawPaint = user.style.activePaint;
  const rawBadge = user.style.activeBadge;
  return {
    paint: rawPaint === null || rawPaint === undefined
      ? null
      : parseSevenTVV4Paint(rawPaint) ?? undefined,
    badge: rawBadge === null || rawBadge === undefined
      ? null
      : parseSevenTVV4Badge(rawBadge) ?? undefined,
  };
}

async function fetchSevenTVBatch(
  userIds: readonly string[],
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<Map<string, PreviewLiveSevenTVStyle>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, PREVIEW_LIVE_SEVENTV_TIMEOUT_MS);
  try {
    const parts = userIds.map((id, index) =>
      `u${index}: userByConnection(platform: TWITCH, platformId: ${JSON.stringify(id)}) { ${SEVENTV_V4_PREVIEW_STYLE_FIELDS} }`,
    );
    const response = await fetchImpl(SEVENTV_V4_GQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query { users { ${parts.join(' ')} } }` }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('7TV preview cosmetics request failed');
    const body: unknown = await response.json();
    const root = isRecord(body) ? body.data : null;
    const users = isRecord(root) ? (isRecord(root.users) ? root.users : root) : null;
    if (!isRecord(users)) throw new Error('invalid 7TV preview cosmetics response');

    const result = new Map<string, PreviewLiveSevenTVStyle>();
    userIds.forEach((id, index) => {
      const key = `u${index}`;
      if (!(key in users)) return;
      const style = styleFromUser(users[key]);
      if (style) result.set(id, style);
    });
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Current equipped 7TV paint/badge per immutable Twitch user ID. */
export async function fetchPreviewSevenTVStyles(
  userIds: readonly string[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, PreviewLiveSevenTVStyle>> {
  const ids = validUserIds(userIds);
  const fetchImpl = options.fetchImpl ?? fetch;
  const result = new Map<string, PreviewLiveSevenTVStyle>();
  if (options.signal?.aborted) return result;
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += PREVIEW_LIVE_SEVENTV_BATCH_SIZE) {
    batches.push(ids.slice(start, start + PREVIEW_LIVE_SEVENTV_BATCH_SIZE));
  }
  const settled = await Promise.allSettled(
    batches.map((batch) => fetchSevenTVBatch(batch, options.signal, fetchImpl)),
  );
  /* A failed batch simply keeps catalog data for its identities. */
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    for (const [id, style] of outcome.value) result.set(id, style);
  }
  return result;
}

/** Current community badges per Twitch user ID (empty results are not recorded). */
export async function fetchPreviewCommunityBadges(
  identities: readonly PreviewLiveIdentity[],
  resolve: typeof resolveTwitchCommunityBadgesWithoutJilChat = resolveTwitchCommunityBadgesWithoutJilChat,
): Promise<Map<string, readonly UnifiedBadge[]>> {
  const unique = new Map<string, PreviewLiveIdentity>();
  for (const identity of identities) {
    if (/^\d{1,25}$/.test(identity.userId) && !unique.has(identity.userId)) {
      unique.set(identity.userId, identity);
    }
    if (unique.size >= PREVIEW_LIVE_MAX_IDENTITIES) break;
  }
  const entries = [...unique.values()];
  const renderOptions = previewBadgeRenderOptions();
  const settled = await Promise.allSettled(entries.map((identity) => resolve({
    userId: identity.userId,
    login: identity.login,
    displayName: identity.displayName,
  }, renderOptions)));
  const result = new Map<string, readonly UnifiedBadge[]>();
  settled.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled' && outcome.value.length) {
      result.set(entries[index]!.userId, outcome.value);
    }
  });
  return result;
}

function parseIvrBadges(value: unknown): UnifiedBadge[] | null {
  if (!Array.isArray(value)) return null;
  const badges: UnifiedBadge[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    /* Twitch set IDs are case-sensitive (twitchconEU2022); keep them as given. */
    const type = String(raw.setID ?? '').trim();
    const version = String(raw.version ?? '').trim();
    if (!/^[a-z0-9_-]{1,64}$/i.test(type) || !/^[a-z0-9_-]{1,32}$/i.test(version)) continue;
    const key = `${type}/${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : undefined;
    badges.push({ type, version, ...(title ? { title } : {}) });
  }
  return badges;
}

/** The global Twitch badge each user currently displays, by immutable user ID. */
export async function fetchPreviewTwitchWornBadges(
  userIds: readonly string[],
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Map<string, readonly UnifiedBadge[]>> {
  const ids = validUserIds(userIds);
  const result = new Map<string, readonly UnifiedBadge[]>();
  if (options.signal?.aborted || !ids.length) return result;
  const fetchImpl = options.fetchImpl ?? fetch;
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += PREVIEW_LIVE_IVR_BATCH_SIZE) {
    batches.push(ids.slice(start, start + PREVIEW_LIVE_IVR_BATCH_SIZE));
  }
  const settled = await Promise.allSettled(batches.map(async (batch) => {
    const response = await fetchImpl(`${PREVIEW_LIVE_IVR_USER_URL}?id=${batch.join(',')}`, {
      signal: options.signal,
    });
    if (!response.ok) throw new Error('IVR preview badge lookup failed');
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('invalid IVR preview badge response');
    const wanted = new Set(batch);
    const found = new Map<string, UnifiedBadge[]>();
    for (const user of body) {
      if (!isRecord(user)) continue;
      const id = String(user.id ?? '');
      if (!wanted.has(id)) continue;
      const badges = parseIvrBadges(user.badges);
      if (badges) found.set(id, badges);
    }
    return found;
  }));
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    for (const [id, badges] of outcome.value) result.set(id, badges);
  }
  return result;
}

function withTwitchWornBadges(
  response: PreviewIdentityResponse,
  worn: readonly UnifiedBadge[],
): PreviewIdentityResponse {
  const twitch = response.providers.Twitch;
  const current = twitch?.resources.ownedBadges ?? [];
  const same = current.length === worn.length
    && current.every((badge, index) => badge.type.toLowerCase() === worn[index]!.type.toLowerCase()
      && badge.version === worn[index]!.version
      && badge.title === worn[index]!.title);
  if (same) return response;
  const resources = twitch?.resources ?? { globalBadges: {}, channelBadges: {} };
  return {
    ...response,
    providers: {
      ...response.providers,
      Twitch: { status: twitch?.status ?? 'loaded', resources: { ...resources, ownedBadges: worn } },
    },
  };
}

/** Twitch global badge art (`set/version` → https URL), or an empty map. */
export async function fetchPreviewTwitchBadgeArt(
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, string>> {
  if (options.signal?.aborted) return {};
  try {
    const response = await (options.fetchImpl ?? fetch)(PREVIEW_LIVE_TWITCH_BADGES_URL, {
      signal: options.signal,
    });
    if (!response.ok) return {};
    return parseBadgeMap(await response.json()) ?? {};
  } catch {
    return {};
  }
}

function withTwitchBadgeArt(
  response: PreviewIdentityResponse,
  art: Readonly<Record<string, string>>,
): PreviewIdentityResponse {
  const twitch = response.providers.Twitch;
  const owned = twitch?.resources.ownedBadges;
  if (!twitch || !owned?.length) return response;
  let changed = false;
  /* Exact key first; catalog entries were stored lowercased (twitchconeu2022). */
  let lowered: Map<string, string> | null = null;
  const artFor = (key: string) => {
    if (art[key]) return art[key];
    lowered ??= new Map(Object.entries(art).map(([k, v]) => [k.toLowerCase(), v]));
    return lowered.get(key.toLowerCase());
  };
  const ownedBadges = owned.map((badge) => {
    if (badge.url) return badge;
    const url = artFor(`${badge.type}/${badge.version ?? '1'}`);
    if (!url) return badge;
    changed = true;
    return { ...badge, url };
  });
  if (!changed) return response;
  return {
    ...response,
    providers: {
      ...response.providers,
      Twitch: { ...twitch, resources: { ...twitch.resources, ownedBadges } },
    },
  };
}

type ShownOptions = {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  resolveJilChat?: typeof resolveTwitchJilChatBadgesDetailed;
};

/**
 * JilChat: the badge each user shows. A real server answer counts even when
 * empty ("shows none"); a skipped/throttled/failed lookup keeps prior data.
 */
export async function fetchPreviewJilChatShown(
  userIds: readonly string[],
  options: ShownOptions = {},
): Promise<Map<string, readonly UnifiedBadge[]>> {
  const ids = validUserIds(userIds);
  const resolveJilChat = options.resolveJilChat ?? resolveTwitchJilChatBadgesDetailed;
  /* The JilChat guard paces these itself (burst 16, queue 12, 1/s). */
  const results = await Promise.all(ids.map((id) => resolveJilChat(id)
    .catch(() => ({ badges: [] as UnifiedBadge[], authoritative: false }))));
  const out = new Map<string, readonly UnifiedBadge[]>();
  ids.forEach((id, index) => {
    const result = results[index];
    if (result && (result.authoritative || result.badges.length)) out.set(id, result.badges);
  });
  return out;
}

export function mergeShownProviderBadges(
  current: ReadonlyMap<string, ReadonlyMap<ShownProvider, readonly UnifiedBadge[]>> | undefined,
  provider: ShownProvider,
  badges: ReadonlyMap<string, readonly UnifiedBadge[]>,
): Map<string, Map<ShownProvider, readonly UnifiedBadge[]>> {
  const next = new Map<string, Map<ShownProvider, readonly UnifiedBadge[]>>();
  for (const [id, perProvider] of current ?? []) next.set(id, new Map(perProvider));
  for (const [id, list] of badges) {
    const perProvider = next.get(id) ?? new Map<ShownProvider, readonly UnifiedBadge[]>();
    perProvider.set(provider, list);
    next.set(id, perProvider);
  }
  return next;
}

/** The per-user providers together (tests and non-progressive callers). */
export async function fetchPreviewShownProviderBadges(
  userIds: readonly string[],
  options: ShownOptions = {},
): Promise<Map<string, Map<ShownProvider, readonly UnifiedBadge[]>>> {
  return mergeShownProviderBadges(undefined, 'jilchat', await fetchPreviewJilChatShown(userIds, options));
}

const isJilChatBadge = (badge: UnifiedBadge) => badge.type.startsWith('community:jilchat:');

/**
 * Overlay live cosmetics onto catalog responses. Lookups are by the
 * response's own immutable user ID, so one identity can never receive
 * another identity's cosmetics. Unchanged responses keep their identity.
 */
export function applyPreviewLiveCosmetics(
  responses: ReadonlyMap<string, PreviewIdentityResponse>,
  live: PreviewLiveCosmetics,
): ReadonlyMap<string, PreviewIdentityResponse> {
  let changed = false;
  const next = new Map<string, PreviewIdentityResponse>();

  for (const [login, response] of responses) {
    const userId = response.identity.userId;
    const style = live.sevenTV.get(userId);
    const community = live.communityBadges.get(userId);
    let updated = response;

    if (style && (style.paint !== undefined || style.badge !== undefined)) {
      const current = response.providers['7TV'];
      const resources = current?.resources ?? EMPTY_SEVENTV_IDENTITY_RESOURCES;
      const paint = style.paint === undefined ? resources.paint : style.paint;
      const badge = style.badge === undefined ? resources.badge : style.badge;
      if (paint !== resources.paint || badge !== resources.badge) {
        updated = {
          ...updated,
          providers: {
            ...updated.providers,
            '7TV': {
              status: current?.status ?? 'loaded',
              resources: { ...resources, paint, badge },
            },
          },
        };
      }
    }

    if (community?.length) {
      /*
       * Keep catalog badges the live result cannot speak for: JilChat (handled
       * by the per-user stage) and any provider whose catalog failed to load.
       */
      const failed = live.communityFailedProviders;
      const providerOf = (badge: UnifiedBadge) => badge.type.split(':')[1] ?? '';
      const kept = (response.communityBadges ?? []).filter(
        (badge) => (isJilChatBadge(badge) || Boolean(failed?.has(providerOf(badge))))
          && !community.some((item) => item.type === badge.type),
      );
      updated = { ...updated, communityBadges: [...community, ...kept] };
    }

    const shown = live.shownProviderBadges?.get(userId);
    if (shown?.size) {
      const replaced = new Set([...shown.keys()].map((provider) => `community:${provider}:`));
      const base = (updated.communityBadges ?? []).filter(
        (badge) => ![...replaced].some((prefix) => badge.type.startsWith(prefix)),
      );
      const additions = [...shown.values()].flat();
      const nextBadges = [...base, ...additions];
      const before = updated.communityBadges ?? [];
      const unchanged = before.length === nextBadges.length
        && before.every((badge, index) => badge.type === nextBadges[index]!.type && badge.url === nextBadges[index]!.url);
      if (!unchanged) updated = { ...updated, communityBadges: nextBadges };
    }

    const viewerLayout = live.viewerBadgeLayouts?.get(userId);
    if (viewerLayout && updated.viewerBadgeLayout !== viewerLayout) updated = { ...updated, viewerBadgeLayout: viewerLayout };

    const jiltvPaint = live.jiltvPaints?.get(userId);
    if (jiltvPaint && updated.jiltvPaint !== jiltvPaint) updated = { ...updated, jiltvPaint };

    const worn = live.twitchWornBadges?.get(userId);
    if (worn) updated = withTwitchWornBadges(updated, worn);
    if (live.twitchBadgeArt) updated = withTwitchBadgeArt(updated, live.twitchBadgeArt);

    if (updated !== response) changed = true;
    next.set(login, updated);
  }

  return changed ? next : responses;
}

/**
 * The JilTV paint each identity wears (its own look: the roster isn't any one
 * channel's chat), through the live overlay's own lookup, which asks about the
 * whole roster in one request. Nothing is asked while the JilTV cosmetics gate
 * is off. `onPaint` gets the paints found so far, by user ID, as they arrive.
 */
export async function fetchPreviewJilTVPaints(
  identities: readonly { userId: string; login: string }[],
  options: {
    signal?: AbortSignal;
    enabled?: boolean;
    lookup?: (login: string) => Promise<JilTVPaintView | null>;
    onPaint?: (paints: ReadonlyMap<string, JilTVPaintView>) => void;
  } = {},
): Promise<ReadonlyMap<string, JilTVPaintView>> {
  const paints = new Map<string, JilTVPaintView>();
  if (!(options.enabled ?? JILTV_COSMETICS_ENABLED) || options.signal?.aborted) return paints;
  const lookup = options.lookup ?? ((login: string) => lookupJilTVPaint(login, '', true));
  const byLogin = new Map<string, string>();
  for (const { userId, login } of identities) {
    const key = login.trim().toLowerCase();
    if (/^\d{1,25}$/.test(userId) && /^[a-z0-9_]{1,25}$/.test(key) && !byLogin.has(key)) byLogin.set(key, userId);
    if (byLogin.size >= PREVIEW_LIVE_MAX_IDENTITIES) break;
  }
  await Promise.all([...byLogin].map(async ([login, userId]) => {
    const paint = await lookup(login).catch(() => null);
    if (options.signal?.aborted || !paint) return;
    paints.set(userId, paint);
    options.onPaint?.(new Map(paints));
  }));
  return paints;
}

/** Fetch every live source for the roster; each source fails independently. */
export async function loadPreviewLiveCosmetics(
  responses: ReadonlyMap<string, PreviewIdentityResponse>,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    resolveCommunity?: typeof resolveTwitchCommunityBadgesWithoutJilChat;
    resolveJilChat?: typeof resolveTwitchJilChatBadgesDetailed;
  } = {},
): Promise<{ live: PreviewLiveCosmetics; failedSources: number; totalSources: number }> {
  const identities = [...responses.values()].map((response) => response.identity);
  const userIds = identities.map((identity) => identity.userId);
  /* Per-user shown badges are slower (JilChat is paced); they load separately. */
  const [sevenTV, communityBadges, twitchArt, twitchWorn] = await Promise.allSettled([
    fetchPreviewSevenTVStyles(userIds, options),
    fetchPreviewCommunityBadges(identities, options.resolveCommunity),
    fetchPreviewTwitchBadgeArt(options),
    fetchPreviewTwitchWornBadges(userIds, options),
  ]);
  const sevenTVMap = sevenTV.status === 'fulfilled' ? sevenTV.value : new Map();
  const communityMap = communityBadges.status === 'fulfilled' ? communityBadges.value : new Map();
  const communityFailedProviders = new Set(communityBadgeProviderFailures());
  /* Loaded with the community lists above. */
  const viewerBadgeLayouts = new Map<string, ViewerBadgeLayout>();
  for (const userId of userIds) {
    const layout = moltorinoBadgeLayoutFor(userId);
    if (layout) viewerBadgeLayouts.set(userId, layout);
  }
  const art = twitchArt.status === 'fulfilled' ? twitchArt.value : {};
  const wornMap = twitchWorn.status === 'fulfilled' ? twitchWorn.value : new Map<string, readonly UnifiedBadge[]>();
  return {
    live: {
      sevenTV: sevenTVMap,
      communityBadges: communityMap,
      communityFailedProviders,
      ...(viewerBadgeLayouts.size ? { viewerBadgeLayouts } : {}),
      twitchBadgeArt: art,
      twitchWornBadges: wornMap,
    },
    failedSources: Number(sevenTVMap.size === 0)
      + Number(communityMap.size === 0)
      + Number(Object.keys(art).length === 0)
      + Number(wornMap.size === 0),
    totalSources: 4,
  };
}
