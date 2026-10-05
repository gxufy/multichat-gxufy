import type { TwitchSourceChannel } from './types';

const SUCCESS_TTL_MS = 60 * 60_000;
const FAILURE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: TwitchSourceChannel | null }>();
const inFlight = new Map<string, Promise<TwitchSourceChannel | null>>();

export function parseTwitchProfile(value: unknown, roomId: string): TwitchSourceChannel | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  if (profile.roomId !== roomId || typeof profile.displayName !== 'string' || !profile.displayName.trim()) return null;
  if (profile.profileImageUrl !== undefined) {
    if (typeof profile.profileImageUrl !== 'string') return null;
    try { if (new URL(profile.profileImageUrl).protocol !== 'https:') return null; } catch { return null; }
  }
  return { roomId, displayName: profile.displayName, ...(profile.profileImageUrl ? { profileImageUrl: profile.profileImageUrl as string } : {}) };
}

export function fetchTwitchProfile(roomId: string): Promise<TwitchSourceChannel | null> {
  const hit = cache.get(roomId);
  if (hit && Date.now() - hit.at < (hit.value ? SUCCESS_TTL_MS : FAILURE_TTL_MS)) return Promise.resolve(hit.value);
  const existing = inFlight.get(roomId);
  if (existing) return existing;
  const promise = fetch(`/api/twitch/profile?id=${encodeURIComponent(roomId)}`)
    .then(async response => response.ok ? parseTwitchProfile(await response.json(), roomId) : null)
    .catch(() => null)
    .then(value => { cache.set(roomId, { at: Date.now(), value }); return value; })
    .finally(() => { if (inFlight.get(roomId) === promise) inFlight.delete(roomId); });
  inFlight.set(roomId, promise);
  return promise;
}
