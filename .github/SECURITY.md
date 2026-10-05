# Security policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. Use
GitHub's **[Report a vulnerability](../../security/advisories/new)** (Security →
Advisories) so the report stays confidential until a fix is available.

Include enough detail to reproduce: the affected surface, steps, and impact.
Please do not include real OAuth tokens or secrets in the report.

## Scope

The sensitive surface is the optional Twitch OAuth / pinned-message feature:

- Tokens are encrypted at rest with AES-256-GCM
  (`src/lib/server/twitchTokenCrypto.ts`) and never sent to the browser.
- `src/lib/server/**` is server-only; a static test
  (`tests/integration/importBoundaries.test.ts`) prevents client code from
  importing it.
- Secrets are read from the environment at call time, never hard-coded.

See [docs/PRIVACY.md](../docs/PRIVACY.md) for how data is stored and handled.

## Supported versions

This is a single actively-developed application; fixes land on `main`. There is
no separate long-term-support branch.
