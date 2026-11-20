#!/usr/bin/env bash
# FlossChat releases without downtime.
#
# Each version lives in its own folder (~/flosschat/releases/<sha>) and runs in
# one of two slots: A on port 3000 or B on port 3001. Caddy (Caddyfile) sends
# visitors only to a healthy slot. A deploy builds the new version next to the
# live one, starts it in the idle slot, checks it, lets it take traffic, then
# drains and stops the old slot. The previous version stays on disk so
# `switch-back` can return to it in seconds without rebuilding.
#
#   release.sh deploy <sha>   (run by .github/workflows/deploy.yml)
#   release.sh switch-back    (run by the owner over SSH if a release misbehaves:
#                              bash ~/flosschat/release.sh switch-back)
#   release.sh status
#
# Before the first slot deploy the site ran as the single pm2 app "multichat"
# from ~/multichat-gxufy on port 3000; that is treated as the "legacy" slot.
set -euo pipefail

FLOSSCHAT_HOME="${FLOSSCHAT_HOME:-$HOME/flosschat}"
LEGACY_DIR="${FLOSSCHAT_LEGACY_DIR:-$HOME/multichat-gxufy}"
CADDY_TARGET="${FLOSSCHAT_CADDY_TARGET:-/etc/caddy/Caddyfile}"
HEALTH_WAIT_SECONDS="${FLOSSCHAT_HEALTH_WAIT_SECONDS:-120}"
CADDY_NOTICE_SECONDS="${FLOSSCHAT_CADDY_NOTICE_SECONDS:-3}"
DRAIN_SECONDS="${FLOSSCHAT_DRAIN_SECONDS:-12}"

RELEASES="$FLOSSCHAT_HOME/releases"
SIGNALS="$FLOSSCHAT_HOME/signals"
ACTIVE_FILE="$FLOSSCHAT_HOME/active"
PREVIOUS_FILE="$FLOSSCHAT_HOME/previous"

say() { printf '%s\n' "$*"; }
die() { printf 'RELEASE_ERROR=%s\n' "$*" >&2; exit 1; }

slot_port() {
  case "$1" in
    a|legacy) echo 3000 ;;
    b) echo 3001 ;;
    *) die "unknown slot $1" ;;
  esac
}

slot_app() {
  case "$1" in
    a|b) echo "flosschat-$1" ;;
    legacy) echo multichat ;;
    *) die "unknown slot $1" ;;
  esac
}

# The slot a new version goes into. Legacy holds port 3000, so it moves to B.
idle_slot() {
  case "$1" in
    a|legacy) echo b ;;
    b|none) echo a ;;
  esac
}

slot_dir() {
  if [ "$1" = legacy ]; then echo "$LEGACY_DIR"; else echo "$RELEASES/$2"; fi
}

pm2_online() {
  pm2 jlist 2>/dev/null | APP="$1" node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      let list = [];
      try { list = JSON.parse(input); } catch {}
      const app = list.find((entry) => entry.name === process.env.APP);
      process.exitCode = app && app.pm2_env && app.pm2_env.status === "online" ? 0 : 1;
    });
  '
}

# Sets ACTIVE_SLOT/ACTIVE_SHA (slot "none" on an empty server).
read_active() {
  if [ -f "$ACTIVE_FILE" ]; then
    read -r ACTIVE_SLOT ACTIVE_SHA < "$ACTIVE_FILE"
  elif pm2_online multichat; then
    ACTIVE_SLOT=legacy
    ACTIVE_SHA="$(git -C "$LEGACY_DIR" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || echo unknown)"
  else
    ACTIVE_SLOT=none
    ACTIVE_SHA=none
  fi
}

write_state() {
  local file="$1" slot="$2" sha="$3"
  printf '%s %s\n' "$slot" "$sha" > "$file.tmp"
  mv "$file.tmp" "$file"
}

# Health of one slot, straight from its port: prints ok / held / draining /
# down. A held slot is running but kept out of Caddy's rotation.
slot_health() {
  PORT="$(slot_port "$1")" node -e '
    const url = `http://127.0.0.1:${process.env.PORT}/api/runtime/health`;
    fetch(url, { signal: AbortSignal.timeout(2000) })
      .then(async (response) => {
        let status = "down";
        try { status = (await response.json()).status || "down"; } catch {}
        console.log(response.ok ? "ok" : status);
      })
      .catch(() => console.log("down"));
  '
}

wait_for_health() {
  local slot="$1" want="$2" waited=0 state
  while [ "$waited" -lt "$HEALTH_WAIT_SECONDS" ]; do
    state="$(slot_health "$slot")"
    case " $want " in *" $state "*) return 0 ;; esac
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Report runtime settings by presence only and fail if a required one is
# missing; never print a value.
verify_runtime_env() {
  pm2 jlist 2>/dev/null | APP="$1" node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const app = JSON.parse(input).find((entry) => entry.name === process.env.APP);
      for (const [label, key] of [
        ["VPS_WEBHOOK_ENV", "GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL"],
        ["VPS_ABUSE_WEBHOOK_ENV", "GXUFY_ABUSE_DISCORD_WEBHOOK_URL"],
        ["VPS_KICK_ENV", "KICK_TYPESENSE_SEARCH_KEY"],
      ]) {
        const value = app?.pm2_env?.[key];
        const present = typeof value === "string" && value.length > 0;
        console.log(`${label}=${present ? "SET" : "MISSING"}`);
        if (!present) process.exitCode = 1;
      }

      /* Launch settings: reported by name only. The supporter database
         location is required: without it each release folder would start
         its own empty database. */
      for (const key of [
        "TWITCH_CLIENT_ID",
        "TWITCH_CLIENT_SECRET",
        "FLOSSCHAT_SESSION_SECRET",
        "PAYPAL_CLIENT_ID",
        "PAYPAL_CLIENT_SECRET",
        "PAYPAL_WEBHOOK_ID",
        "GXUFY_SUPPORTER_STORE_PATH",
        "GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL",
      ]) {
        const value = app?.pm2_env?.[key];
        const present = typeof value === "string" && value.length > 0;
        console.log(`VPS_LAUNCH_${key}=${present ? "SET" : "MISSING"}`);
        if (!present && key === "GXUFY_SUPPORTER_STORE_PATH") process.exitCode = 1;
      }

      const supportPage =
        app?.pm2_env?.GXUFY_SUPPORT_PAGE_ENABLED;
      const supportEnabled =
        supportPage === "1";
      console.log(
        `VPS_SUPPORT_PAGE=${supportEnabled ? "ENABLED" : "UNEXPECTED"}`,
      );
      if (!supportEnabled) process.exitCode = 1;

      /* Real-money PayPal, set by a reviewed release. */
      const paypalLive =
        app?.pm2_env?.PAYPAL_ENV === "live" &&
        app?.pm2_env?.GXUFY_PAYPAL_LIVE_APPROVED === "1";
      console.log(
        `VPS_PAYPAL=${paypalLive ? "LIVE" : "UNEXPECTED"}`,
      );
      if (!paypalLive) process.exitCode = 1;
    });
  '
}

# Install the release's reviewed Caddyfile (validated, with a backup that is
# restored on any failure). Unchanged config is left alone.
sync_caddy() {
  local CADDY_SOURCE="$1/.github/infra/Caddyfile"
  local CADDY_BACKUP
  CADDY_BACKUP="$(dirname "$CADDY_TARGET")/.Caddyfile.gxufy-${2}.$$.before"

  if ! sudo -n true 2>/dev/null; then
    die "Passwordless sudo is required to deploy Caddy configuration."
  fi
  if ! sudo -n test -r "$CADDY_TARGET"; then
    die "Active Caddy configuration is not readable."
  fi
  if sudo -n cmp -s "$CADDY_SOURCE" "$CADDY_TARGET"; then
    say "VPS_CADDY_CONFIG=UNCHANGED"
    return 0
  fi

  sudo -n caddy validate --config "$CADDY_SOURCE"
  sudo -n install -o root -g root -m 600 "$CADDY_TARGET" "$CADDY_BACKUP"
  restore_caddy() {
    say "Restoring previous Caddy configuration."
    if ! sudo -n install -o root -g root -m 644 "$CADDY_BACKUP" "$CADDY_TARGET"; then
      say "Caddy restore install failed; backup retained at $CADDY_BACKUP."
      return 1
    fi
    if ! sudo -n caddy validate --config "$CADDY_TARGET"; then
      say "Restored Caddy configuration failed validation; backup retained at $CADDY_BACKUP."
      return 1
    fi
    if ! sudo -n systemctl reload caddy; then
      say "Caddy reload failed during restore; backup retained at $CADDY_BACKUP."
      return 1
    fi
    if ! sudo -n systemctl is-active --quiet caddy; then
      say "Caddy is not active after restore; backup retained at $CADDY_BACKUP."
      return 1
    fi
    sudo -n rm -f "$CADDY_BACKUP" || true
    say "VPS_CADDY_CONFIG=RESTORED"
    return 0
  }
  if ! sudo -n install -o root -g root -m 644 "$CADDY_SOURCE" "$CADDY_TARGET"; then
    restore_caddy || true
    exit 1
  fi
  if ! sudo -n caddy validate --config "$CADDY_TARGET"; then
    restore_caddy
    exit 1
  fi
  if ! sudo -n systemctl reload caddy; then
    restore_caddy
    exit 1
  fi
  if ! sudo -n systemctl is-active --quiet caddy; then
    restore_caddy
    exit 1
  fi
  if ! sudo -n cmp -s "$CADDY_SOURCE" "$CADDY_TARGET"; then
    restore_caddy
    die "Caddy configuration verification failed."
  fi
  say "VPS_CADDY_CONFIG=SYNCED"
  if sudo -n rm -f "$CADDY_BACKUP"; then
    say "VPS_CADDY_BACKUP=CLEARED"
  else
    say "VPS_CADDY_BACKUP=RETAINED"
  fi
}

# Start a release in a slot, held out of rotation until checked.
start_slot() {
  local slot="$1" dir="$2" sha="$3" app
  app="$(slot_app "$slot")"
  mkdir -p "$SIGNALS"
  rm -f "$SIGNALS/$slot.draining"
  : > "$SIGNALS/$slot.hold"
  pm2 delete "$app" >/dev/null 2>&1 || true
  (
    cd "$dir"
    FLOSSCHAT_SLOT="$slot" \
    FLOSSCHAT_RELEASE="$sha" \
    FLOSSCHAT_DRAIN_FILE="$SIGNALS/$slot.draining" \
    FLOSSCHAT_HOLD_FILE="$SIGNALS/$slot.hold" \
      pm2 start .github/infra/ecosystem.config.js --update-env
  )
  STARTED_SLOT="$slot"
}

# Hand traffic from the old slot to the new one: the new slot leaves "held",
# Caddy notices it, the old slot drains (unhealthy → Caddy stops sending it
# visitors; streams move after a few seconds), then the old slot stops.
hand_over() {
  local new="$1" old="$2"
  rm -f "$SIGNALS/$new.hold"
  wait_for_health "$new" "ok" || die "New slot $new did not become healthy after release."
  sleep "$CADDY_NOTICE_SECONDS"
  if [ "$old" = none ]; then return 0; fi
  if [ "$old" = legacy ]; then
    # The original app has no drain signal: stopping it makes Caddy retry the
    # request on the new slot (lb_try_duration).
    DRAINING_SLOT=legacy
    pm2 stop multichat >/dev/null 2>&1 || true
    pm2 delete multichat >/dev/null 2>&1 || true
  else
    : > "$SIGNALS/$old.draining"
    DRAINING_SLOT="$old"
    sleep "$DRAIN_SECONDS"
    pm2 delete "$(slot_app "$old")" >/dev/null 2>&1 || true
    rm -f "$SIGNALS/$old.draining"
  fi
  DRAINING_SLOT=""
}

# Keep the live and previous releases; remove older ones and partial folders.
prune_releases() {
  local keep_a="$1" keep_b="$2" entry name
  [ -d "$RELEASES" ] || return 0
  for entry in "$RELEASES"/*; do
    [ -e "$entry" ] || continue
    name="$(basename "$entry")"
    if [ "$name" = "$keep_a" ] || [ "$name" = "$keep_b" ]; then continue; fi
    rm -rf "$entry"
    say "VPS_RELEASE_REMOVED=$name"
  done
}

on_failure() {
  local status=$?
  # Never leave the site without a healthy slot: undo a half-finished swap.
  if [ -n "${DRAINING_SLOT:-}" ] && [ "$DRAINING_SLOT" != legacy ]; then
    rm -f "$SIGNALS/$DRAINING_SLOT.draining"
  fi
  if [ -n "${STARTED_SLOT:-}" ] && [ -z "${HANDED_OVER:-}" ]; then
    pm2 delete "$(slot_app "$STARTED_SLOT")" >/dev/null 2>&1 || true
    rm -f "$SIGNALS/$STARTED_SLOT.hold"
    say "VPS_RELEASE=ABANDONED (the live version kept serving)"
  fi
  exit "$status"
}

need_tools() {
  local tool
  for tool in pm2 node; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is not on PATH."
  done
}

lock() {
  need_tools
  mkdir -p "$FLOSSCHAT_HOME"
  exec 9>"$FLOSSCHAT_HOME/.lock"
  flock -n 9 || die "Another release is already running."
}

deploy() {
  local sha="${1:-}" dir new_slot previous_dir
  case "$sha" in ''|*[!0-9a-fA-F]*) die "Invalid release SHA." ;; esac
  [ "${#sha}" -eq 40 ] || die "Invalid release SHA."
  dir="$RELEASES/$sha"
  [ -f "$dir/.github/infra/release.sh" ] || die "Release folder is missing."

  case "${GXUFY_SUPPORTER_STORE_PATH:-}" in
    /*) ;;
    *) die "GXUFY_SUPPORTER_STORE_PATH must be set to the live database (absolute path)." ;;
  esac
  [ -d "$(dirname "$GXUFY_SUPPORTER_STORE_PATH")" ] || die "Supporter database folder does not exist."

  lock
  read_active
  if [ "$ACTIVE_SHA" = "$sha" ] && [ "$ACTIVE_SLOT" != legacy ]; then
    say "VPS_RELEASE=ALREADY_LIVE"
    return 0
  fi
  new_slot="$(idle_slot "$ACTIVE_SLOT")"
  say "VPS_RELEASE_FROM=$ACTIVE_SLOT:$ACTIVE_SHA"
  say "VPS_RELEASE_TO=$new_slot:$sha"

  # Server-only settings kept outside the repo: the app reads <repo root>/
  # .env.local for anything pm2 does not set (app/next.config.js), at build and
  # at start. Every release links to the one file the original app used, so
  # there is still a single copy to edit. Its contents are never read here.
  if [ -e "$LEGACY_DIR/.env.local" ]; then
    ln -sfn "$LEGACY_DIR/.env.local" "$dir/.env.local"
    say "VPS_ENV_LOCAL=LINKED"
  fi

  # Build next to the live version; nothing live changes yet.
  (cd "$dir" && npm ci && npm run build)

  # Pages loaded just before the swap still ask for the old version's script
  # files; the new slot can serve those too (names are content-hashed).
  if [ "$ACTIVE_SLOT" != none ]; then
    previous_dir="$(slot_dir "$ACTIVE_SLOT" "$ACTIVE_SHA")"
    if [ -d "$previous_dir/app/.next/static" ]; then
      cp -Rn "$previous_dir/app/.next/static/." "$dir/app/.next/static/"
    fi
  fi

  sync_caddy "$dir" "$sha"

  trap on_failure EXIT
  start_slot "$new_slot" "$dir" "$sha"
  wait_for_health "$new_slot" "held ok" || die "New slot $new_slot did not start."
  verify_runtime_env "$(slot_app "$new_slot")" || die "New slot $new_slot is missing required settings."
  hand_over "$new_slot" "$ACTIVE_SLOT"
  HANDED_OVER=1

  if [ "$ACTIVE_SLOT" != none ]; then write_state "$PREVIOUS_FILE" "$ACTIVE_SLOT" "$ACTIVE_SHA"; fi
  write_state "$ACTIVE_FILE" "$new_slot" "$sha"
  # A fixed path for the owner: bash ~/flosschat/release.sh switch-back|status
  ln -sfn "$dir/.github/infra/release.sh" "$FLOSSCHAT_HOME/release.sh"
  pm2 save
  trap - EXIT
  local keep_previous=""
  case "$ACTIVE_SLOT" in a|b) keep_previous="$ACTIVE_SHA" ;; esac
  prune_releases "$sha" "$keep_previous"
  say "VPS_RELEASE=LIVE $new_slot $sha"
}

switch_back() {
  local prev_slot prev_sha target dir
  lock
  read_active
  [ -f "$PREVIOUS_FILE" ] || die "There is no previous version to switch back to."
  read -r prev_slot prev_sha < "$PREVIOUS_FILE"
  [ "$ACTIVE_SLOT" != none ] && [ "$ACTIVE_SLOT" != legacy ] || die "Nothing to switch back from."

  # Reuse the live app's runtime settings (they are not stored in the repo):
  # read them from pm2 as NUL-separated name/value pairs, never printed.
  local envfile="$FLOSSCHAT_HOME/.switch-env" key value
  if ! ( umask 077
    pm2 jlist 2>/dev/null | APP="$(slot_app "$ACTIVE_SLOT")" node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        let list = [];
        try { list = JSON.parse(input); } catch {}
        const app = Array.isArray(list) ? list.find((entry) => entry.name === process.env.APP) : null;
        if (!app || typeof app.pm2_env?.GXUFY_SUPPORTER_STORE_PATH !== "string") {
          process.exitCode = 2;
          return;
        }
        const keys = [
          "GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL", "GXUFY_ABUSE_DISCORD_WEBHOOK_URL",
          "KICK_TYPESENSE_SEARCH_KEY", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET",
          "FLOSSCHAT_SESSION_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET",
          "PAYPAL_WEBHOOK_ID", "GXUFY_SUPPORTER_STORE_PATH", "GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL",
        ];
        for (const key of keys) {
          const value = app?.pm2_env?.[key];
          if (typeof value === "string" && value.length > 0 && !value.includes("\0")) {
            process.stdout.write(`${key}\0${value}\0`);
          }
        }
      });
    ' > "$envfile" ); then
    rm -f "$envfile"
    die "Could not read the live app's settings from pm2 (is pm2 on PATH?)."
  fi
  while IFS= read -r -d '' key && IFS= read -r -d '' value; do
    export "$key=$value"
  done < "$envfile"
  rm -f "$envfile"

  trap on_failure EXIT
  if [ "$prev_slot" = legacy ]; then
    target=legacy
    [ "$ACTIVE_SLOT" = b ] || die "The original app needs port 3000, which is in use."
    cp -Rn "$RELEASES/$ACTIVE_SHA/app/.next/static/." "$LEGACY_DIR/app/.next/static/" 2>/dev/null || true
    (cd "$LEGACY_DIR" && pm2 start .github/infra/ecosystem.config.js --update-env)
    STARTED_SLOT=legacy
    wait_for_health legacy "ok" || die "The previous version did not start."
    verify_runtime_env multichat || die "The previous version is missing required settings."
  else
    target="$prev_slot"
    dir="$(slot_dir "$prev_slot" "$prev_sha")"
    [ -d "$dir/app/.next" ] || die "The previous version is no longer on disk."
    # Pages loaded on the newer version just before switching back still need
    # its script files; the older version can serve those too.
    cp -Rn "$RELEASES/$ACTIVE_SHA/app/.next/static/." "$dir/app/.next/static/" 2>/dev/null || true
    start_slot "$target" "$dir" "$prev_sha"
    wait_for_health "$target" "held ok" || die "The previous version did not start."
    verify_runtime_env "$(slot_app "$target")" || die "The previous version is missing required settings."
    rm -f "$SIGNALS/$target.hold"
  fi
  hand_over "$target" "$ACTIVE_SLOT"
  HANDED_OVER=1

  write_state "$PREVIOUS_FILE" "$ACTIVE_SLOT" "$ACTIVE_SHA"
  if [ "$target" = legacy ]; then
    rm -f "$ACTIVE_FILE"
  else
    write_state "$ACTIVE_FILE" "$target" "$prev_sha"
    ln -sfn "$dir/.github/infra/release.sh" "$FLOSSCHAT_HOME/release.sh"
  fi
  pm2 save
  trap - EXIT
  say "VPS_RELEASE=SWITCHED_BACK $target $prev_sha"
}

status() {
  read_active
  say "active: $ACTIVE_SLOT $ACTIVE_SHA"
  if [ -f "$PREVIOUS_FILE" ]; then say "previous: $(cat "$PREVIOUS_FILE")"; else say "previous: none"; fi
  for slot in a b; do say "slot $slot: $(slot_health "$slot")"; done
}

case "${1:-}" in
  deploy) shift; deploy "$@" ;;
  switch-back) switch_back ;;
  status) status ;;
  *) die "usage: release.sh deploy <sha> | switch-back | status" ;;
esac
