/**
 * Twitch Pin Streaming — Server-Side Adapter Boundary
 *
 * This module is intended for server-side code only (API routes,
 * Edge Functions, or serverless handlers). It MUST NOT be imported
 * into client-side React components or pages that ship to the browser,
 * as future implementations will reference TWITCH_CLIENT_SECRET.
 *
 * Current state: stub — no real Twitch pin streaming is operational.
 *
 * === State Model ===
 *
 *   NOT_CONFIGURED  → env vars absent (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)
 *   UNAUTHORIZED    → config present, but no valid session / token
 *   CONNECTING      → OAuth redirect in progress (client-side redirect)
 *   CONNECTED       → token valid, EventSub subscription active
 *   EXPIRED         → access token expired, refresh needed
 *   ERROR           → transient failure (network, EventSub policy, etc.)
 *
 * === Event Model ===
 *
 *   action: 'pin'      — message was pinned
 *   action: 'unpin'    — message was unpinned (clears preview)
 *   action: 'update'   — message text changed (replacement / update)
 *
 * === Security Guarantees ===
 *
 *   - No token or secret is stored in URLs or localStorage
 *   - Tokens live only in server-side session store
 *   - OAuth scope is minimum-privilege: channel:manage:predictions
 *   - The stub never emits fake pin events
 */

import type { Platform } from './types';

/* ── Pin event ─────────────────────────────────────────────────────────── */

export interface TwitchPinEvent {
  platform: Platform;         // always 'twitch'
  action: 'pin' | 'unpin' | 'update';
  message: { id: string; text: string };
  pinnedBy: { id: string; displayName: string };
}

/* ── Provider states ───────────────────────────────────────────────────── */

/** Machine state for the Twitch pin provider lifecycle. */
export type TwitchPinState =
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'EXPIRED'
  | 'ERROR';

/* ── Provider interface (server-side only) ─────────────────────────────── */

export interface TwitchPinProvider {
  /** Current lifecycle state. */
  readonly state: TwitchPinState;
  /** Human-readable state label for UI display. */
  readonly statusText: string;
  /** Begin OAuth flow — returns redirect URL and CSRF state. */
  connect(): Promise<{ redirectUrl: string; state: string }>;
  /** Handle OAuth callback — exchanges code for tokens. */
  exchangeCode(code: string, state: string): Promise<void>;
  /** Subscribe to pin/unpin/update events; returns unsubscribe fn. */
  subscribe(onEvent: (event: TwitchPinEvent) => void): () => void;
  /** Revoke token, remove session, reset to UNAUTHORIZED. */
  disconnect(): Promise<void>;
}

/* ── Factory ───────────────────────────────────────────────────────────── */

/**
 * Creates a Twitch pin provider.
 *
 * Server-safe: reads env vars from process.env which is Node-only.
 * If called in a browser, TWITCH_CLIENT_ID is undefined and the stub
 * returns UNAUTHORIZED (not NOT_CONFIGURED, to avoid leaking infra details).
 */
export function createTwitchPinProvider(): TwitchPinProvider {
  const configured =
    typeof process !== 'undefined' &&
    !!process.env?.TWITCH_CLIENT_ID &&
    !!process.env?.TWITCH_CLIENT_SECRET;

  if (!configured) {
    /* NOT_CONFIGURED — env vars missing */
    const st: TwitchPinState = 'NOT_CONFIGURED';
    return {
      get state() { return st; },
      get statusText() { return 'Twitch pin connection not configured'; },
      async connect() {
        throw new Error(
          'Twitch pin streaming requires OAuth configuration. ' +
            'Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.'
        );
      },
      async exchangeCode() {
        throw new Error('Twitch pin streaming is not configured.');
      },
      subscribe(_onEvent) {
        return () => { /* no-op */ };
      },
      async disconnect() { /* no-op */ },
    };
  }

  /* TODO: When OAuth infrastructure is in place, return a real
   * provider that uses TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET
   * and a server-side session store. The stub below reports
   * UNAUTHORIZED — it does NOT emit fake pin events. */
  const auth: TwitchPinState = 'UNAUTHORIZED';
  return {
    get state() { return auth; },
    get statusText() { return 'Twitch pins require authorization'; },
    async connect() {
      throw new Error('Twitch pin streaming not yet implemented — OAuth infrastructure required.');
    },
    async exchangeCode() {
      throw new Error('Twitch pin streaming not yet implemented.');
    },
    subscribe(_onEvent) {
      return () => { /* no-op */ };
    },
    async disconnect() { /* no-op */ },
  };
}
