/** Server-only helper: read one Twitch user's configured chat name color.
 *
 * Sends a GET request to Twitch's /helix/chat/color endpoint for a single
 * numeric user id. An empty color string is a valid result — Twitch returns
 * it for users who have never chosen a color.
 *
 * Environment variables are read lazily inside the function so a missing
 * variable does not break static builds. Errors never expose credentials,
 * tokens, ids, request URLs, or Twitch response bodies.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * Result of reading a user's chat color.
 *
 * `color` is either an uppercase `#RRGGBB` string or `''` when the user has
 * no color configured (or Twitch does not know the user).
 */
export type TwitchUserChatColorResult =
  | {
      status: 'ok';
      color: string;
    }
  | {
      status: 'unauthorized';
    };

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TWITCH_HELIX_CHAT_COLOR_URL = 'https://api.twitch.tv/helix/chat/color';

/** Colors are decoration on a 5s poll — fail fast rather than stall the pin. */
const REQUEST_TIMEOUT_MS = 2_000;

const GENERIC_ERR = 'Twitch user chat color lookup failed.';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** Throw the single opaque error used for every failure path. */
function fail(): never {
  throw new Error(GENERIC_ERR);
}

/** Validate that `value` is a non-empty string of decimal digits. */
function isDigits(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && /^\d+$/.test(value);
}

/**
 * Parse and strictly validate the body returned by
 * {@link TWITCH_HELIX_CHAT_COLOR_URL}.
 *
 * Requires a non-null object with a `data` array, then accepts only:
 *   - an empty array (unknown user → no color)
 *   - exactly one non-null, non-array record whose `user_id` matches the
 *     requested id and whose `color` is `''` or a six-digit hex value
 *
 * Valid hex colors are normalized to uppercase. Anything else throws.
 */
function parseChatColor(body: unknown, userId: string): string {
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as Record<string, unknown>).data)
  ) {
    fail();
  }

  const data = (body as Record<string, unknown[]>).data;

  // Unknown user — treated as "no color configured", not an error.
  if (data.length === 0) return '';

  if (data.length !== 1) fail();

  const raw = data[0];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail();

  const record = raw as Record<string, unknown>;

  // Reject records describing a different user than the one requested.
  if (!isDigits(record.user_id) || record.user_id !== userId) fail();

  const color = record.color;
  if (typeof color !== 'string') fail();
  if (color === '') return '';
  if (!HEX_COLOR_RE.test(color)) fail();

  return color.toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Read the chat name color configured by the Twitch user `userId`.
 *
 * Returns `{ status: 'ok', color }` where `color` is an uppercase `#RRGGBB`
 * string or `''` when no color is set, or `{ status: 'unauthorized' }` when
 * Twitch rejects the token so the caller can refresh and retry once.
 *
 * Every other failure — invalid input, missing client id, timeout, non-2xx
 * response, malformed body, or a record for a different user — throws a
 * single opaque error.
 */
export async function fetchTwitchUserChatColor(
  accessToken: string,
  userId: string,
): Promise<TwitchUserChatColorResult> {
  // --- Validate inputs ---

  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    fail();
  }

  if (!isDigits(userId)) {
    fail();
  }

  // --- Read client ID lazily ---

  const clientId = process.env.TWITCH_CLIENT_ID;
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    fail();
  }

  // --- Build URL ---

  const url = new URL(TWITCH_HELIX_CHAT_COLOR_URL);
  url.searchParams.set('user_id', userId);

  // --- Request with timeout ---

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
      return { status: 'unauthorized' };
    }

    if (!response.ok) {
      fail();
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      fail();
    }

    return { status: 'ok', color: parseChatColor(body, userId) };
  } catch {
    // Collapse timeouts, network errors, and parse failures into one error.
    throw new Error(GENERIC_ERR);
  } finally {
    clearTimeout(timer);
  }
}
