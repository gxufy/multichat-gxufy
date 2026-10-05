/* Safe process-environment check of the Twitch OAuth configuration contract.
 *
 * WHAT THIS IS FOR
 *
 * This inspects the OAuth variables already exported in the process environment —
 * the shape a PM2 service, a VPS shell, or a CI job runs in. It answers one
 * question: is every variable the flow needs present, and does the redirect URI
 * have the shape Twitch will accept? It is a command an operator runs, not a
 * route the app serves — there is deliberately no endpoint that reports which
 * secrets are set, because that is exactly the thing an attacker would probe.
 *
 * It reads process.env only and never touches a file, so it reflects exactly the
 * environment the running service would see. To check the values in a local
 * .env file instead, use the companion command, which lets Next load that file
 * the same way `next dev` and `next start` do:
 *
 *     npm run verify:oauth:local
 *
 * WHAT IT WILL NOT DO
 *
 *   - It never prints a value from the environment. Not truncated, not a length,
 *     not a prefix. It prints variable names and a present/missing verdict.
 *   - It does not talk to Twitch or Supabase, and proves nothing about whether
 *     the credentials are *correct* — only that they are present and shaped
 *     plausibly. A pass here is not "production OAuth works"; that is only ever
 *     established by a human completing the flow.
 *
 * The verdict, presentation, and exit code all live in oauthConfigReport.mjs, and
 * that reuses the one authoritative contract (lib/server/oauthConfigContract.mjs),
 * so neither this command nor its local companion can drift from what the OAuth
 * routes actually require.
 *
 * Exit status: 0 when the contract is satisfied and the redirect path is right;
 * 1 otherwise, so it can gate a deploy step.
 */
import { runOAuthConfigReport } from './oauthConfigReport.mjs';

process.exit(runOAuthConfigReport());
