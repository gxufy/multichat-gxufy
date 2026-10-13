/* Connection adoption and revocation, shared by every Twitch connection UI.
 *
 * Two surfaces present the Twitch connection: the Classic generator's own panel,
 * styled to match the Classic card, and the descriptor's `runtime.Panel`. They
 * look nothing alike and they should not — but the *behaviour* underneath them is
 * security-relevant in ways that must not be reimplemented twice:
 *
 *   - the OAuth fragment is read once and stripped immediately, so the opaque
 *     connection id never survives into a copy, a bookmark, or a history entry;
 *   - a fragment that was present but unusable is stripped too, so a tampered
 *     value is not left in the address bar;
 *   - disconnect POSTs the id in a body rather than a query string, is bounded by
 *     a timeout so a hung request cannot strand the button, aborts on unmount,
 *     and clears local state even when the server call fails.
 *
 * A second copy of that list would drift, and the drift would be invisible — the
 * panel would still look correct while leaking a live credential into the address
 * bar. So the rules live here once and both panels call this hook for them,
 * keeping only their own markup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearStoredConnection,
  readStoredConnection,
  writeStoredConnection,
} from '@/lib/workspaceStorage';
import { readConnectionFromFragment } from '@/lib/twitchConnection';
import type { MultichatRuntime } from './runtime';

/**
 * How long a disconnect request may hang before it is abandoned.
 *
 * Without a ceiling, a request that never settles leaves the button disabled
 * reading "Disconnecting…" for the life of the page, and the one action the user
 * asked for becomes unreachable. Ten seconds is well past a normal round trip.
 */
export const DISCONNECT_TIMEOUT_MS = 10_000;

/** Remove the OAuth fragment from the address bar without a navigation. */
function stripFragment(): void {
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
}

type RuntimeUpdate = (
  next: MultichatRuntime | ((current: MultichatRuntime) => MultichatRuntime),
) => void;

export type TwitchConnectionControls = {
  /** True while a disconnect request is in flight. */
  readonly disconnecting: boolean;
  /** A user-facing message when the server-side revoke may not have completed. */
  readonly error: string;
  readonly disconnect: () => void;
};

/**
 * Adopt a connection on mount and expose the disconnect action.
 *
 * Adoption prefers the OAuth fragment (we just came back from authorizing) and
 * falls back to session storage (we were already connected before this page
 * load). Either way the address bar is left clean.
 */
export function useTwitchConnection(
  runtime: MultichatRuntime,
  onChange: RuntimeUpdate,
): TwitchConnectionControls {
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');

  /* Guards the adoption effect against a second run (Strict Mode double-invokes
     effects in development), which would re-read an already-stripped fragment. */
  const adopted = useRef(false);
  /* Aborts an in-flight disconnect when the page unmounts, so the request does
     not outlive the component and resolve into state that no longer exists. Held
     in a ref because the cleanup effect and the handler are separate. */
  const disconnectAbort = useRef<AbortController | null>(null);

  /* The live values, so the callbacks below can stay referentially stable
     without closing over a stale snapshot. A changing `disconnect` identity
     would be a dependency of every panel that memoizes on it. */
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(
    () => () => {
      disconnectAbort.current?.abort();
      disconnectAbort.current = null;
    },
    [],
  );

  useEffect(() => {
    if (adopted.current) return;
    adopted.current = true;

    /* Adopted through the updater form, never by spreading a `runtime` snapshot:
       the page folds the typed Twitch channel into runtime from its own effect,
       and the two orderings are not guaranteed. Spreading a mount-time snapshot
       would reset `twitchChannel` to '' if the draft restore had already
       populated it, silently gating pins on a matching account. */
    const adopt = (connectionId: string, connectedLogin: string) =>
      onChangeRef.current((current) => ({
        ...current,
        connectionId,
        connectedLogin,
      }));

    const fromFragment = readConnectionFromFragment(window.location.hash);
    if (fromFragment) {
      stripFragment();
      writeStoredConnection(fromFragment);
      adopt(fromFragment.connectionId, fromFragment.login);
      return;
    }

    /* A fragment that was present but unusable is still removed, so a malformed
       or tampered value is not left sitting in the address bar. Anchors are the
       one exception: `#viewer-counter` is a legitimate in-page target that the
       retired /tools/counter route redirects to, and stripping it would undo the
       scroll the user was sent here for. */
    const hash = window.location.hash.replace(/^#/, '');
    if (hash && hash.includes('=')) stripFragment();

    const stored = readStoredConnection();
    if (stored) adopt(stored.connectionId, stored.login);
    /* Mount only. Re-running on every runtime change would re-adopt a connection
       the user just disconnected. */
  }, []);

  /* Revoke server-side, then clear locally.
   *
   * Local state is cleared even when the request fails: the user asked to
   * disconnect, and leaving a connection that appears active but may already be
   * revoked is worse than a stale server record. The error is surfaced so they
   * know the server side may not have completed. */
  const disconnect = useCallback(() => {
    const connectionId = runtimeRef.current.connectionId;
    if (!connectionId || disconnectAbort.current) return;

    const controller = new AbortController();
    disconnectAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), DISCONNECT_TIMEOUT_MS);

    setDisconnecting(true);
    setError('');

    void (async () => {
      try {
        const res = await fetch('/api/twitch/oauth/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('failed');
      } catch {
        /* Unmount aborts through the same controller, so this also runs on an
           unmount-triggered abort — harmless, since every branch below is either
           a no-op or a setState React discards on an unmounted component. */
        setError('Could not fully disconnect on the server. Try again.');
      } finally {
        clearTimeout(timeout);
        disconnectAbort.current = null;
        clearStoredConnection();
        /* Clearing the id drops the fragment from the overlay URL, and the
           tool's `sync` hook removes twitch from the pin selection — neither is
           done here, because both are consequences the descriptor owns. Updater
           form again: the channel may have been retyped while the request was in
           flight. */
        onChangeRef.current((current) => ({
          ...current,
          connectionId: '',
          connectedLogin: '',
        }));
        setDisconnecting(false);
      }
    })();
  }, []);

  return { disconnecting, error, disconnect };
}
