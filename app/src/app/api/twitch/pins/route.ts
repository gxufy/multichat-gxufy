/** Server-only API route: look up a Twitch channel's current pin.
 *
 * Accepts an opaque connection ID and channel login, calls the stored-channel
 * pin helper, and returns only display-safe public broadcaster / pin data.
 */

import { getStoredTwitchChannelPin } from '@/lib/server/twitchStoredChannelPin';
import { getStoredTwitchUserChatColor } from '@/lib/server/twitchStoredUserChatColor';
import { getStoredTwitchPinnedAuthorBadges } from '@/lib/server/twitchStoredPinnedAuthorBadges';
import { isTwitchConnectionActive } from '@/lib/server/twitchConnectionReader';
import {
  TwitchPinsAdmissionError,
  TwitchPinsBodyError,
  acquireTwitchPinsAdmission,
  readBoundedTwitchPinsBody,
  twitchPinsClientKey,
} from '@/lib/server/twitchPinsSecurity';

/* ------------------------------------------------------------------ */
/* Next.js exports                                                     */
/* ------------------------------------------------------------------ */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/* Cache-control helper                                                */
/* ------------------------------------------------------------------ */

/** Standard cache-control headers returned on every response. */
function cacheHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
  };
}

/* ------------------------------------------------------------------ */
/* Request handler                                                     */
/* ------------------------------------------------------------------ */

/**
 * POST /api/twitch/pins
 *
 * Accepts a JSON body with `connectionId` and `login`, resolves the
 * channel pin through the stored helper, and returns a display-safe
 * public representation.
 */
export async function POST(request: Request): Promise<Response> {
  let parsingRequestJson = false;
  let releaseAdmission: (() => void) | undefined;

  try {
    const contentType = request.headers.get('content-type') ?? '';

    if (!contentType.startsWith('application/json')) {
      return Response.json(
        { error: 'Unsupported content type.' },
        { status: 415, headers: cacheHeaders() },
      );
    }

    // --- Read and parse body, validate inputs, resolve helper, return ---

    let raw: string;
    raw = await readBoundedTwitchPinsBody(request);

    if (raw.trim().length === 0) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    let parsed: unknown;
    parsingRequestJson = true;
    parsed = JSON.parse(raw);
    parsingRequestJson = false;

    // Reject null, non-objects, and arrays.

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    const body = parsed as Record<string, unknown>;

    // Reject missing or additional properties.

    const expectedKeys = new Set(['connectionId', 'login']);
    const bodyKeys = Object.keys(body);
    if (
      bodyKeys.length !== 2 ||
      !expectedKeys.has(bodyKeys[0]) ||
      !expectedKeys.has(bodyKeys[1])
    ) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    // --- Validate connectionId ---

    const rawConnectionId = body.connectionId;
    if (typeof rawConnectionId !== 'string' || rawConnectionId.trim().length === 0) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        rawConnectionId,
      )
    ) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    // --- Validate login ---

    const rawLogin = body.login;
    if (typeof rawLogin !== 'string' || rawLogin.trim().length === 0) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    const normalizedLogin = rawLogin.trim().toLowerCase();

    if (normalizedLogin.length > 100 || !/^[a-z0-9_]+$/.test(normalizedLogin)) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }

    // Admission occurs only after the cheap bounded body/schema validation and
    // before any stored-connection, database, token, or Twitch helper work.
    releaseAdmission = acquireTwitchPinsAdmission(twitchPinsClientKey(request));

    // --- Resolve stored channel pin ---

    let result: Awaited<ReturnType<typeof getStoredTwitchChannelPin>>;

    try {
      result = await getStoredTwitchChannelPin(
        rawConnectionId,
        normalizedLogin,
      );
    } catch {
      /* The stored-pin chain collapses every failure into one opaque error,
         so a disconnected connection is indistinguishable from a transient
         Twitch or network fault. Probe liveness once, only on this failure
         path, to tell the two apart:

           inactive → 400 'Invalid Twitch pin request.' → the client maps
             this to `invalid-request`, which the poller already treats as
             fatal, so an overlay left open on a disconnected connection
             stops instead of retrying forever.
           active   → 500 'Twitch pin lookup failed.' → unchanged transient
             behaviour, so the poller keeps retrying with backoff.

         Revoked and never-existed both answer "inactive" with the same
         response the route already returns for a malformed id, so nothing
         reveals whether the id ever existed. */
      const active = await isTwitchConnectionActive(rawConnectionId);

      if (!active) {
        return Response.json(
          { error: 'Invalid Twitch pin request.' },
          { status: 400, headers: cacheHeaders() },
        );
      }

      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    // --- Validate helper result ---

    if (result === null) {
      return Response.json(
        { error: 'Twitch channel not found.' },
        { status: 404, headers: cacheHeaders() },
      );
    }

    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result)
    ) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    const data = result as Record<string, unknown>;

    // Validate broadcaster.

    const broadcaster = data.broadcaster;
    if (
      typeof broadcaster !== 'object' ||
      broadcaster === null ||
      Array.isArray(broadcaster)
    ) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    const bObj = broadcaster as Record<string, unknown>;
    const bLogin = bObj.login;
    if (typeof bLogin !== 'string' || bLogin.trim().length === 0) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    const bUserId = bObj.userId;
    if (typeof bUserId !== 'string' || !/^\d+$/.test(bUserId)) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    const bDisplayName = bObj.displayName;
    if (typeof bDisplayName !== 'string' || bDisplayName.trim().length === 0) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    // Require broadcaster.login to match the requested login.

    if (bLogin.toLowerCase() !== normalizedLogin) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    // Build the broadcaster slice (no userId).

    const responseBroadcaster = {
      login: bLogin,
      displayName: bDisplayName,
    };

    // --- Build pin slice ---

    const pin = data.pin;

    if (pin === null) {
      return Response.json(
        { broadcaster: responseBroadcaster, pin: null },
        { status: 200, headers: cacheHeaders() },
      );
    }

    if (
      typeof pin !== 'object' ||
      Array.isArray(pin)
    ) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    const pObj = pin as Record<string, unknown>;

    function nonEmpty(value: unknown): string | null {
      if (typeof value !== 'string') return null;
      return value.trim().length > 0 ? value : null;
    }

    function validTimestamp(value: unknown): string | null {
      if (typeof value !== 'string') return null;
      if (value.trim().length === 0) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : value;
    }

    const messageId = nonEmpty(pObj.messageId);
    const senderUserId = nonEmpty(pObj.senderUserId);
    const senderUserLogin = nonEmpty(pObj.senderUserLogin);
    const senderUserName = nonEmpty(pObj.senderUserName);
    const pinnedByUserLogin = nonEmpty(pObj.pinnedByUserLogin);
    const pinnedByUserName = nonEmpty(pObj.pinnedByUserName);
    const text = nonEmpty(pObj.text);
    const startsAt = validTimestamp(pObj.startsAt);
    const updatedAt = validTimestamp(pObj.updatedAt);
    const rawEndsAt = pObj.endsAt;

    let endsAt: string | null;

    if (rawEndsAt === null) {
      endsAt = null;
    } else {
      const validatedEndsAt = validTimestamp(rawEndsAt);

      if (validatedEndsAt === null) {
        return Response.json(
          { error: 'Twitch pin lookup failed.' },
          { status: 500, headers: cacheHeaders() },
        );
      }

      endsAt = validatedEndsAt;
    }

    if (
      messageId === null ||
      senderUserId === null ||
      senderUserLogin === null ||
      senderUserName === null ||
      pinnedByUserLogin === null ||
      pinnedByUserName === null ||
      text === null ||
      startsAt === null ||
      updatedAt === null
    ) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    // Twitch user ids are numeric — reject anything else at the boundary.

    if (!/^\d+$/.test(senderUserId)) {
      return Response.json(
        { error: 'Twitch pin lookup failed.' },
        { status: 500, headers: cacheHeaders() },
      );
    }

    // Native Twitch emotes parsed from the pin message fragments.
    // Older/internal fixtures without the field degrade safely to [].
    const rawEmotes = pObj.emotes;
    const emotes: Array<{ begin: number; end: number; text: string; url: string }> = [];

    if (rawEmotes !== undefined) {
      if (!Array.isArray(rawEmotes) || rawEmotes.length > 100) {
        return Response.json(
          { error: 'Twitch pin lookup failed.' },
          { status: 500, headers: cacheHeaders() },
        );
      }

      const chars = Array.from(text);
      let previousEnd = 0;

      for (const rawEmote of rawEmotes) {
        if (
          typeof rawEmote !== 'object' ||
          rawEmote === null ||
          Array.isArray(rawEmote)
        ) {
          return Response.json(
            { error: 'Twitch pin lookup failed.' },
            { status: 500, headers: cacheHeaders() },
          );
        }

        const emote = rawEmote as Record<string, unknown>;
        const begin = emote.begin;
        const end = emote.end;
        const emoteText = emote.text;
        const url = emote.url;

        if (
          typeof begin !== 'number' ||
          !Number.isInteger(begin) ||
          begin < 0 ||
          begin < previousEnd ||
          typeof end !== 'number' ||
          !Number.isInteger(end) ||
          end <= begin ||
          end > chars.length ||
          typeof emoteText !== 'string' ||
          emoteText.length === 0 ||
          chars.slice(begin, end).join('') !== emoteText ||
          typeof url !== 'string' ||
          url.length > 500 ||
          !url.startsWith('https://static-cdn.jtvnw.net/emoticons/v2/') ||
          !url.endsWith('/default/dark/3.0') ||
          Object.keys(emote).some(
            (key) => key !== 'begin' && key !== 'end' && key !== 'text' && key !== 'url',
          )
        ) {
          return Response.json(
            { error: 'Twitch pin lookup failed.' },
            { status: 500, headers: cacheHeaders() },
          );
        }

        emotes.push({ begin, end, text: emoteText, url });
        previousEnd = end;
      }
    }

    // --- Resolve the author's chat color (never fatal) ---
    //
    // Only reached when a pin exists, so an empty channel costs no request.
    // The helper already swallows its own failures; the extra guard and shape
    // re-test keep `color` provably '' or #RRGGBB whatever happens upstream.

    let color = '';

    try {
      color = await getStoredTwitchUserChatColor(rawConnectionId, senderUserId);
    } catch {
      color = '';
    }

    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      color = color.toUpperCase();
    } else {
      color = '';
    }

    // Native role badges are decoration only. Missing scopes, Twitch failures,
    // or an old connection must never prevent the pin itself from rendering.
    let badges: Array<{ type: string; version: string }> = [];

    try {
      badges = await getStoredTwitchPinnedAuthorBadges(
        rawConnectionId,
        bUserId,
        senderUserId,
      );
    } catch {
      badges = [];
    }

    return Response.json(
      {
        broadcaster: responseBroadcaster,
        pin: {
          messageId,
          senderUserId,
          color,
          badges,
          senderUserLogin,
          senderUserName,
          pinnedByUserLogin,
          pinnedByUserName,
          text,
          emotes,
          startsAt,
          endsAt,
          updatedAt,
        },
      },
      { status: 200, headers: cacheHeaders() },
    );
  } catch (error) {
    if (error instanceof TwitchPinsBodyError) {
      return Response.json(
        {
          error: error.kind === 'too-large'
            ? 'Twitch pin request body too large.'
            : 'Invalid Twitch pin request.',
        },
        { status: error.statusCode, headers: cacheHeaders() },
      );
    }

    if (error instanceof TwitchPinsAdmissionError) {
      return Response.json(
        {
          error: error.kind === 'rate'
            ? 'Too many Twitch pin requests.'
            : 'Twitch pin service temporarily unavailable.',
        },
        {
          status: error.statusCode,
          headers: {
            ...cacheHeaders(),
            'Retry-After': String(error.retryAfterSeconds),
          },
        },
      );
    }

    if (parsingRequestJson) {
      return Response.json(
        { error: 'Invalid Twitch pin request.' },
        { status: 400, headers: cacheHeaders() },
      );
    }
    return Response.json(
      { error: 'Twitch pin lookup failed.' },
      { status: 500, headers: cacheHeaders() },
    );
  } finally {
    releaseAdmission?.();
  }
}
