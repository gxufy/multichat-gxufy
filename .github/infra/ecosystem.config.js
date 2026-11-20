const path = require('path');

const root = path.resolve(__dirname, '../..');
const overlayUsageWebhook = process.env.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL;
const abuseWebhook = process.env.GXUFY_ABUSE_DISCORD_WEBHOOK_URL;
const kickTypesenseSearchKey = process.env.KICK_TYPESENSE_SEARCH_KEY;

/*
 * Launch settings for Twitch sign-in and the $5 supporter checkout. They come
 * from the GitHub "production" environment secrets through the deploy step,
 * exactly like the webhooks above, and are only passed on when set.
 *
 * Deliberately NOT forwarded, so changing them needs a reviewed release:
 * GXUFY_SUPPORT_PAGE_ENABLED, PAYPAL_ENV and GXUFY_PAYPAL_LIVE_APPROVED
 * (all set below).
 */
const LAUNCH_KEYS = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'FLOSSCHAT_SESSION_SECRET',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'GXUFY_SUPPORTER_STORE_PATH',
  'GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL',
];
const launchSettings = {};
for (const key of LAUNCH_KEYS) {
  const value = (process.env[key] ?? '').trim();
  if (value) launchSettings[key] = value;
}

/*
 * Two-slot releases (.github/infra/release.sh): each version runs from its own
 * folder in slot A (port 3000) or slot B (port 3001) and Caddy sends visitors
 * to whichever is healthy. Without FLOSSCHAT_SLOT this is the original single
 * app ("multichat" on port 3000), so an old-style start still works.
 */
const SLOT_PORTS = { a: 3000, b: 3001 };
const slot = (process.env.FLOSSCHAT_SLOT ?? '').trim();
if (slot && !(slot in SLOT_PORTS)) {
  throw new Error('FLOSSCHAT_SLOT must be "a" or "b".');
}
const port = slot ? SLOT_PORTS[slot] : 3000;
const handover = {};
for (const key of ['FLOSSCHAT_DRAIN_FILE', 'FLOSSCHAT_HOLD_FILE', 'FLOSSCHAT_RELEASE']) {
  const value = (process.env[key] ?? '').trim();
  if (slot && value) handover[key] = value;
}

module.exports = {
  apps: [
    {
      name: slot ? `flosschat-${slot}` : 'multichat',
      cwd: root,
      script: 'node_modules/next/dist/bin/next',
      args: `start app -p ${port} -H 127.0.0.1`,
      instances: 1,
      autorestart: true,
      max_memory_restart: '900M',
      /* Time for in-flight requests to finish when a slot is stopped. */
      kill_timeout: 10000,
      env: {
        ...launchSettings,
        ...handover,
        ...(slot ? { FLOSSCHAT_SLOT: slot } : {}),
        /* Real-money PayPal (switched on by an owner-approved release). */
        PAYPAL_ENV: 'live',
        GXUFY_PAYPAL_LIVE_APPROVED: '1',
        NODE_ENV: 'production',
        TRUST_CADDY_PROXY: '1',
        GXUFY_SUPPORT_PAGE_ENABLED: '1',
        ...(overlayUsageWebhook
          ? { GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL: overlayUsageWebhook }
          : {}),
        ...(abuseWebhook
          ? { GXUFY_ABUSE_DISCORD_WEBHOOK_URL: abuseWebhook }
          : {}),
        ...(kickTypesenseSearchKey
          ? { KICK_TYPESENSE_SEARCH_KEY: kickTypesenseSearchKey }
          : {}),
      },
    },
  ],
  /* For tests. */
  __LAUNCH_KEYS: LAUNCH_KEYS,
  __SLOT_PORTS: SLOT_PORTS,
};
