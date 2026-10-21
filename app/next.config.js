const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

const BASELINE_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'files.kick.com' },
      { protocol: 'https', hostname: 'cdn.7tv.app' },
      { protocol: 'https', hostname: 'static-cdn.jtvnw.net' },
      { protocol: 'https', hostname: 'yt3.ggpht.com' },
      { protocol: 'https', hostname: 'yt3.googleusercontent.com' },
      { protocol: 'https', hostname: 'p16-common-sign.tiktokcdn-us.com' },
      { protocol: 'https', hostname: 'p19-common-sign.tiktokcdn-us.com' },
    ],
  },
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  // Next 16 Pages Router can receive the ISR manifest before
  // window.next.router exists. The dev indicator reads router.components
  // too early and throws. This affects only Next's development indicator,
  // not Fast Refresh or production behavior.
  devIndicators: false,

  async headers() {
    /*
     * Next 16 development serves its client middleware manifest with a JSON
     * content type even though the browser consumes the .js route as script.
     * Keep nosniff in production, but do not make Chrome reject Next's own
     * development runtime.
     */
    const headers = process.env.NODE_ENV === 'development'
      ? BASELINE_SECURITY_HEADERS.filter(
          ({ key }) => key !== 'X-Content-Type-Options',
        )
      : BASELINE_SECURITY_HEADERS;

    return [
      {
        source: '/:path*',
        headers,
      },
    ];
  },
};

module.exports = (phase) => {
  // The Next project lives in app/, while this repo's shared .env files live at
  // the repository root. Preserve injected/app-local values and fill any missing
  // variables through the same Next.js loader used by verify:oauth:local. Force
  // the reload because Next has already checked app/.env* before evaluating this
  // config file and @next/env otherwise returns that cached empty result.
  loadEnvConfig(
    path.resolve(__dirname, '..'),
    phase === PHASE_DEVELOPMENT_SERVER,
    console,
    true,
  );
  return nextConfig;
};
