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
  SUPPORT_MAX_CENTS,
  SUPPORT_MIN_CENTS,
  acceptSupportAmountInput,
  clampSupportAmountCents,
  cleanSupportAmountInput,
  stepSupportAmount,
  formatSupportAmount,
  normalizeSupportAmountCents,
  parseSupportAmount,
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

/* Support needs a signed-in buyer; these tests then use "As a gift". */
const SIGNED_IN_BUYER = {
  signInReady: true,
  user: { id: '999', login: 'buyer', displayName: 'Buyer' },
  badges: [],
};

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
          props: { checkoutReady: false },
        });
      },
    );

    it(
      'is $5 or more, starting at $5, up to $500',
      () => {
        expect(SUPPORT_MIN_CENTS).toBe(500);
        expect(SUPPORT_MAX_CENTS).toBe(50_000);
        expect(SUPPORT_AMOUNT_CENTS).toBe(500);
        expect(SUPPORT_AMOUNT_LABEL).toBe('$5');
        expect(SUPPORT_BADGE.minimumCents).toBe(500);

        expect(parseSupportAmount('5')).toBe(500);
        expect(parseSupportAmount(' $7.5 ')).toBe(750);
        expect(parseSupportAmount('10.05')).toBe(1005);
        for (const bad of ['', '.', '5.555', '5,00', '-5', '1e3', 'five', '1234567']) {
          expect(parseSupportAmount(bad), bad).toBeNull();
        }

        expect(normalizeSupportAmountCents(500)).toBe(500);
        expect(normalizeSupportAmountCents(50_000)).toBe(50_000);
        for (const bad of [499, 50_001, 500.5, '500', null, undefined, Number.NaN]) {
          expect(normalizeSupportAmountCents(bad), String(bad)).toBeNull();
        }

        expect(clampSupportAmountCents(100)).toBe(500);
        expect(clampSupportAmountCents(0)).toBe(500);
        expect(clampSupportAmountCents(-900)).toBe(500);
        expect(clampSupportAmountCents(Number.NaN)).toBe(500);
        expect(clampSupportAmountCents(750)).toBe(750);
        expect(clampSupportAmountCents(99_999)).toBe(50_000);

        expect(cleanSupportAmountInput('$12.505')).toBe('12.50');
        expect(cleanSupportAmountInput('1.2.3')).toBe('1.23');
        expect(cleanSupportAmountInput('abc7')).toBe('7');
        expect(cleanSupportAmountInput('-5')).toBe('5');

        /* The box can't hold less than $5 (or more than $500): such edits are ignored. */
        expect(acceptSupportAmountInput('5', '3')).toBe('5');
        expect(acceptSupportAmountInput('5', '')).toBe('5');
        expect(acceptSupportAmountInput('5', '4.99')).toBe('5');
        expect(acceptSupportAmountInput('12', '1')).toBe('12');
        expect(acceptSupportAmountInput('50', '501')).toBe('50');
        expect(acceptSupportAmountInput('5', '50')).toBe('50');
        expect(acceptSupportAmountInput('7', '7.')).toBe('7.');
        expect(acceptSupportAmountInput('7.', '7.5')).toBe('7.5');
        expect(acceptSupportAmountInput('7.5', '7.505')).toBe('7.50');
        expect(acceptSupportAmountInput('5', 'abc')).toBe('5');

        expect(stepSupportAmount(500, -1)).toBe(500);
        expect(stepSupportAmount(500, 1)).toBe(600);
        expect(stepSupportAmount(750, -1)).toBe(650);
        expect(stepSupportAmount(50_000, 1)).toBe(50_000);

        expect(formatSupportAmount(500)).toBe('$5');
        expect(formatSupportAmount(750)).toBe('$7.50');
        expect(formatSupportAmount(1005)).toBe('$10.05');
      },
    );
    it(
      'keeps support source encoding-safe and has no custom amount',
      () => {
        const source =
          readFileSync(
            resolve(
              repositoryRoot,
              'app/src/components/support/SupportCheckout.tsx',
            ),
            'utf8',
          );

        expect(source).toContain(
          "'Checking Twitch\\u2026'",
        );

        expect(source).toContain(
          "{'\\u2713'}",
        );

        expect(source).not.toContain(
          'customAmount',
        );
      },
    );
    it(
      'keeps the amount at full size inside pages that style every label (the Support popup on the generator)',
      () => {
        const source =
          readFileSync(
            resolve(
              repositoryRoot,
              'app/src/components/support/SupportCheckout.tsx',
            ),
            'utf8',
          );
        /* The generator's global `label { font-size: .85rem; color: … }` reaches
           the amount's <label> in the popup; the field must reset it. */
        const rule = source.match(/\.amount-display \.amount-field \{([^}]*)\}/);
        expect(rule?.[1]).toMatch(/font: inherit;/);
        expect(rule?.[1]).toMatch(/color: inherit;/);
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
      'holds $5 or more in one amount box: it never shows less, with − and + to change it',
      async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
          String(input) === '/api/auth/me'
            ? new Response(JSON.stringify(SIGNED_IN_BUYER), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : new Response('{}', { status: 404 })
        )));

        render(
          <SupportPage />,
        );

        fireEvent.click(
          await screen.findByRole('radio', { name: 'As a gift' }),
        );

        const amount = screen.getByRole('textbox', { name: 'Support amount in US dollars ($5 or more)' }) as HTMLInputElement;
        const less = screen.getByRole('button', { name: '$1 less' }) as HTMLButtonElement;
        const more = screen.getByRole('button', { name: '$1 more' }) as HTMLButtonElement;
        const continueButton = () => screen.getByRole('button', { name: /^Continue with/ }) as HTMLButtonElement;
        expect(amount.value).toBe('5');
        expect(screen.getByText('One time, $5 or more.')).toBeTruthy();
        expect(continueButton().textContent).toBe('Continue with $5');

        for (const name of ['$10', '$25', 'Top', 'Custom']) {
          expect(
            screen.queryByRole('button', { name }),
          ).toBeNull();
        }

        /* Less than $5 can't even be typed: the box keeps what it had. */
        for (const typed of ['4.99', '3', '1', '0', '', 'abc']) {
          fireEvent.change(amount, { target: { value: typed } });
          expect(amount.value, typed).toBe('5');
          expect(continueButton().textContent).toBe('Continue with $5');
        }
        expect(less.disabled).toBe(true);

        /* − and + move a dollar at a time; − stops at $5. */
        fireEvent.pointerDown(more, { button: 0 });
        fireEvent.pointerUp(window);
        expect(amount.value).toBe('6');
        fireEvent.pointerDown(more, { button: 0 });
        fireEvent.pointerUp(window);
        expect(amount.value).toBe('7');
        expect(less.disabled).toBe(false);
        fireEvent.pointerDown(less, { button: 0 });
        fireEvent.pointerUp(window);
        fireEvent.pointerDown(less, { button: 0 });
        fireEvent.pointerUp(window);
        expect(amount.value).toBe('5');
        expect(less.disabled).toBe(true);

        /* Keyboard: Enter/Space on the buttons, and the arrow keys in the box. */
        fireEvent.click(more, { detail: 0 });
        expect(amount.value).toBe('6');
        fireEvent.keyDown(amount, { key: 'ArrowUp' });
        expect(amount.value).toBe('7');
        fireEvent.keyDown(amount, { key: 'ArrowDown' });
        fireEvent.keyDown(amount, { key: 'ArrowDown' });
        fireEvent.keyDown(amount, { key: 'ArrowDown' });
        expect(amount.value).toBe('5');

        /* Typing that stays at $5 or more works, cents shown only when there are some. */
        fireEvent.change(amount, { target: { value: '50' } });
        expect(continueButton().textContent).toBe('Continue with $50');
        fireEvent.change(amount, { target: { value: '7.5' } });
        expect(continueButton().textContent).toBe('Continue with $7.50');
        fireEvent.blur(amount);
        expect(amount.value).toBe('7.50');
        fireEvent.change(amount, { target: { value: '20.555' } });
        expect(amount.value).toBe('20.55');

        /* Nor more than $500. */
        fireEvent.change(amount, { target: { value: '500' } });
        fireEvent.change(amount, { target: { value: '5000' } });
        expect(amount.value).toBe('500');
        expect(more.disabled).toBe(true);
        expect(screen.getByText('The most for one payment is $500.')).toBeTruthy();

        fireEvent.change(amount, { target: { value: '5' } });

        expect(
          screen.getByText('YourNameHere'),
        ).toBeTruthy();

        fireEvent.click(
          screen.getByRole('button', { name: 'Continue with $5' }),
        );

        expect(
          screen.getByRole('status').textContent,
        ).toContain('cannot charge you');
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
          'FlossChat Supporter',
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
          '/badges/gxufy/supporter-hand.webp',
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
      'shows the supporter badge once for an account that already owns it',
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
                'community:gxufy:supporter',
              title:
                'FlossChat Supporter',
              url:
                '/badges/gxufy/supporter/1x.webp',
            },
          ],
        };

        for (const includeSupporter of [true, false]) {
          const badges =
            buildSupportBadgePreview(
              response,
              [
                {
                  type:
                    'community:gxufy:supporter',
                  url:
                    '/badges/gxufy/supporter/2x.webp',
                },
              ],
              null,
              includeSupporter,
            );

          expect(
            badges.map(
              (badge) =>
                badge.url,
            ),
          ).toEqual([
            SUPPORT_BADGE.url,
          ]);
        }
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
              input: RequestInfo | URL,
              _init?: RequestInit,
            ) =>
              String(input) === '/api/auth/me'
                ? new Response(
                  JSON.stringify(SIGNED_IN_BUYER),
                  { status: 200, headers: { 'Content-Type': 'application/json' } },
                )
                : new Response(
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

        fireEvent.click(
          await screen.findByRole('radio', { name: 'As a gift' }),
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
         * Verification still has to be the first Twitch request. Additional
         * calls are cosmetic hydration and are allowed only afterward. The
         * page's own sign-in check (/api/auth/me) is not a Twitch lookup.
         */
        const twitchCalls =
          fetchMock.mock.calls
            .map((call) => String(call[0]))
            .filter((url) => url !== '/api/auth/me');
        expect(
          twitchCalls[0],
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
            'img[alt="FlossChat Supporter"]',
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

        /* Owner decision 2026-11-15: no Support link in the homepage bar. */
        expect(
          home,
        ).not.toContain(
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
