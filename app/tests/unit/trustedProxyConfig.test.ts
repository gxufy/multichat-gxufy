import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(process.cwd(), '..');
const ecosystemPath = resolve(repositoryRoot, '.github/infra/ecosystem.config.js');
const caddyfilePath = resolve(repositoryRoot, '.github/infra/Caddyfile');
const deployPath = resolve(repositoryRoot, '.github/workflows/deploy.yml');
const releasePath = resolve(repositoryRoot, '.github/infra/release.sh');

describe('trusted Caddy deployment boundary', () => {
  it('keeps Next loopback-only and explicitly enables trusted-Caddy mode', () => {
    const ecosystem = require(ecosystemPath) as {
      apps: Array<{ args: string; env: Record<string, string> }>;
    };
    expect(ecosystem.apps).toHaveLength(1);
    expect(ecosystem.apps[0].args).toBe('start app -p 3000 -H 127.0.0.1');
    expect(ecosystem.apps[0].env.TRUST_CADDY_PROXY).toBe('1');
    expect(ecosystem.apps[0].env.GXUFY_SUPPORT_PAGE_ENABLED).toBe('1');
    expect(ecosystem.apps[0].env.PAYPAL_ENV).toBe('live');
    expect(ecosystem.apps[0].env.GXUFY_PAYPAL_LIVE_APPROVED).toBe('1');
  });

  it('overwrites X-Forwarded-For from actual remote connection metadata', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    /* One shared upstream block sets it for every proxy of every site. */
    expect(caddyfile.match(
      /header_up\s+X-Forwarded-For\s+\{client_ip\}/g,
    )).toHaveLength(1);
    expect(caddyfile.match(/import flosschat_upstream/g)).toHaveLength(2);
    expect(caddyfile.match(/^\s*import flosschat_app\s*$/gm)).toHaveLength(3);
    expect(caddyfile).not.toMatch(/header_up\s+X-Forwarded-For\s+\{remote_host\}/);
    expect(caddyfile).not.toMatch(/X-Gxufy-Client-IP/i);
    expect(caddyfile).not.toMatch(/header_up\s+\+X-Forwarded-For/i);
    /* Every proxy knows both release slots. */
    expect(caddyfile.match(
      /reverse_proxy(?:\s+@sse)?\s+localhost:3000 localhost:3001 \{/g,
    )).toHaveLength(2);
    expect(caddyfile.match(/^\s*reverse_proxy\b/gm)).toHaveLength(2);
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
      '{ GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: overlayUsageWebhook }',
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
      '{ GXUFY_ABUSE_DISCORD_WEBHOOK_URL: abuseWebhook }',
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
      '{ KICK_TYPESENSE_SEARCH_KEY: kickTypesenseSearchKey }',
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
    expect(readFileSync(releasePath, 'utf8')).toContain('console.log(`VPS_LAUNCH_${key}=${present ? "SET" : "MISSING"}`);');
  });

  it('are passed to the app only when set, and cannot change the PayPal mode', () => {
    const before = { ...process.env };
    try {
      for (const key of KEYS) delete process.env[key];
      process.env.PAYPAL_CLIENT_ID = 'sandbox-id';
      process.env.GXUFY_SUPPORT_PAGE_ENABLED = '0';
      process.env.GXUFY_PAYPAL_LIVE_APPROVED = '0';
      process.env.PAYPAL_ENV = 'sandbox';
      delete require.cache[require.resolve(ecosystemPath)];
      const ecosystem = require(ecosystemPath) as {
        apps: Array<{ env: Record<string, string> }>;
        __LAUNCH_KEYS: string[];
      };
      const env = ecosystem.apps[0]!.env;
      expect(ecosystem.__LAUNCH_KEYS).toEqual(KEYS);
      expect(env.PAYPAL_CLIENT_ID).toBe('sandbox-id');
      expect(env).not.toHaveProperty('PAYPAL_CLIENT_SECRET');
      expect(env.GXUFY_SUPPORT_PAGE_ENABLED).toBe('1');
      expect(env.PAYPAL_ENV).toBe('live');
      expect(env.GXUFY_PAYPAL_LIVE_APPROVED).toBe('1');
    } finally {
      process.env = before;
      delete require.cache[require.resolve(ecosystemPath)];
    }
  });
});

describe('Cloudflare in front of Caddy', () => {
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

describe('two release slots', () => {
  const load = (env: Record<string, string | undefined>) => {
    const before = { ...process.env };
    try {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      delete require.cache[require.resolve(ecosystemPath)];
      return require(ecosystemPath) as {
        apps: Array<{ name: string; args: string; env: Record<string, string>; kill_timeout: number }>;
      };
    } finally {
      process.env = before;
      delete require.cache[require.resolve(ecosystemPath)];
    }
  };

  it('runs slot A on 3000 and slot B on 3001, loopback only, with its handover files', () => {
    const b = load({ FLOSSCHAT_SLOT: 'b', FLOSSCHAT_DRAIN_FILE: '/srv/b.draining', FLOSSCHAT_HOLD_FILE: '/srv/b.hold' }).apps[0]!;
    expect(b.name).toBe('flosschat-b');
    expect(b.args).toBe('start app -p 3001 -H 127.0.0.1');
    expect(b.env.FLOSSCHAT_DRAIN_FILE).toBe('/srv/b.draining');
    expect(b.env.FLOSSCHAT_HOLD_FILE).toBe('/srv/b.hold');
    expect(b.env.TRUST_CADDY_PROXY).toBe('1');
    expect(b.kill_timeout).toBeGreaterThanOrEqual(10000);
    const a = load({ FLOSSCHAT_SLOT: 'a' }).apps[0]!;
    expect(a.name).toBe('flosschat-a');
    expect(a.args).toBe('start app -p 3000 -H 127.0.0.1');
  });

  it('keeps the original single app when no slot is given, and refuses unknown slots', () => {
    const legacy = load({ FLOSSCHAT_SLOT: undefined, FLOSSCHAT_DRAIN_FILE: '/srv/x' }).apps[0]!;
    expect(legacy.name).toBe('multichat');
    expect(legacy.env).not.toHaveProperty('FLOSSCHAT_DRAIN_FILE');
    expect(() => load({ FLOSSCHAT_SLOT: 'c' })).toThrow(/FLOSSCHAT_SLOT/);
  });

  it('sends visitors only to a healthy slot and waits through a swap instead of failing', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    for (const line of [
      'lb_policy first',
      'lb_try_duration 10s',
      'health_uri /api/runtime/health',
      'health_interval 1s',
      'health_status 200',
    ]) expect(caddyfile).toContain(line);
    expect(caddyfile).toContain('exclude http.handlers.reverse_proxy.health_checker.active');
  });
});
