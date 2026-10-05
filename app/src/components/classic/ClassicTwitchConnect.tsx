/* The Twitch connection controls for the Classic generator.
 *
 * Visually this is the Classic generator's own small purple Connect chip, the
 * "Connected as …" line, the mismatch warning, and Disconnect. It sits beside
 * the pin-platform control in Chat settings — the connection is optional and
 * exists only for native Twitch pinned messages, so it belongs with the pin
 * controls it serves, not under the Twitch channel input where it read as
 * though Twitch chat needed a login.
 *
 * Behaviourally it owns nothing. Fragment adoption, stripping, and the bounded
 * disconnect all come from useTwitchConnection; whether pins are usable comes
 * from twitchPinsAvailable, the same predicate that gates the pin option and the
 * URL fragment. So a channel typed as '@Someone' cannot make this panel and the
 * pin control disagree, and there is no second copy of the credential-handling
 * rules to drift.
 *
 * One addition the Classic page needs and the workspace panel did not: a
 * "Use connected channel" action. Connecting authorizes one account, but the
 * Twitch channel field is free text, so the two can differ by a typo — and until
 * they match, native pins stay off. The button fills the field from the connected
 * login, which is the entire fix.
 */
import type { MultichatRuntime } from '@/features/multichat/runtime';
import {
  OAUTH_RETURN_GENERATOR,
  twitchPinsAvailable,
} from '@/features/multichat/runtime';
import { useTwitchConnection } from '@/features/multichat/useTwitchConnection';

export default function ClassicTwitchConnect({
  runtime,
  onRuntimeChange,
  onUseConnectedChannel,
  onBeforeLeave,
  describedBy,
}: {
  runtime: MultichatRuntime;
  onRuntimeChange: (
    next: MultichatRuntime | ((current: MultichatRuntime) => MultichatRuntime),
  ) => void;
  /** Set the Twitch channel field to the connected login. */
  onUseConnectedChannel: (login: string) => void;
  /** Persist both tools' drafts immediately before the OAuth navigation. */
  onBeforeLeave: () => void;
  /** id of help text describing what this connection is for. */
  describedBy?: string;
}) {
  const { disconnecting, error, disconnect } = useTwitchConnection(
    runtime,
    onRuntimeChange,
  );

  const connected = Boolean(runtime.connectionId);
  /* The shared rule, not a second copy of it. */
  const usable = twitchPinsAvailable(runtime);

  return (
    <div className="classic-conn">
      {connected ? (
        /* Rendered whenever a connection exists, mismatch or not: a channel-name
           mismatch must never hide the way to disconnect. `usable` governs the
           warning and the URL fragment, not whether these controls appear. */
        <>
          {/* The login is shown; the connection id never is. */}
          <span className="classic-conn-who">
            Connected as <strong>{runtime.connectedLogin}</strong>
          </span>

          {!usable && (
            <>
              <span className="classic-conn-warn" role="status">
                {runtime.twitchChannel
                  ? `Channel does not match the connected account. Native Twitch pins need ${runtime.connectedLogin}.`
                  : `Set the Twitch channel to ${runtime.connectedLogin} to use its native pins.`}
              </span>
              <button
                type="button"
                className="classic-conn-btn"
                onClick={() => onUseConnectedChannel(runtime.connectedLogin)}
              >
                Use connected channel
              </button>
            </>
          )}

          <button
            type="button"
            className="classic-conn-btn"
            onClick={disconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </>
      ) : (
        /* A plain link, not a fetch: OAuth is a top-level browser navigation.
           The drafts are written first so channels and both tools' settings
           survive it. `returnTo` names the canonical generator, which the
           callback validates against its exact allowlist. */
        <a
          className="classic-connect"
          href={`/api/twitch/oauth/start?returnTo=${encodeURIComponent(OAUTH_RETURN_GENERATOR)}`}
          onClick={onBeforeLeave}
          title="Optional — only needed for Twitch's own pinned messages"
          aria-label="Connect Twitch account"
          aria-describedby={describedBy}
        >
          Connect
        </a>
      )}

      {/* Outside both branches deliberately. A failed disconnect still clears
          local state, so this component has already switched to the unconnected
          view by the time the message matters — nested inside the connected
          branch, the one message the user needs would unmount the moment it
          became relevant. */}
      {error && (
        <span className="classic-conn-err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
