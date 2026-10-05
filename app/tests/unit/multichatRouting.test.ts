/* /multichat routing — the overlay-compatibility boundary.
 *
 * The property under test is one-directional and permanent: any query naming a
 * channel must resolve to the overlay, whatever else it carries. Every OBS scene
 * in existence points at this path, so serving anything else for one of those
 * URLs would black out a live stream. The generator cases matter too, but they are
 * recoverable; the overlay cases are not.
 *
 * Nothing here redirects any more. A channel-less visit renders the generator on
 * this same path, so the previous forwarding rule — and the fragment-preservation
 * machinery that went with it — is gone. What remains is a single pure decision.
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_COUNTER_ROUTE,
  CANONICAL_MULTICHAT_ROUTE,
  COUNTER_SECTION_ID,
  MULTICHAT_CHANNEL_PARAMS,
  hasChannelParam,
  resolveMultichatRoute,
  wantsCounterSection,
} from '@/lib/multichatRouting';

describe('canonical routes', () => {
  it('serves the generator from the overlay path', () => {
    expect(CANONICAL_MULTICHAT_ROUTE).toBe('/multichat');
  });

  it('reaches the counter as a section of that page, not a route', () => {
    expect(COUNTER_SECTION_ID).toBe('viewer-counter');
    expect(CANONICAL_COUNTER_ROUTE).toBe('/multichat#viewer-counter');
  });

  it('covers every channel parameter the overlay parser accepts', () => {
    expect(MULTICHAT_CHANNEL_PARAMS).toEqual([
      'channel',
      'kick',
      'twitch',
      'youtube',
      'tiktok',
    ]);
  });
});

describe('overlay requests', () => {
  it.each(MULTICHAT_CHANNEL_PARAMS)('serves the overlay for ?%s=', (param) => {
    expect(resolveMultichatRoute({ [param]: 'somechannel' })).toEqual({
      kind: 'overlay',
    });
  });

  it('serves the overlay for a full multi-platform URL', () => {
    expect(
      resolveMultichatRoute({
        kick: 'a',
        twitch: 'b',
        youtube: 'c',
        tiktok: 'd',
        fade: '30',
      }).kind,
    ).toBe('overlay');
  });

  /* The case that makes the ordering load-bearing: a scene collection could
     carry any extra parameter, and none of them may cost the overlay. */
  it('serves the overlay even when tab=counter is also present', () => {
    expect(resolveMultichatRoute({ kick: 'a', tab: 'counter' }).kind).toBe('overlay');
  });

  it('serves the overlay for a repeated parameter with one real value', () => {
    expect(resolveMultichatRoute({ kick: ['', 'real'] }).kind).toBe('overlay');
  });

  it('keeps serving the overlay regardless of unrelated settings', () => {
    expect(
      resolveMultichatRoute({
        twitch: 'a',
        sourceTag: 'text',
        pinPlatforms: 'twitch',
        theme: 'dark',
      }).kind,
    ).toBe('overlay');
  });
});

describe('generator requests', () => {
  it('serves the generator for a bare visit', () => {
    expect(resolveMultichatRoute({})).toEqual({ kind: 'generator' });
  });

  it('serves the generator for tab=counter with no channel', () => {
    expect(resolveMultichatRoute({ tab: 'counter' })).toEqual({ kind: 'generator' });
  });

  /* An unfilled generator field submits `?kick=`. That is not a channel, so it
     must not be mistaken for an overlay request and leave the visitor on a page
     with nothing on it. */
  it.each(MULTICHAT_CHANNEL_PARAMS)(
    'treats an empty ?%s= as a generator visit',
    (param) => {
      expect(resolveMultichatRoute({ [param]: '' }).kind).toBe('generator');
      expect(resolveMultichatRoute({ [param]: '   ' }).kind).toBe('generator');
    },
  );

  it('treats a repeated all-empty parameter as a generator visit', () => {
    expect(resolveMultichatRoute({ kick: ['', ''] }).kind).toBe('generator');
  });

  it('only ever resolves to one of the two kinds', () => {
    const queries = [
      {},
      { tab: 'counter' },
      { tab: 'nonsense' },
      { kick: '' },
      { kick: 'a' },
      { sourceTag: 'icon' },
    ];
    for (const query of queries) {
      expect(['overlay', 'generator']).toContain(resolveMultichatRoute(query).kind);
    }
  });
});

/* Two spellings reach the counter: the anchor the retired /tools/counter route
   redirects to, and the ?tab=counter query old bookmarks still carry. */
describe('wantsCounterSection', () => {
  it('honours the counter anchor', () => {
    expect(wantsCounterSection({}, '#viewer-counter')).toBe(true);
    expect(wantsCounterSection({}, 'viewer-counter')).toBe(true);
  });

  it('honours the legacy tab query', () => {
    expect(wantsCounterSection({ tab: 'counter' }, '')).toBe(true);
  });

  it('is false for anything else', () => {
    expect(wantsCounterSection({}, '')).toBe(false);
    expect(wantsCounterSection({}, '#')).toBe(false);
    expect(wantsCounterSection({}, '#faq')).toBe(false);
    expect(wantsCounterSection({ tab: 'chat' }, '')).toBe(false);
    expect(wantsCounterSection({ tab: 'COUNTER' }, '')).toBe(false);
    expect(wantsCounterSection({ tab: 'counter ' }, '')).toBe(false);
  });

  it('is false for an ambiguous repeated tab', () => {
    expect(wantsCounterSection({ tab: ['counter', 'chat'] }, '')).toBe(false);
  });

  /* An OAuth fragment is not an anchor. It must not be read as a request to jump
     to the counter, and the connection-adoption path handles it instead. */
  it('ignores an OAuth connection fragment', () => {
    const ID = '123e4567-e89b-12d3-a456-426614174000';
    expect(
      wantsCounterSection({}, `#twitchConnectionId=${ID}&twitch=someone`),
    ).toBe(false);
  });

  it('defaults the hash, so a caller with none can omit it', () => {
    expect(wantsCounterSection({})).toBe(false);
    expect(wantsCounterSection({ tab: 'counter' })).toBe(true);
  });
});

describe('hasChannelParam', () => {
  it('is true only for a non-empty channel value', () => {
    expect(hasChannelParam({ kick: 'a' })).toBe(true);
    expect(hasChannelParam({ kick: '' })).toBe(false);
    expect(hasChannelParam({})).toBe(false);
    expect(hasChannelParam({ tab: 'counter' })).toBe(false);
  });

  it('ignores parameters that do not name a channel', () => {
    expect(hasChannelParam({ fade: '30', theme: 'dark', chan: 'x' })).toBe(false);
  });
});

/* These helpers must stay usable during server rendering, where there is no
   window. They take everything they need as arguments for exactly that reason —
   a version that read window.location itself would throw on the server pass. */
describe('server-side safety', () => {
  it('resolves every route with window removed', () => {
    const original = globalThis.window;
    // @ts-expect-error deleting the global is the whole point of the test
    delete globalThis.window;
    try {
      expect(resolveMultichatRoute({ kick: 'a' }).kind).toBe('overlay');
      expect(resolveMultichatRoute({}).kind).toBe('generator');
      expect(wantsCounterSection({}, '#viewer-counter')).toBe(true);
      expect(hasChannelParam({ twitch: 'a' })).toBe(true);
    } finally {
      globalThis.window = original;
    }
  });
});
