import type { NextApiRequest, NextApiResponse } from 'next';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let cachedSvg: string | null = null;

function roundedAvatarSvg(): string {
  if (cachedSvg) return cachedSvg;

  const avatarPath = path.join(process.cwd(), 'public', 'gxufy-avatar.gif');
  const avatar = readFileSync(avatarPath).toString('base64');

  cachedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <defs>
    <clipPath id="gxufy-rounded">
      <rect width="192" height="192" rx="42" ry="42" />
    </clipPath>
  </defs>
  <image href="data:image/gif;base64,${avatar}" width="192" height="192" preserveAspectRatio="xMidYMid slice" clip-path="url(#gxufy-rounded)" />
</svg>`;

  return cachedSvg;
}

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
  res.status(200).send(roundedAvatarSvg());
}
