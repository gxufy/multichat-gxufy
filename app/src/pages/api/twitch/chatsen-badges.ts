import { createHash } from 'crypto';
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

import {
  validateCommunityBadgeAssetUrl,
} from '../../../lib/server/communityBadgeAsset';

export const CHATSEN_BADGES_URL =
  'https://raw.githubusercontent.com/chatsen/resources/master/assets/data.json';

export const CHATSEN_BADGES_MAX_BYTES =
  1024 * 1024;

const REQUEST_TIMEOUT_MS = 5_000;

const GENERIC_ERROR = {
  error: 'Unable to load Chatsen badges.',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';

export type ChatsenBadge = {
  id: string;
  title: string;
  url: string;
  users: string[];
  usernames: string[];
};

type ChatsenDefinition = {
  name: string;
  title: string;
  url: string;
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
  max = 160,
): string {
  if (typeof value !== 'string') return '';

  const result = value.trim();

  return result.length <= max
    ? result
    : '';
}

function twitchId(value: unknown): string {
  const result =
    typeof value === 'number'
    && Number.isFinite(value)
      ? String(value)
      : text(value, 25);

  return /^\d{1,25}$/.test(result)
    ? result
    : '';
}

function twitchLogin(value: unknown): string {
  const result =
    text(value, 25).toLowerCase();

  return /^[a-z0-9_]{1,25}$/.test(result)
    ? result
    : '';
}

function chatsenId(name: string): string {
  return `chatsen_${createHash('md5')
    .update(name)
    .digest('hex')}`;
}

export function parseChatsenCatalog(
  value: unknown,
): ChatsenBadge[] | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.badges)
    || !Array.isArray(value.users)
  ) {
    return null;
  }

  const definitions: ChatsenDefinition[] = [];
  const definitionsByName =
    new Map<string, ChatsenDefinition>();

  for (const raw of value.badges) {
    if (!isRecord(raw)) continue;

    const name =
      text(raw.name, 100).toLowerCase();

    if (
      !name
      || !/^[a-z0-9_]+$/.test(name)
      || definitionsByName.has(name)
    ) {
      continue;
    }

    const url =
      validateCommunityBadgeAssetUrl(
        raw.image,
        'chatsen',
      );

    if (!url) continue;

    const definition: ChatsenDefinition = {
      name,
      title:
        text(raw.title)
        || name,
      url,
    };

    definitions.push(definition);
    definitionsByName.set(
      name,
      definition,
    );
  }

  const owners = new Map<
    string,
    {
      users: string[];
      usernames: string[];
    }
  >();

  for (const definition of definitions) {
    owners.set(definition.name, {
      users: [],
      usernames: [],
    });
  }

  /*
   * The timestamps in Chatsen's static resources are metadata.
   * Ownership is the user.badges[].badgeName relationship itself.
   */
  for (const rawUser of value.users) {
    if (
      !isRecord(rawUser)
      || !Array.isArray(rawUser.badges)
    ) {
      continue;
    }

    const id = twitchId(rawUser.id);
    if (!id) continue;

    const login =
      twitchLogin(rawUser.name);

    for (const rawOwned of rawUser.badges) {
      if (!isRecord(rawOwned)) continue;

      const badgeName =
        text(
          rawOwned.badgeName,
          100,
        ).toLowerCase();

      const badgeOwners =
        owners.get(badgeName);

      if (!badgeOwners) continue;

      if (!badgeOwners.users.includes(id)) {
        badgeOwners.users.push(id);
      }

      if (
        login
        && !badgeOwners.usernames.includes(login)
      ) {
        badgeOwners.usernames.push(login);
      }
    }
  }

  return definitions.flatMap(
    (definition) => {
      const badgeOwners =
        owners.get(definition.name);

      if (
        !badgeOwners
        || badgeOwners.users.length === 0
      ) {
        return [];
      }

      return [{
        id: chatsenId(definition.name),
        title: definition.title,
        url: definition.url,
        users: badgeOwners.users,
        usernames:
          badgeOwners.usernames,
      }];
    },
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      error: 'Method not allowed.',
    });
  }

  try {
    const raw =
      await runFixedProviderWork({
        key: 'chatsen-official-resources',
        clientKey:
          fixedProviderClientKey(req),

        run: () =>
          withFixedProviderTimeout(
            REQUEST_TIMEOUT_MS,
            async (signal) => {
              const response =
                await fetch(
                  CHATSEN_BADGES_URL,
                  {
                    signal,
                    redirect: 'error',
                    headers: {
                      Accept:
                        'application/json',
                      'User-Agent':
                        USER_AGENT,
                    },
                  },
                );

              if (!response.ok) {
                await discardFixedProviderBody(
                  response,
                );

                throw new Error(
                  'Chatsen resource lookup failed',
                );
              }

              return readBoundedFixedProviderJson(
                response,
                CHATSEN_BADGES_MAX_BYTES,
              );
            },
          ),
      });

    const badges =
      parseChatsenCatalog(raw);

    if (badges === null) {
      return res
        .status(502)
        .json(GENERIC_ERROR);
    }

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=1800, stale-while-revalidate=3600',
    );

    return res
      .status(200)
      .json(badges);
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

      return res
        .status(error.statusCode)
        .json(GENERIC_ERROR);
    }

    return res
      .status(502)
      .json(GENERIC_ERROR);
  }
}
