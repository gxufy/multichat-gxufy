import type { NextApiHandler } from 'next';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';

const ERROR = 'Unable to load Twitch profile.';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 500;
export const TWITCH_PROFILE_MAX_BYTES = 64 * 1024;
const cache = new Map<string, { at: number; value: Profile }>();
const inFlight = new Map<string, Promise<Profile>>();
interface Profile { roomId: string; displayName: string; profileImageUrl?: string }

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { return new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; }
}

async function lookup(roomId: string): Promise<Profile> {
  return withFixedProviderTimeout(4_000, async (signal) => {
    const response = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query($id: ID!) { user(id: $id) { id displayName profileImageURL(width: 70) } }',
        variables: { id: roomId },
      }),
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await discardFixedProviderBody(response);
      throw new Error(ERROR);
    }
    const body = await readBoundedFixedProviderJson(response, TWITCH_PROFILE_MAX_BYTES);
    const user = (body as any)?.data?.user;
    if (user?.id !== roomId || typeof user.displayName !== 'string' || !user.displayName.trim()) throw new Error(ERROR);
    const image = user.profileImageURL == null ? undefined : httpsUrl(user.profileImageURL);
    if (user.profileImageURL != null && !image) throw new Error(ERROR);
    return { roomId, displayName: user.displayName, ...(image ? { profileImageUrl: image } : {}) };
  });
}

async function cached(roomId: string, clientKey: string): Promise<Profile> {
  const hit = cache.get(roomId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const existing = inFlight.get(roomId);
  if (existing) return existing;
  const promise = runFixedProviderWork({
    key: `twitch-profile:${roomId}`,
    clientKey,
    run: () => lookup(roomId),
  });
  inFlight.set(roomId, promise);
  try {
    const value = await promise;
    cache.delete(roomId); cache.set(roomId, { at: Date.now(), value });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return value;
  } finally { if (inFlight.get(roomId) === promise) inFlight.delete(roomId); }
}

const handler: NextApiHandler = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: ERROR });
  const roomId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!/^\d{1,20}$/.test(roomId)) return res.status(400).json({ error: ERROR });
  try { return res.status(200).json(await cached(roomId, fixedProviderClientKey(req))); }
  catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({ error: ERROR });
    }
    return res.status(502).json({ error: ERROR });
  }
};

export function __resetTwitchProfileResourcesForTests(): void {
  cache.clear();
  inFlight.clear();
}

export default handler;
