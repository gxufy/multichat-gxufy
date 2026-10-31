import type { NextApiRequest, NextApiResponse } from 'next';
import {
  FixedProviderAdmissionError,
  fixedProviderClientKey,
} from '../../../lib/server/fixedProviderProxy';
import {
  isTwitchNumericUserId,
  loadJilChatBadges,
} from '../../../lib/server/vanityCommunityBadges';

const GENERIC_ERROR = { error: 'Unable to load JilChat badges.' };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const userId = Array.isArray(req.query.userId) ? '' : (req.query.userId ?? '').trim();
  if (!isTwitchNumericUserId(userId)) {
    return res.status(400).json({ error: 'Invalid Twitch user ID.' });
  }

  try {
    const badges = await loadJilChatBadges(userId, fixedProviderClientKey(req));
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
    return res.status(200).json(badges.map((badge) => ({
      id: badge.id,
      title: badge.title,
      url: badge.url,
    })));
  } catch (error) {
    if (error instanceof FixedProviderAdmissionError) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
      return res.status(error.statusCode).json(GENERIC_ERROR);
    }
    return res.status(502).json(GENERIC_ERROR);
  }
}
