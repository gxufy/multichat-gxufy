import type { ApiRequest, ApiResponse } from '@/lib/server/apiTypes';
import {
  FixedProviderAdmissionError,
  discardFixedProviderBody,
  fixedProviderClientKey,
  readBoundedFixedProviderJson,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../lib/server/fixedProviderProxy';

export const KICK_HISTORY_TIMEOUT_MS = 2_000;
export const KICK_HISTORY_MAX_BYTES = 1024 * 1024;

/* A plain request. Kick's security answers 403 ("Request blocked by security
   policy") to a server that claims to be a Chrome browser, and 200 to one that
   doesn't (checked from the server). The realtime hub learned the same. */
const HEADERS = { Accept: 'application/json' } as const;

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const channelId = typeof req.query.channelId === 'string'
    ? req.query.channelId.trim()
    : '';
  if (!/^\d{1,20}$/.test(channelId)) return res.status(400).json({ error: 'invalid channel id' });
  try {
    const result = await runFixedProviderWork({
      key: `kick-history:${channelId}`,
      clientKey: fixedProviderClientKey(req),
      run: () => withFixedProviderTimeout(KICK_HISTORY_TIMEOUT_MS, async (signal) => {
        const upstream = await fetch(`https://kick.com/api/v2/channels/${channelId}/messages`, {
          headers: HEADERS,
          cache: 'no-store',
          redirect: 'error',
          signal,
        });
        if (!upstream.ok) {
          await discardFixedProviderBody(upstream);
          return { status: upstream.status === 404 ? 404 : 502, body: null } as const;
        }
        return {
          status: 200,
          body: await readBoundedFixedProviderJson(upstream, KICK_HISTORY_MAX_BYTES),
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
          ? 'Too many Kick history requests.'
          : 'Kick history temporarily unavailable.',
      });
    }
    return res.status(502).json({ error: 'Kick history lookup failed' });
  }
}
