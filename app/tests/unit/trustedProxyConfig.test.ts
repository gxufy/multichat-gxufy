import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(process.cwd(), '..');
const ecosystemPath = resolve(repositoryRoot, '.github/infra/ecosystem.config.js');
const caddyfilePath = resolve(repositoryRoot, '.github/infra/Caddyfile');
const deployPath = resolve(repositoryRoot, '.github/workflows/deploy.yml');
const releasePath = resolve(repositoryRoot, '.github/infra/release.sh');
/* The server setup files live on the server and in the owner's local,
   git-ignored .github/infra folder, not in the public repository: their checks
   run where that copy exists (the deploy workflow's checks always run). */
const hasServerFiles = [ecosystemPath, caddyfilePath, releasePath].every((path) => existsSync(path));

type EcosystemApp = {
  name: string;
  cwd: string;
  script: string;
  args?: string;
  env: Record<string, string>;
  kill_timeout: number;
  max_memory_restart: string;
};
type Ecosystem = { apps: EcosystemApp[]; __WEB_SLOT_PORTS: Record<string, number>; __WEB_LAUNCH_KEYS: string[] };

/* Loads the pm2 file with these environment values, as pm2 would. */
function loadEcosystem(env: Record<string, string | undefined>): Ecosystem {
  const before = { ...process.env };
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve(ecosystemPath)];
    return require(ecosystemPath) as Ecosystem;
  } finally {
    process.env = before;
    delete require.cache[require.resolve(ecosystemPath)];
  }
}

describe.skipIf(!hasServerFiles)('trusted Caddy deployment boundary', () => {
  it('keeps the app loopback-only, with its live switches set in the reviewed file', () => {
    const { apps } = loadEcosystem({ FLOSSCHAT_SLOT: 'a' });
    expect(apps).toHaveLength(1);
    const [app] = apps;
    expect(app!.env.HOST).toBe('127.0.0.1');
    expect(app!.env.GXUFY_SUPPORT_PAGE_ENABLED).toBe('1');
    expect(app!.env.PAYPAL_ENV).toBe('live');
    expect(app!.env.GXUFY_PAYPAL_LIVE_APPROVED).toBe('1');
    expect(app!.env.STRIPE_ENV).toBe('live');
    expect(app!.env.GXUFY_STRIPE_LIVE_APPROVED).toBe('1');
    /* JilTV paints are on; JilTV emotes have no switch here at all. */
    expect(app!.env.GXUFY_JILTV_COSMETICS_ENABLED).toBe('1');
    expect(Object.keys(app!.env).filter((key) => /JILTV/.test(key))).toEqual(['GXUFY_JILTV_COSMETICS_ENABLED']);
    /* Only the site's app: the Next.js app is not started any more. */
    const file = readFileSync(ecosystemPath, 'utf8');
    expect(file).not.toMatch(/node_modules\/next|next start|start app/);
  });

  it('overwrites X-Forwarded-For from actual remote connection metadata', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    /* The one upstream block sets it for the one proxy every site uses. */
    expect(caddyfile.match(
      /header_up\s+X-Forwarded-For\s+\{client_ip\}/g,
    )).toHaveLength(1);
    expect(caddyfile).not.toMatch(/import flosschat_upstream\b/);
    expect(caddyfile.match(/import flosschat_web_upstream\b/g)).toHaveLength(1);
    expect(caddyfile.match(/^\s*import flosschat_app\s*$/gm)).toHaveLength(3);
    expect(caddyfile).not.toMatch(/header_up\s+X-Forwarded-For\s+\{remote_host\}/);
    expect(caddyfile).not.toMatch(/X-Gxufy-Client-IP/i);
    expect(caddyfile).not.toMatch(/header_up\s+\+X-Forwarded-For/i);
    /* The proxy knows both release slots of the app, and nothing else. */
    expect(caddyfile.match(
      /reverse_proxy\s+localhost:3100 localhost:3101 \{/g,
    )).toHaveLength(1);
    expect(caddyfile.match(/^\s*reverse_proxy\b/gm)).toHaveLength(1);
    expect(caddyfile).not.toMatch(/localhost:300[01]/);
  });

  it('keeps deployment restart ownership in the reviewed PM2 ecosystem file', () => {
    const release = readFileSync(releasePath, 'utf8');
    expect(release).toContain(
      'pm2 start .github/infra/ecosystem.config.js --update-env',
    );
  });

  it('persists the inherited server-only Discord webhook in PM2 without embedding it', () => {
    const ecosystem = readFileSync(ecosystemPath, 'utf8');
    expect(ecosystem).toContain(
      'process.env.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL',
    );
    expect(ecosystem).toContain(
      'if (overlayUsageWebhook) webSettings.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL = overlayUsageWebhook;',
    );
    expect(ecosystem).not.toMatch(/discord(?:app)?\.com\/api\/webhooks\//i);

    const release = readFileSync(releasePath, 'utf8');
    expect(release).toContain(
      'pm2 start .github/infra/ecosystem.config.js --update-env',
    );
    expect(release).toContain('pm2 save');
  });

  it('persists the inherited server-only abuse webhook in PM2 without embedding it', () => {
    const ecosystem =
      readFileSync(
        ecosystemPath,
        'utf8',
      );

    expect(ecosystem).toContain(
      'process.env.GXUFY_ABUSE_DISCORD_WEBHOOK_URL',
    );

    expect(ecosystem).toContain(
      'if (abuseWebhook) webSettings.GXUFY_ABUSE_DISCORD_WEBHOOK_URL = abuseWebhook;',
    );

    expect(ecosystem).not.toMatch(
      /discord(?:app)?\.com\/api\/webhooks\//i,
    );

    const workflow =
      readFileSync(
        deployPath,
        'utf8',
      );

    expect(workflow).toContain(
      'GXUFY_ABUSE_DISCORD_WEBHOOK_URL: ${{ secrets.GXUFY_ABUSE_DISCORD_WEBHOOK_URL }}',
    );

    expect(readFileSync(releasePath, 'utf8')).toContain(
      'pm2 start .github/infra/ecosystem.config.js --update-env',
    );
  });

  it('persists the inherited server-only Kick search key in PM2 without embedding it', () => {
    const ecosystem = readFileSync(ecosystemPath, 'utf8');
    expect(ecosystem).toContain(
      'process.env.KICK_TYPESENSE_SEARCH_KEY',
    );
    expect(ecosystem).toContain(
      'if (kickTypesenseSearchKey) webSettings.KICK_TYPESENSE_SEARCH_KEY = kickTypesenseSearchKey;',
    );

    const workflow = readFileSync(deployPath, 'utf8');
    expect(workflow).toContain(
      'KICK_TYPESENSE_SEARCH_KEY: ${{ secrets.KICK_TYPESENSE_SEARCH_KEY }}',
    );
    expect(workflow).toContain(
      'envs: DEPLOY_SHA,GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL,GXUFY_ABUSE_DISCORD_WEBHOOK_URL,KICK_TYPESENSE_SEARCH_KEY',
    );
  });
});

describe('launch settings', () => {
  const KEYS = [
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'FLOSSCHAT_SESSION_SECRET',
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'PAYPAL_WEBHOOK_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'GXUFY_SUPPORTER_STORE_PATH',
    'GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL',
  ];

  it('come from GitHub production secrets through the deploy step, by name', () => {
    const workflow = readFileSync(deployPath, 'utf8');
    for (const key of KEYS) {
      expect(workflow).toContain(`          ${key}: \${{ secrets.${key} }}`);
    }
    expect(workflow).toContain(
      `envs: DEPLOY_SHA,GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL,GXUFY_ABUSE_DISCORD_WEBHOOK_URL,KICK_TYPESENSE_SEARCH_KEY,${KEYS.join(',')}`,
    );
    if (hasServerFiles) expect(readFileSync(releasePath, 'utf8')).toContain('console.log(`VPS_LAUNCH_${key}=${present ? "SET" : "MISSING"}`);');
  });

  it.skipIf(!hasServerFiles)('are passed to the app only when set, and cannot change the PayPal or Stripe mode', () => {
    const ecosystem = loadEcosystem({
      ...Object.fromEntries(KEYS.map((key) => [key, undefined])),
      FLOSSCHAT_SLOT: 'a',
      PAYPAL_CLIENT_ID: 'sandbox-id',
      GXUFY_SUPPORT_PAGE_ENABLED: '0',
      GXUFY_PAYPAL_LIVE_APPROVED: '0',
      PAYPAL_ENV: 'sandbox',
      STRIPE_ENV: 'sandbox',
      GXUFY_STRIPE_LIVE_APPROVED: '0',
    });
    const env = ecosystem.apps[0]!.env;
    expect(ecosystem.__WEB_LAUNCH_KEYS).toEqual(KEYS);
    expect(env.PAYPAL_CLIENT_ID).toBe('sandbox-id');
    expect(env).not.toHaveProperty('PAYPAL_CLIENT_SECRET');
    expect(env.GXUFY_SUPPORT_PAGE_ENABLED).toBe('1');
    expect(env.PAYPAL_ENV).toBe('live');
    expect(env.GXUFY_PAYPAL_LIVE_APPROVED).toBe('1');
    expect(env).not.toHaveProperty('STRIPE_SECRET_KEY');
    expect(env.STRIPE_ENV).toBe('live');
    expect(env.GXUFY_STRIPE_LIVE_APPROVED).toBe('1');
  });
});

describe.skipIf(!hasServerFiles)('Cloudflare in front of Caddy', () => {
  it('lets only Cloudflare\'s published ranges name the visitor address', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    expect(caddyfile).toMatch(/^\s*client_ip_headers CF-Connecting-IP\s*$/m);
    const line = caddyfile.split(/\r?\n/).find((l) => l.trim().startsWith('trusted_proxies static'));
    expect(line).toBeDefined();
    const ranges = line!.trim().split(/\s+/).slice(2);
    expect(ranges).toEqual(expect.arrayContaining(['173.245.48.0/20', '104.16.0.0/13', '172.64.0.0/13', '2606:4700::/32']));
    expect(ranges).toHaveLength(22);
    /* Never trust everyone (that would let anyone forge their address). */
    expect(ranges).not.toContain('0.0.0.0/0');
    expect(ranges).not.toContain('::/0');
    expect(ranges.join(' ')).not.toMatch(/private_ranges/);
    expect(caddyfile).not.toMatch(/X-Forwarded-For\s+\{http\.request\.header\./);
  });
});

describe.skipIf(!hasServerFiles)('two release slots', () => {
  const load = loadEcosystem;

  it('runs the app alone in each slot, with its handover files', () => {
    const b = load({ FLOSSCHAT_SLOT: 'b', FLOSSCHAT_DRAIN_FILE: '/srv/b.draining', FLOSSCHAT_HOLD_FILE: '/srv/b.hold' }).apps;
    expect(b.map((app) => app.name)).toEqual(['flosschat-web-b']);
    expect(b[0]!.env.FLOSSCHAT_DRAIN_FILE).toBe('/srv/b.draining');
    expect(b[0]!.env.FLOSSCHAT_HOLD_FILE).toBe('/srv/b.hold');
    expect(b[0]!.kill_timeout).toBeGreaterThanOrEqual(10000);
    expect(load({ FLOSSCHAT_SLOT: 'a' }).apps.map((app) => app.name)).toEqual(['flosschat-web-a']);
  });

  it('starts nothing without a slot, and refuses unknown slots (release.sh always names one)', () => {
    expect(() => load({ FLOSSCHAT_SLOT: undefined, FLOSSCHAT_DRAIN_FILE: '/srv/x' })).toThrow(/FLOSSCHAT_SLOT/);
    expect(() => load({ FLOSSCHAT_SLOT: 'c' })).toThrow(/FLOSSCHAT_SLOT/);
  });

  it('sends visitors only to a healthy slot and waits through a swap instead of failing', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    for (const line of [
      'lb_policy first',
      'lb_try_duration 10s',
      'health_uri /healthz',
      'health_interval 1s',
      'health_status 200',
    ]) expect(caddyfile).toContain(line);
    expect(caddyfile).toContain('exclude http.handlers.reverse_proxy.health_checker.active');
  });
});

describe.skipIf(!hasServerFiles)('the SvelteKit app in each slot', () => {
  const load = loadEcosystem;

  it('runs web A on 3100 and web B on 3101, loopback only, sharing its slot\'s handover files', () => {
    expect(load({ FLOSSCHAT_SLOT: 'a' }).__WEB_SLOT_PORTS).toEqual({ a: 3100, b: 3101 });
    const apps = load({ FLOSSCHAT_SLOT: 'b', FLOSSCHAT_DRAIN_FILE: '/srv/b.draining', FLOSSCHAT_HOLD_FILE: '/srv/b.hold' }).apps;
    expect(apps.map((app) => app.name)).toEqual(['flosschat-web-b']);
    const web = apps[0]!;
    expect(web.cwd).toBe(resolve(repositoryRoot, 'web'));
    expect(web.script).toBe('build/index.js');
    expect(web.env.HOST).toBe('127.0.0.1');
    expect(web.env.PORT).toBe('3101');
    expect(web.env.FLOSSCHAT_DRAIN_FILE).toBe('/srv/b.draining');
    expect(web.env.FLOSSCHAT_HOLD_FILE).toBe('/srv/b.hold');
    expect(web.env.GXUFY_SUPPORT_PAGE_ENABLED).toBe('1');
    /* The JilTV paint lookup is answered here too; still no emote switch. */
    expect(web.env.GXUFY_JILTV_COSMETICS_ENABLED).toBe('1');
    expect(Object.keys(web.env).filter((key) => /JILTV/.test(key))).toEqual(['GXUFY_JILTV_COSMETICS_ENABLED']);
    expect(web.env.NODE_ENV).toBe('production');
    expect(web.kill_timeout).toBeGreaterThanOrEqual(10000);
    /* Open connections are closed well before pm2 would kill the app. */
    expect(web.env.SHUTDOWN_TIMEOUT).toBe('3');
    expect(Number(web.env.SHUTDOWN_TIMEOUT) * 1000).toBeLessThan(web.kill_timeout / 2);
    /* Room for the API routes and the overlay streams. */
    expect(web.max_memory_restart).toBe('900M');
    /* Caddy's upstream block overwrites X-Forwarded-For with the client. */
    expect(web.env.ADDRESS_HEADER).toBe('x-forwarded-for');
    expect(web.env.XFF_DEPTH).toBe('1');
    /* Without launch settings the new app gets none. */
    for (const key of ['TWITCH_CLIENT_SECRET', 'PAYPAL_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'FLOSSCHAT_SESSION_SECRET', 'GXUFY_SUPPORTER_STORE_PATH']) {
      expect(web.env).not.toHaveProperty(key);
    }
    expect(load({ FLOSSCHAT_SLOT: 'a' }).apps[0]!.env.PORT).toBe('3100');
  });

  it('gives the app every key its routes read, and the background jobs', () => {
    const all = {
      TWITCH_CLIENT_ID: 'client-id', TWITCH_CLIENT_SECRET: 'client-secret', FLOSSCHAT_SESSION_SECRET: 'session',
      PAYPAL_CLIENT_ID: 'pp-id', PAYPAL_CLIENT_SECRET: 'pp-secret', PAYPAL_WEBHOOK_ID: 'pp-hook',
      STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'whsec', GXUFY_SUPPORTER_STORE_PATH: '/srv/data/supporters.db',
      GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL: 'supporter-hook', GXUFY_ABUSE_DISCORD_WEBHOOK_URL: 'abuse-hook',
      GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: 'usage-hook', KICK_TYPESENSE_SEARCH_KEY: 'kick-key',
    };
    /* What the deploy step sends can never change the PayPal or Stripe mode. */
    const config = load({ FLOSSCHAT_SLOT: 'a', ...all, PAYPAL_ENV: 'sandbox', STRIPE_ENV: 'sandbox', GXUFY_PAYPAL_LIVE_APPROVED: '0' });
    const [web] = config.apps;
    expect(config.__WEB_LAUNCH_KEYS).toEqual([
      'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'FLOSSCHAT_SESSION_SECRET',
      'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'GXUFY_SUPPORTER_STORE_PATH', 'GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL',
    ]);
    expect(web!.env).toMatchObject({
      TWITCH_CLIENT_ID: 'client-id',
      TWITCH_CLIENT_SECRET: 'client-secret',
      /* Sign-in. */
      FLOSSCHAT_SESSION_SECRET: 'session',
      /* Payments: the keys, and the live switches from the reviewed file. */
      PAYPAL_CLIENT_ID: 'pp-id',
      PAYPAL_CLIENT_SECRET: 'pp-secret',
      PAYPAL_WEBHOOK_ID: 'pp-hook',
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_WEBHOOK_SECRET: 'whsec',
      GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL: 'supporter-hook',
      PAYPAL_ENV: 'live',
      GXUFY_PAYPAL_LIVE_APPROVED: '1',
      STRIPE_ENV: 'live',
      GXUFY_STRIPE_LIVE_APPROVED: '1',
      /* Only the routes' own limits (1 MB unless a route says otherwise). */
      BODY_SIZE_LIMIT: 'Infinity',
      GXUFY_SUPPORTER_STORE_PATH: '/srv/data/supporters.db',
      GXUFY_ABUSE_DISCORD_WEBHOOK_URL: 'abuse-hook',
      KICK_TYPESENSE_SEARCH_KEY: 'kick-key',
      /* The overlay usage reports. */
      GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: 'usage-hook',
    });
    /* The background jobs run here: the daily database copies and the
       PayPal check are never switched off. */
    expect(web!.env).not.toHaveProperty('GXUFY_SUPPORTER_STORE_BACKUPS');
    expect(web!.env).not.toHaveProperty('GXUFY_PAYPAL_RECHECK');
    expect(web!.env).not.toHaveProperty('TRUST_CADDY_PROXY');
    /* Every launch key the deploy step sends reaches the app. */
    for (const key of config.__WEB_LAUNCH_KEYS) expect(web!.env[key], key).toBe(all[key as keyof typeof all]);
  });

  it('sends every request to the app, and health-checks it', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    /* No page groups any more: the app answers every path. */
    expect(caddyfile).not.toContain('flosschat-pages.caddy');
    expect(caddyfile).not.toContain('@flosschat_web');
    const app = caddyfile.slice(caddyfile.indexOf('(flosschat_app) {'));
    expect(app.slice(0, app.indexOf('\n}'))).toMatch(/^\s*reverse_proxy localhost:3100 localhost:3101 \{\s*import flosschat_web_upstream\s*\}/m);
    const upstream = caddyfile.slice(caddyfile.indexOf('(flosschat_web_upstream) {'));
    for (const line of ['lb_policy first', 'lb_try_duration 10s', 'health_uri /healthz', 'health_interval 1s', 'health_status 200']) {
      expect(upstream.slice(0, upstream.indexOf('}'))).toContain(line);
    }
  });
});
