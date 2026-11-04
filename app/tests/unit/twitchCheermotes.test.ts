import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveTwitchCheerMessage,
  TWITCH_GLOBAL_CHEERMOTE_PREFIXES,
} from '@/lib/twitchCheermotes';

describe(
  'anonymous Twitch Cheermotes',
  () => {
    it(
      'uses Twitch open animated CDN artwork for 100 Bits',
      () => {
        const result =
          resolveTwitchCheerMessage(
            'Cheer100 lets go',
            100,
          );

        expect(
          result.cheer.bits,
        ).toBe(100);

        expect(
          result.cheer.cheermotes[0],
        ).toEqual({
          prefix:
            'Cheer',
          bits:
            100,
          tierMinBits:
            100,
          color:
            '#9c3ee8',
          animatedUrl:
            'https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/100/1.gif',
        });

        expect(
          result.emotes[0],
        ).toMatchObject({
          begin: 0,
          end: 8,
          text:
            'Cheer100',
          kind:
            'cheermote',
        });
      },
    );

    it(
      'selects the 1000-Bit tier',
      () => {
        const result =
          resolveTwitchCheerMessage(
            'Cheer1000 huge',
            1000,
          );

        expect(
          result.cheer.cheermotes[0],
        ).toMatchObject({
          tierMinBits:
            1000,
          color:
            '#1db2a5',
          animatedUrl:
            'https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/1000/1.gif',
        });
      },
    );

    it(
      'supports alternate global Twitch Cheer prefixes',
      () => {
        const result =
          resolveTwitchCheerMessage(
            'Pride5000 W',
            5000,
          );

        expect(
          result.cheer.cheermotes[0],
        ).toMatchObject({
          prefix:
            'Pride',
          bits:
            5000,
          tierMinBits:
            5000,
          color:
            '#0099fe',
        });
      },
    );

    it(
      'uses code-point offsets after emoji',
      () => {
        const result =
          resolveTwitchCheerMessage(
            `${String.fromCodePoint(
              0x1f525,
            )} Cheer100 wow`,
            100,
          );

        expect(
          result.emotes[0],
        ).toMatchObject({
          begin: 2,
          end: 10,
        });
      },
    );

    it(
      'keeps the authoritative IRC total when there is no known global token',
      () => {
        const result =
          resolveTwitchCheerMessage(
            'SomeCustomCheer100 hello',
            100,
          );

        expect(
          result.cheer,
        ).toEqual({
          bits: 100,
          cheermotes: [],
        });

        expect(
          result.emotes,
        ).toEqual([]);
      },
    );

    it(
      'includes the expected global prefix set',
      () => {
        expect(
          TWITCH_GLOBAL_CHEERMOTE_PREFIXES,
        ).toContain(
          'cheer',
        );

        expect(
          TWITCH_GLOBAL_CHEERMOTE_PREFIXES,
        ).toContain(
          'pride',
        );

        expect(
          TWITCH_GLOBAL_CHEERMOTE_PREFIXES,
        ).toContain(
          'shamrock',
        );
      },
    );
  },
);