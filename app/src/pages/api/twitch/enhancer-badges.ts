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
  parseEnhancerAggregate,
} from '../../../lib/server/enhancerBadges';

const ENHANCER_BADGES_URL =
  'https://api.enhancer.at/v1/channel/twitch/global/aggregate';

const REQUEST_TIMEOUT_MS = 5_000;

export const ENHANCER_BADGES_MAX_BYTES =
  1024 * 1024;

const GENERIC_ERROR = {
  error: 'Unable to load Enhancer badges.',
};

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
    const body = await runFixedProviderWork({
      key: 'enhancer-global-badges',
      clientKey: fixedProviderClientKey(req),

      run: () =>
        withFixedProviderTimeout(
          REQUEST_TIMEOUT_MS,
          async (signal) => {
            const response = await fetch(
              ENHANCER_BADGES_URL,
              {
                signal,
                redirect: 'error',
                headers: {
                  Accept: 'application/json',
                },
              },
            );

            if (!response.ok) {
              await discardFixedProviderBody(
                response,
              );

              throw new Error(
                'Enhancer badge lookup failed',
              );
            }

            return readBoundedFixedProviderJson(
              response,
              ENHANCER_BADGES_MAX_BYTES,
            );
          },
        ),
    });

    const badges =
      parseEnhancerAggregate(body);

    if (badges === null) {
      return res.status(502).json(
        GENERIC_ERROR,
      );
    }

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=60',
    );

    return res.status(200).json(badges);
  } catch (error) {
    if (
      error
      instanceof FixedProviderAdmissionError
    ) {
      res.setHeader(
        'Retry-After',
        String(error.retryAfterSeconds),
      );

      return res
        .status(error.statusCode)
        .json(GENERIC_ERROR);
    }

    return res.status(502).json(
      GENERIC_ERROR,
    );
  }
}