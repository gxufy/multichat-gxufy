import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const sevenTVMocks =
  vi.hoisted(
    () => ({
      global:
        vi.fn(),

      channel:
        vi.fn(),
    }),
  );

vi.mock(
  '@/lib/kick',
  async (
    importOriginal,
  ) => {
    const original =
      await importOriginal<
        typeof import(
          '@/lib/kick'
        )
      >();

    return {
      ...original,

      getSevenTVGlobalEmotes:
        sevenTVMocks
          .global,

      getSevenTVChannelEmotes:
        sevenTVMocks
          .channel,
    };
  },
);

import {
  loadFFZRoomBadges,
  loadTwitchEmotes,
} from '@/lib/twitchEmotes';

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(
      body,
    ),
    {
      status,

      headers: {
        'Content-Type':
          'application/json',
      },
    },
  );
}

describe(
  'Twitch FFZ/BTTV emote catalogs',
  () => {
    beforeEach(
      () => {
        sevenTVMocks
          .global
          .mockReset()
          .mockResolvedValue(
            [],
          );

        sevenTVMocks
          .channel
          .mockReset()
          .mockResolvedValue({
            emotes: [],
            setId: null,
          });
      },
    );

    afterEach(
      () => {
        vi.restoreAllMocks();
      },
    );

    it(
      'normalizes FFZ and BTTV resources returned through the same-origin route',
      async () => {
        const zeroWidthId =
          '5e76d338d6581c3724c0f0b2';

        const fetchMock =
          vi.spyOn(
            globalThis,
            'fetch',
          ).mockImplementation(
            async (
              input,
            ) => {
              expect(
                String(
                  input,
                ),
              ).toBe(
                '/api/twitch/emote-resources?channelId=42',
              );

              return jsonResponse({
                ffzGlobal: [
                  {
                    id: 'fg',
                    code: 'FFZG',
                    width: 32,
                    height: 24,

                    images: {
                      '4x':
                        'https://cdn.example/ffzg.png',
                    },
                  },
                ],

                ffzChannel: [
                  {
                    id: 'fr',
                    code: 'FFZR',

                    images: {
                      '2x':
                        'https://cdn.example/ffzr.png',
                    },
                  },
                ],

                bttvGlobal: [
                  {
                    id: 'bg',
                    code: 'BTTVG',
                    width: 40,
                    height: 30,
                  },
                ],

                bttvChannel: {
                  channelEmotes: [
                    {
                      id:
                        zeroWidthId,

                      code:
                        'BTTVZero',

                      width:
                        50,

                      height:
                        40,
                    },
                  ],

                  sharedEmotes: [
                    {
                      id:
                        'bs',

                      code:
                        'BTTVShared',
                    },
                  ],
                },

                ffzRoom:
                  null,
              });
            },
          );

        const emotes =
          await loadTwitchEmotes(
            '42',
          );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          emotes.map(
            (
              emote,
            ) =>
              emote.name,
          ),
        ).toEqual([
          'FFZG',
          'FFZR',
          'BTTVG',
          'BTTVZero',
          'BTTVShared',
        ]);

        expect(
          emotes.find(
            (
              emote,
            ) =>
              emote.name
                === 'FFZG',
          ),
        ).toMatchObject({
          image:
            'https://cdn.example/ffzg.png',

          width:
            32,

          height:
            24,

          zeroWidth:
            false,

          upscale:
            false,
        });

        expect(
          emotes.find(
            (
              emote,
            ) =>
              emote.name
                === 'FFZR',
          ),
        ).toMatchObject({
          image:
            'https://cdn.example/ffzr.png',

          zeroWidth:
            false,

          upscale:
            true,
        });

        expect(
          emotes.find(
            (
              emote,
            ) =>
              emote.name
                === 'BTTVZero',
          ),
        ).toMatchObject({
          image:
            'https://cdn.betterttv.net/emote/'
            + zeroWidthId
            + '/3x',

          width:
            50,

          height:
            40,

          zeroWidth:
            true,

          upscale:
            false,
        });
      },
    );

    it(
      'fails malformed provider entries closed while preserving valid neighbors',
      async () => {
        vi.spyOn(
          globalThis,
          'fetch',
        ).mockResolvedValue(
          jsonResponse({
            ffzGlobal: [
              {
                id:
                  'unsafe',

                code:
                  'UnsafeFFZ',

                images: {
                  '4x':
                    'javascript:alert(1)',
                },
              },

              {
                id:
                  'good',

                code:
                  'SafeFFZ',

                images: {
                  '1x':
                    'https://cdn.example/safe.png',
                },
              },

              {
                id:
                  'missing-code',

                images: {
                  '4x':
                    'https://cdn.example/missing.png',
                },
              },
            ],

            ffzChannel:
              {},

            bttvGlobal: [
              {
                id: '',
                code:
                  'MissingId',
              },

              {
                id:
                  'good-bttv',

                code:
                  'SafeBTTV',
              },

              {
                id:
                  'missing-code',
              },
            ],

            bttvChannel:
              {},

            ffzRoom:
              null,
          }),
        );

        const emotes =
          await loadTwitchEmotes(
            '42',
          );

        expect(
          emotes.map(
            (
              emote,
            ) =>
              emote.name,
          ),
        ).toEqual([
          'SafeFFZ',
          'SafeBTTV',
        ]);

        expect(
          emotes.every(
            (
              emote,
            ) =>
              emote.image
                .startsWith(
                  'https://',
                ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      'keeps the existing later-provider collision precedence',
      async () => {
        vi.spyOn(
          globalThis,
          'fetch',
        ).mockResolvedValue(
          jsonResponse({
            ffzGlobal: [
              {
                id:
                  'ffz',

                code:
                  'COLLIDE',

                images: {
                  '4x':
                    'https://cdn.example/ffz.png',
                },
              },
            ],

            ffzChannel:
              {},

            bttvGlobal: [
              {
                id:
                  'bttv',

                code:
                  'COLLIDE',
              },
            ],

            bttvChannel:
              {},

            ffzRoom:
              null,
          }),
        );

        sevenTVMocks
          .global
          .mockResolvedValueOnce([
            {
              name:
                'COLLIDE',

              image:
                'https://cdn.example/7tv.webp',

              width:
                32,

              height:
                32,

              zeroWidth:
                false,

              upscale:
                false,
            },
          ]);

        const emotes =
          await loadTwitchEmotes(
            '42',
          );

        expect(
          emotes,
        ).toHaveLength(
          1,
        );

        expect(
          emotes[0]
            ?.image,
        ).toBe(
          'https://cdn.example/7tv.webp',
        );

        expect(
          await loadTwitchEmotes(
            'not-a-room-id',
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      'loads FFZ moderator and VIP room overrides through the same-origin route',
      async () => {
        const fetchMock =
          vi.spyOn(
            globalThis,
            'fetch',
          ).mockResolvedValue(
            jsonResponse({
              ffzRoom: {
                room: {
                  moderator_badge:
                    true,

                  vip_badge:
                    true,
                },
              },
            }),
          );

        const badges =
          await loadFFZRoomBadges(
            '42',
          );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          String(
            fetchMock
              .mock
              .calls[0]![0],
          ),
        ).toBe(
          '/api/twitch/emote-resources?channelId=42',
        );

        expect(
          badges,
        ).toEqual({
          'moderator/1':
            'https://cdn.frankerfacez.com/room-badge/mod/id/42/4/rounded',

          'vip/1':
            'https://cdn.frankerfacez.com/room-badge/vip/id/42/4',
        });
      },
    );

    it(
      'keeps 7TV usable when the supplemental same-origin provider request fails',
      async () => {
        vi.spyOn(
          globalThis,
          'fetch',
        ).mockResolvedValue(
          jsonResponse(
            {
              error:
                'offline',
            },
            502,
          ),
        );

        sevenTVMocks
          .global
          .mockResolvedValueOnce([
            {
              name:
                'SevenOnly',

              image:
                'https://cdn.example/seven.webp',

              width:
                32,

              height:
                32,

              zeroWidth:
                false,

              upscale:
                false,
            },
          ]);

        const emotes =
          await loadTwitchEmotes(
            '42',
          );

        expect(
          emotes.map(
            (
              emote,
            ) =>
              emote.name,
          ),
        ).toEqual([
          'SevenOnly',
        ]);
      },
    );
  },
);
