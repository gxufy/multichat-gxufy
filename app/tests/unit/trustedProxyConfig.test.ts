import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(process.cwd(), '..');
const ecosystemPath = resolve(repositoryRoot, '.github/infra/ecosystem.config.js');
const caddyfilePath = resolve(repositoryRoot, '.github/infra/Caddyfile');
const deployPath = resolve(repositoryRoot, '.github/workflows/deploy.yml');

describe('trusted Caddy deployment boundary', () => {
  it('keeps Next loopback-only and explicitly enables trusted-Caddy mode', () => {
    const ecosystem = require(ecosystemPath) as {
      apps: Array<{ args: string; env: Record<string, string> }>;
    };
    expect(ecosystem.apps).toHaveLength(1);
    expect(ecosystem.apps[0].args).toBe('start app -p 3000 -H 127.0.0.1');
    expect(ecosystem.apps[0].env.TRUST_CADDY_PROXY).toBe('1');
  });

  it('overwrites the dedicated header from actual remote connection metadata', () => {
    const caddyfile = readFileSync(caddyfilePath, 'utf8');
    expect(caddyfile.match(
      /header_up\s+X-Gxufy-Client-IP\s+\{remote_host\}/g,
    )).toHaveLength(4);
    expect(caddyfile).not.toMatch(/header_up\s+\+X-Gxufy-Client-IP/i);
    expect(caddyfile.match(
      /reverse_proxy(?:\s+@sse)?\s+localhost:3000/g,
    )).toHaveLength(4);
  });

  it('keeps deployment restart ownership in the reviewed PM2 ecosystem file', () => {
    const workflow = readFileSync(deployPath, 'utf8');
    expect(workflow).toContain(
      'pm2 startOrRestart .github/infra/ecosystem.config.js --update-env',
    );
  });
});
