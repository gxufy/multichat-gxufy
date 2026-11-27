/* GET  /api/overlay/refresh[?c=platform:channel] -> { token, now, targets, commands }
 *        (overlays whose live connection is down ask this about once a minute;
 *         `commands` holds only the owner's commands for the channels named)
 * POST /api/overlay/refresh                                (owner only)
 *        no body                          -> { token }    refresh all overlays
 *        { platform, channel }            -> { target }   refresh one channel's overlays
 *        { platform, channel, command }   -> { command }  run a !flosschat command there
 *
 * "Refresh all" stores a new stamp; each overlay remembers the stamp it started
 * with and reloads, at a quiet moment in chat, once it sees a newer one.
 * "Refresh one channel" adds the channel to a short list (kept 10 minutes);
 * an overlay showing that channel reloads if the request came after it started
 * (`now` is the server clock, so viewers' clocks don't matter). Channel names
 * are public; nothing about any viewer is read or kept.
 */
import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';
import { createClientWindowLimit } from '@/lib/server/clientWindowLimit';
import { isOwner } from '@/lib/server/owner';
import { isSameOriginRequest, readSession } from '@/lib/server/session';
import { openSupporterStore } from '@/lib/server/supporterStore';
import {
  ownerCommandsFor,
  parseOverlayChannelParams,
  pushOverlayLiveState,
} from '@/lib/server/overlayLiveHub';
import { normalizeOwnerCommand } from '@/lib/overlayOwnerCommands';
import { normalizeChatChannel } from '@/lib/channelValidation';
import {
  OVERLAY_REFRESH_PLATFORMS,
  overlayRefreshChannelKey,
  type OverlayRefreshPlatform,
} from '@/lib/overlayRefreshWatcher';
import type { Platform } from '@/lib/types';

const sendLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 10 });
const channelLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 30 });
const commandLimit = createClientWindowLimit({ windowMs: 10 * 60_000, max: 60 });

export function __resetOverlayRefreshLimitForTests(): void {
  sendLimit.reset();
  channelLimit.reset();
  commandLimit.reset();
}

const REAL_PLATFORMS: readonly Platform[] = ['twitch', 'kick', 'youtube', 'tiktok'];

/** The owner's channel request, checked; null when it isn't a usable name. */
function readTarget(body: unknown): { platform: OverlayRefreshPlatform; channel: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { platform, channel } = body as Record<string, unknown>;
  const which = platform === undefined ? 'any' : platform;
  if (typeof which !== 'string' || !(OVERLAY_REFRESH_PLATFORMS as readonly string[]).includes(which)) return null;
  const candidates = which === 'any' ? REAL_PLATFORMS : [which as Platform];
  const valid = candidates
    .map((name) => normalizeChatChannel(name, channel))
    .find(Boolean);
  if (!valid) return null;
  return { platform: which as OverlayRefreshPlatform, channel: overlayRefreshChannelKey(valid) };
}

/** True when the owner asked for one channel rather than everything. */
function asksForChannel(body: unknown): boolean {
  return Boolean(body && typeof body === 'object' && 'channel' in (body as Record<string, unknown>));
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const store = openSupporterStore();
  if (req.method === 'GET') {
    const now = Date.now();
    const channels = parseOverlayChannelParams(req.query.c);
    let token = 0;
    let targets: unknown[] = [];
    let commands: unknown[] = [];
    try {
      token = store ? await store.overlayRefreshToken() : 0;
      targets = store ? await store.overlayRefreshTargets(now) : [];
      commands = store ? ownerCommandsFor(await store.overlayOwnerCommands(now), channels) : [];
    } catch {
      token = 0;
      targets = [];
      commands = [];
    }
    return res.status(200).json({ token, now, targets, commands });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOriginRequest(req)) return res.status(403).json({ error: 'Forbidden.' });
  const user = readSession(req);
  if (!user || !isOwner(user.id)) return res.status(403).json({ error: 'Forbidden.' });
  if (!store) return res.status(503).json({ error: 'Not available right now.' });
  if (asksForChannel(req.body) && 'command' in (req.body as Record<string, unknown>)) {
    const target = readTarget(req.body);
    if (!target) return res.status(400).json({ error: 'Enter a valid channel name.' });
    const text = normalizeOwnerCommand((req.body as Record<string, unknown>).command);
    if (!text) return res.status(400).json({ error: 'Pick a command from the list.' });
    if (!commandLimit.admit(resolveNodeClientKey(req))) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many commands. Try again in a few minutes.' });
    }
    const command = await store.addOverlayOwnerCommand({ ...target, text }, Date.now());
    void pushOverlayLiveState(true);
    return res.status(200).json({ command });
  }
  if (asksForChannel(req.body)) {
    const target = readTarget(req.body);
    if (!target) return res.status(400).json({ error: 'Enter a valid channel name.' });
    if (!channelLimit.admit(resolveNodeClientKey(req))) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many refreshes. Try again in a few minutes.' });
    }
    const at = Date.now();
    await store.addOverlayRefreshTarget(target, at);
    void pushOverlayLiveState(true);
    return res.status(200).json({ target: { ...target, at } });
  }
  if (!sendLimit.admit(resolveNodeClientKey(req))) {
    res.setHeader('Retry-After', '600');
    return res.status(429).json({ error: 'Too many refreshes. Try again in a few minutes.' });
  }
  const token = await store.setOverlayRefreshToken(Date.now());
  void pushOverlayLiveState(true);
  return res.status(200).json({ token });
}
