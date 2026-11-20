

import {
  FormEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { HOME_ORIGIN } from '@/lib/domains.mjs';

import {
  SUPPORT_AMOUNT_CENTS,
  SUPPORT_BADGE,
  SUPPORT_MAX_CENTS,
  SUPPORT_MIN_CENTS,
  acceptSupportAmountInput,
  clampSupportAmountCents,
  formatSupportAmount,
  parseSupportAmount,
  stepSupportAmount,
  SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS,
  normalizeSupportTwitchLogin,
  parseSupportTwitchUser,
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

import {
  SPRING_EASING,
} from '@/components/site/motion';

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

  /* The FlossChat supporter badge itself is drawn once, at the end, from its
     feature art. A copy that already arrives with the account's community
     badges (they own it) is skipped here, so it never shows twice. */
  const supporterType =
    `community:gxufy:${SUPPORT_BADGE.id}`;

  let ownsSupporter =
    false;

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
      if (badge.type === supporterType) {
        ownsSupporter = true;
        continue;
      }

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
    if (badge.type === supporterType) {
      ownsSupporter = true;
      continue;
    }

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

  if (
    includeSupporter
    || ownsSupporter
  ) {
    push(
      `gxufy:${SUPPORT_BADGE.id}`,
      SUPPORT_BADGE.hoverTitle,
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
export type SupportCheckoutProps = {
  /** PayPal keys and the supporter store are both set up on the server. */
  checkoutReady?: boolean;
  /** 'modal' when shown over the MultiChat page instead of on /support. */
  variant?: 'page' | 'modal';
  /** Modal only: close button. */
  onClose?: () => void;
};

type CheckoutOutcome =
  | { kind: 'success'; displayName: string | null }
  | { kind: 'pending' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

function isPayPalApprovalUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:'
      && (url.hostname === 'www.paypal.com' || url.hostname === 'www.sandbox.paypal.com');
  } catch {
    return false;
  }
}

export default function SupportCheckout({
  checkoutReady = false,
  variant = 'page',
  onClose,
}: SupportCheckoutProps = {}) {

  const [
    checkoutBusy,
    setCheckoutBusy,
  ] = useState(false);

  const [
    outcome,
    setOutcome,
  ] = useState<CheckoutOutcome | null>(null);

  const [
    twitchInput,
    setTwitchInput,
  ] = useState('');


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

  /* Twitch sign-in: 'unknown' until /api/auth/me answers; null = signed out
     (or sign-in not set up, which hides the sign-in parts entirely). */
  const [
    signIn,
    setSignIn,
  ] = useState<
    | { ready: false }
    | { ready: true; user: SupportTwitchUser | null }
    | 'unknown'
  >('unknown');
  const [
    recipientMode,
    setRecipientMode,
  ] = useState<'self' | 'gift'>('self');
  /* What's typed in the amount: $5 or more, starting at $5. */
  const [
    amountText,
    setAmountText,
  ] = useState(String(SUPPORT_AMOUNT_CENTS / 100));

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setSignIn({ ready: false });
          return;
        }
        const body = await response.json().catch(() => null) as { user?: Record<string, unknown> | null } | null;
        const u = body?.user;
        const user = u && typeof u.id === 'string' && typeof u.login === 'string' && typeof u.displayName === 'string'
          ? {
            id: u.id,
            login: u.login,
            displayName: u.displayName,
            ...(typeof u.avatarUrl === 'string' ? { profileImageUrl: u.avatarUrl } : {}),
          }
          : null;
        if (!cancelled) setSignIn({ ready: true, user });
      })
      .catch(() => {
        if (!cancelled) setSignIn({ ready: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedInUser =
    signIn !== 'unknown' && signIn.ready ? signIn.user : null;

  /* Back to where sign-in started: the /support page, or the generator with
     this popup reopened. */
  const signInHref = `/api/auth/twitch/login?next=${encodeURIComponent(
    variant === 'modal' && typeof window !== 'undefined'
      ? `${window.location.pathname}?support=1`
      : '/support',
  )}`;
  const forSelf =
    signedInUser !== null && recipientMode === 'self';

  /* "For you": the preview follows the signed-in account. */
  useEffect(() => {
    if (forSelf && signedInUser) setTwitchInput(signedInUser.login);
  }, [forSelf, signedInUser?.login]);

  const normalizedLogin =
    useMemo(
      () =>
        normalizeSupportTwitchLogin(
          twitchInput,
        ),
      [twitchInput],
    );

  /* Never under $5: the box can't even hold less. Typing that would take it
     under $5 (or over $500) is ignored, and − / + move it a dollar at a time.
     The server refuses anything under $5 as well. */
  const amountCents =
    clampSupportAmountCents(
      parseSupportAmount(amountText.replace(/\.$/, ''))
        ?? SUPPORT_MIN_CENTS,
    );

  const amountLabel =
    formatSupportAmount(amountCents);

  const amountNote =
    amountCents >= SUPPORT_MAX_CENTS
      ? 'The most for one payment is $500.'
      : 'One time, $5 or more.';

  /* "7." or "07" back to "7" when you leave the box. */
  const snapAmount = () => {
    setAmountText(amountLabel.slice(1));
  };

  const stepTimers =
    useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});

  const stopStepping = useCallback(() => {
    clearTimeout(stepTimers.current.delay);
    clearInterval(stepTimers.current.repeat);
    stepTimers.current = {};
  }, []);

  useEffect(() => stopStepping, [stopStepping]);

  const stepAmount = useCallback((dollars: number) => {
    setAmountText((previous) => formatSupportAmount(stepSupportAmount(
      clampSupportAmountCents(parseSupportAmount(previous.replace(/\.$/, '')) ?? SUPPORT_MIN_CENTS),
      dollars,
    )).slice(1));
  }, []);

  /* One step on press; holding keeps going, faster after a moment. */
  const startStepping = (dollars: number) => {
    stopStepping();
    stepAmount(dollars);
    stepTimers.current.delay = setTimeout(() => {
      stepTimers.current.repeat = setInterval(() => stepAmount(dollars), 70);
    }, 400);
    window.addEventListener('pointerup', stopStepping, { once: true });
  };

  const qualifiesForSupporter =
    amountCents
    >= SUPPORT_BADGE.minimumCents;

  const hasTwitchInput =
    twitchInput.trim().length > 0;

  const hasPreview =
    accountState === 'found'
    && account !== null
    && account.login
      === normalizedLogin;

  const ready =
    forSelf
    || (
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

  /* Back from PayPal: confirm the payment on our server (never trust the URL). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flow = params.get('paypal');
    if (!flow) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (flow === 'cancel') {
      setOutcome({ kind: 'cancelled' });
      return;
    }
    const orderId = params.get('token') ?? '';
    if (flow !== 'return' || !/^[A-Z0-9]{10,40}$/.test(orderId)) return;
    let cancelled = false;
    setCheckoutBusy(true);
    void (async () => {
      try {
        const response = await fetch('/api/support/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null) as {
          status?: string;
          recipient?: { displayName?: string } | null;
        } | null;
        if (cancelled) return;
        if (response.ok && body?.status === 'completed') {
          setOutcome({ kind: 'success', displayName: body.recipient?.displayName ?? null });
        } else if (response.status === 202) {
          setOutcome({ kind: 'pending' });
        } else {
          setOutcome({ kind: 'error', message: 'We could not confirm that payment. You have not been charged twice; if money left your account, contact us.' });
        }
      } catch {
        if (!cancelled) setOutcome({ kind: 'error', message: 'We could not reach PayPal to confirm the payment. Refresh the page to try again.' });
      } finally {
        if (!cancelled) setCheckoutBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(
    event: FormEvent,
  ) {
    event.preventDefault();

    if (!ready || checkoutBusy) return;
    snapAmount();

    if (!checkoutReady) {
      setSubmissionNote(
        hasPreview
          ? `Checkout is not connected yet. ${account?.displayName} is verified as the future badge recipient.`
          : 'Checkout is not connected yet. This private preview cannot charge you.',
      );
      return;
    }

    setSubmissionNote('');
    setOutcome(null);
    setCheckoutBusy(true);
    try {
      const response = await fetch('/api/support/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          forSelf
            ? { forSelf: true, amountCents }
            : { login: hasPreview ? account?.login ?? '' : '', amountCents },
        ),
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null) as { approveUrl?: unknown; error?: unknown } | null;
      if (response.ok && isPayPalApprovalUrl(body?.approveUrl)) {
        window.location.assign(body.approveUrl);
        return;
      }
      setSubmissionNote(
        typeof body?.error === 'string' ? body.error : 'Checkout is not available right now.',
      );
    } catch {
      setSubmissionNote('Checkout is not available right now.');
    }
    setCheckoutBusy(false);
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
      <style jsx>{`
.support-page,
        .support-page *,
        .support-page *::before,
        .support-page *::after {
          box-sizing: border-box;
        }

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

        /* Layout: badge card always on the
           left with a live name preview, checkout in a panel on the right,
           $5 or more. */
        .support-back {
          display: inline-grid;
          place-items: center;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          color: #c9cedb;
          transition: color .15s, background .15s;
        }
        .support-back:hover {
          color: #fff;
          background: rgba(255, 255, 255, .06);
        }
        .support-back:focus-visible {
          outline: 2px solid #75a2ff;
          outline-offset: 2px;
        }
        .support-composition,
        .support-composition.has-preview {
          align-items: center;
          gap: 48px;
        }
        .support-vanity,
        .has-preview .support-vanity {
          order: -1;
          opacity: 1;
          visibility: visible;
          filter: none;
          transform: none;
        }
        .support-checkout,
        .has-preview .support-checkout {
          transform: none;
          border: 1px solid rgba(255, 255, 255, .07);
          border-radius: 16px;
          padding: 30px 26px 26px;
          background: linear-gradient(180deg, rgba(30, 35, 50, .72), rgba(16, 19, 28, .82));
          box-shadow: 0 24px 60px rgba(0, 0, 0, .28);
        }
        .amount-display {
          gap: 2px;
          cursor: default;
          margin-bottom: 6px;
        }
        .amount-display.is-editable {
          cursor: text;
        }
        .amount-display .amount-field {
          display: inline-grid;
          width: auto;
          /* The amount sits in a <label>: take the big number style, not a
             page's own label style (the generator styles every label small
             and dim, which shrank the number in the Support popup). */
          font: inherit;
          color: inherit;
          cursor: inherit;
          user-select: auto;
        }
        .amount-display .amount-sizer,
        .amount-display .amount-field input {
          grid-area: 1 / 1;
          padding: 0 .02em;
          font: inherit;
          letter-spacing: -.04em;
          white-space: pre;
        }
        .amount-display .amount-sizer {
          visibility: hidden;
        }
        .amount-display .amount-field input {
          /* No width of its own: the invisible copy sets it, the box fills it. */
          width: 0;
          min-width: 100%;
          text-align: left;
          border-bottom: 2px solid transparent;
          transition: border-color .15s;
        }
        .amount-display .amount-field input:hover,
        .amount-display .amount-field input:focus {
          border-bottom-color: rgba(74, 132, 250, .55);
        }
        .amount-hint,
        .amount-error {
          margin: 0 0 18px;
          text-align: center;
          font-size: 12px;
        }
        .amount-hint {
          color: #6f6f7a;
        }
        .amount-hint.is-limit {
          color: #9fb8ff;
        }
        .amount-step {
          align-self: center;
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          margin: 0 14px;
          padding: 0;
          border: 1px solid rgba(255, 255, 255, .12);
          border-radius: 50%;
          background: #1d1d22;
          color: #e6e6ea;
          font-size: 0;
          line-height: 0;
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          transition: border-color .15s, background .15s, opacity .15s;
        }
        .amount-step svg {
          display: block;
          width: 16px;
          height: 16px;
          fill: none;
          stroke: currentColor;
          stroke-width: 2.2;
          stroke-linecap: round;
        }
        .amount-step:hover:not(:disabled) {
          border-color: rgba(74, 132, 250, .6);
          background: #23232a;
        }
        .amount-step:focus-visible {
          outline: 2px solid #75a2ff;
          outline-offset: 2px;
        }
        .amount-step:disabled {
          opacity: .35;
          cursor: default;
        }
        .badge-load-status:empty {
          display: none;
        }
        .amount-value {
          letter-spacing: -.04em;
        }
        @media (max-width: 760px) {
          .support-vanity,
          .has-preview .support-vanity {
            display: block;
          }
          .support-checkout {
            padding: 24px 18px 20px;
          }
        }
        .support-thanks {
          text-align: center;
          padding: 34px 26px 30px;
        }
        .support-thanks h2 {
          margin: 6px 0 8px;
          color: #f6f7fb;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 30px;
          font-weight: 400;
        }
        .support-thanks p {
          margin: 0;
          color: #a4a9b8;
          font-size: 14px;
          line-height: 1.6;
        }
        .support-thanks strong {
          color: #fff;
        }
        .thanks-badge {
          width: 72px;
          height: 72px;
          object-fit: contain;
        }

        /* Look: near-black, flat rounded cards with a hairline
           border, Inter headings, white pill for the main action; Gxufy blue
           stays for accents. Overrides the earlier rules above. */
        .support-page {
          background: #0b0b0d;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .support-page button,
        .support-page input {
          font: inherit;
        }
        .support-heading {
          margin: 56px auto 38px;
        }
        .support-heading h1,
        .support-vanity h2,
        .support-thanks h2,
        .amount-display {
          font-family: inherit;
          font-weight: 800;
          letter-spacing: -.035em;
        }
        .support-heading h1 {
          font-size: clamp(34px, 5vw, 48px);
        }
        .support-heading h1 em {
          font-style: normal;
          color: #4a84fa;
        }
        .support-heading p {
          color: #9a9aa5;
        }
        .support-vanity h2 {
          font-size: 22px;
        }
        .support-vanity h2 span,
        .amount-symbol {
          color: #4a84fa;
        }
        .support-vanity,
        .has-preview .support-vanity,
        .support-checkout,
        .has-preview .support-checkout {
          border: 1px solid rgba(255, 255, 255, .08);
          border-radius: 22px;
          background: #141416;
          box-shadow: none;
          padding: 30px 26px 26px;
          animation: gx-support-rise .5s cubic-bezier(.22, 1, .36, 1) backwards;
        }
        .support-checkout {
          animation-delay: .06s;
        }
        .amount-display {
          font-size: 60px;
        }
        .amount-currency {
          color: #6f6f7a;
        }
        .account-label {
          color: #e6e6ea;
        }
        .account-input {
          border: 1px solid rgba(255, 255, 255, .1);
          border-radius: 12px;
          background: #0e0e10;
          box-shadow: none;
        }
        .account-input:focus-within {
          border-color: rgba(74, 132, 250, .6);
          box-shadow: 0 0 0 3px rgba(74, 132, 250, .18);
        }
        .continue-button {
          border: 1px solid #fff;
          border-radius: 999px;
          background: #fff;
          color: #111;
          box-shadow: none;
          font-weight: 800;
          transition: background .15s, transform .2s;
        }
        .continue-button:hover:not(:disabled) {
          background: #e9e9ee;
        }
        .support-page .continue-button {
          font-weight: 800;
          font-size: 15px;
        }
        .continue-button:active:not(:disabled) {
          transform: scale(.98);
        }
        .continue-button:disabled {
          opacity: .45;
        }
        .chat-preview {
          border: 1px solid rgba(255, 255, 255, .08);
          border-radius: 14px;
          background: #0e0e10;
          box-shadow: none;
        }
        .support-back {
          border: 1px solid rgba(255, 255, 255, .1);
          border-radius: 999px;
        }
        /* Popup on the MultiChat page: no page chrome, own backdrop. */
        .support-page.is-modal {
          min-height: 0;
          padding: 0;
          background: transparent;
        }
        .support-page.is-modal .support-heading {
          margin: 0 auto 24px;
        }
        .support-page.is-modal .support-heading h1 {
          font-size: clamp(30px, 4vw, 40px);
        }
        @keyframes gx-support-rise {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        /* Gxufy supporter badge: same square as the others, whole art
           stretched to fill it. */
        .chat-badge.is-feature {
          object-fit: fill;
          border-radius: 0;
        }
        /* Name preview: same surface as the MultiChat chat preview (dark
           transparency checkerboard, hairline border, soft inset shadow). */
        .support-page .chat-preview {
          border: 1px solid #2c2c35;
          border-radius: 10px;
          background: repeating-conic-gradient(#1a1a20 0% 25%, #131318 0% 50%) 0 0 / 16px 16px;
          box-shadow: inset 0 2px 12px rgba(0, 0, 0, .3);
        }
        /* Name preview at chat-overlay scale: bigger badges and name, with the
           overlay's badge shadow, so it reads like a real chat line. */
        .support-page .chat-preview {
          padding: 16px 18px;
          min-height: 72px;
        }
        .support-page .chat-row {
          gap: 5px;
          row-gap: 6px;
          min-height: 32px;
        }
        .support-page .chat-badge {
          width: 28px;
          height: 28px;
          filter: drop-shadow(rgba(0, 0, 0, .8) 1px 2px 2px);
        }
        .support-page .chat-name {
          margin-left: 4px;
          font-size: 22px;
          letter-spacing: -.01em;
          line-height: 1.2;
        }
        .support-page .recipient-switch {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px;
          padding: 4px;
          margin: 14px 0 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, .05);
          border: 1px solid rgba(255, 255, 255, .08);
        }
        .support-page .recipient-switch button {
          font: inherit;
          font-size: .86rem;
          font-weight: 700;
          color: rgba(255, 255, 255, .6);
          background: transparent;
          border: 0;
          border-radius: 9px;
          padding: 8px 10px;
          cursor: pointer;
          transition: color .15s ease, background-color .15s ease, scale .4s ${SPRING_EASING};
        }
        .support-page .recipient-switch button.is-on {
          color: #fff;
          background: rgba(255, 255, 255, .12);
        }
        .support-page .recipient-switch button:active { scale: .97; }
        .support-page .recipient-self {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          margin-bottom: 14px;
          border-radius: 12px;
          background: rgba(255, 255, 255, .05);
          border: 1px solid rgba(255, 255, 255, .08);
          font-size: .92rem;
        }
        .support-page .recipient-self .account-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
        }
        .support-page .signin-link {
          display: inline-block;
          margin: 12px 0 4px;
          color: #b48cff;
          font-size: .86rem;
          font-weight: 700;
          text-decoration: none;
        }
        .support-page .signin-link:hover { text-decoration: underline; }
        .support-page .signin-required { display: grid; gap: 14px; }
        .support-page .signin-button {
          display: flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }
        .support-page .thanks-manage {
          display: inline-block;
          margin-top: 6px;
          color: #9fc0ff;
          font-weight: 700;
          text-decoration: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .support-page .recipient-switch button { transition: none; }
        }
`}</style>

      <div className={`support-page${variant === 'modal' ? ' is-modal' : ''}`}>
        <div className="support-shell">
          {variant === 'page' ? (
          <a
            className="support-back"
            href={HOME_ORIGIN}
            aria-label="Back to Gxufy"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </a>
          ) : null}
          <header className="support-heading">
            <h1>
              Support <em>Gxufy</em>
            </h1>

            <p>
              Help keep FlossChat frequently updated as
              platform APIs change. Ongoing development
              takes time.
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
            {outcome?.kind === 'success' ? (
              <section
                className="support-checkout support-thanks"
                role="status"
              >
                <img src={SUPPORT_BADGE.url} alt="" className="thanks-badge" />
                <h2>Thank you!</h2>
                <p>
                  {outcome.displayName
                    ? <>Your FlossChat badge is now on <strong>{outcome.displayName}</strong>. It shows up in chat within seconds.</>
                    : 'Your support means a lot.'}
                </p>
                {outcome.displayName && signIn !== 'unknown' && signIn.ready ? (
                  <a className="thanks-manage" href="/badges">Wear or take off your badge</a>
                ) : null}
              </section>
            ) : (
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
                  className="amount-display is-editable"
                >
                  <button
                    type="button"
                    className="amount-step"
                    aria-label="$1 less"
                    disabled={amountCents <= SUPPORT_MIN_CENTS}
                    onPointerDown={(event) => {
                      if (event.button > 0) return;
                      event.preventDefault();
                      startStepping(-1);
                    }}
                    onPointerLeave={stopStepping}
                    onPointerCancel={stopStepping}
                    onClick={(event) => {
                      /* Keyboard Enter/Space; a mouse or touch press already stepped. */
                      if (event.detail === 0) stepAmount(-1);
                    }}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M3.5 8h9" />
                    </svg>
                  </button>
                  <span
                    className="amount-symbol"
                    aria-hidden="true"
                  >
                    $
                  </span>
                  <label className="amount-field">
                    <span className="sr-only">Support amount in US dollars ($5 or more)</span>
                    {/* Same text, invisible, so the box is exactly as wide as what's typed. */}
                    <span className="amount-sizer" aria-hidden="true">{amountText || '0'}</span>
                    <input
                      className="amount-value"
                      inputMode="decimal"
                      autoComplete="off"
                      size={1}
                      maxLength={8}
                      value={amountText}
                      aria-describedby="support-amount-note"
                      onChange={(event) => {
                        const typed = event.target.value;
                        setAmountText((previous) => acceptSupportAmountInput(previous, typed));
                      }}
                      onBlur={snapAmount}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') snapAmount();
                        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                          event.preventDefault();
                          stepAmount(event.key === 'ArrowUp' ? 1 : -1);
                        }
                      }}
                    />
                  </label>
                  <span
                    className="amount-currency"
                    aria-hidden="true"
                  >
                    USD
                  </span>
                  <button
                    type="button"
                    className="amount-step"
                    aria-label="$1 more"
                    disabled={amountCents >= SUPPORT_MAX_CENTS}
                    onPointerDown={(event) => {
                      if (event.button > 0) return;
                      event.preventDefault();
                      startStepping(1);
                    }}
                    onPointerLeave={stopStepping}
                    onPointerCancel={stopStepping}
                    onClick={(event) => {
                      if (event.detail === 0) stepAmount(1);
                    }}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M3.5 8h9M8 3.5v9" />
                    </svg>
                  </button>
                </div>
                <p
                  id="support-amount-note"
                  className={amountNote === 'One time, $5 or more.' ? 'amount-hint' : 'amount-hint is-limit'}
                  aria-live="polite"
                >
                  {amountNote}
                </p>

                {/* Owner rule: nobody supports without signing in with Twitch first,
                    so every payment is tied to a known account. */}
                {signedInUser ? (
                  <>
                  {(
                    <div className="recipient-switch" role="radiogroup" aria-label="Who gets the badge">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={recipientMode === 'self'}
                        className={recipientMode === 'self' ? 'is-on' : ''}
                        onClick={() => setRecipientMode('self')}
                      >
                        For you
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={recipientMode === 'gift'}
                        className={recipientMode === 'gift' ? 'is-on' : ''}
                        onClick={() => {
                          setRecipientMode('gift');
                          setTwitchInput('');
                        }}
                      >
                        As a gift
                      </button>
                    </div>
                  )}

                  {forSelf && signedInUser ? (
                    <div className="recipient-self">
                      {signedInUser.profileImageUrl
                        ? <img className="account-avatar" src={signedInUser.profileImageUrl} alt="" aria-hidden="true" />
                        : null}
                      <span>
                        Badge goes to <strong>@{signedInUser.login}</strong>
                      </span>
                    </div>
                  ) : (
                  <>
                  <label
                    className="account-label"
                    htmlFor="support-twitch"
                  >
                    {recipientMode === 'gift' ? 'Gift to (Twitch username)' : 'Twitch username'}{' '}
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
                  </>
                  )}

                  <button
                    className="continue-button"
                    type="submit"
                    disabled={!ready || checkoutBusy}
                  >
                    {checkoutBusy ? 'Opening PayPal\u2026' : `Continue with ${amountLabel}`}
                  </button>
                  </>
                ) : signIn !== 'unknown' && signIn.ready ? (
                  <div className="signin-required">
                    <p className="account-status">
                      Sign in with Twitch to support. You can get the badge for yourself or gift it.
                    </p>
                    <a className="continue-button signin-button" href={signInHref}>
                      Sign in with Twitch
                    </a>
                  </div>
                ) : (
                  <p className="account-status">
                    {signIn === 'unknown' ? 'Checking sign-in\u2026' : 'Support is not available right now.'}
                  </p>
                )}

                {submissionNote ? (
                  <p
                    className="submission-note"
                    role="status"
                  >
                    {submissionNote}
                  </p>
                ) : null}
                {outcome ? (
                  <p className="submission-note checkout-outcome" role="status">
                    {outcome.kind === 'cancelled'
                      ? 'Payment cancelled. Nothing was charged.'
                      : outcome.kind === 'pending'
                        ? 'PayPal is still processing this payment. Your badge appears once it clears.'
                        : outcome.message}
                  </p>
                ) : null}
              </fieldset>
            </form>
            )}

            <aside
              className="support-vanity"
              aria-label="Chat badge preview"
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
                FlossChat{' '}
                <span>
                  badge
                </span>
              </h2>

              <p className="reward-copy">
                {
                  'Yours with a tip of $5 or more, shown beside your name in FlossChat.'
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
                          className={
                            badge.url === SUPPORT_BADGE.url
                              ? 'chat-badge is-feature'
                              : 'chat-badge'
                          }
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
                      hasPreview
                        ? account
                          ?.displayName
                        : 'YourNameHere'
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
                      : ''
                  }
                </p>
              </div>
            </aside>
          </div>

        </div>
      </div>
    </>
  );
}
