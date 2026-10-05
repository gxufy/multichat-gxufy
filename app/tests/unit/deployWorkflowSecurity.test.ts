import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '..');
const workflowsDirectory = resolve(repositoryRoot, '.github/workflows');
const ci = readFileSync(resolve(workflowsDirectory, 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
const deploy = readFileSync(resolve(workflowsDirectory, 'deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
const scriptMarker = '          script: |\n';
const scriptStart = deploy.indexOf(scriptMarker);
const remoteScript = scriptStart >= 0
  ? deploy.slice(scriptStart + scriptMarker.length)
  : '';

function expectInOrder(source: string, needles: readonly string[]) {
  let previous = -1;
  for (const needle of needles) {
    const current = source.indexOf(needle, previous + 1);
    expect(current, `missing ${needle}`).toBeGreaterThan(-1);
    expect(current, `${needle} is out of order`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe('production deployment workflow security', () => {
  it('runs only after the exact CI workflow completes', () => {
    expect(ci).toMatch(/^name: CI$/m);
    expect(ci).toMatch(/^  push:$/m);
    expect(ci).toMatch(/^  pull_request:$/m);
    expect(deploy).toMatch(
      /^on:\n  workflow_run:\n    workflows:\n      - CI\n    types:\n      - completed$/m,
    );
    expect(deploy).not.toMatch(/^  push:/m);
    expect(deploy).not.toMatch(/^  pull_request:/m);
    expect(deploy).not.toMatch(/^  workflow_dispatch:/m);
  });

  it('puts every trust check on the deploy job before secret-bearing steps', () => {
    const gate = [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      "github.event.workflow_run.head_branch == 'main'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
    ];

    for (const condition of gate) expect(deploy).toContain(condition);
    expectInOrder(deploy, [
      'jobs:\n  deploy:\n    if: >-',
      ...gate,
      '    runs-on: ubuntu-latest',
      '        uses: appleboy/ssh-action@',
      '          host: ${{ secrets.VPS_HOST }}',
    ]);
  });

  it('keeps one serialized production deployment boundary with no token permissions', () => {
    expect(deploy).toMatch(/^permissions: \{\}$/m);
    expect(deploy).toMatch(
      /^concurrency:\n  group: deploy\n  cancel-in-progress: false$/m,
    );
    expect(deploy).toMatch(
      /^    environment:\n      name: production$/m,
    );
    expect(deploy).not.toMatch(/^\s+(contents|actions|deployments|packages):\s+(read|write)$/m);
  });

  it('passes only workflow_run.head_sha through the action environment', () => {
    expect(deploy.match(/github\.event\.workflow_run\.head_sha/g)).toHaveLength(1);
    expect(deploy).toContain('          DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(deploy).toContain('          envs: DEPLOY_SHA');
    expect(remoteScript).not.toContain('${{');
  });

  it('rejects missing, non-hex, or non-40-character deployment SHAs', () => {
    expect(remoteScript).toContain('case "${DEPLOY_SHA:-}" in');
    expect(remoteScript).toContain("''|*[!0-9a-fA-F]*)");
    expect(remoteScript).toContain('if [ "${#DEPLOY_SHA}" -ne 40 ]; then');
    expect(remoteScript.match(/echo "Invalid deployment SHA\."/g)).toHaveLength(2);
  });

  it('skips a stale successful run before changing or building production source', () => {
    expect(remoteScript).toMatch(
      /if \[ "\$ORIGIN_MAIN_SHA" != "\$DEPLOY_SHA" \]; then\n\s+echo "Skipping stale deployment: CI-tested commit is no longer origin\/main\."\n\s+exit 0\n\s+fi/,
    );
    expectInOrder(remoteScript, [
      "git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'",
      'ORIGIN_MAIN_SHA="$(git rev-parse --verify \'refs/remotes/origin/main^{commit}\')"',
      'if [ "$ORIGIN_MAIN_SHA" != "$DEPLOY_SHA" ]; then',
      'exit 0',
      'git reset --hard "$DEPLOY_SHA"',
      'npm ci',
    ]);
  });

  it('places eligible production source at and verifies the exact tested SHA', () => {
    expect(remoteScript).not.toContain('git pull');
    expect(remoteScript).not.toContain('git reset --hard origin/main');
    expectInOrder(remoteScript, [
      'git reset --hard "$DEPLOY_SHA"',
      'CURRENT_SHA="$(git rev-parse --verify \'HEAD^{commit}\')"',
      'if [ "$CURRENT_SHA" != "$DEPLOY_SHA" ]; then',
      'exit 1',
      'npm ci',
      'npm run build',
      'pm2 startOrRestart .github/infra/ecosystem.config.js --update-env',
      'pm2 save',
    ]);
  });

  it('retains the immutable SSH action pin and only the existing VPS secrets', () => {
    expect(deploy.match(/appleboy\/ssh-action@/g)).toHaveLength(1);
    expect(deploy).toContain(
      'appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1.2.5',
    );
    expect(deploy).not.toMatch(/appleboy\/ssh-action@v\d/);
    expect([...deploy.matchAll(/secrets\.(VPS_[A-Z_]+)/g)].map((match) => match[1]).sort())
      .toEqual(['VPS_HOST', 'VPS_SSH_KEY', 'VPS_USER']);
  });

  it('does not consume untrusted workflow artifacts or add another SSH deploy path', () => {
    expect(deploy).not.toMatch(/actions\/(?:download|upload)-artifact/i);
    expect(deploy).not.toMatch(/actions\/checkout/i);

    const sshWorkflows = readdirSync(workflowsDirectory)
      .filter((name) => /\.ya?ml$/i.test(name))
      .filter((name) => readFileSync(resolve(workflowsDirectory, name), 'utf8')
        .includes('appleboy/ssh-action@'));
    expect(sshWorkflows).toEqual(['deploy.yml']);
  });
});
