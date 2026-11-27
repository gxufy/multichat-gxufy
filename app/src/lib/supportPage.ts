export const SUPPORT_PAGE_ENV =
  'GXUFY_SUPPORT_PAGE_ENABLED';

/* Support is $5 or more, one time, in US dollars. The upper limit only
   guards against typos. */
export const SUPPORT_MIN_CENTS = 500;
export const SUPPORT_MAX_CENTS = 50_000;
/** Where the amount starts on the support page. */
export const SUPPORT_AMOUNT_CENTS = SUPPORT_MIN_CENTS;
export const SUPPORT_AMOUNT_LABEL = '$5';
export const SUPPORT_MIN_LABEL = '$5 or more';

/** "$5", "$7.50", "$25": dollars, with cents only when there are some. */
export function formatSupportAmount(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** What someone typed ("7", "$7.5", "7.50") to cents, or null if it isn't a
    plain dollar amount. Range is checked separately. */
export function parseSupportAmount(text: string): number | null {
  const match = /^\s*\$?\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** Any amount pulled into $5–$500 (whole cents): the page never offers less. */
export function clampSupportAmountCents(cents: number): number {
  if (!Number.isFinite(cents)) return SUPPORT_MIN_CENTS;
  return Math.min(SUPPORT_MAX_CENTS, Math.max(SUPPORT_MIN_CENTS, Math.round(cents)));
}

/** What the amount box keeps as you type: digits and one dot, at most 2 decimals. */
export function cleanSupportAmountInput(raw: string): string {
  const kept = raw.replace(/[^\d.]/g, '');
  const dot = kept.indexOf('.');
  const text = dot === -1 ? kept : `${kept.slice(0, dot + 1)}${kept.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`;
  return text.slice(0, 8);
}

/** The amount box only ever holds $5–$500. An edit that would leave it under
    $5, over $500, empty or not a dollar amount is ignored: the box keeps what
    it had. ("7." is kept while the cents are being typed.) */
export function acceptSupportAmountInput(previous: string, raw: string): string {
  const text = cleanSupportAmountInput(raw);
  const whole = text.endsWith('.') ? text.slice(0, -1) : text;
  const cents = parseSupportAmount(whole);
  return cents !== null && cents >= SUPPORT_MIN_CENTS && cents <= SUPPORT_MAX_CENTS ? text : previous;
}

/** One press of − or +: a dollar down or up, never under $5 or over $500. */
export function stepSupportAmount(cents: number, dollars: number): number {
  return clampSupportAmountCents(cents + dollars * 100);
}

/** The amount a checkout may use, in whole cents, or null when it's outside
    $5–$500 or not a whole number of cents. */
export function normalizeSupportAmountCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= SUPPORT_MIN_CENTS && value <= SUPPORT_MAX_CENTS ? value : null;
}
export const SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS = 350;

export const SUPPORT_BADGE = {
  id: 'supporter',
  title: 'FlossChat',
  /** What hovering the badge in chat says (overlay, previews). */
  hoverTitle: 'FlossChat Supporter',
  url: '/badges/gxufy/supporter-hand.webp',
  minimumCents: SUPPORT_MIN_CENTS,
} as const;

export type SupportTwitchUser = {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
};

/**
 * On when GXUFY_SUPPORT_PAGE_ENABLED=1. Also on under `npm run dev` when the
 * variable is not set at all, so the page can be checked locally without
 * touching .env files; production builds never take that branch, and an
 * explicit value (e.g. 0) always wins.
 */
export function supportPageEnabled(
  raw = process.env[SUPPORT_PAGE_ENV],
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (raw === undefined) return nodeEnv === 'development';
  return raw === '1';
}

export function normalizeSupportTwitchLogin(
  value: string,
): string | null {
  const normalized =
    value
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();

  if (!/^[a-z0-9_]{3,25}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function safeHttpsUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseSupportTwitchUser(
  value: unknown,
  expectedLogin: string,
): SupportTwitchUser | null {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = record.id;
  const login = record.login;
  const displayName = record.displayName;
  const profileImageUrl = record.profileImageUrl;

  if (
    typeof id !== 'string'
    || !/^\d{1,20}$/.test(id)
    || typeof login !== 'string'
    || login !== expectedLogin
    || !/^[a-z0-9_]{3,25}$/.test(login)
    || typeof displayName !== 'string'
    || !displayName.trim()
  ) {
    return null;
  }

  const image =
    profileImageUrl == null
      ? undefined
      : safeHttpsUrl(profileImageUrl);

  if (profileImageUrl != null && !image) {
    return null;
  }

  return {
    id,
    login,
    displayName: displayName.trim(),
    ...(image
      ? { profileImageUrl: image }
      : {}),
  };
}
