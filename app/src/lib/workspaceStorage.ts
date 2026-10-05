/* Versioned sessionStorage for the generator workspace.
 *
 * Two kinds of key, deliberately separate:
 *
 *   gxufy.workspace-draft.<toolId>.v1  — channels, style, preview background
 *   gxufy.multichat.connection.v1      — validated connection id and login
 *
 * They are split because they have different lifetimes and different
 * sensitivity. The draft is written before every OAuth navigation and consumed
 * once on return; the connection persists for the browser session so a reload
 * does not silently drop pin capability. Keeping them apart means clearing one
 * cannot clear the other, and a malformed draft cannot invalidate a good
 * connection.
 *
 * sessionStorage, not localStorage: a connection handle should not outlive the
 * tab. Neither key ever holds a token, refresh token, OAuth state, authorization
 * code, encryption material, cookie, or raw provider response — the draft holds
 * only what the user typed and chose, and the connection holds only the two
 * already-validated public-ish values the callback put in the fragment.
 *
 * Every access is wrapped: sessionStorage throws in Safari private mode, under
 * some cookie policies, and when the quota is exceeded. Storage being
 * unavailable degrades the feature, so it must never break the page.
 */
import {
  isValidConnectionId,
  isValidTwitchLogin,
  normalizeTwitchLogin,
  type TwitchConnection,
} from './twitchConnection';

/** Draft key for one tool. Per-tool, so two tools cannot overwrite each other. */
export function workspaceDraftKey(toolId: string): string {
  return `gxufy.workspace-draft.${toolId}.v1`;
}

export const TWITCH_CONNECTION_KEY = 'gxufy.multichat.connection.v1';

/** The version inside each payload, so a v1 key with v0 content is refused. */
const VERSION = 1;

/** sessionStorage, or null when it is unavailable or throws on access. */
function store(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    /* Quota, private mode, or a policy refusal. The feature degrades; the page
       must not. */
  }
}

export function clearStoredKey(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* As above. */
  }
}

/**
 * Parse JSON into a plain own-property record, or null.
 *
 * Rejects arrays and non-objects, and rejects any payload carrying `__proto__`,
 * `constructor`, or `prototype` as an own key. `JSON.parse` does not itself
 * pollute a prototype, but the parsed object is spread into React state and
 * indexed by caller-supplied keys downstream, so refusing the shape outright is
 * cheaper than auditing every consumer.
 */
function parsePlainObject(raw: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  for (const dangerous of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(value, dangerous)) return null;
  }
  return value as Record<string, unknown>;
}

/** A payload's version field, checked before anything else is trusted. */
function hasCurrentVersion(payload: Record<string, unknown>): boolean {
  return payload['version'] === VERSION;
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Read the stored connection, validating both fields again on the way out.
 *
 * Revalidation is not redundant: sessionStorage is writable by any script on the
 * origin and survives across navigations, so what was valid when written is not
 * necessarily what is read. Malformed data is cleared rather than left to fail
 * the same way on every subsequent read.
 */
export function readStoredConnection(): TwitchConnection | null {
  const raw = readRaw(TWITCH_CONNECTION_KEY);
  if (raw === null) return null;

  const payload = parsePlainObject(raw);
  if (!payload || !hasCurrentVersion(payload)) {
    clearStoredKey(TWITCH_CONNECTION_KEY);
    return null;
  }

  const connectionId = payload['connectionId'];
  const login = payload['login'];
  if (!isValidConnectionId(connectionId) || !isValidTwitchLogin(login)) {
    clearStoredKey(TWITCH_CONNECTION_KEY);
    return null;
  }

  return { connectionId, login: normalizeTwitchLogin(login) };
}

/** Persist a validated connection for the rest of the browser session. */
export function writeStoredConnection(connection: TwitchConnection): void {
  if (!isValidConnectionId(connection.connectionId)) return;
  if (!isValidTwitchLogin(connection.login)) return;
  writeRaw(
    TWITCH_CONNECTION_KEY,
    JSON.stringify({
      version: VERSION,
      connectionId: connection.connectionId,
      login: normalizeTwitchLogin(connection.login),
    }),
  );
}

export function clearStoredConnection(): void {
  clearStoredKey(TWITCH_CONNECTION_KEY);
}

/* ------------------------------------------------------------------ */
/* Draft                                                               */
/* ------------------------------------------------------------------ */

/** What survives an OAuth round trip: what the user typed and chose. */
export type WorkspaceDraft = {
  /** Raw channel text, keyed by platform. Unvalidated by design — it is what
   *  was typed, and the tool's own normalizer decides what it means. Values are
   *  optional so a partially filled `ToolChannels` assigns directly; `undefined`
   *  entries are dropped on write. */
  readonly channels: Readonly<Record<string, string | undefined>>;
  /** The tool's style object, re-normalized on read by the tool itself. */
  readonly style: Record<string, unknown>;
  /** Preview-only background id. */
  readonly background: string;
};

/**
 * Persist a draft. Called immediately before an OAuth navigation.
 *
 * Only string channel values are kept, so a non-string that reached state
 * through some future path cannot be written and read back as something else.
 */
export function writeWorkspaceDraft(toolId: string, draft: WorkspaceDraft): void {
  const channels: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft.channels)) {
    if (typeof value === 'string') channels[key] = value;
  }
  writeRaw(
    workspaceDraftKey(toolId),
    JSON.stringify({
      version: VERSION,
      channels,
      style: draft.style,
      background: draft.background,
    }),
  );
}

/**
 * Read and immediately delete the draft.
 *
 * Consuming on read is what makes restoration one-shot. If the draft survived,
 * a later effect run — React Strict Mode double-invokes effects in development,
 * and any remount would too — could overwrite edits the user made after the
 * restore with the stale snapshot.
 */
export function consumeWorkspaceDraft(toolId: string): WorkspaceDraft | null {
  const key = workspaceDraftKey(toolId);
  const raw = readRaw(key);
  if (raw === null) return null;
  clearStoredKey(key);

  const payload = parsePlainObject(raw);
  if (!payload || !hasCurrentVersion(payload)) return null;

  const channelsRaw = payload['channels'];
  const styleRaw = payload['style'];
  const backgroundRaw = payload['background'];

  /* Each field is independently optional: a draft with a good style but a
     corrupted channel map still restores the style. */
  const channels: Record<string, string> = {};
  if (
    typeof channelsRaw === 'object' &&
    channelsRaw !== null &&
    !Array.isArray(channelsRaw)
  ) {
    for (const [key, value] of Object.entries(channelsRaw)) {
      if (typeof value === 'string') channels[key] = value;
    }
  }

  const style =
    typeof styleRaw === 'object' && styleRaw !== null && !Array.isArray(styleRaw)
      ? (styleRaw as Record<string, unknown>)
      : {};

  return {
    channels,
    style,
    background: typeof backgroundRaw === 'string' ? backgroundRaw : '',
  };
}

export function clearWorkspaceDraft(toolId: string): void {
  clearStoredKey(workspaceDraftKey(toolId));
}
