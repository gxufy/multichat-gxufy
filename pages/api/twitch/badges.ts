/* GET /api/twitch/badges?channel=<login>
 *
 * Full Twitch badge art via anonymous GQL (web client-id, no OAuth):
 * global sets + the channel's broadcastBadges (subscriber tiers, bits).
 * Returns { "<setID>/<version>": imageURL } — the exact art for every
 * badge the IRC `badges` tag can reference, replacing the hardcoded
 * 10-UUID map (which missed sub tiers, bits, and event badges).
 */
import type { NextApiRequest, NextApiResponse } from 'next';

const GQL_URL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // Twitch's own web client (anonymous)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const channel = (req.query.channel as string || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) {
    return res.status(400).json({ error: 'invalid channel' });
  }

  const r = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($login: String!) {
        badges { setID version imageURL(size: DOUBLE) }
        user(login: $login) { broadcastBadges { setID version imageURL(size: DOUBLE) } }
      }`,
      variables: { login: channel },
    }),
  });
  if (!r.ok) return res.status(502).json({ error: `gql: ${r.status}` });
  const data = await r.json();

  const map: Record<string, string> = {};
  // globals first so channel badges (sub tiers, bits) override them
  for (const b of data?.data?.badges ?? []) {
    if (b?.setID && b?.imageURL) map[`${b.setID}/${b.version}`] = b.imageURL;
  }
  for (const b of data?.data?.user?.broadcastBadges ?? []) {
    if (b?.setID && b?.imageURL) map[`${b.setID}/${b.version}`] = b.imageURL;
  }

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(map);
}
