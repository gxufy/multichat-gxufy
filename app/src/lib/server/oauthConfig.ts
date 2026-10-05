/* The authoritative Twitch OAuth configuration contract.
 *
 * Every environment variable the OAuth round trip needs is named once, and every
 * OAuth route asks this module rather than reading process.env itself. The list
 * is the union of what the modules on the path actually read —
 *
 *   TWITCH_CLIENT_ID              lib/server/twitchOAuth.ts, twitchTokenRefresh,
 *                                 twitchTokenRevocation, twitchTokenValidation,
 *                                 twitchUserProfile, twitchPinnedMessage, …
 *   TWITCH_CLIENT_SECRET          lib/server/twitchOAuth.ts, twitchTokenRefresh
 *   TWITCH_REDIRECT_URI           lib/server/twitchOAuth.ts (code exchange) and
 *                                 the authorize redirect built by the start route
 *   TWITCH_TOKEN_ENCRYPTION_KEY   lib/server/twitchTokenCrypto.ts
 *   SUPABASE_URL                  lib/server/supabaseAdmin.ts
 *   SUPABASE_SECRET_KEY           lib/server/supabaseAdmin.ts
 *
 * The runtime contract — the required-variable list, the callback constants, and
 * the present/absent inspection helpers — lives in the sibling plain-JS module
 * oauthConfigContract.mjs, re-exported below with no change to this module's
 * public surface. It is plain .mjs so the operator commands scripts/verify-oauth-
 * *.mjs can import the same one list under bare Node with no TypeScript loader,
 * which is what keeps the operator check and the routes from ever drifting apart.
 *
 * WHAT IS AND IS NOT SAID OUT LOUD
 *
 * Clients get a stable, non-secret code — `oauth_not_configured` — and nothing
 * else. Server logs get the *names* of the absent keys, which is what an operator
 * needs and what no attacker can use. No value from process.env is ever logged or
 * returned, not truncated, not fingerprinted, not length-reported.
 *
 * Every read is lazy, inside a function, so importing this module does nothing and
 * a missing variable cannot break a static build.
 */
import {
  REQUIRED_TWITCH_OAUTH_ENV,
  TWITCH_OAUTH_CALLBACK_PATH,
  missingTwitchOAuthEnv,
  twitchRedirectUriPathLooksWrong,
} from './oauthConfigContract.mjs';

/**
 * The stable machine-readable code returned when the OAuth configuration is
 * incomplete. Deliberately not a sentence: it is contract, so support can be
 * told to look for exactly this string. It names no variable and reveals no
 * value.
 */
export const OAUTH_NOT_CONFIGURED = 'oauth_not_configured';

/** Every required variable name, as a union of string literals. */
export type TwitchOAuthEnvKey = (typeof REQUIRED_TWITCH_OAUTH_ENV)[number];

/**
 * The two public values the authorize redirect carries. The client id is public
 * by protocol — it travels in the authorize URL the browser must see. The client
 * secret is deliberately absent: it is read only by the server-side code
 * exchange, and nothing that reaches a redirect should reference it.
 */
export type TwitchOAuthStartConfig = {
  clientId: string;
  redirectUri: string;
};

/**
 * Log which parts of the contract are unsatisfied, by name. The one place in the
 * OAuth flow that writes to the log at all. It prints key names and a fixed
 * sentence — never `process.env` values, never anything derived from a value.
 */
export function reportTwitchOAuthMisconfiguration(
  route: string,
  missing: readonly TwitchOAuthEnvKey[],
): void {
  if (missing.length > 0) {
    console.error(
      `[twitch-oauth] ${route}: ${OAUTH_NOT_CONFIGURED} — missing required environment variables: ${missing.join(', ')}`,
    );
  }
  if (twitchRedirectUriPathLooksWrong()) {
    console.error(
      `[twitch-oauth] ${route}: TWITCH_REDIRECT_URI does not end with ${TWITCH_OAUTH_CALLBACK_PATH}; it must equal the OAuth Redirect URL registered on the Twitch application`,
    );
  }
}

/**
 * The start route's configuration, or null when the contract is unsatisfied.
 * Returns null on *any* missing key, not only the two it uses, for the
 * fail-early reason in the module header. `missing` is what the caller logs.
 */
export function readTwitchOAuthStartConfig():
  | { ok: true; config: TwitchOAuthStartConfig }
  | { ok: false; missing: TwitchOAuthEnvKey[] } {
  const missing = missingTwitchOAuthEnv();
  if (missing.length > 0) return { ok: false, missing };

  /* Non-null by construction: missingTwitchOAuthEnv() just proved both are
     present and non-empty. Trimmed, because a value pasted with a trailing
     newline would otherwise be sent to Twitch as-is and refused. */
  return {
    ok: true,
    config: {
      clientId: process.env.TWITCH_CLIENT_ID!.trim(),
      redirectUri: process.env.TWITCH_REDIRECT_URI!.trim(),
    },
  };
}

export {
  REQUIRED_TWITCH_OAUTH_ENV,
  TWITCH_OAUTH_CALLBACK_PATH,
  TWITCH_OAUTH_PRODUCTION_ORIGIN,
  TWITCH_OAUTH_LEGACY_ORIGIN,
  TWITCH_OAUTH_LOCAL_ORIGIN,
  twitchOAuthCallbackUrl,
  TWITCH_OAUTH_PRODUCTION_CALLBACK,
  TWITCH_OAUTH_LEGACY_CALLBACK,
  TWITCH_OAUTH_LOCAL_CALLBACK,
  missingTwitchOAuthEnv,
  twitchRedirectUriPathLooksWrong,
} from './oauthConfigContract.mjs';
