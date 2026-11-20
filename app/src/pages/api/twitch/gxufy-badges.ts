import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import {
  getGxufyBadges,
} from '@/lib/server/gxufyBadges';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: 'Method not allowed',
    });
    return;
  }

  const badges = await getGxufyBadges();

  res.setHeader(
    'Cache-Control',
    'public, s-maxage=300, stale-while-revalidate=3600',
  );

  res.status(200).json(badges);
}
