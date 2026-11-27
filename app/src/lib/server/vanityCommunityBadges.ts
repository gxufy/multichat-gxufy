import { validateCommunityBadgeAssetUrl } from './communityBadgeAsset';
import {
  FixedProviderUpstreamError,
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

export type VanityCommunityBadgeProvider = 'ffzap' | 'jilchat';

export type VanityCommunityBadge = {
  provider: VanityCommunityBadgeProvider;
  id: string;
  title: string;
  url: string;
  userIds: string[];
  backgroundColor?: string;
};

export const VANITY_BADGE_REQUEST_TIMEOUT_MS = 5_000;
export const VANITY_BADGE_RESPONSE_MAX_BYTES = 512 * 1024;
export const JILCHAT_USER_CACHE_TTL_MS = 15 * 60_000;
export const JILCHAT_USER_CACHE_MAX_KEYS = 500;
/* JilChat's directory says who displays which badge right now; refreshed this often. */
export const JILCHAT_DIRECTORY_TTL_MS = 5 * 60_000;
const JILCHAT_DIRECTORY_MAX_USERS = 50_000;

const GLOBAL_CACHE_TTL_MS = 30 * 60_000;
const FFZAP_SUPPORTERS_URL = 'https://api.ffzap.com/v1/supporters';
const JILCHAT_BADGES_URL = 'https://api.jil.chat/v1/badges';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

type CacheEntry<T> = { value: T; expiresAt: number };
type JilChatCatalogBadge = Omit<VanityCommunityBadge, 'provider' | 'userIds'>;
/*
 * JilChat's whole badge list (GET api.jil.chat/v1/badges): every custom and
 * milestone badge with the Twitch users displaying it right now, so one small
 * request says what every chatter shows. `listsUsers` is false if a future
 * answer stops listing users; lookups then fall back to asking per user.
 */
export type JilChatDirectory = {
  catalog: Map<string, JilChatCatalogBadge>;
  displayed: Map<string, string>;
  listsUsers: boolean;
};

let ffzapCache: CacheEntry<VanityCommunityBadge[]> | null = null;
let jilChatDirectoryCache: CacheEntry<JilChatDirectory> | null = null;
const jilChatUserCache = new Map<string, CacheEntry<VanityCommunityBadge[]>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum = 160): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized : '';
}

export function isTwitchNumericUserId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,25}$/.test(value);
}

function validColor(value: unknown): string {
  const color = boundedText(value, 7);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
}

function cacheHit<T>(entry: CacheEntry<T> | null, now = Date.now()): T | null {
  return entry && entry.expiresAt > now ? entry.value : null;
}

async function requestJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'User-Agent': BROWSER_USER_AGENT,
    },
  });
  if (!response.ok) {
    await discardFixedProviderBody(response);
    throw new FixedProviderUpstreamError('badge provider request failed');
  }
  return readBoundedFixedProviderJson(response, VANITY_BADGE_RESPONSE_MAX_BYTES);
}

async function cachedFixedWork<T>({
  cached,
  key,
  clientKey,
  load,
}: {
  cached: () => T | null;
  key: string;
  clientKey: string;
  load: (signal: AbortSignal) => Promise<T>;
}): Promise<T> {
  const current = cached();
  if (current !== null) return current;
  return runFixedProviderWork({
    key,
    clientKey,
    run: () => withFixedProviderTimeout(VANITY_BADGE_REQUEST_TIMEOUT_MS, async (signal) => {
      const afterAdmission = cached();
      return afterAdmission !== null ? afterAdmission : load(signal);
    }),
  });
}

export function parseFfzApSupporters(value: unknown): VanityCommunityBadge[] | null {
  if (!Array.isArray(value)) return null;
  const badges: VanityCommunityBadge[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const userId = String(raw.id ?? '').trim();
    if (!isTwitchNumericUserId(userId)) continue;
    const url = validateCommunityBadgeAssetUrl(
      `https://api.ffzap.com/v1/user/badge/${encodeURIComponent(userId)}/3`,
      'ffzap',
    );
    if (!url) continue;
    const backgroundColor = raw.badge_is_colored ? validColor(raw.badge_color) : '';
    badges.push({
      provider: 'ffzap',
      id: 'supporter',
      title: 'FFZ:AP Supporter',
      url,
      userIds: [userId],
      ...(backgroundColor ? { backgroundColor } : {}),
    });
  }
  return badges;
}

export function parseJilChatCatalog(value: unknown): Map<string, JilChatCatalogBadge> | null {
  if (!Array.isArray(value)) return null;
  const badges = new Map<string, JilChatCatalogBadge>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const slug = boundedText(raw.slug, 100).toLowerCase();
    const title = boundedText(raw.name) || slug;
    const url = validateCommunityBadgeAssetUrl(raw.image_url, 'jilchat');
    if (!slug || !url || badges.has(slug)) continue;
    badges.set(slug, { id: slug, title, url });
  }
  return badges;
}

export function parseJilChatDirectory(value: unknown): JilChatDirectory | null {
  const catalog = parseJilChatCatalog(value);
  if (catalog === null || !Array.isArray(value)) return null;
  const displayed = new Map<string, string>();
  let listsUsers = false;
  for (const raw of value) {
    if (!isRecord(raw) || !Array.isArray(raw.users)) continue;
    listsUsers = true;
    const slug = boundedText(raw.slug, 100).toLowerCase();
    if (!catalog.has(slug)) continue;
    for (const user of raw.users) {
      if (displayed.size >= JILCHAT_DIRECTORY_MAX_USERS) break;
      const userId = isRecord(user) ? String(user.twitch_id ?? '').trim() : '';
      /* One badge per user; the first listing wins if a user appears twice. */
      if (isTwitchNumericUserId(userId) && !displayed.has(userId)) displayed.set(userId, slug);
    }
  }
  return { catalog, displayed, listsUsers };
}

/** Everyone who displays a JilChat badge, as one badge per entry with its users. */
export function jilChatDirectoryBadges(directory: JilChatDirectory): VanityCommunityBadge[] {
  const users = new Map<string, string[]>();
  for (const [userId, slug] of directory.displayed) {
    const list = users.get(slug);
    if (list) list.push(userId);
    else users.set(slug, [userId]);
  }
  return [...directory.catalog.values()].flatMap((badge) => {
    const userIds = users.get(badge.id);
    return userIds ? [{ provider: 'jilchat' as const, ...badge, userIds }] : [];
  });
}

export function parseJilChatOwnership(
  value: unknown,
  userId: string,
  catalog: ReadonlyMap<string, JilChatCatalogBadge>,
): VanityCommunityBadge[] | null {
  if (!Array.isArray(value) || !isTwitchNumericUserId(userId)) return null;
  /*
   * JilChat marks the badge a user chose to display with `visible: true`
   * (e.g. Translator while also owning Halloween 2026 / First / Month 1).
   * When the API reports visibility, only the displayed badge is returned —
   * none when the user shows none. Older payloads without the flag keep
   * every owned badge.
   */
  const reportsVisibility = value.some((raw) => isRecord(raw) && typeof raw.visible === 'boolean');
  const seen = new Set<string>();
  const badges: VanityCommunityBadge[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    if (reportsVisibility && raw.visible !== true) continue;
    const slug = boundedText(raw.slug, 100).toLowerCase();
    if (!slug || seen.has(slug)) continue;
    const catalogBadge = catalog.get(slug);
    const fallbackUrl = validateCommunityBadgeAssetUrl(raw.image_url, 'jilchat');
    const url = catalogBadge?.url ?? fallbackUrl;
    if (!url) continue;
    seen.add(slug);
    badges.push({
      provider: 'jilchat',
      id: slug,
      title: catalogBadge?.title ?? (boundedText(raw.name) || slug),
      url,
      userIds: [userId],
    });
  }
  return badges;
}

export async function loadFfzApBadges(clientKey: string): Promise<VanityCommunityBadge[]> {
  return cachedFixedWork({
    cached: () => cacheHit(ffzapCache),
    key: 'ffzap-supporters',
    clientKey,
    load: async (signal) => {
      const parsed = parseFfzApSupporters(await requestJson(FFZAP_SUPPORTERS_URL, signal));
      if (parsed === null) throw new FixedProviderUpstreamError('malformed badge provider response');
      ffzapCache = { value: parsed, expiresAt: Date.now() + GLOBAL_CACHE_TTL_MS };
      return parsed;
    },
  });
}

export async function loadJilChatDirectory(clientKey: string): Promise<JilChatDirectory> {
  return cachedFixedWork({
    cached: () => cacheHit(jilChatDirectoryCache),
    key: 'jilchat-directory',
    clientKey,
    load: async (signal) => {
      const parsed = parseJilChatDirectory(await requestJson(JILCHAT_BADGES_URL, signal));
      if (parsed === null) throw new FixedProviderUpstreamError('malformed badge provider response');
      jilChatDirectoryCache = { value: parsed, expiresAt: Date.now() + JILCHAT_DIRECTORY_TTL_MS };
      return parsed;
    },
  });
}

function cachedJilChatUser(userId: string, now = Date.now()): VanityCommunityBadge[] | null {
  const entry = jilChatUserCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    jilChatUserCache.delete(userId);
    return null;
  }
  jilChatUserCache.delete(userId);
  jilChatUserCache.set(userId, entry);
  return entry.value;
}

function rememberJilChatUser(userId: string, value: VanityCommunityBadge[]): void {
  jilChatUserCache.delete(userId);
  while (jilChatUserCache.size >= JILCHAT_USER_CACHE_MAX_KEYS) {
    const oldest = jilChatUserCache.keys().next();
    if (oldest.done) break;
    jilChatUserCache.delete(oldest.value);
  }
  jilChatUserCache.set(userId, {
    value,
    expiresAt: Date.now() + JILCHAT_USER_CACHE_TTL_MS,
  });
}

export async function loadJilChatBadges(
  userId: string,
  clientKey: string,
): Promise<VanityCommunityBadge[]> {
  if (!isTwitchNumericUserId(userId)) return [];
  const directory = await loadJilChatDirectory(clientKey);
  /* The directory already says what this user displays: no request per user. */
  if (directory.listsUsers) {
    const slug = directory.displayed.get(userId);
    const badge = slug ? directory.catalog.get(slug) : undefined;
    return badge ? [{ provider: 'jilchat', ...badge, userIds: [userId] }] : [];
  }

  /* Safety net: the list stopped naming users, so ask for this one. */
  const current = cachedJilChatUser(userId);
  if (current !== null) return current;
  const ownership = await runFixedProviderWork({
    key: `jilchat-user:${userId}`,
    clientKey,
    run: () => withFixedProviderTimeout(VANITY_BADGE_REQUEST_TIMEOUT_MS, (signal) =>
      requestJson(
        `https://api.jil.chat/v1/badges/user/${encodeURIComponent(userId)}/all`,
        signal,
      )),
  });
  const parsed = parseJilChatOwnership(ownership, userId, directory.catalog);
  if (parsed === null) throw new FixedProviderUpstreamError('malformed badge provider response');
  rememberJilChatUser(userId, parsed);
  return parsed;
}

export async function resolveVanityCommunityBadges(
  userId: string,
  clientKey: string,
): Promise<VanityCommunityBadge[]> {
  if (!isTwitchNumericUserId(userId)) return [];
  const results = await Promise.allSettled([
    loadFfzApBadges(clientKey),
    loadJilChatBadges(userId, clientKey),
  ]);
  return results.flatMap((result) => result.status === 'fulfilled'
    ? result.value.filter((badge) => badge.userIds.includes(userId))
    : []);
}

export function vanityCommunityBadgeStatsForTests() {
  return { jilChatUserCacheKeys: jilChatUserCache.size };
}

export function resetVanityCommunityBadgeCachesForTests(): void {
  ffzapCache = null;
  jilChatDirectoryCache = null;
  jilChatUserCache.clear();
}
