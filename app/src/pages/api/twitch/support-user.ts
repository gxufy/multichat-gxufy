import type {
  NextApiHandler,
} from 'next';

import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '@/lib/server/fixedProviderProxy';

import {
  normalizeSupportTwitchLogin,
  supportPageEnabled,
  type SupportTwitchUser,
} from '@/lib/supportPage';

const ERROR =
  'Unable to verify Twitch account.';

const NOT_FOUND =
  'Twitch account not found.';

const CLIENT_ID =
  'kimne78kx3ncx6brgo4mv6wki5h1ko';

const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 500;

export const SUPPORT_TWITCH_USER_MAX_BYTES =
  64 * 1024;

type CachedValue =
  SupportTwitchUser | null;

const cache =
  new Map<
    string,
    {
      at: number;
      value: CachedValue;
    }
  >();

const inFlight =
  new Map<
    string,
    Promise<CachedValue>
  >();

function httpsUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

async function lookup(
  login: string,
): Promise<CachedValue> {
  return withFixedProviderTimeout(
    4_000,
    async (signal) => {
      const response =
        await fetch(
          'https://gql.twitch.tv/gql',
          {
            method: 'POST',
            headers: {
              'Client-ID': CLIENT_ID,
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              query: `
                query($login: String!) {
                  user(login: $login) {
                    id
                    login
                    displayName
                    profileImageURL(width: 70)
                  }
                }
              `,
              variables: {
                login,
              },
            }),
            redirect: 'error',
            signal,
          },
        );

      if (!response.ok) {
        await discardFixedProviderBody(
          response,
        );
        throw new Error(ERROR);
      }

      const body =
        await readBoundedFixedProviderJson(
          response,
          SUPPORT_TWITCH_USER_MAX_BYTES,
        );

      const user =
        (
          body as {
            data?: {
              user?: unknown;
            };
          }
        )?.data?.user;

      if (user == null) {
        return null;
      }

      if (
        typeof user !== 'object'
        || Array.isArray(user)
      ) {
        throw new Error(ERROR);
      }

      const record =
        user as Record<
          string,
          unknown
        >;

      const id = record.id;
      const returnedLogin =
        record.login;
      const displayName =
        record.displayName;
      const profileImageURL =
        record.profileImageURL;

      if (
        typeof id !== 'string'
        || !/^\d{1,20}$/.test(id)
        || returnedLogin !== login
        || typeof returnedLogin !==
          'string'
        || typeof displayName !==
          'string'
        || !displayName.trim()
      ) {
        throw new Error(ERROR);
      }

      const image =
        profileImageURL == null
          ? undefined
          : httpsUrl(
              profileImageURL,
            );

      if (
        profileImageURL != null
        && !image
      ) {
        throw new Error(ERROR);
      }

      return {
        id,
        login: returnedLogin,
        displayName:
          displayName.trim(),
        ...(image
          ? {
              profileImageUrl:
                image,
            }
          : {}),
      };
    },
  );
}

async function cached(
  login: string,
  clientKey: string,
): Promise<CachedValue> {
  const hit = cache.get(login);

  if (
    hit
    && Date.now() - hit.at
      < TTL_MS
  ) {
    return hit.value;
  }

  const existing =
    inFlight.get(login);

  if (existing) {
    return existing;
  }

  const promise =
    runFixedProviderWork({
      key:
        `twitch-support-user:${login}`,
      clientKey,
      run: () => lookup(login),
    });

  inFlight.set(
    login,
    promise,
  );

  try {
    const value = await promise;

    cache.delete(login);
    cache.set(
      login,
      {
        at: Date.now(),
        value,
      },
    );

    while (
      cache.size > MAX_ENTRIES
    ) {
      const oldest =
        cache.keys().next();

      if (oldest.done) break;

      cache.delete(
        oldest.value,
      );
    }

    return value;
  } finally {
    if (
      inFlight.get(login)
      === promise
    ) {
      inFlight.delete(login);
    }
  }
}

const handler:
NextApiHandler = async (
  req,
  res,
) => {
  res.setHeader(
    'Cache-Control',
    'private, no-store',
  );

  if (!supportPageEnabled()) {
    return res
      .status(404)
      .json({
        error: 'Not found.',
      });
  }

  if (req.method !== 'GET') {
    res.setHeader(
      'Allow',
      'GET',
    );

    return res
      .status(405)
      .json({
        error: ERROR,
      });
  }

  const rawLogin =
    Array.isArray(
      req.query.login,
    )
      ? null
      : req.query.login;

  const login =
    typeof rawLogin ===
      'string'
      ? normalizeSupportTwitchLogin(
          rawLogin,
        )
      : null;

  if (!login) {
    return res
      .status(400)
      .json({
        error: ERROR,
      });
  }

  try {
    const value =
      await cached(
        login,
        fixedProviderClientKey(
          req,
        ),
      );

    if (!value) {
      return res
        .status(404)
        .json({
          error: NOT_FOUND,
        });
    }

    return res
      .status(200)
      .json(value);
  } catch (error) {
    if (
      error instanceof
        FixedProviderAdmissionError
    ) {
      res.setHeader(
        'Retry-After',
        String(
          error
            .retryAfterSeconds,
        ),
      );

      return res
        .status(
          error.statusCode,
        )
        .json({
          error: ERROR,
        });
    }

    return res
      .status(502)
      .json({
        error: ERROR,
      });
  }
};

export function __resetSupportTwitchUserResourcesForTests():
void {
  cache.clear();
  inFlight.clear();
}

export default handler;
