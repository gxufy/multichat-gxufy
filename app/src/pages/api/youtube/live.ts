/* GET /api/youtube/live?channel=<handle|name>
 *
 * Compatibility bootstrap for direct-polling clients. Production MultiChat
 * browsers use /api/youtube/stream so one server upstream can fan out to every
 * overlay, but this endpoint remains available for older/browser fallback use.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { normalizeChatChannel } from '../../../lib/channelValidation';
import {
  FixedProviderAdmissionError,
  fixedProviderClientKey,
  runFixedProviderWork,
  withFixedProviderTimeout,
} from '../../../lib/server/fixedProviderProxy';
import {
  bootstrapYouTubeChat,
  discoverYouTubeLiveVideos,
} from '../../../lib/server/youtubeUpstream';

export { extractAssignedJson, liveViewContinuation } from '../../../lib/server/youtubeUpstream';

export const YOUTUBE_LIVE_TIMEOUT_MS = 12_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const channel = normalizeChatChannel('youtube', req.query.channel);
  if (!channel) return res.status(400).json({ error: 'invalid channel' });

  try {
    const result = await runFixedProviderWork({
      key: `youtube-live:${channel.toLowerCase()}`,
      clientKey: fixedProviderClientKey(req),
      cost: 4,
      run: () => withFixedProviderTimeout(YOUTUBE_LIVE_TIMEOUT_MS, async (signal) => {
        const discovery = await discoverYouTubeLiveVideos(channel, signal);
        const videoId = discovery.featuredVideoId ?? discovery.videoIds[0];
        if (!videoId) return { status: 200, body: { offline: true } } as const;

        const bootstrap = await bootstrapYouTubeChat(videoId, signal);
        if (!bootstrap) {
          return {
            status: 502,
            body: {
              error: 'could not bootstrap live chat',
              videoId,
              videoIds: discovery.videoIds,
            },
          } as const;
        }

        return {
          status: 200,
          body: {
            ...bootstrap,
            videoIds: discovery.videoIds,
            ...(discovery.liveShortVideoId
              ? { liveShortVideoId: discovery.liveShortVideoId }
              : {}),
          },
        } as const;
      }),
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json({
        error: error.kind === 'rate'
          ? 'Too many YouTube live lookups.'
          : 'YouTube live lookup temporarily unavailable.',
      });
    }
    return res.status(502).json({ error: 'YouTube live lookup failed' });
  }
}
