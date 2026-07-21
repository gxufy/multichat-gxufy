/* GET /api/viewers?twitch=x&youtube=y&tiktok=z
 *
 * Live viewer counts, server-side (Kick is fetched client-side — its API
 * blocks server IPs but allows browsers). 12s in-memory cache per channel
 * so many overlay clients share upstream requests.
 *  - twitch: anonymous GQL stream{viewersCount}
 *  - youtube: /@handle/live canonical → watch page "watching now" scrape
 *  - tiktok: tiktok-live-connector room info (user_count)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { TikTokLiveConnection } from 'tiktok-live-connector';

interface PlatformCount { live: boolean; viewers: number }
const cache = new Map<string, { at: number; data: PlatformCount }>();
const TTL = 12_000;

async function cached(key: string, fn: () => Promise<PlatformCount>): Promise<PlatformCount> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  try {
    const data = await fn();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    // keep serving stale on upstream hiccups
    return hit?.data ?? { live: false, viewers: 0 };
  }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function twitchViewers(login: string): Promise<PlatformCount> {
  const r = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query($login: String!) { user(login: $login) { stream { viewersCount } } }',
      variables: { login },
    }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const stream = (await r.json())?.data?.user?.stream;
  return { live: !!stream, viewers: stream?.viewersCount ?? 0 };
}

async function youtubeViewers(handle: string): Promise<PlatformCount> {
  const clean = handle.replace(/^@/, '');
  const live = await fetch(`https://www.youtube.com/@${clean}/live`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+cb' },
  });
  if (!live.ok) return { live: false, viewers: 0 };
  const html = await live.text();
  // Datacenter IPs sometimes get HTML variants without the canonical
  // <link>; accept any signal that this resolved to a live watch page
  const isLive =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=/.test(html) ||
    /<meta property="og:url" content="https:\/\/www\.youtube\.com\/watch\?v=/.test(html) ||
    /"isLiveNow"\s*:\s*true/.test(html);
  if (!isLive) return { live: false, viewers: 0 };
  const m = html.match(/"viewCount":\{"runs":\[\{"text":"([\d,.\s ]+)"/)
    || html.match(/"originalViewCount":"(\d+)"/)
    || html.match(/([\d,.]+)\s+watching now/);
  const viewers = m ? parseInt(m[1].replace(/[^\d]/g, ''), 10) || 0 : 0;
  return { live: true, viewers };
}

async function tiktokViewers(user: string): Promise<PlatformCount> {
  const conn = new TikTokLiveConnection(`@${user.replace(/^@/, '')}`, {
    ...(process.env.TIKTOK_SIGN_API_KEY ? { signApiKey: process.env.TIKTOK_SIGN_API_KEY } : {}),
  });
  const info: any = await conn.fetchRoomInfo();
  const viewers = info?.user_count ?? info?.data?.user_count ?? 0;
  // status 2 = live, 4 = ended
  const status = info?.status ?? info?.data?.status;
  return { live: status === 2 || (!status && viewers > 0), viewers };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = (k: string) => {
    const v = (req.query[k] as string || '').trim();
    return /^@?[A-Za-z0-9._-]{1,50}$/.test(v) ? v : '';
  };
  const twitch = q('twitch'), youtube = q('youtube'), tiktok = q('tiktok');

  // ?debug=yt — report what YouTube actually serves this server's IP
  if (req.query.debug === 'yt' && youtube) {
    const clean = youtube.replace(/^@/, '');
    const r = await fetch(`https://www.youtube.com/@${clean}/live`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+cb' },
      redirect: 'follow',
    });
    const html = await r.text();
    return res.status(200).json({
      status: r.status,
      finalUrl: r.url,
      htmlLen: html.length,
      title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null,
      canonical: html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null,
      ogUrl: html.match(/<meta property="og:url" content="([^"]+)"/)?.[1] ?? null,
      isLiveNow: /"isLiveNow"\s*:\s*true/.test(html),
      hasViewCountRuns: /"viewCount":\{"runs"/.test(html),
      consentPage: /consent\.youtube\.com|before you continue/i.test(html),
      snippet: html.slice(0, 300),
    });
  }

  const [tw, yt, tt] = await Promise.all([
    twitch ? cached(`tw:${twitch.toLowerCase()}`, () => twitchViewers(twitch.toLowerCase())) : null,
    youtube ? cached(`yt:${youtube.toLowerCase()}`, () => youtubeViewers(youtube)) : null,
    tiktok ? cached(`tt:${tiktok.toLowerCase()}`, () => tiktokViewers(tiktok)) : null,
  ]);

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ...(tw ? { twitch: tw } : {}),
    ...(yt ? { youtube: yt } : {}),
    ...(tt ? { tiktok: tt } : {}),
  });
}
