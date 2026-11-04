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

const GQL_URL =
  'https://gql.twitch.tv/gql';

const GQL_CLIENT_ID =
  'kimne78kx3ncx6brgo4mv6wki5h1ko';

const QUERY = `
query($login: String) {
  user(login: $login) {
    channel {
      hypeTrain {
        execution {
          isActive
          progress {
            goal
            progression
            level {
              value
            }
          }
        }
      }
    }
  }
}
`;

export const TWITCH_HYPE_TRAIN_TIMEOUT_MS =
  15_000;

export const TWITCH_HYPE_TRAIN_MAX_BYTES =
  64 * 1024;

const GENERIC_ERROR = {
  error: 'Unable to load Twitch Hype Train status.',
};

type ActiveResponse = {
  active: true;
  level: number;
  progress: number;
  goal: number;
};

type InactiveResponse = {
  active: false;
};

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function safeInteger(
  value: unknown,
  minimum: number,
): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    return null;
  }

  return value;
}

function parseHypeTrain(
  body: unknown,
):
  | ActiveResponse
  | InactiveResponse
  | null {
  if (
    !isPlainObject(body) ||
    !isPlainObject(body.data) ||
    !isPlainObject(body.data.user) ||
    !isPlainObject(
      body.data.user.channel,
    ) ||
    !(
      'hypeTrain' in
      body.data.user.channel
    )
  ) {
    return null;
  }

  const hypeTrain =
    body.data.user.channel.hypeTrain;

  if (hypeTrain === null) {
    return {
      active: false,
    };
  }

  if (!isPlainObject(hypeTrain)) {
    return null;
  }

  const execution =
    hypeTrain.execution;

  if (
    execution === null ||
    execution === undefined
  ) {
    return {
      active: false,
    };
  }

  if (
    !isPlainObject(execution) ||
    typeof execution.isActive !==
      'boolean'
  ) {
    return null;
  }

  if (!execution.isActive) {
    return {
      active: false,
    };
  }

  if (
    !isPlainObject(
      execution.progress,
    )
  ) {
    return null;
  }

  const progressData =
    execution.progress;

  if (
    !isPlainObject(
      progressData.level,
    )
  ) {
    return null;
  }

  const level = safeInteger(
    progressData.level.value,
    1,
  );

  const progress = safeInteger(
    progressData.progression,
    0,
  );

  const goal = safeInteger(
    progressData.goal,
    0,
  );

  if (
    level === null ||
    progress === null ||
    goal === null
  ) {
    return null;
  }

  return {
    active: true,
    level,
    progress,
    goal,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader(
      'Allow',
      'GET',
    );

    res.status(405).json({
      error:
        'Method not allowed.',
    });

    return;
  }

  if (
    Array.isArray(
      req.query.channel,
    )
  ) {
    res.status(400).json({
      error: 'Invalid channel.',
    });

    return;
  }

  const channel =
    (
      req.query.channel ??
      ''
    )
      .trim()
      .toLowerCase()
      .replace(/^@/, '');

  if (
    !/^[a-z0-9_]{1,25}$/.test(
      channel,
    )
  ) {
    res.status(400).json({
      error: 'Invalid channel.',
    });

    return;
  }

  try {
    const body =
      await runFixedProviderWork({
        key:
          `twitch-hypetrain:${channel}`,
        clientKey:
          fixedProviderClientKey(
            req,
          ),
        run: () =>
          withFixedProviderTimeout(
            TWITCH_HYPE_TRAIN_TIMEOUT_MS,
            async (signal) => {
              const response =
                await fetch(
                  GQL_URL,
                  {
                    method: 'POST',
                    headers: {
                      'Client-ID':
                        GQL_CLIENT_ID,
                      'Content-Type':
                        'application/json',
                    },
                    body:
                      JSON.stringify({
                        query:
                          QUERY,
                        variables: {
                          login:
                            channel,
                        },
                      }),
                    redirect:
                      'error',
                    signal,
                  },
                );

              if (
                !response.ok
              ) {
                await discardFixedProviderBody(
                  response,
                );

                throw new Error(
                  'Twitch Hype Train lookup failed.',
                );
              }

              return readBoundedFixedProviderJson(
                response,
                TWITCH_HYPE_TRAIN_MAX_BYTES,
              );
            },
          ),
      });

    const parsed =
      parseHypeTrain(body);

    if (!parsed) {
      res.status(502).json(
        GENERIC_ERROR,
      );

      return;
    }

    res.setHeader(
      'Cache-Control',
      'no-store',
    );

    res.status(200).json(
      parsed,
    );
  } catch (error) {
    if (
      error instanceof
      FixedProviderAdmissionError
    ) {
      res.setHeader(
        'Retry-After',
        String(
          error.retryAfterSeconds,
        ),
      );

      res
        .status(
          error.statusCode,
        )
        .json({
          error:
            error.kind ===
            'rate'
              ? 'Too many Twitch Hype Train requests.'
              : 'Twitch Hype Train status temporarily unavailable.',
        });

      return;
    }

    res.status(502).json(
      GENERIC_ERROR,
    );
  }
}