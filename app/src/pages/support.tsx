import Head from 'next/head';

import type {
  GetServerSideProps,
} from 'next';

import {
  FormEvent,
  type CSSProperties,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  SUPPORT_AMOUNT_CENTS,
  SUPPORT_AMOUNT_LABEL,
  SUPPORT_BADGE,
  SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS,
  normalizeSupportTwitchLogin,
  parseSupportTwitchUser,
  supportPageEnabled,
  type SupportTwitchUser,
} from '@/lib/supportPage';

import {
  acquirePreviewIdentity,
  cachedPreviewIdentity,
} from '@/features/multichat/previewIdentityClient';

import type {
  PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';

import {
  loadPreviewBttvProBadges,
} from '@/features/multichat/previewBttvPro';

import {
  resolveTwitchJilChatBadges,
} from '@/lib/communityBadges';

import {
  buildPaintStyle,
} from '@/lib/multichatMessageModel';

import type {
  UnifiedBadge,
} from '@/lib/types';

type AccountState =
  | 'idle'
  | 'waiting'
  | 'checking'
  | 'found'
  | 'error'
  | 'unavailable';

const SUPPORT_CUSTOM_MIN_CENTS = SUPPORT_AMOUNT_CENTS;
const SUPPORT_CUSTOM_MAX_CENTS =
  10_000_000;

function parseSupportAmountCents(
  value: string,
): number | null {
  const normalized =
    value
      .trim()
      .replace(/^\$/, '');

  if (
    !/^(?:\d+|\d+\.\d{1,2})$/
      .test(normalized)
  ) {
    return null;
  }

  const [
    dollars,
    fraction = '',
  ] =
    normalized.split('.');

  const cents =
    Number(dollars) * 100
    + Number(
      fraction.padEnd(2, '0'),
    );

  if (
    !Number.isSafeInteger(cents)
    || cents
      < SUPPORT_CUSTOM_MIN_CENTS
    || cents
      > SUPPORT_CUSTOM_MAX_CENTS
  ) {
    return null;
  }

  return cents;
}

function formatSupportAmountLabel(
  cents: number,
): string {
  const dollars =
    cents / 100;

  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}

type BadgeLoadState =
  | 'idle'
  | 'loading'
  | 'loaded';

export type SupportBadgePreview = {
  readonly key: string;
  readonly title: string;
  readonly url: string;
};

function unifiedBadgeUrl(
  badge: UnifiedBadge,
): string | null {
  return (
    badge.url
    ?? badge.fallbackUrl
    ?? null
  );
}

export function buildSupportBadgePreview(
  response:
    PreviewIdentityResponse | null,
  deferredCommunityBadges:
    readonly UnifiedBadge[] = [],
  bttvProBadgeUrl:
    string | null = null,
  includeSupporter = false,
): readonly SupportBadgePreview[] {
  const result:
  SupportBadgePreview[] = [];

  const seen =
    new Set<string>();

  const push = (
    key: string,
    title: string,
    url:
      string | null | undefined,
  ) => {
    if (
      !url
      || seen.has(url)
    ) {
      return;
    }

    seen.add(url);

    result.push({
      key:
        `${key}:${url}`,
      title,
      url,
    });
  };

  if (response) {
    const twitch =
      response.providers
        .Twitch?.resources;

    for (
      const badge
      of twitch?.ownedBadges
        ?? []
    ) {
      push(
        `twitch:${badge.type}:${badge.version ?? ''}`,
        badge.title
          ?? (
            badge.version
              ? `Twitch ${badge.type} ${badge.version}`
              : `Twitch ${badge.type}`
          ),
        unifiedBadgeUrl(
          badge,
        ),
      );
    }

    const ffz =
      response.providers
        .FFZ?.resources;

    for (
      const badge
      of ffz?.ownedBadges
        ?? []
    ) {
      push(
        `ffz:${badge.id}`,
        `FFZ ${badge.id}`,
        badge.image,
      );
    }

    const bttv =
      response.providers
        .BTTV?.resources;

    for (
      const badge
      of bttv?.ownedBadges
        ?? []
    ) {
      push(
        `bttv:${badge.id}`,
        `BTTV ${badge.id}`,
        badge.image,
      );
    }

    const sevenTV =
      response.providers[
        '7TV'
      ]?.resources.badge;

    if (sevenTV) {
      push(
        `7tv:${sevenTV.id}`,
        `7TV ${sevenTV.id}`,
        sevenTV.image,
      );
    }

    for (
      const badge
      of response
        .communityBadges
        ?? []
    ) {
      push(
        `community:${badge.type}:${badge.version ?? ''}`,
        badge.title
          ?? badge.type,
        unifiedBadgeUrl(
          badge,
        ),
      );
    }
  }

  for (
    const badge
    of deferredCommunityBadges
  ) {
    push(
      `deferred:${badge.type}:${badge.version ?? ''}`,
      badge.title
        ?? badge.type,
      unifiedBadgeUrl(
        badge,
      ),
    );
  }

  if (bttvProBadgeUrl) {
    push(
      'bttv-pro',
      'BTTV Pro',
      bttvProBadgeUrl,
    );
  }

  if (includeSupporter) {
    push(
      `gxufy:${SUPPORT_BADGE.id}`,
      SUPPORT_BADGE.title,
      SUPPORT_BADGE.url,
    );
  }

  return result;
}

export function buildSupportUsernameStyle(
  response:
    PreviewIdentityResponse | null,
): CSSProperties | undefined {
  const paint =
    response?.providers[
      '7TV'
    ]?.resources.paint;

  if (!paint) {
    return undefined;
  }

  const {
    background,
    filter,
  } = buildPaintStyle(
    paint,
    true,
  );

  if (!background) {
    return undefined;
  }

  return {
    background,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    textShadow: 'none',
    filter:
      filter || undefined,
  };
}
export const getServerSideProps:
GetServerSideProps = async () => {
  if (!supportPageEnabled()) {
    return {
      notFound: true,
    };
  }

  return {
    props: {},
  };
};

export default function SupportPage() {
  const [
    twitchInput,
    setTwitchInput,
  ] = useState('');

  const [
    amountMode,
    setAmountMode,
  ] =
    useState<
      'preset' | 'custom'
    >('preset');

  const [
    customAmount,
    setCustomAmount,
  ] = useState('5');

  const [
    accountState,
    setAccountState,
  ] = useState<AccountState>(
    'idle',
  );

  const [
    accountMessage,
    setAccountMessage,
  ] = useState('');

  const [
    account,
    setAccount,
  ] =
    useState<
      SupportTwitchUser | null
    >(null);

  const [
    submissionNote,
    setSubmissionNote,
  ] = useState('');

  const [
    badgeIdentity,
    setBadgeIdentity,
  ] =
    useState<
      PreviewIdentityResponse | null
    >(null);

  const [
    deferredCommunityBadges,
    setDeferredCommunityBadges,
  ] =
    useState<
      readonly UnifiedBadge[]
    >([]);

  const [
    bttvProBadgeUrl,
    setBttvProBadgeUrl,
  ] =
    useState<
      string | null
    >(null);

  const [
    badgeLoadState,
    setBadgeLoadState,
  ] =
    useState<
      BadgeLoadState
    >('idle');

  const normalizedLogin =
    useMemo(
      () =>
        normalizeSupportTwitchLogin(
          twitchInput,
        ),
      [twitchInput],
    );

  const customAmountCents =
    useMemo(
      () =>
        parseSupportAmountCents(
          customAmount,
        ),
      [customAmount],
    );

  const amountCents =
    amountMode === 'custom'
      ? customAmountCents
      : SUPPORT_AMOUNT_CENTS;

  const amountValid =
    amountCents !== null;

  const amountLabel =
    amountCents === null
      ? 'Custom amount'
      : formatSupportAmountLabel(
          amountCents,
        );

  const qualifiesForSupporter =
    (
      amountCents
      ?? 0
    )
    >= SUPPORT_BADGE.minimumCents;

  const hasTwitchInput =
    twitchInput.trim().length > 0;

  const hasPreview =
    accountState === 'found'
    && account !== null
    && account.login
      === normalizedLogin;

  const ready =
    amountValid
    && (
      !hasTwitchInput
      || hasPreview
    );

  const supportUsernameStyle =
    useMemo(
      () =>
        buildSupportUsernameStyle(
          badgeIdentity,
        ),
      [badgeIdentity],
    );

  const supportBadges =
    useMemo(
      () =>
        buildSupportBadgePreview(
          badgeIdentity,
          deferredCommunityBadges,
          bttvProBadgeUrl,
          qualifiesForSupporter,
        ),
      [
        badgeIdentity,
        deferredCommunityBadges,
        bttvProBadgeUrl,
        qualifiesForSupporter,
      ],
    );

  useEffect(() => {
    const raw =
      twitchInput.trim();

    setSubmissionNote('');

    if (!raw) {
      setAccount(null);
      setAccountState('idle');
      setAccountMessage('');
      return;
    }

    if (!normalizedLogin) {
      setAccount(null);
      setAccountState('error');
      setAccountMessage(
        raw
          .replace(/^@+/, '')
          .length < 3
          ? 'Use at least 3 characters.'
          : 'Use 3 to 25 letters, numbers, or underscores.',
      );
      return;
    }

    const controller =
      new AbortController();

    setAccount(null);
    setAccountState(
      'waiting',
    );
    setAccountMessage(
      'Checking Twitch\u2026',
    );

    const timer =
      window.setTimeout(
        async () => {
          setAccountState(
            'checking',
          );

          try {
            const response =
              await fetch(
                `/api/twitch/support-user?login=${
                  encodeURIComponent(
                    normalizedLogin,
                  )
                }`,
                {
                  cache: 'no-store',
                  signal:
                    controller
                      .signal,
                },
              );

            const body =
              await response
                .json()
                .catch(
                  () => null,
                );

            if (
              controller
                .signal
                .aborted
            ) {
              return;
            }

            if (
              response.status
              === 404
            ) {
              setAccountState(
                'error',
              );
              setAccountMessage(
                'No Twitch account found.',
              );
              return;
            }

            if (!response.ok) {
              setAccountState(
                'unavailable',
              );
              setAccountMessage(
                'Twitch verification is temporarily unavailable.',
              );
              return;
            }

            const parsed =
              parseSupportTwitchUser(
                body,
                normalizedLogin,
              );

            if (!parsed) {
              setAccountState(
                'unavailable',
              );
              setAccountMessage(
                'Twitch verification returned an invalid response.',
              );
              return;
            }

            setAccount(parsed);
            setAccountState(
              'found',
            );
            setAccountMessage(
              `Verified as ${parsed.displayName}.`,
            );
          } catch (error) {
            if (
              controller
                .signal
                .aborted
              || (
                error
                instanceof
                  DOMException
                && error.name
                  === 'AbortError'
              )
            ) {
              return;
            }

            setAccountState(
              'unavailable',
            );
            setAccountMessage(
              'Twitch verification is temporarily unavailable.',
            );
          }
        },
        SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS,
      );

    return () => {
      window.clearTimeout(
        timer,
      );
      controller.abort();
    };
  }, [
    twitchInput,
    normalizedLogin,
  ]);

  useEffect(() => {
    let cancelled =
      false;

    setDeferredCommunityBadges(
      [],
    );

    setBttvProBadgeUrl(
      null,
    );

    if (
      !hasPreview
      || !account
    ) {
      setBadgeIdentity(
        null,
      );

      setBadgeLoadState(
        'idle',
      );

      return;
    }

    setBadgeLoadState(
      'loading',
    );

    /*
     * Session cache can paint badges immediately when this Twitch identity
     * has already been used by Preview Data in the same browser session.
     */
    const cached =
      cachedPreviewIdentity(
        account.login,
      );

    if (
      cached
      && cached.identity.userId
        === account.id
    ) {
      setBadgeIdentity(
        cached,
      );
    } else {
      setBadgeIdentity(
        null,
      );
    }

    const acquired =
      acquirePreviewIdentity(
        account.login,
      );

    const acceptIdentity = (
      response:
        PreviewIdentityResponse,
    ) => {
      if (
        cancelled
        || response.identity
          .userId !== account.id
        || response.identity
          .login !== account.login
      ) {
        return;
      }

      setBadgeIdentity(
        response,
      );
    };

    /*
     * Base Twitch/FFZ/BTTV/7TV resources appear first.
     */
    void acquired.promise
      .then(
        acceptIdentity,
      )
      .catch(() => {
        /*
         * Verification already succeeded independently.
         * Cosmetics failure never invalidates the account.
         */
      })
      .finally(() => {
        acquired.release();
      });

    /*
     * Normal community providers enrich the same response in the background.
     */
    void acquired.enrichment
      .then(
        acceptIdentity,
      )
      .catch(() => {
        // Supplementary cosmetics only.
      });

    /*
     * JilChat is intentionally deferred from the normal Preview fast path.
     */
    const jilChat =
      resolveTwitchJilChatBadges(
        account.id,
      )
        .then((badges) => {
          if (cancelled) {
            return;
          }

          setDeferredCommunityBadges(
            badges,
          );
        })
        .catch(() => {
          // Supplementary provider only.
        });

    /*
     * BTTV Pro uses the existing one-user websocket lookup and is also
     * independent of account verification.
     */
    const bttvPro =
      loadPreviewBttvProBadges([
        {
          userId:
            account.id,
        },
      ])
        .then((badges) => {
          if (cancelled) {
            return;
          }

          setBttvProBadgeUrl(
            badges.get(
              account.id,
            )
            ?? null,
          );
        })
        .catch(() => {
          // Supplementary provider only.
        });

    void Promise
      .allSettled([
        acquired.enrichment,
        jilChat,
        bttvPro,
      ])
      .then(() => {
        if (cancelled) {
          return;
        }

        setBadgeLoadState(
          'loaded',
        );
      });

    return () => {
      cancelled = true;
      acquired.release();
    };
  }, [
    hasPreview,
    account,
  ]);

  function submit(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!ready) return;

    setSubmissionNote(
      hasPreview
        ? `Checkout is not connected yet. ${account?.displayName} is verified as the future badge recipient.`
        : 'Checkout is not connected yet. This private preview cannot charge you.',
    );
  }

  const indicator =
    accountState === 'found'
    && account
      ? (
        account
          .profileImageUrl
          ? (
            <img
              className="account-avatar"
              src={
                account
                  .profileImageUrl
              }
              alt=""
              aria-hidden="true"
            />
          )
          : (
            <span
              className="account-check"
              aria-hidden="true"
            >
              {'\u2713'}
            </span>
          )
      )
      : (
        accountState
          === 'waiting'
        || accountState
          === 'checking'
          ? (
            <span
              className="account-spinner"
              aria-hidden="true"
            />
          )
          : accountState
            === 'error'
          || accountState
            === 'unavailable'
            ? (
              <span
                className="account-warning"
                aria-hidden="true"
              >
                !
              </span>
            )
            : null
      );

  return (
    <>
      <Head>
        <title>
          Support Gxufy | Private Preview
        </title>

        <meta
          name="robots"
          content="noindex,nofollow,noarchive"
        />

        <meta
          name="description"
          content="Private preview of the Gxufy supporter flow."
        />
      </Head>
      <style jsx global>{`
*,
        *::before,
        *::after {
          box-sizing: border-box;
        }

        html,
        body,
        .support-page {
          min-height: 100%;
          margin: 0;
          background:
            radial-gradient(
              circle at 50% -10%,
              rgba(69, 126, 255, .17),
              transparent 38rem
            ),
            radial-gradient(
              circle at 85% 60%,
              rgba(87, 67, 255, .08),
              transparent 34rem
            ),
            #0e0f14;
          color: #f6f7fb;
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        button,
        input {
          font: inherit;
        }

        button {
          color: inherit;
        }

        .support-page {
          min-height: 100vh;
          padding:
            26px
            28px
            64px;
        }

        .support-shell {
          width:
            min(
              920px,
              100%
            );
          margin:
            0 auto;
        }

        .support-brand {
          display:
            inline-flex;
          align-items:
            center;
          gap: 9px;
          color:
            #f8f9ff;
          text-decoration:
            none;
          font-size:
            14px;
          font-weight:
            850;
          letter-spacing:
            -.025em;
        }

        .support-preview-pill {
          margin-left:
            10px;
          border:
            1px solid
              rgba(
                111,
                157,
                255,
                .28
              );
          border-radius:
            999px;
          padding:
            4px 8px;
          color:
            #8eb3ff;
          background:
            rgba(
              64,
              112,
              220,
              .08
            );
          font-size:
            10px;
          font-weight:
            800;
          letter-spacing:
            .08em;
          text-transform:
            uppercase;
        }

        .support-heading {
          margin:
            72px auto
            46px;
          text-align:
            center;
        }

        .support-heading h1 {
          margin: 0;
          color:
            #f6f7fb;
          font-family:
            Georgia,
            "Times New Roman",
            serif;
          font-size:
            clamp(
              44px,
              7vw,
              68px
            );
          font-weight:
            400;
          letter-spacing:
            -.04em;
          line-height:
            1.03;
        }

        .support-heading h1 em {
          color:
            #75a2ff;
          font-weight:
            400;
        }

        .support-heading p {
          max-width:
            520px;
          margin:
            17px auto 0;
          color:
            #979ba9;
          font-size:
            14px;
          line-height:
            1.7;
        }

        .support-composition {
          --support-gap:
            64px;
          display:
            grid;
          grid-template-columns:
            repeat(
              2,
              minmax(0, 1fr)
            );
          gap:
            var(
              --support-gap
            );
          align-items:
            end;
        }

        .support-checkout {
          min-width: 0;
          transform:
            translateX(
              calc(
                50%
                + var(
                  --support-gap
                ) / 2
              )
            );
          transition:
            transform
              .52s
              cubic-bezier(
                .22,
                1,
                .36,
                1
              );
        }

        .support-composition.has-preview
        .support-checkout {
          transform: none;
        }

        .support-checkout fieldset {
          min-width: 0;
          margin: 0;
          padding: 0;
          border: 0;
        }

        .sr-only {
          position:
            absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          clip:
            rect(
              0,
              0,
              0,
              0
            );
          overflow:
            hidden;
          white-space:
            nowrap;
          border: 0;
        }

        .amount-display {
          display:
            flex;
          justify-content:
            center;
          align-items:
            baseline;
          gap: 4px;
          margin-bottom:
            17px;
          color:
            #f5f7ff;
          cursor:
            text;
          font-family:
            Georgia,
            "Times New Roman",
            serif;
          font-size:
            clamp(
              56px,
              7vw,
              72px
            );
          font-weight:
            400;
          line-height:
            1.15;
        }

        .amount-symbol {
          color:
            #75a2ff;
        }

        .amount-field {
          width:
            min(
              250px,
              58vw
            );
        }

        .amount-field input {
          width: 100%;
          border: 0;
          outline: 0;
          padding: 0;
          background:
            transparent;
          color: inherit;
          font: inherit;
          letter-spacing:
            -.055em;
          text-align:
            center;
        }

        .amount-field input::selection {
          background:
            rgba(
              117,
              162,
              255,
              .35
            );
        }

        .amount-currency {
          margin-left:
            7px;
          color:
            #777d8c;
          font-family:
            Inter,
            sans-serif;
          font-size:
            11px;
          font-weight:
            750;
          letter-spacing:
            .08em;
        }

        .amount-options {
          display:
            flex;
          justify-content:
            center;
          gap: 7px;
          margin: 0;
        }

        .amount-option {
          min-width: 76px;
          border:
            1px solid
              rgba(
                117,
                162,
                255,
                .22
              );
          border-radius:
            8px;
          padding:
            9px 14px;
          color:
            #aeb6c9;
          background:
            rgba(
              255,
              255,
              255,
              .035
            );
          font: inherit;
          font-size:
            12px;
          font-weight:
            750;
          cursor:
            pointer;
        }

        .amount-option:hover {
          color:
            #f7f9ff;
          border-color:
            rgba(
              117,
              162,
              255,
              .52
            );
        }

        .amount-option.is-active {
          color:
            #fff;
          border-color:
            #75a2ff;
          background:
            rgba(
              72,
              125,
              241,
              .30
            );
        }

        .amount-option:focus-visible {
          outline:
            2px solid #fff;
          outline-offset:
            2px;
        }

        .amount-error {
          margin:
            9px 0 0;
          color:
            #ff8d9b;
          font-size:
            11px;
          line-height:
            1.45;
          text-align:
            center;
        }

        .account-label {
          display:
            block;
          margin-top:
            34px;
          color:
            #dce2f3;
          font-size:
            12px;
          font-weight:
            760;
        }

        .account-label span {
          color:
            #7d8392;
          font-weight:
            500;
        }

        .account-input {
          isolation:
            isolate;
          display:
            flex;
          align-items:
            center;
          margin-top:
            9px;
          border:
            1px solid
              rgba(
                255,
                255,
                255,
                .07
              );
          border-radius:
            15px;
          background:
            linear-gradient(
              180deg,
              #1b1e29,
              #12141b 85%
            );
          box-shadow:
            inset
              0 1px
              rgba(
                255,
                255,
                255,
                .045
              ),
            0 8px 22px
              rgba(
                0,
                0,
                0,
                .22
              );
          transition:
            border-color
              .2s,
            box-shadow
              .2s;
        }

        .account-input:focus-within {
          border-color:
            rgba(
              117,
              162,
              255,
              .45
            );
          box-shadow:
            0 0 0 3px
              rgba(
                117,
                162,
                255,
                .07
              ),
            0 8px 22px
              rgba(
                0,
                0,
                0,
                .22
              );
        }

        .account-prefix {
          padding-left:
            17px;
          color:
            #7f8697;
          font-size:
            15px;
        }

        .account-input input {
          width: 100%;
          min-width: 0;
          height:
            50px;
          border: 0;
          outline: 0;
          padding:
            0 10px;
          background:
            transparent;
          color:
            #f1f3fa;
          font-size:
            14px;
        }

        .account-input input::placeholder {
          color:
            #686e7d;
        }

        .account-indicator {
          display:
            grid;
          flex:
            0 0 40px;
          place-items:
            center;
          width:
            40px;
          height:
            40px;
          margin-right:
            5px;
        }

        .account-avatar {
          width:
            36px;
          height:
            36px;
          border-radius:
            10px;
          object-fit:
            cover;
          outline:
            1px solid
              rgba(
                255,
                255,
                255,
                .09
              );
        }

        .account-spinner {
          width:
            19px;
          height:
            19px;
          border:
            2px solid
              rgba(
                255,
                255,
                255,
                .12
              );
          border-top-color:
            #84aaff;
          border-radius:
            999px;
          animation:
            account-spin
              .8s
              linear
              infinite;
        }

        @keyframes account-spin {
          to {
            transform:
              rotate(360deg);
          }
        }

        .account-check {
          display:
            grid;
          place-items:
            center;
          width:
            26px;
          height:
            26px;
          border-radius:
            999px;
          background:
            rgba(
              81,
              195,
              138,
              .13
            );
          color:
            #7be0aa;
          font-size:
            15px;
          font-weight:
            900;
        }

        .account-warning {
          display:
            grid;
          place-items:
            center;
          width:
            26px;
          height:
            26px;
          border-radius:
            999px;
          background:
            rgba(
              255,
              120,
              112,
              .11
            );
          color:
            #ffaaa2;
          font-size:
            14px;
          font-weight:
            900;
        }

        .account-status {
          display:
            flex;
          align-items:
            center;
          min-height:
            38px;
          padding:
            4px 1px;
          color:
            #818898;
          font-size:
            11px;
          line-height:
            1.45;
        }

        .account-status.is-found {
          color:
            #83d7ac;
        }

        .account-status.is-error,
        .account-status.is-unavailable {
          color:
            #e7aaa4;
        }

        .continue-button {
          width: 100%;
          min-height:
            50px;
          border:
            1px solid
              rgba(
                130,
                169,
                255,
                .45
              );
          border-radius:
            13px;
          padding:
            0 17px;
          background:
            linear-gradient(
              180deg,
              #558cff,
              #3f72e5
            );
          color: #fff;
          cursor:
            pointer;
          font-weight:
            820;
          box-shadow:
            inset
              0 1px
              rgba(
                255,
                255,
                255,
                .22
              ),
            0 12px 30px
              rgba(
                48,
                100,
                230,
                .22
              );
        }

        .continue-button:hover:not(:disabled) {
          background:
            linear-gradient(
              180deg,
              #6799ff,
              #4a7bea
            );
        }

        .continue-button:disabled {
          cursor:
            not-allowed;
          opacity: .38;
          box-shadow: none;
        }

        .submission-note {
          margin:
            12px 0 0;
          border:
            1px solid
              rgba(
                117,
                162,
                255,
                .2
              );
          border-radius:
            11px;
          padding:
            11px
            12px;
          background:
            rgba(
              78,
              123,
              225,
              .07
            );
          color:
            #b8cbf5;
          font-size:
            11px;
          line-height:
            1.55;
        }

        .support-vanity {
          min-width: 0;
          text-align:
            center;
          opacity: 0;
          visibility:
            hidden;
          filter:
            blur(7px);
          transform:
            translateX(18px);
          transition:
            opacity
              .32s,
            filter
              .42s,
            transform
              .52s
              cubic-bezier(
                .22,
                1,
                .36,
                1
              ),
            visibility
              .52s;
        }

        .support-composition.has-preview
        .support-vanity {
          opacity: 1;
          visibility:
            visible;
          filter: none;
          transform: none;
        }

        .supporter-emblem {
          display:
            grid;
          place-items:
            center;
          width:
            250px;
          max-width:
            100%;
          height:
            164px;
          margin:
            0 auto 8px;
        }

        .supporter-emblem img {
          width:
            126px;
          height:
            126px;
          object-fit:
            contain;
          filter:
            drop-shadow(
              0 15px 32px
              rgba(
                65,
                113,
                235,
                .22
              )
            );
          transition:
            opacity .25s,
            filter .25s;
        }

        .supporter-emblem.is-locked
        img {
          opacity: .34;
          filter:
            saturate(.25)
            drop-shadow(
              0 10px 24px
              rgba(
                0,
                0,
                0,
                .3
              )
            );
        }

        .support-vanity h2 {
          margin:
            0 0 10px;
          color:
            #f0f3fb;
          font-family:
            Georgia,
            "Times New Roman",
            serif;
          font-size:
            30px;
          font-weight:
            400;
          letter-spacing:
            -.025em;
          line-height:
            1.2;
        }

        .support-vanity h2 span {
          color:
            #75a2ff;
        }

        .reward-copy {
          min-height:
            40px;
          margin: 0;
          color:
            #9299aa;
          font-size:
            11px;
          line-height:
            1.65;
        }

        .chat-preview {
          display:
            grid;
          align-items:
            center;
          min-height:
            50px;
          margin-top:
            34px;
          border:
            1px solid
              rgba(
                255,
                255,
                255,
                .055
              );
          border-radius:
            15px;
          padding:
            12px 16px;
          background:
            linear-gradient(
              180deg,
              rgba(
                33,
                40,
                58,
                .78
              ),
              rgba(
                16,
                19,
                28,
                .9
              )
            );
          box-shadow:
            inset
              0 1px
              rgba(
                150,
                180,
                255,
                .07
              ),
            0 10px 32px
              rgba(
                0,
                0,
                0,
                .25
              );
        }

        .chat-row {
          display:
            flex;
          flex-wrap:
            wrap;
          justify-content:
            center;
          align-items:
            center;
          gap: 5px;
          min-height:
            22px;
        }

        .chat-badge {
          width:
            20px;
          height:
            20px;
          object-fit:
            contain;
          border-radius:
            2px;
        }

        .badge-load-status {
          min-height:
            17px;
          margin:
            10px 0 0;
          color:
            #737b8e;
          font-size:
            10px;
          line-height:
            1.5;
          text-align:
            center;
        }

        .chat-name {
          margin-left:
            2px;
          color:
            #92b5ff;
          font-size:
            14px;
          font-weight:
            800;
        }

        .support-total-note {
          margin:
            52px auto 0;
          color:
            #656c7b;
          font-size:
            11px;
          line-height:
            1.65;
          text-align:
            center;
        }

        @media (
          max-width: 760px
        ) {
          .support-page {
            padding:
              20px
              20px
              46px;
          }

          .support-heading {
            margin:
              48px auto
              38px;
          }

          .support-composition {
            grid-template-columns:
              1fr;
            gap:
              38px;
          }

          .support-checkout {
            transform: none;
          }

          .support-vanity {
            display: none;
            transform: none;
          }

          .support-composition.has-preview
          .support-vanity {
            display: block;
          }

          .amount-field {
            width:
              min(
                220px,
                55vw
              );
          }

          .support-total-note {
            margin-top:
              38px;
          }
        }

        @media (
          prefers-reduced-motion:
            reduce
        ) {
          *,
          *::before,
          *::after {
            scroll-behavior:
              auto !important;
            transition-duration:
              .01ms !important;
            animation-duration:
              .01ms !important;
            animation-iteration-count:
              1 !important;
          }
        }
      `}</style>



      <main className="support-page">
        <div className="support-shell">
          <a
            className="support-brand"
            href="/"
          >
            <span>
              {
                'Gxufy \u{1F54A}\uFE0F'
              }
            </span>

            <span className="support-preview-pill">
              Private preview
            </span>
          </a>

          <header className="support-heading">
            <h1>
              Support <em>Gxufy</em>
            </h1>

            <p>
              Help keep MultiChat frequently updated
              as platforms change their APIs.
              Twitch, Kick, YouTube, TikTok, badges,
              emotes, and overlays all need ongoing
              maintenance. Development time adds up.
              Twitch is optional unless you want a
              supporter badge linked to your account.
            </p>
          </header>

          <div
            className={
              `support-composition${
                hasPreview
                  ? ' has-preview'
                  : ''
              }`
            }
          >
            <form
              className="support-checkout"
              onSubmit={submit}
              noValidate
            >
              <fieldset>
                <legend className="sr-only">
                  Support amount
                </legend>

                <div
                  className="amount-display"
                  aria-label={`Support amount: ${amountLabel} USD`}
                >
                  <span
                    className="amount-symbol"
                    aria-hidden="true"
                  >
                    $
                  </span>

                  <span className="amount-field">
                    <input
                      id="support-amount"
                      aria-label="Support amount in US dollars"
                      inputMode="decimal"
                      value={
                        amountMode
                        === 'custom'
                          ? customAmount
                          : SUPPORT_AMOUNT_CENTS / 100
                      }
                      readOnly={
                        amountMode
                        !== 'custom'
                      }
                      tabIndex={
                        amountMode
                        === 'custom'
                          ? 0
                          : -1
                      }
                      onChange={(event) => {
                        if (
                          amountMode
                          !== 'custom'
                        ) {
                          return;
                        }

                        setCustomAmount(
                          event.target
                            .value,
                        );

                        setSubmissionNote('');
                      }}
                    />
                  </span>

                  <span className="amount-currency">
                    USD
                  </span>
                </div>

                <div
                  className="amount-options"
                  aria-label="Support amount options"
                >
                  <button
                    type="button"
                    className={
                      `amount-option${
                        amountMode
                        === 'preset'
                          ? ' is-active'
                          : ''
                      }`
                    }
                    aria-pressed={
                      amountMode
                      === 'preset'
                    }
                    onClick={() => {
                      setAmountMode(
                        'preset',
                      );
                      setSubmissionNote('');
                    }}
                  >
                    {SUPPORT_AMOUNT_LABEL}
                  </button>

                  <button
                    type="button"
                    className={
                      `amount-option${
                        amountMode
                        === 'custom'
                          ? ' is-active'
                          : ''
                      }`
                    }
                    aria-pressed={
                      amountMode
                      === 'custom'
                    }
                    onClick={() => {
                      setAmountMode(
                        'custom',
                      );
                      setSubmissionNote('');
                    }}
                  >
                    Custom
                  </button>
                </div>

                {
                  amountMode
                  === 'custom'
                  && !amountValid
                    ? (
                      <p
                        className="amount-error"
                        role="alert"
                      >
                        Enter a custom amount from $5 to $100,000.
                      </p>
                    )
                    : null
                }

                <label
                  className="account-label"
                  htmlFor="support-twitch"
                >
                  Twitch username{' '}
                  <span>
                    (optional)
                  </span>
                </label>

                <div className="account-input">
                  <span
                    className="account-prefix"
                    aria-hidden="true"
                  >
                    @
                  </span>

                  <input
                    id="support-twitch"
                    aria-label="Twitch username"
                    aria-describedby="support-account-status"
                    autoComplete="off"
                    autoCapitalize="none"
                    placeholder="Username"
                    value={twitchInput}
                    onChange={(event) => {
                      setTwitchInput(
                        event.target
                          .value,
                      );
                    }}
                  />

                  <span className="account-indicator">
                    {indicator}
                  </span>
                </div>

                <div
                  id="support-account-status"
                  className={
                    `account-status is-${accountState}`
                  }
                  aria-live="polite"
                >
                  {
                    accountMessage
                    || 'Leave blank to support without linking a badge.'
                  }
                </div>

                <button
                  className="continue-button"
                  type="submit"
                  disabled={!ready}
                >
                  Continue with {amountLabel}
                </button>

                {submissionNote ? (
                  <p
                    className="submission-note"
                    role="status"
                  >
                    {submissionNote}
                  </p>
                ) : null}
              </fieldset>
            </form>

            <aside
              className="support-vanity"
              aria-label="Chat badge preview"
              aria-hidden={!hasPreview}
            >
              <div className="supporter-emblem">
                <img
                  src={
                    SUPPORT_BADGE.url
                  }
                  alt={
                    SUPPORT_BADGE.title
                  }
                />
              </div>

              <h2>
                Gxufy Supporter{' '}
                <span>
                  badge
                </span>
              </h2>

              <p className="reward-copy">
                {
                  qualifiesForSupporter
                    ? 'Included with this support amount and shown beside your name in Gxufy MultiChat after verified payment.'
                    : 'The Gxufy Supporter badge unlocks with support of $5 or more.'
                }
              </p>

              <div
                className="chat-preview"
                aria-label="Username preview"
              >
                <div className="chat-row">
                  {
                    supportBadges.map(
                      (badge) => (
                        <img
                          key={
                            badge.key
                          }
                          className="chat-badge"
                          src={
                            badge.url
                          }
                          alt={
                            badge.title
                          }
                          title={
                            badge.title
                          }
                        />
                      ),
                    )
                  }

                  <strong
                    className="chat-name"
                    style={
                      supportUsernameStyle
                    }
                  >
                    {
                      account
                        ?.displayName
                    }
                  </strong>
                </div>

                <p
                  className="badge-load-status"
                  aria-live="polite"
                >
                  {
                    badgeLoadState
                    === 'loading'
                      ? 'Loading linked Twitch badges\u2026'
                      : badgeLoadState
                        === 'loaded'
                        ? `${
                            supportBadges.length
                          } badge${
                            supportBadges.length
                            === 1
                              ? ''
                              : 's'
                          } shown.`
                        : ''
                  }
                </p>
              </div>
            </aside>
          </div>

          <footer className="support-total-note">
            Support can add up toward future Gxufy
            badge tiers. The payment and cumulative
            supporter-history systems are intentionally
            offline in this private preview.
          </footer>
        </div>
      </main>
    </>
  );
}
