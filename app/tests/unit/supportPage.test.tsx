import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  readFileSync,
} from 'node:fs';

import {
  resolve,
} from 'node:path';

import SupportPage, {
  buildSupportBadgePreview,
  buildSupportUsernameStyle,
  getServerSideProps,
} from '@/pages/support';

import type {
  PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';

import {
  SAMPLE_SEVENTV_PAINT,
} from '@/features/multichat/samples';

import {
  SUPPORT_AMOUNT_CENTS,
  SUPPORT_AMOUNT_LABEL,
  SUPPORT_BADGE,
  normalizeSupportTwitchLogin,
  parseSupportTwitchUser,
} from '@/lib/supportPage';

const repositoryRoot =
  resolve(
    process.cwd(),
    '..',
  );

const originalFlag =
  process.env
    .GXUFY_SUPPORT_PAGE_ENABLED;

afterEach(() => {
  if (
    originalFlag === undefined
  ) {
    delete process.env
      .GXUFY_SUPPORT_PAGE_ENABLED;
  } else {
    process.env
      .GXUFY_SUPPORT_PAGE_ENABLED =
        originalFlag;
  }

  vi.unstubAllGlobals();
});

describe(
  'private support page',
  () => {
    it(
      'returns 404 while the server-only feature flag is absent',
      async () => {
        delete process.env
          .GXUFY_SUPPORT_PAGE_ENABLED;

        await expect(
          getServerSideProps(
            {} as never,
          ),
        ).resolves.toEqual({
          notFound: true,
        });
      },
    );

    it(
      'can be intentionally enabled server-side for private preview',
      async () => {
        process.env
          .GXUFY_SUPPORT_PAGE_ENABLED =
            '1';

        await expect(
          getServerSideProps(
            {} as never,
          ),
        ).resolves.toEqual({
          props: {},
        });
      },
    );

    it(
      'fixes support at exactly $5',
      () => {
        expect(
          SUPPORT_AMOUNT_CENTS,
        ).toBe(500);

        expect(
          SUPPORT_AMOUNT_LABEL,
        ).toBe('$5');

        expect(
          SUPPORT_BADGE.minimumCents,
        ).toBe(
          SUPPORT_AMOUNT_CENTS,
        );
      },
    );
    it(
      'keeps support source encoding-safe and custom-amount-capable',
      () => {
        const source =
          readFileSync(
            resolve(
              repositoryRoot,
              'app/src/pages/support.tsx',
            ),
            'utf8',
          );

        expect(source).toContain(
          "'Checking Twitch\\u2026'",
        );

        expect(source).toContain(
          "{'\\u2713'}",
        );

        expect(source).toContain(
          '.amount-options',
        );

        expect(source).not.toContain(
          '.amount-group',
        );

        expect(source).toContain(
          '.amount-error',
        );
      },
    );
    it(
      'normalizes and validates Twitch account payloads',
      () => {
        expect(
          normalizeSupportTwitchLogin(
            ' @Gxufy ',
          ),
        ).toBe('gxufy');

        expect(
          normalizeSupportTwitchLogin(
            'ab',
          ),
        ).toBeNull();

        expect(
          parseSupportTwitchUser(
            {
              id: '123',
              login: 'gxufy',
              displayName:
                'Gxufy',
              profileImageUrl:
                'https://cdn.example/g.png',
            },
            'gxufy',
          ),
        ).toEqual({
          id: '123',
          login: 'gxufy',
          displayName:
            'Gxufy',
          profileImageUrl:
            'https://cdn.example/g.png',
        });

        expect(
          parseSupportTwitchUser(
            {
              id: '123',
              login: 'other',
              displayName:
                'Other',
            },
            'gxufy',
          ),
        ).toBeNull();
      },
    );

    it(
      'keeps $5 as the default, supports a custom amount, and keeps checkout inert',
      () => {
        render(
          <SupportPage />,
        );

        const amountInput =
          screen.getByLabelText(
            'Support amount in US dollars',
          ) as HTMLInputElement;

        expect(
          amountInput.value,
        ).toBe('5');

        expect(
          amountInput.readOnly,
        ).toBe(true);

        expect(
          screen.getByRole(
            'button',
            {
              name: '$5',
            },
          ),
        ).toBeTruthy();

        expect(
          screen.getByRole(
            'button',
            {
              name: 'Custom',
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByRole(
            'button',
            {
              name: '$10',
            },
          ),
        ).toBeNull();

        expect(
          screen.queryByRole(
            'button',
            {
              name: '$25',
            },
          ),
        ).toBeNull();

        fireEvent.click(
          screen.getByRole(
            'button',
            {
              name: 'Custom',
            },
          ),
        );

        expect(
          amountInput.readOnly,
        ).toBe(false);

        fireEvent.change(
          amountInput,
          {
            target: {
              value: '4.99',
            },
          },
        );

        expect(
          screen.getByRole(
            'alert',
          ).textContent,
        ).toContain(
          '$5 to $100,000',
        );

        expect(
          (
            screen.getByRole(
              'button',
              {
                name: /Continue/,
              },
            ) as HTMLButtonElement
          ).disabled,
        ).toBe(true);

        fireEvent.change(
          amountInput,
          {
            target: {
              value: '5.00',
            },
          },
        );

        expect(
          screen.queryByRole(
            'alert',
          ),
        ).toBeNull();

        expect(
          (
            screen.getByRole(
              'button',
              {
                name: 'Continue with $5',
              },
            ) as HTMLButtonElement
          ).disabled,
        ).toBe(false);

        fireEvent.change(
          amountInput,
          {
            target: {
              value: '12.34',
            },
          },
        );

        expect(
          screen.getByRole(
            'button',
            {
              name:
                'Continue with $12.34',
            },
          ),
        ).toBeTruthy();

        fireEvent.change(
          amountInput,
          {
            target: {
              value: '0',
            },
          },
        );

        expect(
          screen.getByRole(
            'alert',
          ).textContent,
        ).toContain(
          '$5 to $100,000',
        );

        expect(
          screen.getByRole(
            'button',
            {
              name:
                'Continue with Custom amount',
            },
          ).hasAttribute(
            'disabled',
          ),
        ).toBe(true);

        fireEvent.click(
          screen.getByRole(
            'button',
            {
              name: '$5',
            },
          ),
        );

        const continueButton =
          screen.getByRole(
            'button',
            {
              name:
                'Continue with $5',
            },
          );

        expect(
          continueButton
            .hasAttribute(
              'disabled',
            ),
        ).toBe(false);

        fireEvent.click(
          continueButton,
        );

        expect(
          screen.getByRole(
            'status',
          ).textContent,
        ).toContain(
          'cannot charge you',
        );
      },
    );
    it(
      'combines Twitch, FFZ, BTTV, 7TV, community, deferred, Pro, and supporter badges',
      () => {
        const response:
        PreviewIdentityResponse = {
          identity: {
            userId: '123',
            login: 'gxufy',
            displayName: 'Gxufy',
          },
          providers: {
            Twitch: {
              status: 'loaded',
              resources: {
                globalBadges: {},
                channelBadges: {},
                ownedBadges: [
                  {
                    type:
                      'subscriber',
                    version:
                      '12',
                    title:
                      'Twitch Subscriber',
                    url:
                      'https://cdn.example/twitch.png',
                  },
                ],
              },
            },
            FFZ: {
              status: 'loaded',
              resources: {
                globalEmotes: [],
                roomEmotes: [],
                badgeOverrides: {},
                ownedBadges: [
                  {
                    id:
                      'ffz-supporter',
                    image:
                      'https://cdn.example/ffz.png',
                  },
                ],
              },
            },
            BTTV: {
              status: 'loaded',
              resources: {
                globalEmotes: [],
                channelEmotes: [],
                sharedEmotes: [],
                ownedBadges: [
                  {
                    id:
                      'bttv-badge',
                    image:
                      'https://cdn.example/bttv.png',
                  },
                ],
              },
            },
            '7TV': {
              status: 'loaded',
              resources: {
                globalEmotes: [],
                channelEmotes: [],
                personalEmotes: [],
                paint: null,
                badge: {
                  id:
                    'seven-badge',
                  image:
                    'https://cdn.example/seven.png',
                },
              },
            },
          },
          communityBadges: [
            {
              type:
                'community:chatsen:verified',
              title:
                'Chatsen Verified',
              url:
                'https://cdn.example/chatsen.png',
            },
          ],
        };

        const badges =
          buildSupportBadgePreview(
            response,
            [
              {
                type:
                  'community:jilchat:one',
                title:
                  'JilChat One',
                url:
                  'https://cdn.example/jilchat.png',
              },
            ],
            'https://cdn.example/bttv-pro.png',
            true,
          );

        expect(
          badges.map(
            (badge) =>
              badge.title,
          ),
        ).toEqual([
          'Twitch Subscriber',
          'FFZ ffz-supporter',
          'BTTV bttv-badge',
          '7TV seven-badge',
          'Chatsen Verified',
          'JilChat One',
          'BTTV Pro',
          'Gxufy Supporter',
        ]);

        expect(
          badges.map(
            (badge) =>
              badge.url,
          ),
        ).toEqual([
          'https://cdn.example/twitch.png',
          'https://cdn.example/ffz.png',
          'https://cdn.example/bttv.png',
          'https://cdn.example/seven.png',
          'https://cdn.example/chatsen.png',
          'https://cdn.example/jilchat.png',
          'https://cdn.example/bttv-pro.png',
          '/badges/gxufy/supporter.webp',
        ]);
      },
    );

    it(
      'deduplicates one badge asset exposed by multiple providers',
      () => {
        const response:
        PreviewIdentityResponse = {
          identity: {
            userId: '123',
            login: 'gxufy',
            displayName: 'Gxufy',
          },
          providers: {},
          communityBadges: [
            {
              type:
                'community:first',
              url:
                'https://cdn.example/shared.png',
            },
          ],
        };

        const badges =
          buildSupportBadgePreview(
            response,
            [
              {
                type:
                  'community:second',
                url:
                  'https://cdn.example/shared.png',
              },
            ],
            null,
            false,
          );

        expect(
          badges,
        ).toHaveLength(1);
      },
    );
    it(
      'renders the active 7TV paint on the supporter username',
      () => {
        const response:
        PreviewIdentityResponse = {
          identity: {
            userId: '123',
            login: 'gxufy',
            displayName: 'Gxufy',
          },
          providers: {
            '7TV': {
              status: 'loaded',
              resources: {
                globalEmotes: [],
                channelEmotes: [],
                personalEmotes: [],
                paint:
                  SAMPLE_SEVENTV_PAINT,
                badge: null,
              },
            },
          },
        };

        const style =
          buildSupportUsernameStyle(
            response,
          );

        expect(style).toBeDefined();

        expect(
          String(
            style?.background,
          ),
        ).toContain(
          'linear-gradient(',
        );

        expect(
          style?.WebkitBackgroundClip,
        ).toBe('text');

        expect(
          style?.backgroundClip,
        ).toBe('text');

        expect(
          style?.color,
        ).toBe('transparent');

        expect(
          String(
            style?.filter,
          ),
        ).toContain(
          'drop-shadow(',
        );
      },
    );
    it(
      'requires a non-empty Twitch username to verify before continuing',
      async () => {
        const fetchMock =
          vi.fn(
            async (
              _input: RequestInfo | URL,
              _init?: RequestInit,
            ) =>
              new Response(
                JSON.stringify({
                  id: '123',
                  login: 'gxufy',
                  displayName:
                    'Gxufy',
                  profileImageUrl:
                    'https://cdn.example/g.png',
                }),
                {
                  status: 200,
                  headers: {
                    'Content-Type':
                      'application/json',
                  },
                },
              ),
          );

        vi.stubGlobal(
          'fetch',
          fetchMock,
        );

        /*
         * The Support badge row may ask BTTV Pro for supplementary cosmetics
         * after verification. This test is about the verification contract,
         * so make that optional websocket path deterministically unavailable.
         */
        vi.stubGlobal(
          'WebSocket',
          class {
            constructor() {
              throw new Error(
                'BTTV Pro disabled in Support verification unit test',
              );
            }
          },
        );

        render(
          <SupportPage />,
        );

        fireEvent.change(
          screen.getByLabelText(
            'Twitch username',
          ),
          {
            target: {
              value: 'gxufy',
            },
          },
        );

        expect(
          screen.getByRole(
            'button',
            {
              name:
                'Continue with $5',
            },
          )
            .hasAttribute(
              'disabled',
            ),
        ).toBe(true);

        await waitFor(
          () => {
            expect(
              screen.getByText(
                'Verified as Gxufy.',
              ),
            ).toBeTruthy();
          },
          {
            timeout: 2_000,
          },
        );

        expect(
          fetchMock.mock.calls.length,
        ).toBeGreaterThanOrEqual(
          1,
        );

        /*
         * Verification still has to be the first network request. Additional
         * calls are cosmetic hydration and are allowed only afterward.
         */
        expect(
          String(
            fetchMock
              .mock
              .calls[0][0],
          ),
        ).toBe(
          '/api/twitch/support-user?login=gxufy',
        );

        expect(
          screen.getByRole(
            'button',
            {
              name:
                'Continue with $5',
            },
          )
            .hasAttribute(
              'disabled',
            ),
        ).toBe(false);

        const usernamePreview =
          screen.getByLabelText(
            'Username preview',
          );

        expect(
          usernamePreview.querySelector(
            'img[alt="Gxufy Supporter"]',
          ),
        ).not.toBeNull();

        expect(
          screen.getByLabelText(
            'Username preview',
          ).textContent,
        ).toContain(
          'Gxufy',
        );
      },
    );

    it(
      'keeps homepage support advertising server-gated and out of the sitemap while private',
      () => {
        const home =
          readFileSync(
            resolve(
              repositoryRoot,
              'app/src/pages/index.tsx',
            ),
            'utf8',
          );


        const sitemap =
          readFileSync(
            resolve(
              repositoryRoot,
              'app/public/sitemap.xml',
            ),
            'utf8',
          );

        expect(
          home,
        ).toContain(
          'supportPageEnabled()',
        );

        expect(
          home,
        ).toContain(
          'supportEnabled ? (',
        );

        expect(
          home,
        ).toContain(
          'href="/support"',
        );


        expect(
          sitemap,
        ).not.toContain(
          '<loc>https://gxufy.com/support</loc>',
        );
      },
    );

    it(
      'documents only a blank server-side feature flag',
      () => {
        const envExample =
          readFileSync(
            resolve(
              repositoryRoot,
              'app/.env.example',
            ),
            'utf8',
          );

        expect(
          envExample,
        ).toMatch(
          /^GXUFY_SUPPORT_PAGE_ENABLED=$/m,
        );

        expect(
          envExample,
        ).not.toContain(
          'NEXT_PUBLIC_GXUFY_SUPPORT_PAGE_ENABLED',
        );
      },
    );
  },
);
