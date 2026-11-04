const path = require('path');

const root = path.resolve(__dirname, '../..');
const overlayUsageWebhook = process.env.GXUFY_OVERLAY_USAGE_DISCORD_WEBHOOK_URL;
const abuseWebhook = process.env.GXUFY_ABUSE_DISCORD_WEBHOOK_URL;
const kickTypesenseSearchKey = process.env.KICK_TYPESENSE_SEARCH_KEY;

module.exports = {
  apps: [
    {
      name: 'multichat',
      cwd: root,
      script: 'node_modules/next/dist/bin/next',
      args: 'start app -p 3000 -H 127.0.0.1',
      instances: 1,
      autorestart: true,
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'production',
        TRUST_CADDY_PROXY: '1',
        GXUFY_SUPPORT_PAGE_ENABLED: '',
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
};
