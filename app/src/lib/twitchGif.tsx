import { el, type ChatElement } from './render/elementTree';
import { isSafeRemoteMediaUrl } from './remoteMediaUrl';
import { normalizeTwitchGifSize } from './twitchGifConfig';

export { DEFAULT_TWITCH_GIF_SIZE_PX } from './twitchGifConfig';

export { parseTwitchGifTag } from './twitchGifTag';

export function twitchGifPart(url: string, size: number, key = 'twitch-native-gif'): ChatElement | null {
  if (!isSafeRemoteMediaUrl(url)) return null;
  const px = normalizeTwitchGifSize(size);
  return el('img', {
    class: 'ck-twitch-gif',
    src: url,
    alt: 'GIF',
    draggable: 'false',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
    style: {
      display: 'inline-block',
      width: 'auto',
      height: 'auto',
      maxWidth: '100%',
      maxHeight: `${px}px`,
      objectFit: 'contain',
      verticalAlign: 'middle',
    },
  }, undefined, { key, onError: 'hide' });
}
