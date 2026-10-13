import {
  type LimerinoBadgeFile,
  type LimerinoBadgeRecord,
  normalizeLimerinoArtHost,
  parseLimerinoFile,
} from '../limerinoBadges';
import { validateCommunityBadgeAssetUrl } from './communityBadgeAsset';
import {
  FixedProviderUpstreamError,
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

export const LIMERINO_CATALOG_URL = 'https://api.limerino.com/v1/badges';
export const LIMERINO_HOLDERS_URL = 'https://api.limerino.com/v1/badges/holders';
export const LIMERINO_REFRESH_MS = 10 * 60_000;
export const LIMERINO_RETRY_BASE_MS = 60_000;
export const LIMERINO_RETRY_MAX_MS = 10 * 60_000;
export const LIMERINO_REQUEST_TIMEOUT_MS = 5_000;
export const LIMERINO_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

type CatalogBadge = Omit<LimerinoBadgeRecord, 'users'>;
type Holders = Map<string, string[]>;
type EndpointResult<T> = { value: T; etag: string };
type CacheState = {
  catalog: CatalogBadge[];
  holders: Holders;
  badges: LimerinoBadgeRecord[];
  catalogEtag: string;
  holdersEtag: string;
};

let cache: CacheState | null = null;
let nextRefreshAt = 0;
let failures = 0;
let inFlight: Promise<LimerinoBadgeRecord[]> | null = null;

class LimerinoUpstreamError extends FixedProviderUpstreamError {
  constructor(readonly retryAfterMs = 0) {
    super('Limerino request failed');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : '';
}

function safeEtag(value: string | null): string {
  return value && value.length <= 256 && !/[\r\n]/.test(value) ? value : '';
}

function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1_000, LIMERINO_RETRY_MAX_MS);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - now), LIMERINO_RETRY_MAX_MS) : 0;
}

export function parseLimerinoCatalog(value: unknown): CatalogBadge[] | null {
  if (!isRecord(value) || !Array.isArray(value.badges)) return null;
  const badges: CatalogBadge[] = [];
  const seen = new Set<string>();
  for (const raw of value.badges) {
    if (!isRecord(raw) || raw.kind !== 'BADGE' || !isRecord(raw.data)) continue;
    const id = boundedText(raw.id ?? raw.data.id, 100);
    const title = boundedText(raw.data.tooltip, 160);
    const hostData = isRecord(raw.data.host) ? raw.data.host : null;
    const host = normalizeLimerinoArtHost(hostData?.url);
    const files = Array.isArray(hostData?.files)
      ? hostData.files.slice(0, 32).map(parseLimerinoFile)
        .filter((file): file is LimerinoBadgeFile => file !== null)
      : [];
    if (!id || seen.has(id) || !title || !host || !files.length) continue;
    if (!files.some((file) => (
      file.format === 'PNG'
      && validateCommunityBadgeAssetUrl(`${host}/${file.name}`, 'limerino') !== null
    ))) continue;
    seen.add(id);
    badges.push({ id, title, host, files });
    if (badges.length >= 1_000) break;
  }
  return badges;
}

export function parseLimerinoHolders(value: unknown): Holders | null {
  if (!isRecord(value) || !isRecord(value.users)) return null;
  const holders = new Map<string, string[]>();
  for (const [userId, rawBadges] of Object.entries(value.users)) {
    if (!/^\d{1,25}$/.test(userId) || !Array.isArray(rawBadges)) continue;
    const badgeIds = [...new Set(rawBadges.flatMap((badge) => {
      const id = boundedText(badge, 100);
      return id ? [id] : [];
    }))];
    holders.set(userId, badgeIds.slice(0, 100));
    if (holders.size >= 100_000) break;
  }
  return holders;
}

export function combineLimerinoBadges(
  catalog: readonly CatalogBadge[],
  holders: ReadonlyMap<string, readonly string[]>,
): LimerinoBadgeRecord[] {
  const usersByBadge = new Map<string, string[]>();
  for (const [userId, badgeIds] of holders) {
    for (const badgeId of badgeIds) {
      const users = usersByBadge.get(badgeId) ?? [];
      users.push(userId);
      usersByBadge.set(badgeId, users);
    }
  }
  return catalog.map((badge) => ({
    ...badge,
    users: usersByBadge.get(badge.id) ?? [],
  }));
}

async function requestEndpoint<T>(
  url: string,
  previous: T | null,
  etag: string,
  parse: (value: unknown) => T | null,
  now: number,
): Promise<EndpointResult<T>> {
  return withFixedProviderTimeout(LIMERINO_REQUEST_TIMEOUT_MS, async (signal) => {
    const response = await fetch(url, {
      signal,
      redirect: 'error',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    });
    if (response.status === 304) {
      await discardFixedProviderBody(response);
      if (previous === null) throw new LimerinoUpstreamError();
      return { value: previous, etag: safeEtag(response.headers.get('etag')) || etag };
    }
    if (!response.ok) {
      const delay = response.status === 429
        ? retryAfterMs(response.headers.get('retry-after'), now)
        : 0;
      await discardFixedProviderBody(response);
      throw new LimerinoUpstreamError(delay);
    }
    const parsed = parse(await readBoundedFixedProviderJson(response, LIMERINO_RESPONSE_MAX_BYTES));
    if (parsed === null) throw new LimerinoUpstreamError();
    return { value: parsed, etag: safeEtag(response.headers.get('etag')) };
  });
}

async function refresh(now: number): Promise<LimerinoBadgeRecord[]> {
  try {
    const [catalogResult, holdersResult] = await Promise.all([
      requestEndpoint(
        LIMERINO_CATALOG_URL,
        cache?.catalog ?? null,
        cache?.catalogEtag ?? '',
        parseLimerinoCatalog,
        now,
      ),
      requestEndpoint(
        LIMERINO_HOLDERS_URL,
        cache?.holders ?? null,
        cache?.holdersEtag ?? '',
        parseLimerinoHolders,
        now,
      ),
    ]);
    const badges = combineLimerinoBadges(catalogResult.value, holdersResult.value);
    cache = {
      catalog: catalogResult.value,
      holders: holdersResult.value,
      badges,
      catalogEtag: catalogResult.etag,
      holdersEtag: holdersResult.etag,
    };
    failures = 0;
    nextRefreshAt = now + LIMERINO_REFRESH_MS;
    return badges;
  } catch (error) {
    failures += 1;
    const exponential = Math.min(
      LIMERINO_RETRY_BASE_MS * (2 ** Math.min(failures - 1, 4)),
      LIMERINO_RETRY_MAX_MS,
    );
    const providerDelay = error instanceof LimerinoUpstreamError ? error.retryAfterMs : 0;
    nextRefreshAt = now + Math.max(exponential, providerDelay);
    if (cache) return cache.badges;
    throw error;
  }
}

export function loadLimerinoBadges(now = Date.now()): Promise<LimerinoBadgeRecord[]> {
  if (cache && now < nextRefreshAt) return Promise.resolve(cache.badges);
  if (inFlight) return inFlight;
  const work = refresh(now);
  inFlight = work;
  void work.then(
    () => { if (inFlight === work) inFlight = null; },
    () => { if (inFlight === work) inFlight = null; },
  );
  return work;
}

export function resetLimerinoBadgeCacheForTests(): void {
  cache = null;
  nextRefreshAt = 0;
  failures = 0;
  inFlight = null;
}

export function limerinoBadgeCacheStatsForTests() {
  return {
    cached: cache !== null,
    catalogEtag: cache?.catalogEtag ?? '',
    holdersEtag: cache?.holdersEtag ?? '',
    nextRefreshAt,
    failures,
  };
}
