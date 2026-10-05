/* The shared body of both OAuth configuration checks.
 *
 * There are two entry points — verify-oauth-config.mts, which inspects whatever
 * is already exported in the process environment (a PM2/VPS/CI check), and
 * verify-oauth-local.mts, which first lets Next load a local .env file and then
 * inspects the result. What they print, how they decide pass from fail, and the
 * exit code they choose is one thing, and it lives here so the two can never
 * drift apart or restate the contract differently.
 *
 * This module reuses lib/server/oauthConfigContract.mjs — the one authoritative
 * list of required variables and the inspection helpers, which the OAuth routes
 * read through oauthConfig.ts — rather than naming any variable itself, so it
 * stays in step with what those routes actually read.
 *
 * SAFETY. Like the contract it draws on, this prints variable *names* and a
 * present/absent verdict only. It never reads a value out of the environment —
 * not truncated, not a length, not a prefix — and never touches a file. The
 * callback URLs it prints are public constants, not secrets: they are what the
 * operator registers on the Twitch application.
 *
 * It returns an exit code rather than calling process.exit, so a caller stays in
 * control of when to exit and a test can invoke it without killing the runner.
 * Importing it does nothing; all work happens when runOAuthConfigReport() runs.
 */
import {
  REQUIRED_TWITCH_OAUTH_ENV,
  TWITCH_OAUTH_CALLBACK_PATH,
  TWITCH_OAUTH_LEGACY_CALLBACK,
  TWITCH_OAUTH_LOCAL_CALLBACK,
  TWITCH_OAUTH_PRODUCTION_CALLBACK,
  missingTwitchOAuthEnv,
  twitchRedirectUriPathLooksWrong,
} from '../src/lib/server/oauthConfigContract.mjs';

/**
 * Print the configuration verdict and return the process exit code: 0 when every
 * required variable is present and the redirect path is well formed, 1 otherwise,
 * so either entry script can gate a deploy step on it.
 */
export function runOAuthConfigReport() {
  /* Presence, one line per variable. Deriving the missing set once and testing
     membership keeps this in step with missingTwitchOAuthEnv()'s own rules —
     crucially, that a whitespace-only value counts as absent. */
  const missing = new Set(missingTwitchOAuthEnv());
  const pathLooksWrong = twitchRedirectUriPathLooksWrong();

  console.log('Twitch OAuth configuration check');
  console.log('================================');
  console.log('(variable names and a present/absent verdict only — no values are read out)');
  console.log('');

  for (const key of REQUIRED_TWITCH_OAUTH_ENV) {
    const present = !missing.has(key);
    /* A verdict and the name. Never process.env[key]. */
    console.log(`  ${present ? 'present ' : 'MISSING '} ${key}`);
  }

  console.log('');

  if (pathLooksWrong) {
    /* The value is not printed; only the rule it broke and the fix. */
    console.log(
      `  warning  TWITCH_REDIRECT_URI is set but does not end with ${TWITCH_OAUTH_CALLBACK_PATH}.`,
    );
    console.log(
      '           It must equal the OAuth Redirect URL registered on the Twitch application.',
    );
    console.log('');
  }

  /* The callback URLs are public constants, not secrets — showing them is the
     point: they are what the operator pastes into the Twitch developer console,
     and TWITCH_REDIRECT_URI must equal one of them byte for byte. */
  console.log('Register these as OAuth Redirect URLs on the Twitch application, and set');
  console.log('TWITCH_REDIRECT_URI to the one for the origin this deployment serves:');
  console.log(`  primary  ${TWITCH_OAUTH_PRODUCTION_CALLBACK}`);
  console.log(`  legacy   ${TWITCH_OAUTH_LEGACY_CALLBACK}`);
  console.log(`  local    ${TWITCH_OAUTH_LOCAL_CALLBACK}`);
  console.log('');

  const missingList = REQUIRED_TWITCH_OAUTH_ENV.filter((key) => missing.has(key));

  if (missingList.length === 0 && !pathLooksWrong) {
    console.log('Result: all required variables are present and the redirect path is well formed.');
    console.log('This does NOT confirm the credentials are valid — only a human completing the');
    console.log('OAuth flow can establish that.');
    return 0;
  }

  if (missingList.length > 0) {
    console.log(`Result: ${missingList.length} required variable(s) absent: ${missingList.join(', ')}`);
  }
  if (pathLooksWrong) {
    console.log('Result: TWITCH_REDIRECT_URI has the wrong path (see the warning above).');
  }
  return 1;
}
