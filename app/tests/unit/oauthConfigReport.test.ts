/* The two OAuth configuration checks, exercised as the commands an operator runs.
 *
 * `npm run verify:oauth` inspects the process environment as-is (a PM2 / VPS / CI
 * check); `npm run verify:oauth:local` first lets Next's loader read a local .env
 * file and then runs the identical check. Both are driven here through their real
 * `node scripts/*.mjs` invocation rather than by importing the module: they are
 * plain-JS ESM leaves that bare Node runs with no TypeScript loader (which is the
 * point — CI on Node 20 has no loader), and running them as the shipped command is
 * what actually proves the exit code and the printed verdict. A controlled
 * environment is handed to the child, so nothing here depends on the machine's own
 * OAuth variables or on a real .env.local.
 *
 * The overriding safety property is that neither command prints a value — only
 * variable *names* and a present/absent verdict. Every configured value below
 * carries the marker SECRET-VALUE, a string no key name, error code, or URL path
 * legitimately contains, so a value reaching the output is proved by its presence
 * rather than merely assumed absent.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TWITCH_OAUTH_CALLBACK_PATH,
  TWITCH_OAUTH_LEGACY_CALLBACK,
  TWITCH_OAUTH_LOCAL_CALLBACK,
  TWITCH_OAUTH_PRODUCTION_CALLBACK,
} from '@/lib/server/oauthConfig';

/* Distinctive on purpose: each value contains SECRET-VALUE, so a value reaching
   the output is unmistakable rather than something a realistic value could hide.
   The redirect URI is a real callback so the "present and well formed" path is
   the default, and individual tests break exactly the one thing they test. */
const COMPLETE: Record<string, string> = {
  TWITCH_CLIENT_ID: 'SECRET-VALUE-client-id',
  TWITCH_CLIENT_SECRET: 'SECRET-VALUE-client-secret',
  TWITCH_REDIRECT_URI: TWITCH_OAUTH_PRODUCTION_CALLBACK,
  TWITCH_TOKEN_ENCRYPTION_KEY: 'SECRET-VALUE-'.padEnd(64, 'a'),
  SUPABASE_URL: 'https://SECRET-VALUE.supabase.co',
  SUPABASE_SECRET_KEY: 'SECRET-VALUE-service-role',
};
const KEYS = Object.keys(COMPLETE);

/* Vitest runs from the repo root, so that is where the scripts are resolved from
   and the cwd the process-environment check is invoked in. The package.json
   invocation is mirrored exactly: bare `node <script>.mjs`, no extra flags. */
const REPO = process.cwd();
const CONFIG_SCRIPT = join(REPO, 'scripts', 'verify-oauth-config.mjs');
const LOCAL_SCRIPT = join(REPO, 'scripts', 'verify-oauth-local.mjs');
const NODE_ARGS = (script: string) => [script];

/* A base environment with every OAuth variable and NODE_ENV stripped, so a test
   controls the whole contract and the machine's own settings never leak in. Node
   itself still needs PATH and the rest, which is why this clones rather than
   starts empty. */
function baseEnv(): Record<string, string | undefined> {
  /* NODE_ENV is stripped with the rest: left at "test" it would steer Next's
     loader to .env.test precedence, which is not the local setup an operator
     means. Destructured out rather than deleted because it is non-optional on
     the ProcessEnv type — dropping it is exactly why the return type is the
     looser record. */
  const { NODE_ENV, ...env } = process.env;
  void NODE_ENV;
  for (const key of KEYS) delete env[key];
  return env;
}

/** Run a verifier script and capture its exit code and combined output. */
function run(
  script: string,
  env: Record<string, string | undefined>,
  cwd: string,
): { code: number; out: string } {
  try {
    const out = execFileSync('node', NODE_ARGS(script), {
      /* Our record deliberately omits NODE_ENV (see baseEnv); ProcessEnv marks
         it non-optional, so narrow at the boundary where the value is used. */
      env: env as NodeJS.ProcessEnv,
      cwd,
      encoding: 'utf8',
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/* Temp directories created for the local-loader tests, removed after each. */
const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

/** A fresh directory holding a .env.local with the given variables. */
function dirWithEnvLocal(vars: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-verify-'));
  tempDirs.push(dir);
  const body = `${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;
  writeFileSync(join(dir, '.env.local'), body);
  return dir;
}

/* ------------------------------------------------------------------ */
/* verify:oauth — the process-environment check                        */
/* ------------------------------------------------------------------ */

describe('verify:oauth (process environment)', () => {
  it('exits 0 and prints no value when every variable is present', () => {
    const { code, out } = run(CONFIG_SCRIPT, { ...baseEnv(), ...COMPLETE }, REPO);
    expect(code).toBe(0);
    expect(out).not.toContain('SECRET-VALUE');
  });

  it('does not print the MODULE_TYPELESS_PACKAGE_JSON warning', () => {
    /* The scripts are .mjs — unambiguous ESM — so Node never has to guess a
       typeless .js file's module kind and this warning cannot arise. Asserting
       its absence pins that the scripts stay .mjs and no bare .js creeps in. */
    const { out } = run(CONFIG_SCRIPT, { ...baseEnv(), ...COMPLETE }, REPO);
    expect(out).not.toContain('MODULE_TYPELESS_PACKAGE_JSON');
  });

  it.each(KEYS)('exits 1 and names %s MISSING when it is absent', (key) => {
    const env = { ...baseEnv(), ...COMPLETE };
    delete env[key];
    const { code, out } = run(CONFIG_SCRIPT, env, REPO);
    expect(code).toBe(1);
    expect(out).toMatch(new RegExp(`MISSING\\s+${key}`));
    expect(out).not.toContain('SECRET-VALUE');
  });

  it('exits 1 and lists all six when nothing is configured', () => {
    const { code, out } = run(CONFIG_SCRIPT, baseEnv(), REPO);
    expect(code).toBe(1);
    for (const key of KEYS) expect(out).toMatch(new RegExp(`MISSING\\s+${key}`));
  });

  it('exits 1 when the redirect URI has the wrong path, though nothing is missing', () => {
    /* A bare start path pasted in place of the callback: present, so the missing
       check passes, but the path check fails — the most likely mistake after a
       missing variable, and the value is never echoed to say so. */
    const env = {
      ...baseEnv(),
      ...COMPLETE,
      TWITCH_REDIRECT_URI: 'https://SECRET-VALUE.example/api/twitch/oauth/start',
    };
    const { code, out } = run(CONFIG_SCRIPT, env, REPO);
    expect(code).toBe(1);
    expect(out).toContain(TWITCH_OAUTH_CALLBACK_PATH);
    expect(out).not.toContain('SECRET-VALUE');
  });

  it('prints the primary, legacy, and local callback URLs to register on the Twitch application', () => {
    const { out } = run(CONFIG_SCRIPT, { ...baseEnv(), ...COMPLETE }, REPO);
    expect(out).toContain(TWITCH_OAUTH_PRODUCTION_CALLBACK);
    expect(out).toContain(TWITCH_OAUTH_LEGACY_CALLBACK);
    expect(out).toContain(TWITCH_OAUTH_LOCAL_CALLBACK);
  });

  it('says a pass is not proof the OAuth flow works', () => {
    /* Present and plausibly shaped is never "authorized"; only a human completing
       the round trip establishes that, and the command must keep saying so. */
    const { out } = run(CONFIG_SCRIPT, { ...baseEnv(), ...COMPLETE }, REPO);
    expect(out).toMatch(/does NOT confirm|only a human/i);
  });
});

/* ------------------------------------------------------------------ */
/* verify:oauth:local — the Next-loader check                          */
/* ------------------------------------------------------------------ */

describe('verify:oauth:local (Next env loader)', () => {
  it('loads a local .env.local and exits 0 when it satisfies the contract', () => {
    const dir = dirWithEnvLocal(COMPLETE);
    const { code, out } = run(LOCAL_SCRIPT, baseEnv(), dir);
    expect(code).toBe(0);
    expect(out).toContain('Next.js env loader');
  });

  it('reports the loaded file by name only, never its contents', () => {
    /* The one property that separates this from reading the file itself: Next is
       asked to load it, and only the file *name* is echoed. The SECRET-VALUE
       markers filling the file must not appear. */
    const dir = dirWithEnvLocal(COMPLETE);
    const { out } = run(LOCAL_SCRIPT, baseEnv(), dir);
    expect(out).toContain('.env.local');
    expect(out).not.toContain('SECRET-VALUE');
  });

  it('exits 1 and names the absent variable when the local file is incomplete', () => {
    const partial = { ...COMPLETE };
    delete partial.SUPABASE_SECRET_KEY;
    const dir = dirWithEnvLocal(partial);
    const { code, out } = run(LOCAL_SCRIPT, baseEnv(), dir);
    expect(code).toBe(1);
    expect(out).toMatch(/MISSING\s+SUPABASE_SECRET_KEY/);
    expect(out).not.toContain('SECRET-VALUE');
  });

  it('exits 1 when no local file is found, checking the process environment as-is', () => {
    /* An empty directory: nothing to load, and the base environment carries no
       OAuth variables, so the contract is unsatisfied and the command says which
       state it fell back to rather than pretending a file existed. */
    const dir = mkdtempSync(join(tmpdir(), 'oauth-verify-'));
    tempDirs.push(dir);
    const { code, out } = run(LOCAL_SCRIPT, baseEnv(), dir);
    expect(code).toBe(1);
    expect(out).toMatch(/No local .env files were found|checking the process environment/i);
  });
});
