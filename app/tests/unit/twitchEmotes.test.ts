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
  TWITCH_EMOTE_RESOURCE_RETRY_MS,
  clearTwitchEmoteResourceCache,
  loadFFZRoomBadges,
  loadFFZRoomUserBadges,
  loadTwitchEmotes,
  parseFFZRoomUserBadges,
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
        clearTwitchEmoteResourceCache();
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

    it('loads 7TV globals but prefers an active channel emote with the same name', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
        ffzGlobal: [], ffzChannel: [], bttvGlobal: [], bttvChannel: {}, ffzRoom: null,
      }));

      const base = {
        width: 32, height: 32, zeroWidth: false, upscale: false,
      };
      sevenTVMocks.global.mockResolvedValueOnce([
        { ...base, name: 'GlobalOnly', image: 'https://cdn.example/global.webp' },
        { ...base, name: 'COLLIDE', image: 'https://cdn.example/global-collision.webp' },
      ]);
      sevenTVMocks.channel.mockResolvedValueOnce({
        emotes: [{ ...base, name: 'COLLIDE', image: 'https://cdn.example/channel.webp' }],
        setId: 'active-channel',
        stvUserId: 'stv-user',
      });

      const emotes = await loadTwitchEmotes('42');
      expect(sevenTVMocks.global).toHaveBeenCalledTimes(1);
      expect(emotes.find((emote) => emote.name === 'GlobalOnly')?.image)
        .toBe('https://cdn.example/global.webp');
      expect(emotes.find((emote) => emote.name === 'COLLIDE')?.image)
        .toBe('https://cdn.example/channel.webp');
    });

    it('rejects a partial catalog during a strict 7TV refresh', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
        ffzGlobal: [], ffzChannel: [], bttvGlobal: [], bttvChannel: {}, ffzRoom: null,
      }));
      sevenTVMocks.channel.mockRejectedValueOnce(new Error('7TV channel unavailable'));
      await expect(loadTwitchEmotes('42', undefined, true))
        .rejects.toThrow('7TV channel unavailable');
    });

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
          .channel
          .mockResolvedValueOnce({
            emotes: [
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
            ],

            setId:
              'channel-set',

            stvUserId:
              'stv-user',
          });

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
          .channel
          .mockResolvedValueOnce({
            emotes: [
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
            ],

            setId:
              'channel-set',

            stvUserId:
              'stv-user',
          });

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

describe('Twitch emote loading does not repeat requests', () => {
  beforeEach(() => {
    clearTwitchEmoteResourceCache();
    sevenTVMocks.global.mockReset().mockResolvedValue([]);
    sevenTVMocks.channel.mockReset().mockResolvedValue({ emotes: [], setId: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses a 7TV channel answer the overlay already has instead of downloading it again', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}));
    const channel = {
      emotes: [{ name: 'PEPE', image: 'https://cdn.7tv.app/emote/p/4x.webp', width: 32, height: 32, zeroWidth: false, upscale: false }],
      setId: 'set', stvUserId: 'user',
    };
    const emotes = await loadTwitchEmotes('42', undefined, false, Promise.resolve(channel));
    expect(sevenTVMocks.channel).not.toHaveBeenCalled();
    expect(emotes.map((emote) => emote.name)).toContain('PEPE');
  });

  it('shares one BTTV/FFZ request between the emote list and the FFZ room badges', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
      ffzGlobal: null, ffzChannel: null, bttvGlobal: [], bttvChannel: null,
      ffzRoom: { room: { moderator_badge: true } },
    }));
    const [, badges] = await Promise.all([loadTwitchEmotes('42'), loadFFZRoomBadges('42')]);
    expect(badges['moderator/1']).toContain('/room-badge/mod/id/42/');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /* Another channel still gets its own request. */
    await loadFFZRoomBadges('43');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed answer, so the next load asks again', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => jsonResponse({ error: 'failed' }, 500))
      .mockImplementation(async () => jsonResponse({ ffzRoom: { room: { vip_badge: true } } }));
    expect(await loadFFZRoomBadges('42')).toEqual({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await loadFFZRoomBadges('42'))['vip/1']).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('a busy emote server gets one more try', () => {
  beforeEach(() => {
    clearTwitchEmoteResourceCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries once after a 503, then uses the answer', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => jsonResponse({ error: 'busy' }, 503))
      .mockImplementation(async () => jsonResponse({ ffzRoom: { room: { moderator_badge: true } } }));
    const pending = loadFFZRoomBadges('42');
    await vi.advanceTimersByTimeAsync(TWITCH_EMOTE_RESOURCE_RETRY_MS + 10);
    expect((await pending)['moderator/1']).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second failure (no endless retries)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ error: 'busy' }, 502));
    const pending = loadFFZRoomBadges('42');
    await vi.advanceTimersByTimeAsync(TWITCH_EMOTE_RESOURCE_RETRY_MS * 3);
    expect(await pending).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('FFZ badges a channel gives its chatters', () => {
  beforeEach(() => {
    clearTwitchEmoteResourceCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the room list by login and by Twitch id', () => {
    const map = parseFFZRoomUserBadges({ room: {
      user_badges: { '2': ['PajBot', 'supibot'] },
      user_badge_ids: { '2': [82008718, '68136884'], '7': [82008718] },
    } });
    expect(map.get('login:pajbot')).toEqual(['2']);
    expect(map.get('login:supibot')).toEqual(['2']);
    expect(map.get('id:82008718')).toEqual(['2', '7']);
    expect(map.get('id:68136884')).toEqual(['2']);
  });

  it('accepts the overlay bundle shape and ignores anything malformed', () => {
    const map = parseFFZRoomUserBadges({ ffzRoom: { room: {
      user_badges: { '2': ['good_bot', 'bad name', '', 5], abc: ['x'], '3': 'not-a-list' },
      user_badge_ids: { '2': [0, -4, 1.5, '01', 'x', 99] },
    } } });
    expect([...map.keys()].sort()).toEqual(['id:99', 'login:good_bot']);
    expect(parseFFZRoomUserBadges(null).size).toBe(0);
    expect(parseFFZRoomUserBadges({ room: { user_badges: {}, user_badge_ids: {} } }).size).toBe(0);
  });

  it('keeps the list bounded', () => {
    const many = Array.from({ length: 5_000 }, (_, index) => `bot_${index}`);
    const map = parseFFZRoomUserBadges({ room: { user_badges: { '2': many } } });
    expect(map.size).toBe(2_000);
  });

  it('comes from the same request as the mod/VIP badges', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
      ffzGlobal: null, ffzChannel: null, bttvGlobal: [], bttvChannel: null,
      ffzRoom: { room: { moderator_badge: true, user_badges: { '2': ['channel_bot'] } } },
    }));
    const [overrides, people] = await Promise.all([loadFFZRoomBadges('42'), loadFFZRoomUserBadges('42')]);
    expect(overrides['moderator/1']).toBeTruthy();
    expect(people.get('login:channel_bot')).toEqual(['2']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await loadFFZRoomUserBadges('not-a-number')).size).toBe(0);
  });
});
