/*
 * JilTV cosmetics (jiltv.app — not JilChat, not 7TV): shared parsing, the
 * browser lookup and paint styling. The server proxy is
 * pages/api/jiltv/cosmetics.ts; see lib/server/jiltvCosmetics.ts for the
 * upstream contract.
 *
 * Release gate: the overlay only asks for JilTV cosmetics when the build has
 * NEXT_PUBLIC_GXUFY_JILTV_COSMETICS=1, and the server only answers when
 * GXUFY_JILTV_COSMETICS_ENABLED=1. Both are off by default.
 * JilTV emotes are not part of this and stay out of the codebase.
 */
import {
  JILCHAT_CLIENT_BURST,
  JILCHAT_CLIENT_FAILURE_TTL_MS,
  JILCHAT_CLIENT_MAX_CONCURRENT,
  JILCHAT_CLIENT_MAX_QUEUE,
  JILCHAT_CLIENT_REFILL_MS,
} from './communityBadges';
import { createPerUserLookupGuard } from './perUserLookupGuard';
import {
  type JilTVUserCosmetics,
  parseJilTVUserCosmetics,
} from './jiltvCosmeticsContract';

export * from './jiltvCosmeticsContract';

export const JILTV_COSMETICS_ENABLED = process.env.NEXT_PUBLIC_GXUFY_JILTV_COSMETICS === '1';

const JILTV_CLIENT_CACHE_TTL_MS = 5 * 60_000;
/* Same live-path wait and throttle lifetime as the JilChat guard. */
const JILTV_CLIENT_LIVE_WAIT_MS = 250;
const JILTV_CLIENT_THROTTLED_TTL_MS = 10_000;
const JILTV_CLIENT_REQUEST_TIMEOUT_MS = 6_000;

async function requestJilTVUser(
  userId: string,
  onRateLimit: (retryAfter: string | null) => void,
): Promise<JilTVUserCosmetics> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JILTV_CLIENT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/jiltv/cosmetics?userId=${encodeURIComponent(userId)}`, {
      signal: controller.signal,
    });
    if (response.status === 429) onRateLimit(response.headers.get('Retry-After'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = parseJilTVUserCosmetics(await response.json());
    if (!parsed) throw new Error('malformed JilTV cosmetics');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/* Separate budget from JilChat and Enhancer, same shape (burst 16, 6 at once,
   queue 12, 1 per second, cooldown on 429). */
const jiltvUserGuard = createPerUserLookupGuard<JilTVUserCosmetics>({
  burst: JILCHAT_CLIENT_BURST,
  maxConcurrent: JILCHAT_CLIENT_MAX_CONCURRENT,
  maxQueue: JILCHAT_CLIENT_MAX_QUEUE,
  refillMs: JILCHAT_CLIENT_REFILL_MS,
  liveWaitMs: JILTV_CLIENT_LIVE_WAIT_MS,
  cacheTtlMs: JILTV_CLIENT_CACHE_TTL_MS,
  failureTtlMs: JILCHAT_CLIENT_FAILURE_TTL_MS,
  throttledTtlMs: JILTV_CLIENT_THROTTLED_TTL_MS,
  maxKeys: 500,
  request: requestJilTVUser,
});

/**
 * What a Twitch chatter wears on JilTV, or `null` when the gate is off, we're
 * not in a browser, or the lookup was skipped/throttled/failed. Waits for the
 * answer (the caller updates the already-shown message when it arrives).
 */
export async function lookupJilTVCosmetics(
  twitchUserId: string,
  enabled: boolean = JILTV_COSMETICS_ENABLED,
): Promise<JilTVUserCosmetics | null> {
  if (!enabled || typeof window === 'undefined' || !/^\d{1,25}$/.test(twitchUserId)) return null;
  const result = await jiltvUserGuard.lookup(twitchUserId, true);
  return result?.value ?? null;
}

export function __resetJilTVCosmeticsClientForTests(): void {
  jiltvUserGuard.reset();
}
