/* MultiChat's runtime state: the Twitch connection, and what it gates.
 *
 * Separate from `settings.ts` (appearance) and from the channel fields, because a
 * connection is neither. It is capability, not configuration: it changes what the
 * overlay is *able* to do rather than how it looks.
 *
 * The rule this module encodes, and the reason it is not spread across the UI:
 * native Twitch pins require an authorized poll for the *same account* as the
 * configured Twitch channel. Three separate things depend on that one fact — the
 * pin-platform option's availability, whether `twitch` survives in the emitted
 * pin list, and whether the connection id is added to the overlay URL — so it is
 * computed once here.
 */
import type { MultichatWorkspaceStyle } from '@/lib/multichatConfig';
import type { OptionAvailability } from '@/lib/tools/settingTypes';
import type { ToolContext } from '@/lib/tools/toolContext';
import {
  TWITCH_CONNECTION_FRAGMENT_ID,
  TWITCH_CONNECTION_FRAGMENT_LOGIN,
  normalizeTwitchLogin,
} from '@/lib/twitchConnection';

export { OAUTH_RETURN_GENERATOR } from '@/lib/oauthReturn';

/** Runtime state the workspace shell stores opaquely for this tool. */
export type MultichatRuntime = {
  /** Opaque handle to the server-side encrypted record, or ''. Never rendered. */
  readonly connectionId: string;
  /** The connected account's login, or ''. Safe to display. */
  readonly connectedLogin: string;
  /** The Twitch channel currently typed in, normalized. Mirrored here so the
   *  gating rule can be evaluated without the shell knowing why. */
  readonly twitchChannel: string;
};

export const EMPTY_MULTICHAT_RUNTIME: MultichatRuntime = {
  connectionId: '',
  connectedLogin: '',
  twitchChannel: '',
};

/**
 * Whether native Twitch pins can actually be fetched right now.
 *
 * Both halves are required. A connection alone is not enough: polling pins for
 * account A while the overlay reads chat for channel B would return pins that
 * never appear in the chat on screen. The typed channel must name the account
 * that was authorized.
 */
export function twitchPinsAvailable(runtime: MultichatRuntime): boolean {
  if (!runtime.connectionId) return false;
  if (!runtime.connectedLogin) return false;
  return normalizeTwitchLogin(runtime.twitchChannel) === runtime.connectedLogin;
}

/** Why the Twitch pin option is unavailable, in the user's terms. */
export function twitchPinsReason(runtime: MultichatRuntime): string | undefined {
  if (!runtime.connectionId) {
    return 'Connect a Twitch account to read its native pinned messages.';
  }
  if (normalizeTwitchLogin(runtime.twitchChannel) !== runtime.connectedLogin) {
    return `Connected as ${runtime.connectedLogin}. Set the Twitch channel to that account to use its pins.`;
  }
  return undefined;
}

/**
 * Drop `twitch` from the pinned-platform set when pins cannot be fetched.
 *
 * The user's other choices are preserved exactly, and nothing is added — so
 * connecting does not silently opt someone into Twitch pins, and disconnecting
 * does not silently discard their Kick or YouTube selections.
 */
export function syncMultichatStyle(
  style: MultichatWorkspaceStyle,
  runtime: MultichatRuntime,
): MultichatWorkspaceStyle {
  if (twitchPinsAvailable(runtime)) return style;
  if (!style.pinPlatforms.includes('twitch')) return style;
  return { ...style, pinPlatforms: style.pinPlatforms.filter((p) => p !== 'twitch') };
}

/**
 * The overlay URL's fragment, when there is anything to put in it.
 *
 * A fragment — never a query parameter. The overlay reads it from
 * `window.location.hash`, and a fragment is not sent to the server, so the
 * connection id stays out of access logs, out of `Referer` headers, and out of
 * anything that proxies or caches by URL.
 *
 * Emitted only when pins are actually available *and* the user has asked for
 * Twitch pins. So a URL never carries a connection id it has no use for: not
 * when pins are off, not when the option is unselected, and not when the
 * connected account does not match the configured channel.
 */
export function multichatContext(
  style: MultichatWorkspaceStyle,
  runtime: MultichatRuntime,
): ToolContext | undefined {
  if (!style.showPinEnabled) return undefined;
  if (!style.pinPlatforms.includes('twitch')) return undefined;
  if (!twitchPinsAvailable(runtime)) return undefined;

  const fragment = new URLSearchParams({
    [TWITCH_CONNECTION_FRAGMENT_ID]: runtime.connectionId,
    [TWITCH_CONNECTION_FRAGMENT_LOGIN]: runtime.connectedLogin,
  }).toString();

  return { fragment };
}

/**
 * Availability for the pin-platform control's `twitch` option.
 *
 * The return type is stated rather than inferred, so a caller can ask about any
 * platform — the inferred literal type would only admit `twitch` and make a
 * lookup of an ungated option a compile error rather than the `undefined` that
 * correctly means "available".
 */
export function multichatOptionAvailability(
  runtime: MultichatRuntime,
): Partial<Record<'pinPlatforms', Record<string, OptionAvailability>>> {
  if (twitchPinsAvailable(runtime)) return {};
  return {
    pinPlatforms: {
      twitch: { available: false, reason: twitchPinsReason(runtime) },
    },
  };
}
