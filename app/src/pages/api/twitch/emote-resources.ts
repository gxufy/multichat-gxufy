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

const REQUEST_TIMEOUT_MS =
  7_000;

export const TWITCH_EMOTE_RESOURCE_MAX_BYTES =
  4 * 1024 * 1024;

const GENERIC_ERROR = {
  error:
    'Unable to load Twitch emote resources.',
};

function providerUrls(
  channelId: string,
) {
  return {
    ffzGlobal:
      'https://api.betterttv.net/3/cached/frankerfacez/emotes/global',

    ffzChannel:
      'https://api.betterttv.net/3/cached/frankerfacez/users/twitch/'
      + channelId,

    bttvGlobal:
      'https://api.betterttv.net/3/cached/emotes/global',

    bttvChannel:
      'https://api.betterttv.net/3/cached/users/twitch/'
      + channelId,

    ffzRoom:
      'https://api.frankerfacez.com/v1/_room/id/'
      + channelId,
  };
}

async function readOptionalProvider(
  url: string,
  signal: AbortSignal,
): Promise<unknown | null> {
  try {
    const response =
      await fetch(
        url,
        {
          signal,
          redirect:
            'error',
          headers: {
            Accept:
              'application/json, text/plain;q=0.9, */*;q=0.8',
          },
        },
      );

    if (
      !response.ok
    ) {
      await discardFixedProviderBody(
        response,
      );

      return null;
    }

    return await readBoundedFixedProviderJson(
      response,
      TWITCH_EMOTE_RESOURCE_MAX_BYTES,
    );
  } catch (error) {
    /*
     * A route timeout aborts all five fixed requests together.
     * An ordinary single-provider failure remains partial data.
     */
    if (
      signal.aborted
    ) {
      throw error;
    }

    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (
    req.method !== 'GET'
  ) {
    res.setHeader(
      'Allow',
      'GET',
    );

    return res
      .status(405)
      .json({
        error:
          'Method not allowed.',
      });
  }

  const channelId =
    typeof req.query
      .channelId === 'string'
      ? req.query
          .channelId
          .trim()
      : '';

  if (
    !/^\d{1,30}$/.test(
      channelId,
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          'Invalid Twitch channel id.',
      });
  }

  const upstream =
    providerUrls(
      channelId,
    );

  try {
    const body =
      await runFixedProviderWork({
        /*
         * Fixed resource class, not user-controlled upstream identity.
         */
        key:
          'twitch-emote-resources',

        clientKey:
          fixedProviderClientKey(
            req,
          ),

        run: () =>
          withFixedProviderTimeout(
            REQUEST_TIMEOUT_MS,
            async (
              signal,
            ) => {
              const [
                ffzGlobal,
                ffzChannel,
                bttvGlobal,
                bttvChannel,
                ffzRoom,
              ] =
                await Promise.all([
                  readOptionalProvider(
                    upstream
                      .ffzGlobal,
                    signal,
                  ),

                  readOptionalProvider(
                    upstream
                      .ffzChannel,
                    signal,
                  ),

                  readOptionalProvider(
                    upstream
                      .bttvGlobal,
                    signal,
                  ),

                  readOptionalProvider(
                    upstream
                      .bttvChannel,
                    signal,
                  ),

                  readOptionalProvider(
                    upstream
                      .ffzRoom,
                    signal,
                  ),
                ]);

              return {
                ffzGlobal,
                ffzChannel,
                bttvGlobal,
                bttvChannel,
                ffzRoom,
              };
            },
          ),
      });

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300',
    );

    return res
      .status(200)
      .json(
        body,
      );
  } catch (error) {
    if (
      error
        instanceof
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
          error
            .statusCode,
        )
        .json(
          GENERIC_ERROR,
        );
    }

    return res
      .status(502)
      .json(
        GENERIC_ERROR,
      );
  }
}
