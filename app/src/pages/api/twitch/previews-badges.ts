import type {
  NextApiRequest,
  NextApiResponse,
} from 'next';

import {
  getPreviewsTwitchDataset,
} from '@/lib/server/previewsBadges';

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

  try {
    const dataset = await getPreviewsTwitchDataset();

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=3600',
    );

    res.status(200).json(dataset);
  } catch {
    res.status(502).json({
      error: 'Previews badge data unavailable',
    });
  }
}