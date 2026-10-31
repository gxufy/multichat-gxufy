export const SUPPORT_PAGE_ENV =
  'GXUFY_SUPPORT_PAGE_ENABLED';

export const SUPPORT_AMOUNT_CENTS = 500;
export const SUPPORT_AMOUNT_LABEL = '$5';
export const SUPPORT_TWITCH_LOOKUP_DEBOUNCE_MS = 350;

export const SUPPORT_BADGE = {
  id: 'supporter',
  title: 'Gxufy Supporter',
  url: '/badges/gxufy/supporter.webp',
  minimumCents: SUPPORT_AMOUNT_CENTS,
} as const;

export type SupportTwitchUser = {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
};

export function supportPageEnabled(
  raw = process.env[SUPPORT_PAGE_ENV],
): boolean {
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
