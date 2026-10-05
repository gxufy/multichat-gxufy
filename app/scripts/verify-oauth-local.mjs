/* Safe local check of the Twitch OAuth configuration, loading a local .env file.
 *
 * WHAT THIS IS FOR
 *
 * The companion to verify-oauth-config.mjs. That one inspects whatever is already
 * exported in the process environment — a PM2 service, a VPS shell, a CI job.
 * This one first lets Next load the local .env files the same way `next dev` and
 * `next start` do, then runs the identical check against the result. It answers,
 * for the machine a developer actually works on: is every variable the OAuth flow
 * needs present in my local env, and does the redirect URI have the shape Twitch
 * will accept?
 *
 * HOW IT LOADS THE ENVIRONMENT
 *
 * It does not read .env.local itself. It hands the current directory to Next's own
 * loader (`loadEnvConfig` from @next/env), which is the exact code the framework
 * runs at startup — the same file precedence, the same parsing. Letting the
 * runtime do the reading means this script owns no file access of its own and can
 * never diverge from how the app really loads its environment. @next/env is a
 * CommonJS module, so it is imported by its default export and destructured.
 *
 * WHAT IT WILL NOT DO
 *
 *   - It never prints a value from the environment, or from any file it caused to
 *     be loaded. Not truncated, not a length, not a prefix. It prints variable
 *     names and a present/missing verdict, and the *names* of the env files Next
 *     loaded — never their contents.
 *   - It does not talk to Twitch or Supabase, and proves nothing about whether the
 *     credentials are *correct* — only that they are present and shaped plausibly.
 *     A pass here is not "OAuth works"; that is only ever established by a human
 *     completing the flow.
 *
 * The verdict, presentation, and exit code all live in oauthConfigReport.mjs,
 * which reuses the one authoritative contract (lib/server/oauthConfigContract.mjs),
 * so this command and its process-environment companion can never drift apart or
 * restate the required list differently.
 *
 * Exit status: 0 when the contract is satisfied and the redirect path is right;
 * 1 otherwise, so it can gate a deploy step.
 */
import nextEnv from '@next/env';
import { runOAuthConfigReport } from './oauthConfigReport.mjs';

/* @next/env is CommonJS; the named function lives on the default export. */
const { loadEnvConfig } = nextEnv;

/* Load the local env files through Next's own loader. The second argument, dev,
   selects the .env.development.local / .env.local / .env.development / .env
   precedence that `next dev` uses — the set a developer checking their local
   setup means by "my local environment". The loader mutates process.env, which is
   what the report then inspects. */
const { loadedEnvFiles } = loadEnvConfig(process.cwd(), true);

console.log('Loading local environment through the Next.js env loader');
console.log('=========================================================');
if (loadedEnvFiles.length > 0) {
  /* File names only — never their contents. This tells the operator which files
     were actually found, which is the one thing that is easy to get wrong. */
  console.log(`Loaded (names only): ${loadedEnvFiles.map((f) => f.path).join(', ')}`);
} else {
  console.log('No local .env files were found; checking the process environment as-is.');
}
console.log('');

process.exit(runOAuthConfigReport());
