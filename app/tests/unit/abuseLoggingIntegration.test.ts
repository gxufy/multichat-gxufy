import {
  readFileSync,
} from 'node:fs';

import {
  resolve,
} from 'node:path';

import {
  describe,
  expect,
  it,
} from 'vitest';

const root =
  process.cwd();

function source(
  relativePath: string,
): string {
  return readFileSync(
    resolve(
      root,
      relativePath,
    ),
    'utf8',
  );
}

describe('abuse-prevention logging integration', () => {
  it('hooks the shared server admission boundaries', () => {
    for (
      const file
      of [
        'src/lib/server/fixedProviderProxy.ts',
        'src/lib/server/viewerResourceControl.ts',
        'src/lib/server/ttsSecurity.ts',
        'src/lib/server/sharedSseAdmission.ts',
      ]
    ) {
      expect(
        source(file),
      ).toContain(
        'queueAbuseRateLimit',
      );
    }
  });

  it('hooks all four channel-search rate limits', () => {
    for (
      const file
      of [
        'src/pages/api/twitch/channel-search.ts',
        'src/pages/api/kick/channel-search.ts',
        'src/pages/api/youtube/channel-search.ts',
        'src/pages/api/tiktok/channel-search.ts',
      ]
    ) {
      expect(
        source(file),
      ).toContain(
        'queueAbuseRateLimit',
      );
    }
  });

  it('publicly discloses abuse-prevention IP logging', () => {
    const notice =
      'For abuse prevention, IP addresses may be logged when repeated server rate limits indicate possible abuse.';

    expect(
      source(
        'src/pages/index.tsx',
      ),
    ).toContain(
      notice,
    );

  });
});
