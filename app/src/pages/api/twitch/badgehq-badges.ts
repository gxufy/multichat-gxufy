import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';

const BADGEHQ_ORIGIN =
  'https://www.badgehq.xyz';

const BADGEHQ_IMAGE_ORIGINS =
  new Set([
    BADGEHQ_ORIGIN,
    'https://badgehq.jessekettle.xyz',
  ]);

export const BADGEHQ_BADGES_URL =
  `${BADGEHQ_ORIGIN}/api/v1/badges`;

export const BADGEHQ_BADGES_MAX_BYTES =
  4 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 5_000;

const GENERIC_ERROR = {
  error: 'Unable to load BadgeHQ badges.',
};

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

export type BadgeHqBadge = {
  id: string;
  title: string;
  url: string;
  users: string[];
};

type BadgeDefinition = {
  id: string;
  title: string;
  url: string;
  priority: number;
  order: number;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function text(
  value: unknown,
  maximumLength: number,
): string {
  if (typeof value !== 'string') return '';

  const normalized = value.trim();

  if (
    !normalized
    || normalized.length > maximumLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return '';
  }

  return normalized;
}

function twitchUserId(
  value: unknown,
): string {
  const normalized =
    typeof value === 'number'
    && Number.isSafeInteger(value)
      ? String(value)
      : text(value, 20);

  return (
    /^[1-9]\d{0,19}$/.test(normalized)
      ? normalized
      : ''
  );
}

function imageUrl(
  value: unknown,
): string {
  const raw = text(value, 2_048);

  if (!raw) return '';

  try {
    const url =
      new URL(
        raw,
        BADGEHQ_ORIGIN,
      );

    if (
      !BADGEHQ_IMAGE_ORIGINS.has(url.origin)
      || !url.pathname.startsWith('/badges/')
      || url.username
      || url.password
      || url.port
      || url.hash
    ) {
      return '';
    }

    return url.toString();
  } catch {
    return '';
  }
}

function priority(
  value: unknown,
): number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
      ? value
      : Number.MAX_SAFE_INTEGER
  );
}

export function parseBadgeHqBadges(
  value: unknown,
): BadgeHqBadge[] | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.badges)
    || !isRecord(value.users)
  ) {
    return null;
  }

  const definitions =
    new Map<string, BadgeDefinition>();

  let definitionOrder = 0;

  for (const raw of value.badges) {
    if (
      !isRecord(raw)
      || raw.listed === false
    ) {
      continue;
    }

    const id =
      text(raw.id, 64);

    const title =
      text(raw.tooltip, 256)
      || id;

    const images =
      isRecord(raw.images)
        ? raw.images
        : {};

    const url =
      imageUrl(images['4x'])
      || imageUrl(images['3x'])
      || imageUrl(images['2x'])
      || imageUrl(images['1x']);

    if (
      !id
      || !title
      || !url
      || definitions.has(id)
    ) {
      continue;
    }

    definitions.set(id, {
      id,
      title,
      url,
      priority:
        priority(raw.priority),
      order:
        definitionOrder++,
    });

    if (definitions.size > 5_000) {
      return null;
    }
  }

  const owners =
    new Map<string, Set<string>>();

  for (const id of definitions.keys()) {
    owners.set(id, new Set());
  }

  let totalAssignments = 0;

  for (
    const [rawUserId, rawUser]
    of Object.entries(value.users)
  ) {
    const userId =
      twitchUserId(rawUserId);

    if (
      !userId
      || !isRecord(rawUser)
      || !Array.isArray(rawUser.badges)
    ) {
      continue;
    }

    const owned = [
      ...new Set(
        rawUser.badges
          .map((entry) =>
            text(entry, 64))
          .filter(Boolean),
      ),
    ]
      .map((id) =>
        definitions.get(id))
      .filter(
        (
          badge,
        ): badge is BadgeDefinition =>
          Boolean(badge),
      )
      .sort(
        (a, b) =>
          a.priority - b.priority
          || a.order - b.order,
      )
      .slice(0, 4);

    for (const badge of owned) {
      owners
        .get(badge.id)
        ?.add(userId);

      totalAssignments += 1;

      if (totalAssignments > 200_000) {
        return null;
      }
    }
  }

  return [
    ...definitions.values(),
  ]
    .sort(
      (a, b) =>
        a.priority - b.priority
        || a.order - b.order,
    )
    .flatMap((badge) => {
      const users =
        [...(owners.get(badge.id) ?? [])];

      if (!users.length) return [];

      return [{
        id: badge.id,
        title: badge.title,
        url: badge.url,
        users,
      }];
    });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    res.status(405).json({
      error: 'Method not allowed.',
    });

    return;
  }

  try {
    const raw =
      await runFixedProviderWork({
        key: 'badgehq-badges',
        clientKey:
          fixedProviderClientKey(req),

        run: () =>
          withFixedProviderTimeout(
            REQUEST_TIMEOUT_MS,
            async (signal) => {
              const response =
                await fetch(
                  BADGEHQ_BADGES_URL,
                  {
                    signal,
                    redirect: 'error',
                    headers: {
                      Accept:
                        'application/json',
                      'User-Agent':
                        BROWSER_USER_AGENT,
                    },
                  },
                );

              if (!response.ok) {
                await discardFixedProviderBody(
                  response,
                );

                throw new Error(
                  'BadgeHQ badge lookup failed',
                );
              }

              return readBoundedFixedProviderJson(
                response,
                BADGEHQ_BADGES_MAX_BYTES,
              );
            },
          ),
      });

    const badges =
      parseBadgeHqBadges(raw);

    if (badges === null) {
      res.status(502).json(GENERIC_ERROR);
      return;
    }

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=1800, stale-while-revalidate=3600',
    );

    res.status(200).json(badges);
  } catch (error) {
    if (
      error
      instanceof FixedProviderAdmissionError
    ) {
      res.setHeader(
        'Retry-After',
        String(
          error.retryAfterSeconds,
        ),
      );

      res
        .status(error.statusCode)
        .json(GENERIC_ERROR);

      return;
    }

    res.status(502).json(GENERIC_ERROR);
  }
}
