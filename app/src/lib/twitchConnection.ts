/* Twitch connection identity: validation, fragment reading, session storage.
 *
 * The rules here are the classic generator's own, lifted verbatim rather than
 * reinvented — the same UUID shape, the same login pattern and 100-character
 * bound, the same lowercase-and-trim normalization. Two generators consuming the
 * same OAuth callback must agree on what a valid return looks like, and the only
 * way to guarantee that is one implementation.
 *
 * What the connection id is: an opaque handle to a server-side encrypted record.
 * It is not a token, but it is bearer-shaped — whoever holds it can poll pins for
 * that account — so it is treated as sensitive throughout: never logged, never
 * put in a query string, never rendered as standalone text, and removed from the
 * address bar as soon as it has been read.
 */

/** The connection id shape the overlay's poller also requires. */
const CONNECTION_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Twitch logins are lowercase alphanumerics and underscores. */
const LOGIN_RE = /^[a-z0-9_]+$/;

const LOGIN_MAX = 100;

export const TWITCH_CONNECTION_FRAGMENT_ID = 'twitchConnectionId';
export const TWITCH_CONNECTION_FRAGMENT_LOGIN = 'twitch';

/** A validated connection, or nothing. Never partially populated. */
export type TwitchConnection = {
  readonly connectionId: string;
  readonly login: string;
};

export function isValidConnectionId(value: unknown): value is string {
  return typeof value === 'string' && CONNECTION_ID_RE.test(value);
}

/** Normalize a Twitch login the way every other consumer here does. */
export function normalizeTwitchLogin(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

export function isValidTwitchLogin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizeTwitchLogin(value);
  return normalized.length > 0 && normalized.length <= LOGIN_MAX && LOGIN_RE.test(normalized);
}

/**
 * Read a connection out of a URL fragment.
 *
 * Returns null unless *both* values are present and valid, so a half-valid
 * fragment can never produce a connection with an empty login — which would then
 * match no channel and silently disable pins with no explanation.
 *
 * `URLSearchParams.get` returns the first value for a repeated key, which would
 * let `#twitch=victim&twitch=attacker` be read as the first while a different
 * consumer read the second. `getAll` is checked instead, and any duplicate of
 * either key rejects the whole fragment.
 */
/**
 * Serialize a validated connection back into a URL fragment.
 *
 * Deliberately rebuilt from the two validated fields rather than passing an
 * incoming hash through: forwarding a hash verbatim would carry along whatever
 * else was in it, and the point of a redirect that preserves a connection is to
 * preserve *only* the connection. Anything unrecognized is dropped by
 * construction, not by a filter that could miss a case.
 *
 * Key order matches what the OAuth callback emits, so a preserved fragment is
 * byte-identical to the one the callback would have produced.
 */
export function buildConnectionFragment(connection: TwitchConnection): string {
  const params = new URLSearchParams();
  params.set(TWITCH_CONNECTION_FRAGMENT_ID, connection.connectionId);
  params.set(TWITCH_CONNECTION_FRAGMENT_LOGIN, connection.login);
  return `#${params.toString()}`;
}

export function readConnectionFromFragment(hash: string): TwitchConnection | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

  const ids = params.getAll(TWITCH_CONNECTION_FRAGMENT_ID);
  const logins = params.getAll(TWITCH_CONNECTION_FRAGMENT_LOGIN);
  if (ids.length !== 1 || logins.length !== 1) return null;

  const connectionId = ids[0];
  const login = logins[0];
  if (!isValidConnectionId(connectionId)) return null;
  if (!isValidTwitchLogin(login)) return null;

  return { connectionId, login: normalizeTwitchLogin(login) };
}
