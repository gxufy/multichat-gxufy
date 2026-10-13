/** Browser-safe client for the POST /api/twitch/pins endpoint.
 *
 * Validates inputs and the display-safe response shape, throwing
 * {@link TwitchPinApiError} on any failure so callers can distinguish
 * error categories by the `code` property.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Minimal broadcaster shape returned by the pins API. */
export type TwitchPinApiBroadcaster = {
  login: string;
  displayName: string;
};

/** Minimal pin-message shape returned by the pins API. */
export type TwitchPinApiMessage = {
  messageId: string;
  /** Twitch's real numeric sender id — keys 7TV cosmetics lookups. */
  senderUserId: string;
  /** Uppercase `#RRGGBB`, or `''` when unset or unavailable. */
  color: string;
  /** Native Twitch role badges known for the pinned-message author. */
  badges: Array<{
    type: 'broadcaster' | 'moderator' | 'vip' | 'subscriber';
    version: string;
  }>;
  senderUserLogin: string;
  senderUserName: string;
  pinnedByUserLogin: string;
  pinnedByUserName: string;
  text: string;
  /** Native Twitch emotes with code-point offsets into text. */
  emotes: Array<{
    begin: number;
    end: number;
    text: string;
    url: string;
  }>;
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
};

/** The top-level shape returned by the pins API. */
export type TwitchPinApiResult = {
  broadcaster: TwitchPinApiBroadcaster;
  pin: TwitchPinApiMessage | null;
};

/* ------------------------------------------------------------------ */
/* Error class                                                         */
/* ------------------------------------------------------------------ */

/**
 * Thrown by {@link fetchTwitchChannelPin} when the API call or
 * response validation fails.
 *
 * Callers can inspect `code` to decide whether to retry, redirect,
 * or show a user-facing message.
 */
export class TwitchPinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'invalid-request' | 'channel-not-found' | 'lookup-failed',
  ) {
    super(message);
    this.name = 'TwitchPinApiError';
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Check that *val* is a non-null, non-array object. */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/** Check that *val* is a non-empty string after trimming. */
function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

/** Return *true* when *val* looks like a valid timestamp string. */
function isValidTimestamp(val: unknown): boolean {
  if (typeof val !== 'string' || val.trim().length === 0) return false;
  const date = new Date(val);
  return !Number.isNaN(date.getTime());
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Call the pins API for *login* on *connectionId* and return the
 * validated, display-safe result.
 *
 * @param connectionId — UUID-formatted connection identifier (not trimmed or altered).
 * @param login — Twitch channel login (trimmed, lowercased, validated).
 * @param signal — Optional `AbortSignal`.  An abort is re-thrown as-is so callers
 *                 can still detect `AbortError` via `instanceof DOMException`.
 * @throws {TwitchPinApiError} on validation or network failures.
 * @throws {DOMError} when *signal* is aborted (re-thrown unchanged).
 */
export async function fetchTwitchChannelPin(
  connectionId: string,
  login: string,
  signal?: AbortSignal,
): Promise<TwitchPinApiResult> {
  /* ---- Input validation ---- */

  if (
    typeof connectionId !== 'string' ||
    connectionId.trim().length === 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      connectionId,
    )
  ) {
    throw new TwitchPinApiError(
      'Invalid Twitch pin request.',
      400,
      'invalid-request',
    );
  }

  if (
    typeof login !== 'string' ||
    login.trim().length === 0
  ) {
    throw new TwitchPinApiError(
      'Invalid Twitch pin request.',
      400,
      'invalid-request',
    );
  }

  const normalizedLogin = login.trim().toLowerCase();

  if (
    normalizedLogin.length === 0 ||
    normalizedLogin.length > 100 ||
    !/^[a-z0-9_]+$/.test(normalizedLogin)
  ) {
    throw new TwitchPinApiError(
      'Invalid Twitch pin request.',
      400,
      'invalid-request',
    );
  }

  /* ---- Fetch ---- */

  let response: Response;

  try {
    response = await fetch('/api/twitch/pins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify({ connectionId, login: normalizedLogin }),
      signal,
    });
  } catch (error) {
    // Preserve AbortError so callers can still detect it.
    if (
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      throw error;
    }
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      0,
      'lookup-failed',
    );
  }

  /* ---- HTTP-status handling ---- */

  if (response.status === 400 || response.status === 415) {
    throw new TwitchPinApiError(
      'Invalid Twitch pin request.',
      response.status,
      'invalid-request',
    );
  }

  if (response.status === 404) {
    throw new TwitchPinApiError(
      'Twitch channel not found.',
      404,
      'channel-not-found',
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  /* ---- Parse & validate JSON body ---- */

  let parsed: unknown;

  try {
    parsed = await response.json();
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === 'AbortError'
    ) {
      throw error;
    }

    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      0,
      'lookup-failed',
    );
  }

  // Top-level must be a non-null object (not an array).
  if (!isPlainObject(parsed)) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  // --- Validate broadcaster ---

  const broadcaster = parsed.broadcaster;

  if (!isPlainObject(broadcaster)) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  const bLogin = broadcaster.login;
  if (!isNonEmptyString(bLogin)) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  const bDisplayName = broadcaster.displayName;
  if (!isNonEmptyString(bDisplayName)) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  // broadcaster.login must match the requested login.
  if (bLogin.toLowerCase() !== normalizedLogin) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  // --- Validate pin (nullable) ---

  const pin = parsed.pin;

  if (pin !== null && !isPlainObject(pin)) {
    throw new TwitchPinApiError(
      'Twitch pin lookup failed.',
      response.status,
      'lookup-failed',
    );
  }

  if (pin !== null) {
    const requiredStringFields: Array<keyof TwitchPinApiMessage> = [
      'messageId',
      'senderUserId',
      'senderUserLogin',
      'senderUserName',
      'pinnedByUserLogin',
      'pinnedByUserName',
      'text',
    ];

    for (const field of requiredStringFields) {
      if (!isNonEmptyString(pin[field])) {
        throw new TwitchPinApiError(
          'Twitch pin lookup failed.',
          response.status,
          'lookup-failed',
        );
      }
    }

    /* color is not in requiredStringFields: '' is a legitimate value for a
       user with no color configured, and that loop rejects empty strings. */
    if (
      typeof pin.color !== 'string' ||
      (pin.color !== '' && !/^#[0-9a-fA-F]{6}$/.test(pin.color))
    ) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }

    if (!Array.isArray(pin.badges) || pin.badges.length > 8) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }

    const allowedBadgeTypes = new Set<string>([
      'broadcaster',
      'moderator',
      'vip',
      'subscriber',
    ]);

    for (const badge of pin.badges) {
      if (
        !isPlainObject(badge) ||
        typeof badge.type !== 'string' ||
        !allowedBadgeTypes.has(badge.type) ||
        !isNonEmptyString(badge.version) ||
        badge.version.length > 100 ||
        Object.keys(badge).some((key) => key !== 'type' && key !== 'version')
      ) {
        throw new TwitchPinApiError(
          'Twitch pin lookup failed.',
          response.status,
          'lookup-failed',
        );
      }
    }

    if (!Array.isArray(pin.emotes) || pin.emotes.length > 100) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }

    const messageChars = Array.from(pin.text as string);
    let previousEmoteEnd = 0;

    for (const emote of pin.emotes) {
      if (
        !isPlainObject(emote) ||
        typeof emote.begin !== 'number' ||
        !Number.isInteger(emote.begin) ||
        emote.begin < 0 ||
        emote.begin < previousEmoteEnd ||
        typeof emote.end !== 'number' ||
        !Number.isInteger(emote.end) ||
        emote.end <= emote.begin ||
        emote.end > messageChars.length ||
        !isNonEmptyString(emote.text) ||
        messageChars.slice(emote.begin, emote.end).join('') !== emote.text ||
        typeof emote.url !== 'string' ||
        emote.url.length > 500 ||
        !emote.url.startsWith('https://static-cdn.jtvnw.net/emoticons/v2/') ||
        !emote.url.endsWith('/default/dark/3.0') ||
        Object.keys(emote).some(
          (key) => key !== 'begin' && key !== 'end' && key !== 'text' && key !== 'url',
        )
      ) {
        throw new TwitchPinApiError(
          'Twitch pin lookup failed.',
          response.status,
          'lookup-failed',
        );
      }

      previousEmoteEnd = emote.end;
    }

    // Twitch user ids are numeric; a non-digit id is a malformed response.
    if (!/^\d+$/.test(pin.senderUserId as string)) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }

    if (!isValidTimestamp(pin.startsAt)) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }

    if (!isValidTimestamp(pin.updatedAt)) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }

    if (pin.endsAt !== null && !isValidTimestamp(pin.endsAt)) {
      throw new TwitchPinApiError(
        'Twitch pin lookup failed.',
        response.status,
        'lookup-failed',
      );
    }
  }

  // Cast is safe because runtime validation passed above.
  return parsed as TwitchPinApiResult;
}
