import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '..');
const workflowsDirectory = resolve(repositoryRoot, '.github/workflows');
const ci = readFileSync(resolve(workflowsDirectory, 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
const deploy = readFileSync(resolve(workflowsDirectory, 'deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8').replace(/\r\n/g, '\n');
const release = readFileSync(resolve(repositoryRoot, '.github/infra/release.sh'), 'utf8').replace(/\r\n/g, '\n');
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

  it('passes only the trusted SHA and required server-only secrets through the action environment', () => {
    expect(deploy.match(/github\.event\.workflow_run\.head_sha/g)).toHaveLength(1);
    expect(deploy).toContain('          DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(deploy).toContain(
      '          GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: ${{ secrets.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL }}',
    );
    expect(deploy).toContain(
      '          GXUFY_ABUSE_DISCORD_WEBHOOK_URL: ${{ secrets.GXUFY_ABUSE_DISCORD_WEBHOOK_URL }}',
    );
    expect(deploy).toContain(
      '          KICK_TYPESENSE_SEARCH_KEY: ${{ secrets.KICK_TYPESENSE_SEARCH_KEY }}',
    );
    expect(deploy).toContain(
      '          envs: DEPLOY_SHA,GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL,GXUFY_ABUSE_DISCORD_WEBHOOK_URL,KICK_TYPESENSE_SEARCH_KEY',
    );
    expect(remoteScript).not.toContain('${{');
  });

  it('fails closed before source/build/restart when any required server secret is missing', () => {
    expectInOrder(remoteScript, [
      'if [ -z "${GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL:-}" ]; then',
      'echo "Missing Discord overlay-usage webhook configuration."',
      'exit 1',
      'if [ -z "${GXUFY_ABUSE_DISCORD_WEBHOOK_URL:-}" ]; then',
      'echo "Missing Discord abuse webhook configuration."',
      'exit 1',
      'if [ -z "${KICK_TYPESENSE_SEARCH_KEY:-}" ]; then',
      'echo "Missing Kick Typesense search configuration."',
      'exit 1',
      'case "${DEPLOY_SHA:-}" in',
      'git archive --format=tar "$DEPLOY_SHA"',
      'bash "$RELEASE_DIR/.github/infra/release.sh" deploy "$DEPLOY_SHA"',
    ]);
    /* The release script refuses to run without the live supporter database
       location, before building or starting anything. */
    expectInOrder(release, [
      'deploy() {',
      'GXUFY_SUPPORTER_STORE_PATH must be set to the live database (absolute path).',
      'npm ci',
      'pm2 start .github/infra/ecosystem.config.js --update-env',
    ]);
  });

  it('reports only secret presence and fails if PM2 drops a required runtime secret', () => {
    expect(remoteScript).toContain('VPS_DEPLOYED_SHA=$PREVIOUS_DEPLOYED_SHA');
    expect(remoteScript).toContain('VPS_WEBHOOK_ENV=${typeof value === "string" && value.length > 0 ? "SET" : "MISSING"}');
    expect(release).toContain('["VPS_ABUSE_WEBHOOK_ENV", "GXUFY_ABUSE_DISCORD_WEBHOOK_URL"]');
    expect(release).toContain('["VPS_KICK_ENV", "KICK_TYPESENSE_SEARCH_KEY"]');
    expect(release).toContain('if (!present) process.exitCode = 1;');
    expect(release).toContain('if (!present && key === "GXUFY_SUPPORTER_STORE_PATH") process.exitCode = 1;');
    for (const script of [remoteScript, release]) {
      expect(script).not.toContain('console.log(value)');
      expect(script).not.toContain('console.log(app?.pm2_env)');
      expect(script).not.toMatch(/console\.log\(`\$\{key\}=\$\{value/);
    }
    /* Switch-back copies the live settings to the restarted version through a
       private file of name/value pairs, deleted right after; never printed. */
    expectInOrder(release, [
      'umask 077',
      'process.stdout.write(`${key}\\0${value}\\0`);',
      'export "$key=$value"',
      'rm -f "$envfile"',
    ]);
    /* .env.local is linked, never read. */
    expect(release).toContain('ln -sfn "$LEGACY_DIR/.env.local" "$dir/.env.local"');
    expect(release).not.toMatch(/(cat|source|\.) [^\n]*\.env\.local/);
    expect(remoteScript).toContain("echo 'VPS_TELEMETRY_STATE=unconfigured'");
    expect(remoteScript).toContain("echo 'VPS_TELEMETRY_STATE=failed'");
    expect(remoteScript).toContain('unset PM2_TELEMETRY_LOGS');
    expect(remoteScript).not.toContain('console.log(value)');
    expect(remoteScript).not.toContain('console.log(app?.pm2_env)');
    expect(remoteScript).not.toContain('echo "$PM2_TELEMETRY_LOGS"');
  });

  it('documents the server-only production key without embedding a webhook', () => {
    expect(envExample).toMatch(/^GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL=$/m);
    expect(envExample).toMatch(/^GXUFY_ABUSE_DISCORD_WEBHOOK_URL=$/m);
    expect(envExample).not.toMatch(/discord(?:app)?\.com\/api\/webhooks\//i);
    expect(envExample).not.toContain('NEXT_PUBLIC_GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL');
    expect(envExample).not.toContain('NEXT_PUBLIC_GXUFY_ABUSE_DISCORD_WEBHOOK_URL');
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
      'git archive --format=tar "$DEPLOY_SHA"',
      'bash "$RELEASE_DIR/.github/infra/release.sh" deploy "$DEPLOY_SHA"',
    ]);
  });

  it('deploys and verifies the reviewed Caddyfile before starting the new version', () => {
    expectInOrder(release, [
      'npm run build',
      'sync_caddy "$dir" "$sha"',
      'start_slot "$new_slot" "$dir" "$sha"',
    ]);
    expectInOrder(release, [
      'CADDY_TARGET="${FLOSSCHAT_CADDY_TARGET:-/etc/caddy/Caddyfile}"',
      'local CADDY_SOURCE="$1/.github/infra/Caddyfile"',
      'CADDY_BACKUP="$(dirname "$CADDY_TARGET")/.Caddyfile.gxufy-${2}.$$.before"',
      'sudo -n caddy validate --config "$CADDY_SOURCE"',
      'sudo -n install -o root -g root -m 600 "$CADDY_TARGET" "$CADDY_BACKUP"',
      'restore_caddy() {',
      'if ! sudo -n install -o root -g root -m 644 "$CADDY_SOURCE" "$CADDY_TARGET"; then',
      'if ! sudo -n caddy validate --config "$CADDY_TARGET"; then',
      'if ! sudo -n systemctl reload caddy; then',
      'if ! sudo -n systemctl is-active --quiet caddy; then',
      'if ! sudo -n cmp -s "$CADDY_SOURCE" "$CADDY_TARGET"; then',
      'say "VPS_CADDY_CONFIG=SYNCED"',
      'if sudo -n rm -f "$CADDY_BACKUP"; then',
    ]);
    expect(release).not.toContain('CADDY_BACKUP="/tmp/');
    for (const line of [
      'Caddy restore install failed; backup retained at $CADDY_BACKUP.',
      'Restored Caddy configuration failed validation; backup retained at $CADDY_BACKUP.',
      'Caddy reload failed during restore; backup retained at $CADDY_BACKUP.',
      'Caddy is not active after restore; backup retained at $CADDY_BACKUP.',
      'const supportPage =',
      'supportPage === "1";',
      'VPS_SUPPORT_PAGE=${supportEnabled ? "ENABLED" : "UNEXPECTED"}',
      'if (!supportEnabled) process.exitCode = 1;',
      'VPS_PAYPAL=${paypalLive ? "LIVE" : "UNEXPECTED"}',
      'if (!paypalLive) process.exitCode = 1;',
    ]) expect(release).toContain(line);
  });

  it('checks the new version before it gets any visitors, and keeps the live one if anything fails', () => {
    expectInOrder(release, [
      'trap on_failure EXIT',
      'start_slot "$new_slot" "$dir" "$sha"',
      'wait_for_health "$new_slot" "held ok"',
      'verify_runtime_env "$(slot_app "$new_slot")"',
      'hand_over "$new_slot" "$ACTIVE_SLOT"',
      'HANDED_OVER=1',
      'write_state "$ACTIVE_FILE" "$new_slot" "$sha"',
      'pm2 save',
    ]);
    /* A new slot starts held (out of Caddy's rotation) and is released only
       after it is checked; the old slot drains before it stops. */
    expectInOrder(release, [
      'start_slot() {',
      ': > "$SIGNALS/$slot.hold"',
      'hand_over() {',
      'rm -f "$SIGNALS/$new.hold"',
      ': > "$SIGNALS/$old.draining"',
      'sleep "$DRAIN_SECONDS"',
    ]);
    expectInOrder(release, [
      'on_failure() {',
      'rm -f "$SIGNALS/$DRAINING_SLOT.draining"',
      'pm2 delete "$(slot_app "$STARTED_SLOT")"',
    ]);
    expect(release).toContain('flock -n 9');
  });

  it('places eligible production source at and verifies the exact tested SHA', () => {
    expect(remoteScript).not.toContain('git pull');
    expect(remoteScript).not.toContain('git reset --hard origin/main');
    /* The live folder is never reset or rebuilt in place: each version is
       exported from the exact tested commit into its own folder. */
    expect(remoteScript).not.toContain('git reset --hard');
    expect(release).not.toContain('git reset');
    expectInOrder(remoteScript, [
      'CURRENT_SHA="$(git rev-parse --verify "${DEPLOY_SHA}^{commit}")"',
      'if [ "$CURRENT_SHA" != "$DEPLOY_SHA" ]; then',
      'exit 1',
      'git archive --format=tar "$DEPLOY_SHA" | tar -x -C "$RELEASE_DIR.partial"',
      'mv "$RELEASE_DIR.partial" "$RELEASE_DIR"',
      'bash "$RELEASE_DIR/.github/infra/release.sh" deploy "$DEPLOY_SHA"',
    ]);
    expectInOrder(release, [
      'deploy() {',
      "case \"$sha\" in ''|*[!0-9a-fA-F]*) die \"Invalid release SHA.\" ;; esac",
      '[ "${#sha}" -eq 40 ] || die "Invalid release SHA."',
      '(cd "$dir" && npm ci && npm run build)',
      'pm2 start .github/infra/ecosystem.config.js --update-env',
      'pm2 save',
    ]);
  });

  it('retains the immutable SSH action pin and only the reviewed production secrets', () => {
    expect(deploy.match(/appleboy\/ssh-action@/g)).toHaveLength(1);
    expect(deploy).toContain(
      'appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1.2.5',
    );
    expect(deploy).not.toMatch(/appleboy\/ssh-action@v\d/);
    expect([...deploy.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]).sort())
      .toEqual([
        'FLOSSCHAT_SESSION_SECRET',
        'GXUFY_ABUSE_DISCORD_WEBHOOK_URL',
        'GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL',
        'GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL',
        'GXUFY_SUPPORTER_STORE_PATH',
        'KICK_TYPESENSE_SEARCH_KEY',
        'PAYPAL_CLIENT_ID',
        'PAYPAL_CLIENT_SECRET',
        'PAYPAL_WEBHOOK_ID',
        'TWITCH_CLIENT_ID',
        'TWITCH_CLIENT_SECRET',
        'VPS_HOST',
        'VPS_SSH_KEY',
        'VPS_USER',
      ]);
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
