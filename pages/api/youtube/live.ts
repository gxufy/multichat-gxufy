/* GET /api/youtube/live?channel=<handle|name>
 *
 * Resolves a channel handle to its current livestream and bootstraps the
 * InnerTube live-chat session (unified-chat-lite youtube.py scheme):
 *  1. GET youtube.com/@handle/live — only a LIVE page canonicalizes to
 *     /watch?v=<id>; offline pages canonicalize back to the channel.
 *  2. GET the popout live_chat page and scrape INNERTUBE_API_KEY,
 *     INNERTUBE_CONTEXT_CLIENT_VERSION and the first continuation token.
 * SOCS=CAI cookie skips EU consent walls.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const CANONICAL_WATCH_RE = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/;
const API_KEY_RE = /"INNERTUBE_API_KEY":"([^"]+)"/;
const CLIENT_VERSION_RE = /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/;
const CONTINUATION_RE = /"continuation":"([^"]+)"/;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'SOCS=CAI',
};

async function findLiveVideo(name: string): Promise<string | null> {
  const clean = name.replace(/^@/, '');
  const urls = [
    `https://www.youtube.com/@${clean}/live`,
    `https://www.youtube.com/c/${clean}/live`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: 'follow' });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(CANONICAL_WATCH_RE);
      if (m) return m[1];
    } catch { /* try next form */ }
  }
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const channel = (req.query.channel as string || '').trim();
  if (!channel || !/^@?[A-Za-z0-9._-]{1,50}$/.test(channel)) {
    return res.status(400).json({ error: 'invalid channel' });
  }

  const videoId = await findLiveVideo(channel);
  if (!videoId) return res.status(200).json({ offline: true });

  const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`;
  const r = await fetch(chatUrl, { headers: HEADERS });
  if (!r.ok) return res.status(502).json({ error: `live_chat page: ${r.status}` });
  const html = await r.text();

  const apiKey = html.match(API_KEY_RE)?.[1];
  const clientVersion = html.match(CLIENT_VERSION_RE)?.[1];
  const continuation = html.match(CONTINUATION_RE)?.[1];
  if (!apiKey || !clientVersion || !continuation) {
    return res.status(502).json({ error: 'could not bootstrap live chat' });
  }

  res.status(200).json({ videoId, apiKey, clientVersion, continuation });
}
