# Security policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. Use
GitHub's **[Report a vulnerability](../../security/advisories/new)** (Security →
Advisories) so the report stays confidential until a fix is available.

Include enough detail to reproduce: the affected surface, steps, and impact.
Please do not include real OAuth tokens or secrets in the report.

## Scope

The sensitive parts are Twitch sign-in and supporter payments:

- Twitch sign-in asks for no permissions. The Twitch token is used once to read
  who signed in, then revoked; the site keeps only a signed, HttpOnly session
  cookie with the account's id, name and avatar
  (`app/src/lib/server/session.ts`).
- Payments go through PayPal and Stripe. The server sets every price and grants
  a badge only after PayPal or Stripe confirms the exact amount
  (`app/src/lib/server/supportCheckout.ts`). Payment notices are
  signature-checked, and no card or bank details reach FlossChat.
- `app/src/lib/server/**` is server-only; a test
  (`app/tests/integration/importBoundaries.test.ts`) stops site code from
  importing it.
- Keys come from the server's environment, never from the code.

How data is stored and handled: see the Privacy section of the
[terms](https://flosschat.app/support/terms#privacy).

## Supported versions

This is a single actively-developed application; fixes land on `main`. There is
no separate long-term-support branch.
