import type { NextApiRequest, NextApiResponse } from 'next';

import {
  FixedProviderAdmissionError,
  FixedProviderUpstreamError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';
import { isSafeRemoteMediaUrl } from '../../../lib/remoteMediaUrl';

export const BCHAT_BADGES_URL =
  'https://www.itsbr0dyy.dev/api/badges';

export const BCHAT_BADGES_MAX_BYTES =
  4 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 5_000;

const GENERIC_ERROR = {
  error: 'Unable to load bChat badges.',
};

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

export type BChatBadge = {
  id: string;
  title: string;
  url: string;
  users: string[];
};

export const BCHAT_BADGES_FALLBACK: BChatBadge[] = [
  {
    id: 'admins',
    title: 'Admin',
    url:
      'https://itsbr0dyy.dev/badges/4x.avif',
    users: [
      '1039455040',
      '824594608',
      '503279234',
      '798723114',
      '247321209',
      '54698159',
      '61021189',
    ],
  },
  {
    id: 'supporters',
    title: 'Supporter',
    url:
      'https://itsbr0dyy.dev/badges/supporter-4x.avif',
    users: [
      '204219574',
      '740648504',
      '204497246',
    ],
  },
];

class BChatUpstreamUnavailableError
  extends Error {
  constructor() {
    super(
      'bChat upstream unavailable',
    );

    this.name =
      'BChatUpstreamUnavailableError';
  }
}

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
      : text(value, 25);

  return /^\d{1,25}$/.test(normalized)
    ? normalized
    : '';
}

function badgeAssetUrl(
  value: unknown,
): string {
  const normalized = text(value, 2_048);

  if (
    !normalized
    || !isSafeRemoteMediaUrl(normalized)
  ) {
    return '';
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return '';
  }
}

export function parseBChatBadges(
  value: unknown,
): BChatBadge[] | null {
  if (
    !isRecord(value)
    || !isRecord(value.badges)
  ) {
    return null;
  }

  const badges: BChatBadge[] = [];
  let totalOwners = 0;

  for (
    const [rawId, rawBadge]
    of Object.entries(value.badges)
  ) {
    if (!isRecord(rawBadge)) continue;

    const id = text(rawId, 80);
    const title =
      text(rawBadge.title, 256)
      || id;

    const images =
      isRecord(rawBadge.images)
        ? rawBadge.images
        : {};

    const url =
      badgeAssetUrl(images['4x'])
      || badgeAssetUrl(images['3x'])
      || badgeAssetUrl(images['2x'])
      || badgeAssetUrl(images['1x']);

    const users = Array.isArray(rawBadge.users)
      ? [
          ...new Set(
            rawBadge.users
              .map(twitchUserId)
              .filter(Boolean),
          ),
        ]
      : [];

    if (
      !id
      || !title
      || !url
      || users.length === 0
    ) {
      continue;
    }

    totalOwners += users.length;

    if (totalOwners > 200_000) {
      return null;
    }

    badges.push({
      id,
      title,
      url,
      users,
    });

    if (badges.length > 5_000) {
      return null;
    }
  }

  return badges;
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
        key: 'bchat-badges',
        clientKey:
          fixedProviderClientKey(req),

        run: () =>
          withFixedProviderTimeout(
            REQUEST_TIMEOUT_MS,
            async (signal) => {
              let response: Response;

              try {
                response =
                  await fetch(
                    BCHAT_BADGES_URL,
                    {
                      signal,
                      redirect: 'error',
                      headers: {
                        Accept:
                          'application/json, text/plain;q=0.9, */*;q=0.8',
                        'User-Agent':
                          BROWSER_USER_AGENT,
                      },
                    },
                  );
              } catch {
                throw new BChatUpstreamUnavailableError();
              }

              if (!response.ok) {
                await discardFixedProviderBody(
                  response,
                );

                throw new BChatUpstreamUnavailableError();
              }

              return readBoundedFixedProviderJson(
                response,
                BCHAT_BADGES_MAX_BYTES,
              );
            },
          ),
      });

    const badges =
      parseBChatBadges(raw);

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

    if (
      error
        instanceof BChatUpstreamUnavailableError
      || (
        error
          instanceof FixedProviderUpstreamError
        && error.message
          === 'upstream timeout'
      )
    ) {
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=300, stale-while-revalidate=3600',
      );

      res
        .status(200)
        .json(BCHAT_BADGES_FALLBACK);

      return;
    }

    res.status(502).json(GENERIC_ERROR);
  }
}
