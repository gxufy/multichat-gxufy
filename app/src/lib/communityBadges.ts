import type { UnifiedBadge } from './types';
import {
  type LimerinoBadgeRecord,
  type LimerinoBadgeRenderOptions,
  parseLimerinoBadgeRecords,
  selectLimerinoBadgeImage,
} from './limerinoBadges';
import { resolvePreviewsBadge } from './previewsBadges';

type ProviderName =
  | 'chatterino'
  | 'homies'
  | 'custom-homies'
  | 'moltorino'
  | 'bluzyrino'
  | 'ffz'
  | 'bttv'
  | 'turteg'
  | 'polandbot'
  | 'bchat'
  | 'badgehq'
  | 'folhinha'
  | 'dankchat'
  | 'chatty'
  | 'chatsen'
  | 'ffzap'
  | 'streamnook'
  | 'jilchat'
  | 'limerino'
  | 'enhancer'
  | 'previews'
  | 'gxufy';

type Assignment = {
  provider: ProviderName;
  id: string;
  title: string;
  url: string;
  userIds: string[];
  usernames: string[];
  backgroundColor?: string;
  fallbackUrl?: string;
  limerinoBadge?: LimerinoBadgeRecord;
};

type Registry = {
  byUserId: Map<string, Assignment[]>;
  byUsername: Map<string, Assignment[]>;
  partial: boolean;
};

const SUCCESS_TTL_MS = 30 * 60_000;
const PARTIAL_TTL_MS = 5 * 60_000;
const LIMERINO_CLIENT_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
export const COMMUNITY_BADGE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
export const JILCHAT_CLIENT_CACHE_TTL_MS = 15 * 60_000;
export const JILCHAT_CLIENT_FAILURE_TTL_MS = 5 * 60_000;
export const JILCHAT_CLIENT_CACHE_MAX_KEYS = 500;
export const JILCHAT_CLIENT_MAX_CONCURRENT = 6;

const STREAMNOOK_CLIENT_CACHE_TTL_MS = 60_000;
const STREAMNOOK_CLIENT_FAILURE_TTL_MS = 10_000;
const STREAMNOOK_CLIENT_CACHE_MAX_KEYS = 5_000;
const STREAMNOOK_BATCH_MAX_IDS = 200;
const STREAMNOOK_BATCH_WINDOW_MS = 25;
const STREAMNOOK_BATCH_MIN_INTERVAL_MS = 250;
const STREAMNOOK_BULK_CACHE_TTL_MS = 5 * 60_000;
const STREAMNOOK_USERS_URL = 'https://streamnook.app/api/v1/cosmetics/users';
const STREAMNOOK_BADGES_USERS_URL = 'https://streamnook.app/api/v1/cosmetics/badges/users';

const PREVIEWS_CLIENT_CACHE_TTL_MS = 5 * 60_000;

type PreviewsClientDataset = {
  twitch: Record<string, number>;
};

let cachedPreviewsDataset: PreviewsClientDataset | null = null;
let cachedPreviewsAt = 0;
let previewsInFlight: Promise<PreviewsClientDataset> | null = null;
type GxufyClientBadge = {
  id: string;
  title: string;
  url: string;
  userIds: string[];
};

let cachedGxufyBadges: GxufyClientBadge[] | null = null;
let cachedGxufyAt = 0;
let gxufyInFlight: Promise<GxufyClientBadge[]> | null = null;
const GXUFY_CLIENT_CACHE_TTL_MS = 5 * 60_000;
/* Providers in this set can mirror the same client badge artwork. Keeping the
   set explicit allows cross-provider title de-duplication. */
const MIRRORED_CHAT_CLIENT_PROVIDERS = new Set<ProviderName>([
  'ffz',
  'bttv',
  'chatterino',
  'homies',
  'chatsen',
  'chatty',
  'dankchat',
]);

let cachedRegistry: Registry | null = null;
let cachedAt = 0;
let inFlight: Promise<Registry> | null = null;

type ProviderCacheEntry = {
  badges: Assignment[];
  failed: boolean;
  expiresAt: number;
};

const providerCache = new Map<number, ProviderCacheEntry>();
const providerInFlight = new Map<number, Promise<ProviderCacheEntry>>();

let cachedLimerino: Assignment[] | null = null;
let cachedLimerinoAt = 0;
let limerinoInFlight: Promise<Assignment[]> | null = null;
const jilChatUserCache = new Map<string, { badges: Assignment[]; expiresAt: number }>();
const jilChatUserInFlight = new Map<string, Promise<Assignment[]>>();

type JilChatQueueEntry = {
  userId: string;
  resolve: (badges: Assignment[]) => void;
};

const jilChatQueue: JilChatQueueEntry[] = [];
let jilChatActiveRequests = 0;

type StreamNookQueueEntry = {
  userId: string;
  resolve: (badges: Assignment[]) => void;
};

const streamNookUserCache = new Map<
  string,
  { badges: Assignment[]; expiresAt: number }
>();
const streamNookUserInFlight = new Map<string, Promise<Assignment[]>>();

let streamNookBulkCache: {
  badgesByUserId: Map<string, Assignment[]>;
  expiresAt: number;
} | null = null;

let streamNookBulkInFlight:
  | Promise<Map<string, Assignment[]>>
  | null = null;

const streamNookQueue: StreamNookQueueEntry[] = [];
let streamNookFlushTimer: ReturnType<typeof setTimeout> | null = null;
let streamNookBatchActive = false;
let streamNookLastBatchStartedAt = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return asString(value);
}

function httpsUrl(value: unknown): string {
  const raw = asString(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'badge';
}

function badgeBackgroundColor(value: unknown): string {
  const raw = asString(value);
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '';
}

function strings(value: unknown): string[] {
  return asArray(value).map(asId).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function assignment(
  provider: ProviderName,
  id: string,
  title: string,
  url: string,
  userIds: string[] = [],
  usernames: string[] = [],
  backgroundColor = '',
): Assignment | null {
  const image = httpsUrl(url);
  if (!image) return null;
  const normalizedBackgroundColor = badgeBackgroundColor(backgroundColor);
  return {
    provider,
    id: id || slug(title),
    title: title || id || provider,
    url: image,
    userIds: unique(userIds),
    usernames: unique(usernames.map((name) => name.toLowerCase())),
    ...(normalizedBackgroundColor ? { backgroundColor: normalizedBackgroundColor } : {}),
  };
}

function parsePreviewsClientDataset(
  value: unknown,
): PreviewsClientDataset {
  if (!isRecord(value) || !isRecord(value.twitch)) {
    throw new Error('Malformed Previews badge dataset');
  }

  const twitch: Record<string, number> = {};

  for (const [rawHash, rawMonths] of Object.entries(value.twitch)) {
    const hash = rawHash.trim().toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(hash)) continue;

    if (
      typeof rawMonths !== 'number'
      || !Number.isInteger(rawMonths)
      || rawMonths < 0
    ) {
      continue;
    }

    twitch[hash] = rawMonths;
  }

  return { twitch };
}

async function previewsClientDataset(): Promise<PreviewsClientDataset> {
  const now = Date.now();

  if (
    cachedPreviewsDataset
    && now - cachedPreviewsAt < PREVIEWS_CLIENT_CACHE_TTL_MS
  ) {
    return cachedPreviewsDataset;
  }

  if (previewsInFlight) return previewsInFlight;

  const work = requestJson('/api/twitch/previews-badges')
    .then((body) => {
      const dataset = parsePreviewsClientDataset(body);
      cachedPreviewsDataset = dataset;
      cachedPreviewsAt = Date.now();
      return dataset;
    })
    .catch((error) => {
      if (cachedPreviewsDataset) {
        return cachedPreviewsDataset;
      }

      throw error;
    });

  previewsInFlight = work;

  void work.then(
    () => {
      if (previewsInFlight === work) {
        previewsInFlight = null;
      }
    },
    () => {
      if (previewsInFlight === work) {
        previewsInFlight = null;
      }
    },
  );

  return work;
}

async function loadPreviews(
  login: string,
): Promise<Assignment[]> {
  /*
   * The Previews extension keys Twitch ownership by SHA-256 of the
   * canonical lower-case Twitch login. Do not fall back to displayName:
   * localized/display casing is not part of the ownership key.
   */
  const normalizedLogin = login.trim().toLowerCase();

  if (!normalizedLogin) return [];

  const dataset = await previewsClientDataset();

  const resolved = await resolvePreviewsBadge(
    normalizedLogin,
    dataset.twitch,
  );

  if (!resolved) return [];

  return [{
    provider: 'previews',
    id: `subscriber-${resolved.threshold}`,
    title: resolved.title,
    url: resolved.url,
    userIds: [],
    usernames: [normalizedLogin],
  }];
}
function parseGxufyClientBadges(
  value: unknown,
): GxufyClientBadge[] {
  if (!Array.isArray(value)) {
    throw new Error('Malformed GXUFY badge response');
  }

  const badges: GxufyClientBadge[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (typeof item.title !== 'string' || !item.title.trim()) continue;
    if (typeof item.url !== 'string' || !item.url.trim()) continue;
    if (!Array.isArray(item.userIds)) continue;

    const userIds = item.userIds
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => /^\d+$/.test(entry));

    badges.push({
      id: item.id.trim(),
      title: item.title.trim(),
      url: item.url.trim(),
      userIds,
    });
  }

  return badges;
}

async function gxufyClientBadges(): Promise<GxufyClientBadge[]> {
  const now = Date.now();

  if (
    cachedGxufyBadges
    && now - cachedGxufyAt < GXUFY_CLIENT_CACHE_TTL_MS
  ) {
    return cachedGxufyBadges;
  }

  if (gxufyInFlight) return gxufyInFlight;

  const work = requestJson('/api/twitch/gxufy-badges')
    .then((body) => {
      const badges = parseGxufyClientBadges(body);
      cachedGxufyBadges = badges;
      cachedGxufyAt = Date.now();
      return badges;
    })
    .catch((error) => {
      if (cachedGxufyBadges) {
        return cachedGxufyBadges;
      }

      throw error;
    });

  gxufyInFlight = work;

  void work.then(
    () => {
      if (gxufyInFlight === work) {
        gxufyInFlight = null;
      }
    },
    () => {
      if (gxufyInFlight === work) {
        gxufyInFlight = null;
      }
    },
  );

  return work;
}

async function loadGxufy(
  userId: string,
): Promise<Assignment[]> {
  const normalizedUserId = userId.trim();

  if (!/^\d+$/.test(normalizedUserId)) return [];

  const badges = await gxufyClientBadges();

  return badges
    .filter((badge) => badge.userIds.includes(normalizedUserId))
    .map((badge) => ({
      provider: 'gxufy' as const,
      id: badge.id,
      title: badge.title,
      url: badge.url,
      userIds: [normalizedUserId],
      usernames: [],
    }));
}
async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort after rejecting a provider response.
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const rawLength = response.headers.get('content-length');
  if (rawLength && /^\d+$/.test(rawLength)) {
    const declared = Number(rawLength);
    if (!Number.isFinite(declared) || declared > COMMUNITY_BADGE_RESPONSE_MAX_BYTES) {
      await cancelResponseBody(response);
      throw new Error('response too large');
    }
  }
  if (!response.body) throw new Error('malformed response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > COMMUNITY_BADGE_RESPONSE_MAX_BYTES) throw new Error('response too large');
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function requestJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: typeof window === 'undefined' ? 'error' : 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await boundedJson(response);
  } finally {
    clearTimeout(timer);
  }
}

function chatterinoLike(provider: ProviderName, body: unknown): Assignment[] {
  const badges = isRecord(body) ? asArray(body.badges) : [];
  return badges.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const title = asString(raw.tooltip) || asString(raw.title) || asString(raw.id) || provider;
    const item = assignment(
      provider,
      asString(raw.id) || slug(title),
      title,
      asString(raw.image3) || asString(raw.image2) || asString(raw.image1),
      strings(raw.users),
    );
    return item ? [item] : [];
  });
}

async function loadChatterino(): Promise<Assignment[]> {
  return chatterinoLike('chatterino', await requestJson('https://api.chatterino.com/badges'));
}

async function loadLegacyHomies(): Promise<Assignment[]> {
  const [one, two] = await Promise.allSettled([
    requestJson('https://itzalex.github.io/badges'),
    requestJson('https://itzalex.github.io/badges2'),
  ]);
  const out: Assignment[] = [];
  if (one.status === 'fulfilled') out.push(...chatterinoLike('homies', one.value));
  if (two.status === 'fulfilled') out.push(...chatterinoLike('homies', two.value));
  return out;
}

async function loadCustomHomies(): Promise<Assignment[]> {
  const body = await requestJson('https://chatterinohomies.com/api/badges/list');
  const badges = isRecord(body) ? asArray(body.badges) : [];
  return badges.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const title = asString(raw.tooltip) || 'Custom Homies Badge';
    const item = assignment(
      'custom-homies',
      asString(raw.badgeId) || `custom-homies-${index}`,
      title,
      asString(raw.image3) || asString(raw.image2) || asString(raw.image1),
      [asId(raw.userId)].filter(Boolean),
      [asString(raw.username)].filter(Boolean),
    );
    return item ? [item] : [];
  });
}

async function loadMoltorino(): Promise<Assignment[]> {
  const body = await requestJson('https://api.moltorino.com/badges');
  const badges = isRecord(body) ? asArray(body.badges) : [];
  return badges.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const users = asArray(raw.users).filter(isRecord);
    const images = isRecord(raw.images) ? raw.images : {};
    const title = asString(raw.tooltip) || asString(raw.id) || 'Moltorino';
    const item = assignment(
      'moltorino',
      asString(raw.id) || slug(title),
      title,
      asString(images['3x']) || asString(images['2x']) || asString(images['1x']),
      users.map((user) => asId(user.id)).filter(Boolean),
      users.map((user) => asString(user.username)).filter(Boolean),
    );
    return item ? [item] : [];
  });
}

async function loadBluzyrino(): Promise<Assignment[]> {
  const body = await requestJson('https://bluzyrino-badge-registry.blu901-55.workers.dev/v1/badges');
  const bchat = isRecord(body) && isRecord(body.bchat) ? body.bchat : {};
  const badges = asArray(bchat.badges);
  return badges.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const users = asArray(raw.users).filter(isRecord);
    const title = asString(raw.tooltip) || asString(raw.id) || 'Bluzyrino';
    const item = assignment(
      'bluzyrino',
      asString(raw.id) || slug(title),
      title,
      asString(raw.image_url_4x) || asString(raw.image_url_2x) || asString(raw.image_url_1x),
      users.map((user) => asId(user.id)).filter(Boolean),
      users.map((user) => asString(user.login)).filter(Boolean),
    );
    return item ? [item] : [];
  });
}

function parseFFZ(body: unknown, ownersAreIds: boolean): Assignment[] {
  if (!isRecord(body)) return [];
  const badges = asArray(body.badges);
  const users = isRecord(body.users) ? body.users : {};
  return badges.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const id = asId(raw.id);
    const urls = isRecord(raw.urls) ? raw.urls : {};
    const image = asString(urls['4']) || asString(urls['3']) || asString(urls['2']) || asString(urls['1']);
    const title = asString(raw.title) || asString(raw.name) || `FFZ ${id}`;
    const owners = id ? strings(users[id]) : [];
    const item = assignment(
      'ffz',
      id || slug(title),
      title,
      image,
      ownersAreIds ? owners : [],
      ownersAreIds ? [] : owners,
      asString(raw.color),
    );
    return item ? [item] : [];
  });
}

async function loadFFZ(): Promise<Assignment[]> {
  /* Prefer the endpoint that maps directly to Twitch user IDs, but retain the
     older username feed as
     a compatibility fallback in case the IDs endpoint is temporarily unavailable. */
  try {
    const byId = parseFFZ(await requestJson('https://api.frankerfacez.com/v1/badges/ids'), true);
    if (byId.length) return byId;
  } catch { /* fall through */ }
  return parseFFZ(await requestJson('https://api.frankerfacez.com/v1/badges'), false);
}

function parseBTTV(body: unknown): Assignment[] {
  return asArray(body).flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const badge = isRecord(raw.badge) ? raw.badge : {};
    const title = asString(badge.description) || asString(raw.title) || 'BTTV';
    const item = assignment(
      'bttv',
      asString(raw.id) || `bttv-${index}`,
      title,
      asString(badge.svg) || asString(raw.url),
      [asId(raw.providerId)].filter(Boolean),
    );
    return item ? [item] : [];
  });
}

async function loadBTTV(): Promise<Assignment[]> {
  /* Prefer the current cached-badges endpoint, with the old /twitch route
     retained only as a fallback for provider-side compatibility. */
  try {
    const current = parseBTTV(await requestJson('https://api.betterttv.net/3/cached/badges'));
    if (current.length) return current;
  } catch { /* fall through */ }
  return parseBTTV(await requestJson('https://api.betterttv.net/3/cached/badges/twitch'));
}

async function loadTurteg(): Promise<Assignment[]> {
  const body = await requestJson('https://turteg-api.xslash.ovh/v1/ffz/badges');
  const badges = isRecord(body) ? asArray(body.badges) : [];
  return badges.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const urls = isRecord(raw.urls) ? raw.urls : {};
    const title = asString(raw.title) || 'Turteg';
    const item = assignment(
      'turteg',
      asId(raw.id) || `turteg-${index}`,
      title,
      asString(raw.image) || asString(urls['4']) || asString(urls['3']) || asString(urls['2']) || asString(urls['1']),
      strings(raw.users),
    );
    return item ? [item] : [];
  });
}

async function loadPolandBot(): Promise<Assignment[]> {
  const body = await requestJson('https://devpoland.xyz/api/roles');
  if (!isRecord(body)) return [];
  return Object.entries(body).flatMap(([role, rawUsers]) => {
    const item = assignment(
      'polandbot',
      role,
      role,
      `https://devpoland.xyz/badges/${encodeURIComponent(role)}.avif`,
      strings(rawUsers),
    );
    return item ? [item] : [];
  });
}

async function loadBChat(): Promise<Assignment[]> {
  const body =
    await requestJson(
      '/api/twitch/bchat-badges',
    );

  return asArray(body).flatMap(
    (raw, index) => {
      if (!isRecord(raw)) return [];

      const title =
        asString(raw.title)
        || 'bChat';

      const item = assignment(
        'bchat',
        asString(raw.id)
          || `bchat-${index}`,
        title,
        asString(raw.url),
        strings(raw.users),
      );

      return item ? [item] : [];
    },
  );
}

async function loadBadgeHq(): Promise<Assignment[]> {
  const body =
    await requestJson(
      '/api/twitch/badgehq-badges',
    );

  return asArray(body).flatMap(
    (raw, index) => {
      if (!isRecord(raw)) return [];

      const title =
        asString(raw.title)
        || 'BadgeHQ';

      const item = assignment(
        'badgehq',
        asString(raw.id)
          || `badgehq-${index}`,
        title,
        asString(raw.url),
        strings(raw.users),
      );

      return item ? [item] : [];
    },
  );
}

async function loadFolhinha(): Promise<Assignment[]> {
  const body = await requestJson('https://api.folhinhabot.com/plus');
  if (!isRecord(body)) return [];
  const badges = isRecord(body.badges) ? body.badges : {};
  const imageFor = (role: string): string => {
    const raw = badges[role];
    if (!isRecord(raw)) return '';
    return asString(raw['4']) || asString(raw['3']) || asString(raw['2']) || asString(raw['1']);
  };
  const definitions = [
    /* The current API uses `dev`; retain `devs` as a compatibility fallback for
       older cached/provider payloads. */
    { list: body.dev ?? body.devs, role: 'dev', imageRole: 'dev', title: 'Folhinha Developer' },
    { list: body.admins, role: 'admin', imageRole: 'admin', title: 'Folhinha Admin' },
    { list: body.plus, role: 'founder', imageRole: 'founder', title: 'Folhinha Founder' },
    { list: body.supporters, role: 'supporter', imageRole: 'sub', title: 'Folhinha Supporter' },
  ] as const;
  return definitions.flatMap((definition) => {
    const image = imageFor(definition.imageRole);
    return asArray(definition.list).flatMap((raw, index) => {
      if (!isRecord(raw)) return [];
      const item = assignment(
        'folhinha',
        `${definition.role}-${asId(raw.id) || index}`,
        definition.title,
        image,
        [asId(raw.userId) || asId(raw.userid)].filter(Boolean),
        [asString(raw.currAlias)].filter(Boolean),
      );
      return item ? [item] : [];
    });
  });
}

async function loadDankChat(): Promise<Assignment[]> {
  const body = await requestJson('/api/twitch/dankchat-badges');
  return asArray(body).flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const title = asString(raw.type) || 'DankChat';
    const item = assignment(
      'dankchat',
      `dankchat-${index}`,
      title,
      asString(raw.url),
      strings(raw.users),
    );
    return item ? [item] : [];
  });
}

async function loadChatty(): Promise<Assignment[]> {
  const body = await requestJson('/api/twitch/chatty-badges');
  return asArray(body).flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const title = asString(raw.title) || 'Chatty';
    const item = assignment(
      'chatty',
      asString(raw.id) || `chatty-${index}`,
      title,
      asString(raw.url),
      strings(raw.users),
      strings(raw.usernames),
      asString(raw.color),
    );
    return item ? [item] : [];
  });
}

async function loadChatsen(): Promise<Assignment[]> {
  const body = await requestJson('/api/twitch/chatsen-badges');
  return asArray(body).flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const title = asString(raw.title) || 'Chatsen';
    const item = assignment(
      'chatsen',
      asString(raw.id) || `chatsen-${index}`,
      title,
      asString(raw.url),
      strings(raw.users),
      strings(raw.usernames),
    );
    return item ? [item] : [];
  });
}

function normalizedProviderBadges(provider: 'ffzap', body: unknown): Assignment[] {
  return asArray(body).flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const title = asString(raw.title) || 'FFZ:AP Supporter';
    const item = assignment(
      provider,
      asString(raw.id) || `${provider}-${index}`,
      title,
      asString(raw.url),
      strings(raw.users),
      [],
      asString(raw.color),
    );
    return item ? [item] : [];
  });
}

async function loadFfzAp(): Promise<Assignment[]> {
  return normalizedProviderBadges('ffzap', await requestJson('/api/twitch/ffzap-badges'));
}

async function loadEnhancer(): Promise<Assignment[]> {
  const body = await requestJson('/api/twitch/enhancer-badges');

  return asArray(body).flatMap((raw, index) => {
    if (!isRecord(raw)) return [];

    const title = asString(raw.title) || 'Enhancer';

    const item = assignment(
      'enhancer',
      asString(raw.id) || `enhancer-${index}`,
      title,
      asString(raw.url),
      strings(raw.users),
    );

    return item ? [item] : [];
  });
}

async function loadLimerino(): Promise<Assignment[]> {
  if (typeof window === 'undefined') return [];
  return parseLimerinoBadgeRecords(await requestJson('/api/twitch/limerino-badges'))
    .flatMap((badge) => {
      const image = selectLimerinoBadgeImage(badge, {
        slotSizePx: 18,
        displayScale: 1,
        reducedMotion: false,
      });
      if (!image) return [];
      return [{
        provider: 'limerino' as const,
        id: badge.id,
        title: badge.title,
        url: image.url,
        fallbackUrl: image.fallbackUrl,
        userIds: badge.users,
        usernames: [],
        limerinoBadge: badge,
      }];
    });
}

async function limerinoRegistry(): Promise<Assignment[]> {
  const now = Date.now();
  if (cachedLimerino && now - cachedLimerinoAt < LIMERINO_CLIENT_TTL_MS) {
    return cachedLimerino;
  }
  if (limerinoInFlight) return limerinoInFlight;

  const work = loadLimerino().then((badges) => {
    cachedLimerino = badges;
    cachedLimerinoAt = Date.now();
    return badges;
  }, (error) => {
    if (cachedLimerino) return cachedLimerino;
    throw error;
  });
  limerinoInFlight = work;
  void work.then(
    () => { if (limerinoInFlight === work) limerinoInFlight = null; },
    () => { if (limerinoInFlight === work) limerinoInFlight = null; },
  );
  return work;
}

function cachedJilChat(userId: string, now = Date.now()): Assignment[] | null {
  const cached = jilChatUserCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    jilChatUserCache.delete(userId);
    return null;
  }
  jilChatUserCache.delete(userId);
  jilChatUserCache.set(userId, cached);
  return cached.badges;
}

function rememberJilChat(
  userId: string,
  badges: Assignment[],
  ttlMs = JILCHAT_CLIENT_CACHE_TTL_MS,
): void {
  jilChatUserCache.delete(userId);
  while (jilChatUserCache.size >= JILCHAT_CLIENT_CACHE_MAX_KEYS) {
    const oldest = jilChatUserCache.keys().next();
    if (oldest.done) break;
    jilChatUserCache.delete(oldest.value);
  }
  jilChatUserCache.set(userId, {
    badges,
    expiresAt: Date.now() + ttlMs,
  });
}

async function requestJilChat(userId: string): Promise<Assignment[]> {
  try {
    const body = await requestJson(
      `/api/twitch/jilchat-badges?userId=${encodeURIComponent(userId)}`,
    );

    const badges = asArray(body).flatMap((raw, index) => {
      if (!isRecord(raw)) return [];

      const title = asString(raw.title) || 'JilChat';
      const item = assignment(
        'jilchat',
        asString(raw.id) || `jilchat-${index}`,
        title,
        asString(raw.url),
        [userId],
      );

      return item ? [item] : [];
    });

    rememberJilChat(userId, badges);
    return badges;
  } catch {
    /*
     * A provider outage must not make every subsequent message from the same
     * chatter immediately retry the ownership endpoint. Cache the miss briefly,
     * then allow it to be checked again after the provider has had time to
     * recover.
     */
    rememberJilChat(
      userId,
      [],
      JILCHAT_CLIENT_FAILURE_TTL_MS,
    );

    return [];
  }
}

function drainJilChatQueue(): void {
  while (
    jilChatActiveRequests < JILCHAT_CLIENT_MAX_CONCURRENT &&
    jilChatQueue.length > 0
  ) {
    const next = jilChatQueue.shift();
    if (!next) break;

    jilChatActiveRequests += 1;

    void requestJilChat(next.userId)
      .then(next.resolve)
      .finally(() => {
        jilChatActiveRequests -= 1;
        drainJilChatQueue();
      });
  }
}

async function loadJilChat(userId: string): Promise<Assignment[]> {
  if (!/^\d{1,25}$/.test(userId)) return [];

  const cached = cachedJilChat(userId);
  if (cached) return cached;

  const existing = jilChatUserInFlight.get(userId);
  if (existing) return existing;

  /*
   * Queue every unique user instead of dropping ownership checks during a busy
   * channel. Only a small number contact JilChat simultaneously; the rest wait
   * their turn and still receive their badge update when resolved.
   */
  const work = new Promise<Assignment[]>((resolve) => {
    jilChatQueue.push({ userId, resolve });
    drainJilChatQueue();
  });

  jilChatUserInFlight.set(userId, work);

  void work.then(
    () => jilChatUserInFlight.delete(userId),
    () => jilChatUserInFlight.delete(userId),
  );

  return work;
}

function cachedStreamNook(
  userId: string,
  now = Date.now(),
): Assignment[] | null {
  const cached = streamNookUserCache.get(userId);
  if (!cached || cached.expiresAt <= now) return null;

  streamNookUserCache.delete(userId);
  streamNookUserCache.set(userId, cached);
  return cached.badges;
}

function rememberStreamNook(
  userId: string,
  badges: Assignment[],
  ttlMs = STREAMNOOK_CLIENT_CACHE_TTL_MS,
): void {
  streamNookUserCache.delete(userId);

  while (streamNookUserCache.size >= STREAMNOOK_CLIENT_CACHE_MAX_KEYS) {
    const oldest = streamNookUserCache.keys().next();
    if (oldest.done) break;
    streamNookUserCache.delete(oldest.value);
  }

  streamNookUserCache.set(userId, {
    badges,
    expiresAt: Date.now() + ttlMs,
  });
}

function streamNookBadgesForUser(
  userId: string,
  rawUser: unknown,
  rawCosmetics: unknown,
): Assignment[] {
  if (!isRecord(rawUser)) return [];

  const equipped = isRecord(rawUser.equipped) ? rawUser.equipped : {};
  const badgeSlug = asString(rawUser.badge) || asString(equipped.badge);
  if (!badgeSlug || !isRecord(rawCosmetics)) return [];

  const cosmetic = rawCosmetics[badgeSlug];
  if (!isRecord(cosmetic)) return [];

  const kind = asString(cosmetic.kind);
  if (kind && kind !== 'badge') return [];

  const surfaces = asArray(cosmetic.surfaces)
    .map(asString)
    .filter(Boolean);

  if (surfaces.length && !surfaces.includes('chat')) return [];

  const item = assignment(
    'streamnook',
    badgeSlug,
    asString(cosmetic.name) || 'StreamNook',
    asString(cosmetic.image_url),
    [userId],
  );

  return item ? [item] : [];
}

function parseStreamNookBulkRegistry(
  body: unknown,
): Map<string, Assignment[]> | null {
  if (
    !isRecord(body)
    || !Array.isArray(body.badges)
    || !isRecord(body.users)
  ) {
    return null;
  }

  const badgeDefinitions = new Map<
    string,
    { name: string; url: string }
  >();

  for (const rawBadge of body.badges) {
    if (!isRecord(rawBadge)) continue;

    const slug =
      asString(rawBadge.slug)
      || asString(rawBadge.version);

    const url =
      asString(rawBadge.image_url_4)
      || asString(rawBadge.image_url_2)
      || asString(rawBadge.image_url);

    if (!slug || !url) continue;

    badgeDefinitions.set(slug, {
      name:
        asString(rawBadge.name)
        || asString(rawBadge.meta_title)
        || 'StreamNook',
      url,
    });
  }

  const badgesByUserId = new Map<string, Assignment[]>();
  let unresolvedAppliedBadge = false;

  for (const [userId, rawUser] of Object.entries(body.users)) {
    if (!/^\d{1,15}$/.test(userId) || !isRecord(rawUser)) continue;

    /*
     * StreamNook's bulk file can list every badge a member owns, but chat must
     * render exactly one: the badge in users[id].applied.
     */
    const applied = asString(rawUser.applied);
    if (!applied) continue;

    const definition = badgeDefinitions.get(applied);

    if (!definition) {
      unresolvedAppliedBadge = true;
      continue;
    }

    const item = assignment(
      'streamnook',
      applied,
      definition.name,
      definition.url,
      [userId],
    );

    if (item) {
      badgesByUserId.set(userId, [item]);
    }
  }

  /*
   * A user pointing at an unknown applied slug means this bulk response cannot
   * faithfully render everyone. Treat that as unusable so the existing expanded
   * per-user path can recover hidden/staged art instead of silently dropping it.
   */
  if (unresolvedAppliedBadge) return null;

  return badgesByUserId;
}

function cachedStreamNookBulk(
  now = Date.now(),
): Map<string, Assignment[]> | null {
  if (
    !streamNookBulkCache
    || streamNookBulkCache.expiresAt <= now
  ) {
    return null;
  }

  return streamNookBulkCache.badgesByUserId;
}

async function streamNookBulkRegistry():
Promise<Map<string, Assignment[]>> {
  const cached = cachedStreamNookBulk();
  if (cached) return cached;

  if (streamNookBulkInFlight) {
    return streamNookBulkInFlight;
  }

  const stale = streamNookBulkCache?.badgesByUserId ?? null;

  const work = (async () => {
    try {
      const body = await requestJson(
        STREAMNOOK_BADGES_USERS_URL,
      );

      const badgesByUserId =
        parseStreamNookBulkRegistry(body);

      if (!badgesByUserId) {
        throw new Error(
          'Invalid StreamNook bulk badge registry',
        );
      }

      streamNookBulkCache = {
        badgesByUserId,
        expiresAt:
          Date.now() + STREAMNOOK_BULK_CACHE_TTL_MS,
      };

      return badgesByUserId;
    } catch (error) {
      /*
       * Keep the last complete bulk file briefly during an outage. If there has
       * never been a good copy, rethrow so loadStreamNook uses the established
       * /users?ids= fallback path.
       */
      if (stale) {
        streamNookBulkCache = {
          badgesByUserId: stale,
          expiresAt:
            Date.now() + STREAMNOOK_CLIENT_FAILURE_TTL_MS,
        };

        return stale;
      }

      throw error;
    }
  })();

  streamNookBulkInFlight = work;

  void work.then(
    () => {
      if (streamNookBulkInFlight === work) {
        streamNookBulkInFlight = null;
      }
    },
    () => {
      if (streamNookBulkInFlight === work) {
        streamNookBulkInFlight = null;
      }
    },
  );

  return work;
}
async function requestStreamNookBatch(
  entries: StreamNookQueueEntry[],
): Promise<void> {
  const ids = entries
    .map((entry) => entry.userId)
    .sort((a, b) => a.localeCompare(b));

  const params = new URLSearchParams({
    ids: ids.join(','),
    kind: 'badge',
    expand: '1',
  });

  try {
    const body = await requestJson(
      `${STREAMNOOK_USERS_URL}?${params.toString()}`,
    );

    const users = isRecord(body) && isRecord(body.users)
      ? body.users
      : {};

    const cosmetics = isRecord(body) && isRecord(body.cosmetics)
      ? body.cosmetics
      : {};

    for (const entry of entries) {
      const badges = streamNookBadgesForUser(
        entry.userId,
        users[entry.userId],
        cosmetics,
      );

      rememberStreamNook(entry.userId, badges);
      entry.resolve(badges);
    }
  } catch {
    for (const entry of entries) {
      /*
       * Keep the last known result briefly during a StreamNook outage. This
       * prevents a busy chat from retrying the same failed batch per message
       * while also preserving a previously known badge until the API recovers.
       */
      const stale = streamNookUserCache.get(entry.userId)?.badges ?? [];

      rememberStreamNook(
        entry.userId,
        stale,
        STREAMNOOK_CLIENT_FAILURE_TTL_MS,
      );

      entry.resolve(stale);
    }
  }
}

function scheduleStreamNookFlush(): void {
  if (
    streamNookFlushTimer !== null ||
    streamNookBatchActive ||
    streamNookQueue.length === 0
  ) {
    return;
  }

  const elapsedSinceLastBatch = streamNookLastBatchStartedAt
    ? Date.now() - streamNookLastBatchStartedAt
    : Number.POSITIVE_INFINITY;

  const waitMs = Math.max(
    STREAMNOOK_BATCH_WINDOW_MS,
    STREAMNOOK_BATCH_MIN_INTERVAL_MS - elapsedSinceLastBatch,
  );

  streamNookFlushTimer = setTimeout(() => {
    streamNookFlushTimer = null;

    if (streamNookBatchActive) return;

    const entries = streamNookQueue.splice(
      0,
      STREAMNOOK_BATCH_MAX_IDS,
    );

    if (!entries.length) return;

    streamNookBatchActive = true;
    streamNookLastBatchStartedAt = Date.now();

    void requestStreamNookBatch(entries).finally(() => {
      streamNookBatchActive = false;
      scheduleStreamNookFlush();
    });
  }, waitMs);
}

async function loadStreamNook(userId: string): Promise<Assignment[]> {
  /*
   * StreamNook accepts Twitch numeric ids from 1 to 15 digits. It deliberately
   * has no login-name lookup, so malformed/provider-less identities are skipped.
   */
  if (!/^\d{1,15}$/.test(userId)) return [];

  const cached = cachedStreamNook(userId);
  if (cached) return cached;

  const existing = streamNookUserInFlight.get(userId);
  if (existing) return existing;

  const work = (async (): Promise<Assignment[]> => {
    try {
      /*
       * One five-minute bulk file covers the whole chat. Every concurrent
       * caller shares this promise, so a preview roster or busy channel does not
       * create one StreamNook request per chatter.
       */
      const badgesByUserId =
        await streamNookBulkRegistry();

      const badges =
        badgesByUserId.get(userId) ?? [];

      rememberStreamNook(userId, badges);
      return badges;
    } catch {
      /*
       * Bulk is an optimization, not a dependency. If it is unavailable or
       * malformed, retain the already-tested 200-id /users?ids= queue.
       */
      return new Promise<Assignment[]>((resolve) => {
        streamNookQueue.push({ userId, resolve });
        scheduleStreamNookFlush();
      });
    }
  })();

  streamNookUserInFlight.set(userId, work);

  void work.then(
    () => streamNookUserInFlight.delete(userId),
    () => streamNookUserInFlight.delete(userId),
  );

  return work;
}
const PROVIDERS: ReadonlyArray<() => Promise<Assignment[]>> = [
  loadChatterino,
  loadLegacyHomies,
  loadCustomHomies,
  loadMoltorino,
  loadBluzyrino,
  loadFFZ,
  loadBTTV,
  loadTurteg,
  loadPolandBot,
  loadBChat,
  loadBadgeHq,
  loadFolhinha,
  loadDankChat,
  loadChatty,
  loadChatsen,
  loadFfzAp,
  loadEnhancer,
];

function addToIndex(map: Map<string, Assignment[]>, key: string, badge: Assignment): void {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(badge);
  map.set(key, list);
}

async function loadProviderCached(
  index: number,
  provider: () => Promise<Assignment[]>,
): Promise<ProviderCacheEntry> {
  const now = Date.now();
  const cached = providerCache.get(index);
  if (cached && now < cached.expiresAt) return cached;

  const existing = providerInFlight.get(index);
  if (existing) return existing;

  const work = (async (): Promise<ProviderCacheEntry> => {
    try {
      const badges = await provider();
      const result: ProviderCacheEntry = {
        badges,
        failed: false,
        expiresAt: Date.now() + SUCCESS_TTL_MS,
      };
      providerCache.set(index, result);
      return result;
    } catch {
      const result: ProviderCacheEntry = {
        badges: [],
        failed: true,
        expiresAt: Date.now() + PARTIAL_TTL_MS,
      };
      providerCache.set(index, result);
      return result;
    }
  })();

  providerInFlight.set(index, work);
  void work.then(() => {
    if (providerInFlight.get(index) === work) {
      providerInFlight.delete(index);
    }
  });

  return work;
}

async function buildRegistry(): Promise<Registry> {
  const results = await Promise.all(
    PROVIDERS.map((provider, index) =>
      loadProviderCached(index, provider),
    ),
  );

  const byUserId = new Map<string, Assignment[]>();
  const byUsername = new Map<string, Assignment[]>();
  let partial = false;

  for (const result of results) {
    if (result.failed) {
      partial = true;
      continue;
    }

    for (const badge of result.badges) {
      for (const userId of badge.userIds) {
        addToIndex(byUserId, userId, badge);
      }
      for (const username of badge.usernames) {
        addToIndex(byUsername, username.toLowerCase(), badge);
      }
    }
  }

  return { byUserId, byUsername, partial };
}

async function registry(): Promise<Registry> {
  const now = Date.now();
  const ttl = cachedRegistry?.partial ? PARTIAL_TTL_MS : SUCCESS_TTL_MS;
  if (cachedRegistry && now - cachedAt < ttl) return cachedRegistry;
  if (inFlight) return inFlight;

  inFlight = buildRegistry().then((value) => {
    cachedRegistry = value;
    cachedAt = Date.now();
    inFlight = null;
    return value;
  }, (error) => {
    inFlight = null;
    throw error;
  });
  return inFlight;
}

function dedupe(assignments: Assignment[]): Assignment[] {
  const seen = new Set<string>();
  const out: Assignment[] = [];
  for (const badge of assignments) {
    const key = `${badge.provider}:${badge.id}:${badge.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(badge);
  }
  return out;
}

function normalizedTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeClientMirrors(assignments: Assignment[]): Assignment[] {
  const seenTitles = new Set<string>();
  const out: Assignment[] = [];

  for (const badge of assignments) {
    if (!MIRRORED_CHAT_CLIENT_PROVIDERS.has(badge.provider)) {
      out.push(badge);
      continue;
    }

    const title = normalizedTitle(badge.title);
    if (title && seenTitles.has(title)) continue;
    if (title) seenTitles.add(title);
    out.push(badge);
  }

  return out;
}

const MULTI_DISPLAY_BADGE_PROVIDERS = new Set<ProviderName>([
  /*
   * Homies and Enhancer can intentionally display multiple active badges on one
   * chatter. Other community providers keep one displayed slot unless their
   * provider-specific parser has already reduced ownership to equipped state.
   */
  'homies',
  'custom-homies',
  'enhancer',
  'badgehq',
]);

function selectDisplayedProviderBadges(
  assignments: Assignment[],
): Assignment[] {
  /*
   * Resolve the FFZ family before generic mirrored-client title dedupe.
   *
   * Otherwise an earlier client mirror such as Chatterino/Chatty can survive
   * while the official FFZ assignment is later reduced independently, leaving
   * two visible FFZ-family badges on the same chatter.
   */
  const isFfzFamilyAssignment = (
    badge: Assignment,
  ): boolean => {
    if (
      badge.provider === 'ffz'
      || badge.provider === 'turteg'
    ) {
      return true;
    }

    if (
      !MIRRORED_CHAT_CLIENT_PROVIDERS.has(
        badge.provider,
      )
    ) {
      return false;
    }

    const fingerprint = [
      normalizedTitle(
        badge.title,
      ),
      badge.id
        .trim()
        .toLowerCase(),
      badge.url
        .trim()
        .toLowerCase(),
    ].join(' ');

    return (
      /(^|[^a-z0-9])ffz([^a-z0-9]|$)/u.test(
        fingerprint,
      )
      || fingerprint.includes(
        'frankerfacez',
      )
    );
  };

  const ffzRank = (
    badge: Assignment,
  ): number => {
    const fingerprint = [
      normalizedTitle(
        badge.title,
      ),
      badge.id
        .trim()
        .toLowerCase(),
      badge.url
        .trim()
        .toLowerCase(),
    ].join(' ');

    /*
     * Active Subwoofer wins over the older/permanent Supporter assignment.
     */
    const tierRank =
      fingerprint.includes(
        'subwoofer',
      )
        ? 300
        : fingerprint.includes(
            'supporter',
          )
          ? 200
          : 100;

    /*
     * Within the same tier, prefer the canonical provider.
     */
    const providerRank =
      badge.provider === 'ffz'
        ? 30
        : badge.provider === 'turteg'
          ? 20
          : 10;

    return (
      tierRank
      + providerRank
    );
  };

  let out =
    assignments;

  const ffzFamily =
    out.filter(
      isFfzFamilyAssignment,
    );

  if (
    ffzFamily.length > 0
  ) {
    let keep =
      ffzFamily[0]!;

    let keepRank =
      ffzRank(
        keep,
      );

    for (
      const badge
      of ffzFamily.slice(1)
    ) {
      const rank =
        ffzRank(
          badge,
        );

      /*
       * >= preserves the previous later-assignment preference on equal rank.
       */
      if (
        rank >= keepRank
      ) {
        keep =
          badge;

        keepRank =
          rank;
      }
    }

    out =
      out.filter(
        (badge) =>
          !isFfzFamilyAssignment(
            badge,
          )
          || badge === keep,
      );
  }

  /*
   * Keep the existing duplicate-client cleanup for every other provider.
   */
  out =
    dedupeClientMirrors(
      out,
    );

  /*
   * Preserve existing Bluzyrino newest-assignment behavior.
   */
  const blue =
    out.filter(
      (badge) =>
        badge.provider ===
          'bluzyrino',
    );

  if (
    blue.length > 1
  ) {
    const keep =
      blue[
        blue.length - 1
      ];

    out =
      out.filter(
        (badge) =>
          badge.provider !==
            'bluzyrino'
          || badge === keep,
      );
  }

  /*
   * Preserve the existing one-visible-slot rule for ordinary providers.
   * Homies/custom-Homies/Enhancer retain their explicit multi-display contract.
   */
  const displayed =
    new Map<
      ProviderName,
      Assignment
    >();

  for (
    const badge
    of out
  ) {
    if (
      MULTI_DISPLAY_BADGE_PROVIDERS.has(
        badge.provider,
      )
    ) {
      continue;
    }

    if (
      !displayed.has(
        badge.provider,
      )
    ) {
      displayed.set(
        badge.provider,
        badge,
      );
    }
  }

  return out.filter(
    (badge) =>
      MULTI_DISPLAY_BADGE_PROVIDERS.has(
        badge.provider,
      )
      || displayed.get(
        badge.provider,
      ) === badge,
  );
}

export type TwitchCommunityBadgeIdentity = {
  userId: string;
  login?: string;
  displayName?: string;
};

async function resolveTwitchCommunityBadgesInternal(
  identity: TwitchCommunityBadgeIdentity,
  limerinoOptions: Partial<LimerinoBadgeRenderOptions> | undefined,
  includeJilChat: boolean,
): Promise<UnifiedBadge[]> {
  const userId = identity.userId.trim();
  const aliases = [...new Set([
    identity.login?.trim().toLowerCase(),
    identity.displayName?.trim().toLowerCase(),
  ].filter((value): value is string => Boolean(value)))];
  if (!userId && !aliases.length) return [];
  const [
    limerinoResult,
    registryResult,
    jilChatResult,
    streamNookResult,
    previewsResult,
    gxufyResult,
  ] = await Promise.allSettled([
    userId ? limerinoRegistry() : Promise.resolve([]),
    registry(),
    includeJilChat && userId ? loadJilChat(userId) : Promise.resolve([]),
    userId ? loadStreamNook(userId) : Promise.resolve([]),
    identity.login
      ? loadPreviews(identity.login)
      : Promise.resolve([]),
    userId
      ? loadGxufy(userId)
      : Promise.resolve([]),
  ]);

  const matches = [
    ...(limerinoResult.status === 'fulfilled' && userId
      ? limerinoResult.value.filter((badge) => badge.userIds.includes(userId))
      : []),
    ...(registryResult.status === 'fulfilled' && userId
      ? registryResult.value.byUserId.get(userId) ?? []
      : []),
    ...(registryResult.status === 'fulfilled'
      ? aliases.flatMap((alias) => registryResult.value.byUsername.get(alias) ?? [])
      : []),
    ...(jilChatResult.status === 'fulfilled' ? jilChatResult.value : []),
    ...(streamNookResult.status === 'fulfilled' ? streamNookResult.value : []),
    ...(previewsResult.status === 'fulfilled' ? previewsResult.value : []),
    ...(gxufyResult.status === 'fulfilled' ? gxufyResult.value : []),
  ];

  const renderOptions: LimerinoBadgeRenderOptions = {
    slotSizePx: limerinoOptions?.slotSizePx ?? 18,
    displayScale: limerinoOptions?.displayScale
      ?? (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
    reducedMotion: limerinoOptions?.reducedMotion
      ?? (typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true),
  };

  return selectDisplayedProviderBadges(dedupe(matches)).flatMap((badge) => {
    const image = badge.limerinoBadge
      ? selectLimerinoBadgeImage(badge.limerinoBadge, renderOptions)
      : null;
    if (badge.limerinoBadge && !image) return [];
    return [{
      type: `community:${badge.provider}:${slug(badge.id)}`,
      ...((badge.provider === 'custom-homies'
        || badge.provider === 'enhancer'
        || badge.provider === 'previews'
        || badge.provider === 'gxufy'
        || badge.provider === 'chatsen'
        || badge.provider === 'ffzap'
        || badge.provider === 'jilchat'
        || badge.provider === 'badgehq'
        || badge.provider === 'streamnook'
        || badge.provider === 'limerino')
        ? { title: badge.title }
        : {}),
      url: image?.url ?? badge.url,
      ...((image?.fallbackUrl ?? badge.fallbackUrl)
        ? { fallbackUrl: image?.fallbackUrl ?? badge.fallbackUrl }
        : {}),
      ...(badge.backgroundColor ? { backgroundColor: badge.backgroundColor } : {}),
    }];
  });
}

export function resolveTwitchCommunityBadges(
  identity: TwitchCommunityBadgeIdentity,
  limerinoOptions?: Partial<LimerinoBadgeRenderOptions>,
): Promise<UnifiedBadge[]> {
  return resolveTwitchCommunityBadgesInternal(
    identity,
    limerinoOptions,
    true,
  );
}

/**
 * Preview fast path.
 *
 * All normal production community providers are resolved exactly as they are
 * for live chat, but JilChat is deliberately omitted from the critical path.
 * Preview hydrates authoritative JilChat ownership afterward.
 */
export function resolveTwitchCommunityBadgesWithoutJilChat(
  identity: TwitchCommunityBadgeIdentity,
  limerinoOptions?: Partial<LimerinoBadgeRenderOptions>,
): Promise<UnifiedBadge[]> {
  return resolveTwitchCommunityBadgesInternal(
    identity,
    limerinoOptions,
    false,
  );
}

/**
 * Authoritative deferred JilChat lookup used by Preview.
 *
 * JilChat resolves to one displayed provider slot. When there is no explicit
 * shown flag, the first owned badge is selected. The JilChat API consumed here
 * does not provide a shown flag, so Preview intentionally displays only the
 * first owned JilChat badge.
 */
export async function resolveTwitchJilChatBadges(
  rawUserId: string,
): Promise<UnifiedBadge[]> {
  const userId = rawUserId.trim();

  if (!/^\d{1,25}$/.test(userId)) return [];

  const badges = dedupe(await loadJilChat(userId));
  const badge = badges.find(
    (candidate) => candidate.provider === 'jilchat',
  );

  if (!badge) return [];

  return [{
    type: `community:jilchat:${slug(badge.id)}`,
    title: badge.title,
    url: badge.url,
    ...(badge.fallbackUrl
      ? { fallbackUrl: badge.fallbackUrl }
      : {}),
    ...(badge.backgroundColor
      ? { backgroundColor: badge.backgroundColor }
      : {}),
  }];
}

export function __resetCommunityBadgeCache(): void {
  cachedRegistry = null;
  cachedAt = 0;
  inFlight = null;
  providerCache.clear();
  providerInFlight.clear();
  cachedLimerino = null;
  cachedLimerinoAt = 0;
  limerinoInFlight = null;
  jilChatUserCache.clear();
  jilChatUserInFlight.clear();
  jilChatQueue.splice(0);
  jilChatActiveRequests = 0;

  streamNookUserCache.clear();
  streamNookUserInFlight.clear();
  streamNookBulkCache = null;
  streamNookBulkInFlight = null;
  streamNookQueue.splice(0);

  if (streamNookFlushTimer !== null) {
    clearTimeout(streamNookFlushTimer);
    streamNookFlushTimer = null;
  }

  streamNookBatchActive = false;
  streamNookLastBatchStartedAt = 0;

  cachedPreviewsDataset = null;
  cachedPreviewsAt = 0;
  previewsInFlight = null;

  cachedGxufyBadges = null;
  cachedGxufyAt = 0;
  gxufyInFlight = null;
}
