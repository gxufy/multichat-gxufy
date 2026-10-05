import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeChatChannel } from '../../../lib/channelValidation';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';

export const KICK_CHANNEL_TIMEOUT_MS = 5_000;
export const KICK_CHANNEL_MAX_BYTES = 512 * 1024;

const HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://kick.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const channel = normalizeChatChannel('kick', req.query.channel);
  if (!channel) return res.status(400).json({ error: 'invalid channel' });
  try {
    const result = await runFixedProviderWork({
      key: `kick-channel:${channel.toLowerCase()}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(KICK_CHANNEL_TIMEOUT_MS, async (signal) => {
        const upstream = await fetch(
          `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`,
          {
            headers: HEADERS,
            cache: 'no-store',
            redirect: 'error',
            signal,
          },
        );
        if (!upstream.ok) {
          await discardFixedProviderBody(upstream);
          return { status: upstream.status === 404 ? 404 : 502, body: null } as const;
        }
        return {
          status: 200,
          body: await readBoundedFixedProviderJson(upstream, KICK_CHANNEL_MAX_BYTES),
        } as const;
      }),
    });
    if (result.status !== 200) return res.status(result.status).json({ error: `Kick ${result.status}` });
    return res.status(200).json(result.body);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many Kick channel lookups.'
          : 'Kick channel lookup temporarily unavailable.',
      });
    }
    return res.status(502).json({ error: 'Kick channel lookup failed' });
  }
}
