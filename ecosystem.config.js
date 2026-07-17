// pm2 process config — `pm2 start ecosystem.config.js`
module.exports = {
  apps: [
    {
      name: 'multichat',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1,
      autorestart: true,
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'production',
        // TIKTOK_SIGN_API_KEY: 'your-eulerstream-key', // optional
      },
    },
  ],
};
