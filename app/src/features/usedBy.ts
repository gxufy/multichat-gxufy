/*
 * "Used by" row on the generator: streamers who run FlossChat and FlossCounter
 * on stream and agreed to have a clip shown here. Each one has three files in
 * public/used-by/: the clip with sound (the big clip in the fullscreen
 * carousel), a small silent copy for the clips peeking in at the sides, and a
 * still poster shown while a clip loads.
 */
export type UsedByStreamer = {
  /** Twitch login; also the file name stem in public/used-by/. */
  login: string;
  /** Twitch display name, as written on the channel. */
  name: string;
  /** Twitch user id, for their current profile picture. */
  id: string;
};

/* Bump when any clip file changes, so browsers and Cloudflare fetch the new one. */
export const USED_BY_ASSET_VERSION = '2';

export const USED_BY_STREAMERS: readonly UsedByStreamer[] = [
  { login: 'kaicenat', name: 'KaiCenat', id: '641972806' },
  { login: 'stableronaldo', name: 'stableronaldo', id: '246450563' },
  { login: 'silky', name: 'Silky', id: '451786566' },
  { login: 'plaqueboymax', name: 'PlaqueBoyMax', id: '672238954' },
  { login: 'symfuhny', name: 'Symfuhny', id: '31688366' },
  { login: '2xrakai', name: '2xRaKai', id: '997729120' },
  { login: 'yourragegaming', name: 'yourragegaming', id: '36926489' },
  { login: 'reemknocks', name: 'reemknocks', id: '480299813' },
  { login: 'agent00', name: 'Agent00', id: '90222258' },
  { login: 'rayasianboy', name: 'rayasianboy', id: '570335223' },
  { login: 'kelo', name: 'kelo', id: '705793897' },
];

export type UsedByAsset = 'clip' | 'tile' | 'poster';

export function usedByAssetPath(login: string, asset: UsedByAsset): string {
  const file = asset === 'clip'
    ? `${login}.mp4`
    : asset === 'tile'
      ? `${login}-tile.mp4`
      : `${login}.webp`;
  return `/used-by/${file}?v=${USED_BY_ASSET_VERSION}`;
}

export function usedByChannelUrl(login: string): string {
  return `https://www.twitch.tv/${encodeURIComponent(login)}`;
}
