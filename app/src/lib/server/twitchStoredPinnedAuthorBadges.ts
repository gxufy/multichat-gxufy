/**
 * Resolve native Twitch role badges for the author of a pinned message.
 *
 * Broadcaster status is inferred locally. Moderator / VIP / subscriber
 * membership is queried only when the stored OAuth connection has the
 * corresponding read scope.
 *
 * Badge decoration is best-effort: this module never throws to callers.
 * Temporary failures are cached briefly so the 5-second pin poll cannot
 * hammer Twitch.
 */

import type { UnifiedBadge } from '../types';
import { getTwitchConnection } from './twitchConnectionReader';
import { refreshStoredTwitchConnection } from './twitchConnectionRefresher';

export type TwitchPinnedAuthorBadge = {
  type: 'broadcaster' | 'moderator' | 'vip' | 'subscriber';
  version: string;
};

type RoleType = 'moderator' | 'vip' | 'subscriber';

type RoleSpec = {
  type: RoleType;
  scope: string;
  endpoint: string;
  version: string;
};

type RoleOutcome = 'present' | 'absent' | 'unauthorized' | 'error';

type RoleConnection = {
  twitchUserId: string;
  accessToken: string;
  scopes: string[];
};

type CacheEntry = {
  badges: TwitchPinnedAuthorBadge[];
  expiresAt: number;
};

const ROLE_SPECS: readonly RoleSpec[] = [
  {
    type: 'moderator',
    scope: 'moderation:read',
    endpoint: 'https://api.twitch.tv/helix/moderation/moderators',
    version: '1',
  },
  {
    type: 'vip',
    scope: 'channel:read:vips',
    endpoint: 'https://api.twitch.tv/helix/channels/vips',
    version: '1',
  },
  {
    type: 'subscriber',
    scope: 'channel:read:subscriptions',
    endpoint: 'https://api.twitch.tv/helix/subscriptions',
    // The subscription lookup confirms membership, not badge tenure.
    // Twitch's channel badge table uses subscriber/0 as the base badge.
    version: '0',
  },
] as const;

const REQUEST_TIMEOUT_MS = 2_000;
const SUCCESS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TwitchPinnedAuthorBadge[]>>();

function isDigits(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && /^\d+$/.test(value);
}

function cloneBadges(
  badges: TwitchPinnedAuthorBadge[],
): TwitchPinnedAuthorBadge[] {
  return badges.map((badge) => ({ ...badge }));
}

function cacheKey(
  broadcasterId: string,
  senderUserId: string,
  scopes: string[],
): string {
  const relevantScopes = ROLE_SPECS
    .filter((role) => scopes.includes(role.scope))
    .map((role) => role.scope)
    .sort()
    .join(',');

  return `${broadcasterId}:${senderUserId}:${relevantScopes}`;
}

function readCache(key: string): TwitchPinnedAuthorBadge[] | null {
  const entry = cache.get(key);

  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cloneBadges(entry.badges);
}

function writeCache(
  key: string,
  badges: TwitchPinnedAuthorBadge[],
  ttlMs: number,
): void {
  cache.delete(key);
  cache.set(key, {
    badges: cloneBadges(badges),
    expiresAt: Date.now() + ttlMs,
  });

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function fetchRole(
  role: RoleSpec,
  accessToken: string,
  broadcasterId: string,
  senderUserId: string,
): Promise<RoleOutcome> {
  const clientId = process.env.TWITCH_CLIENT_ID;

  if (
    typeof clientId !== 'string' ||
    clientId.trim().length === 0 ||
    typeof accessToken !== 'string' ||
    accessToken.length === 0
  ) {
    return 'error';
  }

  const url = new URL(role.endpoint);
  url.searchParams.set('broadcaster_id', broadcasterId);
  url.searchParams.set('user_id', senderUserId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId,
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      return 'unauthorized';
    }

    if (!response.ok) {
      return 'error';
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      return 'error';
    }

    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body)
    ) {
      return 'error';
    }

    const data = (body as Record<string, unknown>).data;

    if (!Array.isArray(data) || data.length > 1) {
      return 'error';
    }

    for (const item of data) {
      if (
        typeof item !== 'object' ||
        item === null ||
        Array.isArray(item)
      ) {
        return 'error';
      }

      const userId = (item as Record<string, unknown>).user_id;

      if (!isDigits(userId)) {
        return 'error';
      }
    }

    return data.some(
      (item) =>
        (item as Record<string, unknown>).user_id === senderUserId,
    )
      ? 'present'
      : 'absent';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWithConnection(
  connectionId: string,
  initial: RoleConnection,
  broadcasterId: string,
  senderUserId: string,
): Promise<{ badges: TwitchPinnedAuthorBadge[]; hadFailure: boolean }> {
  if (initial.twitchUserId !== broadcasterId) {
    return { badges: [], hadFailure: false };
  }

  const eligible = ROLE_SPECS.filter((role) =>
    initial.scopes.includes(role.scope),
  );

  if (eligible.length === 0) {
    return { badges: [], hadFailure: false };
  }

  const firstResults = await Promise.all(
    eligible.map(async (role) => ({
      role,
      outcome: await fetchRole(
        role,
        initial.accessToken,
        broadcasterId,
        senderUserId,
      ),
    })),
  );

  let refreshed: RoleConnection | null = null;

  if (firstResults.some(({ outcome }) => outcome === 'unauthorized')) {
    try {
      refreshed = await refreshStoredTwitchConnection(connectionId);
      if (refreshed.twitchUserId !== broadcasterId) {
        refreshed = null;
      }
    } catch {
      refreshed = null;
    }
  }

  const badges: TwitchPinnedAuthorBadge[] = [];
  let hadFailure = false;

  for (const first of firstResults) {
    let outcome = first.outcome;

    if (outcome === 'unauthorized') {
      if (
        refreshed &&
        refreshed.scopes.includes(first.role.scope)
      ) {
        outcome = await fetchRole(
          first.role,
          refreshed.accessToken,
          broadcasterId,
          senderUserId,
        );
      } else {
        outcome = 'error';
      }
    }

    if (outcome === 'present') {
      badges.push({
        type: first.role.type,
        version: first.role.version,
      });
    } else if (outcome === 'error' || outcome === 'unauthorized') {
      hadFailure = true;
    }
  }

  return { badges, hadFailure };
}

/**
 * Return the native Twitch role badges known for a pinned-message author.
 *
 * Old connections remain supported: roles whose OAuth scopes were never
 * granted are simply omitted. A broadcaster badge requires no extra scope.
 *
 * This function never throws.
 */
export async function getStoredTwitchPinnedAuthorBadges(
  connectionId: string,
  broadcasterId: string,
  senderUserId: string,
): Promise<TwitchPinnedAuthorBadge[]> {
  if (
    typeof connectionId !== 'string' ||
    !UUID_RE.test(connectionId) ||
    !isDigits(broadcasterId) ||
    !isDigits(senderUserId)
  ) {
    return [];
  }

  if (senderUserId === broadcasterId) {
    return [{ type: 'broadcaster', version: '1' }];
  }

  let connection: RoleConnection;

  try {
    connection = await getTwitchConnection(connectionId);
  } catch {
    return [];
  }

  const key = cacheKey(
    broadcasterId,
    senderUserId,
    connection.scopes,
  );

  const cached = readCache(key);
  if (cached) return cached;

  const pending = inFlight.get(key);
  if (pending) return cloneBadges(await pending);

  const promise = (async () => {
    try {
      const result = await resolveWithConnection(
        connectionId,
        connection,
        broadcasterId,
        senderUserId,
      );

      writeCache(
        key,
        result.badges,
        result.hadFailure ? FAILURE_TTL_MS : SUCCESS_TTL_MS,
      );

      return result.badges;
    } catch {
      writeCache(key, [], FAILURE_TTL_MS);
      return [];
    }
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);

  return cloneBadges(await promise);
}