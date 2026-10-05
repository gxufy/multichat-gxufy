/* The generated URLs, as literal strings.
 *
 * Every other URL test in this suite asserts an identity: that the page's URL
 * equals what the serializer produces. These literal assertions additionally
 * lock the current public URL shape after intentional default changes.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMultichatQuery,
  safeParseMultichatConfig,
  type MultichatSerializableStyle,
} from '@/lib/multichatConfig';
import {
  buildViewerCounterQuery,
  parseViewerCounterConfig,
} from '@/lib/viewerCounterConfig';
import { buildOverlayUrl, overlayFragment } from '@/lib/tools/toolContext';
import { multichatTool } from '@/features/multichat/config';
import { counterTool } from '@/features/counter/config';

const BASE = 'https://multichat-gxufy.vercel.app';

const NO_CHANNELS = { kick: '', twitch: '', youtube: '', tiktok: '' };

/** A query string → the keys in the order they appear. */
function keys(query: string): string[] {
  return query.length ? query.split('&').map((p) => p.split('=')[0]) : [];
}

describe('MultiChat, complete strings', () => {
  const MC_DEFAULT_TAIL =
    '&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium' +
    '&font=opensans&textShadow=large&stroke=none&animation=slide&fade=30' +
    '&hideNames=false';

  it('one Kick channel at every default', () => {
    expect(
      buildOverlayUrl({
        baseUrl: BASE,
        route: multichatTool.overlayRoute,
        query: buildMultichatQuery({ ...NO_CHANNELS, kick: 'somechannel' }, multichatTool.defaults),
      }),
    ).toBe(`${BASE}/multichat?kick=somechannel${MC_DEFAULT_TAIL}`);
  });

  it('the descriptor produces that same string through its own adapter', () => {
    expect(multichatTool.serialize({ kick: 'somechannel' } as never, multichatTool.defaults)).toBe(
      `kick=somechannel${MC_DEFAULT_TAIL}`.replace(/^&/, ''),
    );
  });

  it('all four channels, every active control off its default', () => {
    const flipped: MultichatSerializableStyle = {
      ...multichatTool.defaults,
      sevenTVEmotesEnabled: false,
      sevenTVCosmeticsEnabled: false,
      textSize: 'large',
      font: 'roboto',
      textShadow: 'none',
      stroke: 'thick',
      animation: 'none',
      fade: '5',
      fadeEnabled: true,
      showPinEnabled: false,
      mentionColor: false,
      bgColor: '#112233',
      emoteScale: '1.5',
      msgBold: false,
      msgCaps: true,
      modAction: false,
      paintShadows: false,
      fontColor: '#ff0000',
      pinPlatforms: [],
      hideNames: true,
      botNames: 'nightbot, streamelements',
      userBL: 'someone',
      prefixBL: '!, ?',
      sourceTag: 'label',
    };
    expect(
      buildOverlayUrl({
        baseUrl: BASE,
        route: multichatTool.overlayRoute,
        query: buildMultichatQuery(
          { kick: 'kickname', twitch: 'twitchname', youtube: '@handle', tiktok: 'tiktokname' },
          flipped,
        ),
      }),
    ).toBe(
      `${BASE}/multichat?kick=kickname&twitch=twitchname&youtube=handle&tiktok=tiktokname` +
        '&sevenTVEmotesEnabled=false&sevenTVCosmeticsEnabled=false&textSize=large' +
        '&font=roboto&textShadow=none&stroke=thick&animation=none&fade=5' +
        '&sourceTag=label&mentionColor=false&bgColor=112233' +
        '&emoteScale=1.5&msgBold=false&msgCaps=true&modAction=false&paintShadows=false' +
        '&fontColor=ff0000&hideNames=true' +
        '&botNames=nightbot%2C+streamelements&userBL=someone&prefixBL=%21%2C+%3F',
    );
  });

  it('omits fade entirely when the fade switch is off', () => {
    expect(
      buildMultichatQuery(
        { ...NO_CHANNELS, kick: 'k' },
        {
          ...multichatTool.defaults,
          fadeEnabled: false,
          pinPlatforms: ['kick', 'twitch', 'youtube', 'tiktok'],
        },
      ),
    ).toBe(
      'kick=k&sevenTVEmotesEnabled=true&sevenTVCosmeticsEnabled=true&textSize=medium' +
        '&font=opensans&textShadow=large&stroke=none&animation=slide' +
        '&hideNames=false',
    );
  });

  it('substitutes a placeholder channel when nothing is typed', () => {
    expect(buildMultichatQuery(NO_CHANNELS, multichatTool.defaults)).toBe(
      `kick=yourchannel${MC_DEFAULT_TAIL}`.replace(/^&/, ''),
    );
  });

  it('retired pin fields never reappear in generated URLs', () => {
    const query = buildMultichatQuery(
      { ...NO_CHANNELS, kick: 'k' },
      { ...multichatTool.defaults, showPinEnabled: true, pinPlatforms: ['twitch'] },
    );
    expect(query).not.toContain('showPinEnabled');
    expect(query).not.toContain('pinPlatforms');
  });

  it('buildOverlayUrl still places an explicit fragment strictly after the query', () => {
    expect(
      buildOverlayUrl({
        baseUrl: BASE,
        route: multichatTool.overlayRoute,
        query: buildMultichatQuery({ ...NO_CHANNELS, twitch: 'twitchname' }, multichatTool.defaults),
        context: { fragment: 'conn=abc123' },
      }),
    ).toBe(`${BASE}/multichat?twitch=twitchname${MC_DEFAULT_TAIL}#conn=abc123`);
  });
});

describe('Counter, complete strings', () => {
  it('one Kick channel at every default', () => {
    expect(
      buildOverlayUrl({
        baseUrl: BASE,
        route: counterTool.overlayRoute,
        query: buildViewerCounterQuery({ kick: 'somechannel' }, counterTool.defaults),
      }),
    ).toBe(
      `${BASE}/counter?kick=somechannel&combined=true&icons=true&bg=false` +
        '&textShadow=large&stroke=none',
    );
  });

  it('all four channels with every control flipped', () => {
    expect(
      buildOverlayUrl({
        baseUrl: BASE,
        route: counterTool.overlayRoute,
        query: buildViewerCounterQuery(
          { kick: 'kickname', twitch: 'twitchname', youtube: 'handle', tiktok: 'tiktokname' },
          {
            ...counterTool.defaults,
            combined: false,
            icons: false,
            bg: true,
            textShadow: 'none',
            stroke: 'thin',
            align: 'right',
          },
        ),
      }),
    ).toBe(
      `${BASE}/counter?twitch=twitchname&youtube=handle&kick=kickname&tiktok=tiktokname` +
        '&combined=false&icons=false&bg=true&textShadow=none&stroke=thin&align=right',
    );
  });

  it('omits align while it is still the default', () => {
    expect(buildViewerCounterQuery({ kick: 'k' }, counterTool.defaults)).not.toContain('align');
  });

  it('never carries a connection fragment', () => {
    const once = buildOverlayUrl({ baseUrl: BASE, route: counterTool.overlayRoute, query: 'kick=a' });
    expect(once).toBe(
      buildOverlayUrl({ baseUrl: BASE, route: counterTool.overlayRoute, query: 'kick=a' }),
    );
    expect(once).not.toContain('#');
  });
});

describe('nothing malformed can reach a URL', () => {
  it('a partial counter style serializes to current defaults, never to "undefined"', () => {
    const query = buildViewerCounterQuery({ kick: 'k' }, {});
    expect(query).toBe('kick=k&combined=true&icons=true&bg=false&textShadow=large&stroke=none');
  });

  it('emits no undefined, null, or NaN in either tool', () => {
    for (const query of [
      buildMultichatQuery({ ...NO_CHANNELS, kick: 'somechannel' }, multichatTool.defaults),
      buildViewerCounterQuery({ kick: 'somechannel' }, counterTool.defaults),
      buildViewerCounterQuery({ kick: 'somechannel' }, {}),
    ]) {
      expect(query).not.toContain('undefined');
      expect(query).not.toContain('null');
      expect(query).not.toContain('NaN');
    }
  });

  it('every emitted pair has a key', () => {
    for (const query of [
      buildMultichatQuery(
        { kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' },
        { ...multichatTool.defaults, pinPlatforms: [] },
      ),
      buildViewerCounterQuery({ kick: 'a', twitch: 'b' }, counterTool.defaults),
    ]) {
      for (const key of keys(query)) expect(key.length, query).toBeGreaterThan(0);
      expect(query).not.toContain('&&');
      expect(query.startsWith('&')).toBe(false);
      expect(query.endsWith('&')).toBe(false);
    }
  });

  it('neither serializer emits a fragment or a leading question mark', () => {
    for (const query of [
      buildMultichatQuery({ ...NO_CHANNELS, kick: 'a' }, multichatTool.defaults),
      buildViewerCounterQuery({ kick: 'a' }, counterTool.defaults),
    ]) {
      expect(query).not.toContain('#');
      expect(query).not.toContain('?');
    }
  });

  it('leaves no bare or doubled # on any built URL', () => {
    for (const fragment of [undefined, '', '   ', '#', '##', '#conn=1', 'conn=1']) {
      const url = buildOverlayUrl({
        baseUrl: BASE,
        route: '/multichat',
        query: 'kick=a',
        context: fragment === undefined ? undefined : { fragment },
      });
      expect(url.endsWith('#'), String(fragment)).toBe(false);
      expect(url, String(fragment)).not.toContain('##');
      expect(url.split('#').length, String(fragment)).toBeLessThanOrEqual(2);
    }
    expect(overlayFragment({ fragment: 'conn=1' })).toBe(overlayFragment({ fragment: '#conn=1' }));
  });
});

describe('what the overlay reads back', () => {
  it('a complete MultiChat string parses to the state that built it', () => {
    const style: MultichatSerializableStyle = {
      ...multichatTool.defaults,
      textSize: 'large',
      fade: '5',
      emoteScale: '1.5',
      sourceTag: 'dot',
      showPinEnabled: false,
    };
    const query = buildMultichatQuery(
      { ...NO_CHANNELS, kick: 'kickname', twitch: 'twitchname' },
      style,
    );
    const parsed = safeParseMultichatConfig(Object.fromEntries(new URLSearchParams(query)));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.kick).toBe('kickname');
    expect(parsed.data.twitch).toBe('twitchname');
    expect(parsed.data.textSize).toBe('large');
    expect(parsed.data.fade).toBe(5);
    expect(parsed.data.emoteScale).toBe(1.5);
    expect(parsed.data.sourceTag).toBe('dot');
    expect(parsed.data.showPinEnabled).toBe(false);
  });

  it('a complete Counter string parses to the state that built it', () => {
    const style = {
      ...counterTool.defaults,
      combined: false,
      stroke: 'thin' as const,
      align: 'right' as const,
    };
    const query = buildViewerCounterQuery({ kick: 'kickname', tiktok: 'tiktokname' }, style);
    const parsed = parseViewerCounterConfig(Object.fromEntries(new URLSearchParams(query)));
    expect(parsed.channels.kick).toBe('kickname');
    expect(parsed.channels.tiktok).toBe('tiktokname');
    expect(parsed.style).toEqual(style);
  });

  it('every representative current string still parses', () => {
    const urls = [
      buildMultichatQuery({ ...NO_CHANNELS, kick: 'somechannel' }, multichatTool.defaults),
      buildMultichatQuery(NO_CHANNELS, multichatTool.defaults),
      buildMultichatQuery(
        { ...NO_CHANNELS, kick: 'k' },
        { ...multichatTool.defaults, fadeEnabled: false, pinPlatforms: [] },
      ),
    ];
    for (const query of urls) {
      const parsed = safeParseMultichatConfig(Object.fromEntries(new URLSearchParams(query)));
      expect(parsed.success, query).toBe(true);
    }
  });

  it('parameter order is stable across repeated builds', () => {
    const build = () =>
      buildMultichatQuery(
        { kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' },
        multichatTool.defaults,
      );
    expect(build()).toBe(build());
    expect(keys(build()).slice(0, 4)).toEqual(['kick', 'twitch', 'youtube', 'tiktok']);
    expect(keys(buildViewerCounterQuery({ kick: 'a', twitch: 'b', youtube: 'c', tiktok: 'd' }, counterTool.defaults)).slice(0, 4)).toEqual(
      ['twitch', 'youtube', 'kick', 'tiktok'],
    );
  });
});
