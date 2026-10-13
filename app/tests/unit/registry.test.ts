/* Multi-tool registry, descriptor platform metadata, and the one URL builder.
 *
 * These are the properties the workspace shell now relies on instead of
 * counter-specific knowledge: the registry can hold more than one tool, each
 * tool declares its own channel fields, and every overlay URL comes from a
 * single derivation that keeps a query and a fragment apart.
 */
import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_IDS, findTool } from '@/features/registry';
import { buildOverlayUrl, overlayFragment } from '@/lib/tools/toolContext';
import {
  COUNTER_PLATFORMS,
  counterTool,
} from '@/features/counter/config';
import { COUNTER_CATALOG } from '@/features/counter/settings';
import {
  DEFAULT_STYLE,
  PLATFORM_ORDER,
  buildViewerCounterQuery,
  normalizeChannel,
} from '@/lib/viewerCounterConfig';

describe('registry', () => {
  it('holds MultiChat and the viewer counter, in that order', () => {
    expect(TOOL_IDS).toEqual(['multichat', 'counter']);
    expect(TOOLS).toHaveLength(2);
  });

  it('has unique tool ids', () => {
    expect(new Set(TOOL_IDS).size).toBe(TOOL_IDS.length);
  });

  it('finds the counter by its id', () => {
    expect(findTool('counter')?.id).toBe('counter');
    expect(findTool('counter')?.label).toBe('Viewer Counter');
    expect(findTool('counter')?.overlayRoute).toBe('/counter');
  });

  it('finds MultiChat by its id', () => {
    expect(findTool('multichat')?.id).toBe('multichat');
    expect(findTool('multichat')?.label).toBe('MultiChat');
    expect(findTool('multichat')?.overlayRoute).toBe('/multichat');
  });

  it('returns undefined for an unknown, empty, or missing id', () => {
    expect(findTool('unknown')).toBeUndefined();
    expect(findTool('')).toBeUndefined();
    expect(findTool(undefined)).toBeUndefined();
  });

  it('exposes ids for static path generation, matching the registry', () => {
    expect(TOOL_IDS).toEqual(TOOLS.map((tool) => tool.id));
  });

  it('hands back the concrete descriptor through use', () => {
    const registered = findTool('counter');
    expect(registered).toBeDefined();
    /* `use` is what lets the route stay branch-free: it returns whatever the
     * consumer computes from the fully-typed descriptor. */
    expect(registered?.use((tool) => tool.overlayRoute)).toBe('/counter');
    expect(registered?.use((tool) => tool.catalog)).toBe(COUNTER_CATALOG);
  });

  it('registers exactly the two overlay routes already in OBS scenes', () => {
    /* These are the addresses in scene collections nobody will edit, so they are
       permanent. Neither tool declares a generator route of its own — both are
       panels in the one generator at /multichat. */
    expect(TOOLS.map((tool) => tool.overlayRoute)).toEqual(['/multichat', '/counter']);
    for (const tool of TOOLS) {
      expect(tool).not.toHaveProperty('workspaceRoute');
    }
  });

  it('carries previewNote through registration without losing it', () => {
    /* The flat field the shell reads, and the descriptor field behind `use`,
     * have to be the same string — a registration that dropped it would make
     * the shell silently fall back to generic prose. */
    for (const tool of TOOLS) {
      expect(tool.previewNote).toBe(tool.use((descriptor) => descriptor.previewNote));
      expect(tool.previewNote?.length).toBeGreaterThan(0);
    }
  });

  it('gives each tool its own preview note', () => {
    const notes = TOOLS.map((tool) => tool.previewNote);
    expect(new Set(notes).size).toBe(notes.length);
  });
});

describe('every registered tool declares usable platform metadata', () => {
  it('declares at least one platform', () => {
    for (const tool of TOOLS) {
      expect(tool.platforms.length).toBeGreaterThan(0);
    }
  });

  it('uses unique platform keys within a tool', () => {
    for (const tool of TOOLS) {
      const keys = tool.platforms.map((platform) => platform.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every platform a label and a normalizer', () => {
    for (const tool of TOOLS) {
      for (const platform of tool.platforms) {
        expect(platform.label.length).toBeGreaterThan(0);
        expect(typeof platform.normalize).toBe('function');
        /* A normalizer must be total: junk in, empty string out, no throw. */
        expect(platform.normalize(undefined)).toBe('');
        expect(platform.normalize('   ')).toBe('');
      }
    }
  });
});

describe('counter descriptor parity', () => {
  const keys = COUNTER_PLATFORMS.map((platform) => platform.key);

  it('keeps the four platform keys in the overlay order', () => {
    expect(keys).toEqual(['twitch', 'youtube', 'kick', 'tiktok']);
    expect(keys).toEqual([...PLATFORM_ORDER]);
  });

  it('keeps the four visible labels in the same order', () => {
    expect(COUNTER_PLATFORMS.map((platform) => platform.label)).toEqual([
      'Twitch',
      'YouTube',
      'Kick',
      'TikTok',
    ]);
  });

  it('keeps the placeholder every field had before', () => {
    for (const platform of COUNTER_PLATFORMS) {
      expect(platform.placeholder).toBe('channel name');
    }
  });

  it('validates with the overlay normalizer itself, not a copy', () => {
    for (const platform of COUNTER_PLATFORMS) {
      expect(platform.normalize).toBe(normalizeChannel);
    }
  });

  it('normalizes exactly as the authoritative rule does', () => {
    const cases = ['name', '@name', ' name ', 'a.b_c-d', 'bad name', '', 'x'.repeat(51)];
    for (const platform of COUNTER_PLATFORMS) {
      for (const raw of cases) {
        expect(platform.normalize(raw)).toBe(normalizeChannel(raw));
      }
    }
  });

  it('reuses the authoritative defaults and catalog by reference', () => {
    expect(counterTool.defaults).toBe(DEFAULT_STYLE);
    expect(counterTool.catalog).toBe(COUNTER_CATALOG);
  });

  it('serializes byte-identically to the overlay serializer', () => {
    const channels = { twitch: 'someone', kick: 'other_1' };
    expect(counterTool.serialize(channels, DEFAULT_STYLE)).toBe(
      buildViewerCounterQuery(channels, DEFAULT_STYLE),
    );
    const altered = { ...DEFAULT_STYLE, combined: !DEFAULT_STYLE.combined };
    expect(counterTool.serialize(channels, altered)).toBe(
      buildViewerCounterQuery(channels, altered),
    );
  });

  it('declares no runtime context, so it contributes no fragment', () => {
    expect(counterTool.context).toBeUndefined();
  });
});

describe('fragment normalization', () => {
  it('produces nothing for an absent context', () => {
    expect(overlayFragment()).toBe('');
    expect(overlayFragment(undefined)).toBe('');
  });

  it('produces nothing for an undefined, empty, or blank fragment', () => {
    expect(overlayFragment({})).toBe('');
    expect(overlayFragment({ fragment: undefined })).toBe('');
    expect(overlayFragment({ fragment: '' })).toBe('');
    expect(overlayFragment({ fragment: '   ' })).toBe('');
  });

  it('produces nothing for a fragment that is only hashes', () => {
    expect(overlayFragment({ fragment: '#' })).toBe('');
    expect(overlayFragment({ fragment: '###' })).toBe('');
  });

  it('adds exactly one hash to text without one', () => {
    expect(overlayFragment({ fragment: 'a=1' })).toBe('#a=1');
  });

  it('keeps exactly one hash for text that already has one', () => {
    expect(overlayFragment({ fragment: '#a=1' })).toBe('#a=1');
    expect(overlayFragment({ fragment: '##a=1' })).toBe('#a=1');
  });

  it('leaves a hash inside the fragment body alone', () => {
    expect(overlayFragment({ fragment: 'a=1#b' })).toBe('#a=1#b');
  });
});

describe('centralized overlay URL derivation', () => {
  const parts = { baseUrl: 'https://example.com', route: '/counter', query: 'a=1&b=2' };

  it('emits no hash when there is no context', () => {
    expect(buildOverlayUrl(parts)).toBe('https://example.com/counter?a=1&b=2');
    expect(buildOverlayUrl(parts)).not.toContain('#');
  });

  it('emits no hash for an empty fragment', () => {
    expect(buildOverlayUrl({ ...parts, context: { fragment: '' } })).toBe(
      'https://example.com/counter?a=1&b=2',
    );
  });

  it('keeps the query before the fragment', () => {
    const url = buildOverlayUrl({ ...parts, context: { fragment: 'tok=x' } });
    expect(url).toBe('https://example.com/counter?a=1&b=2#tok=x');
    expect(url.indexOf('?')).toBeLessThan(url.indexOf('#'));
  });

  it('leaves the query string untouched when a fragment is present', () => {
    const url = buildOverlayUrl({ ...parts, context: { fragment: 'tok=x' } });
    expect(url.slice(url.indexOf('?') + 1, url.indexOf('#'))).toBe(parts.query);
  });

  it('does not encode the fragment into the query', () => {
    const url = buildOverlayUrl({ ...parts, context: { fragment: 'tok=x' } });
    expect(url).not.toContain('%23');
    expect(new URL(url).searchParams.get('tok')).toBeNull();
    expect(new URL(url).hash).toBe('#tok=x');
  });

  it('does not double the fragment when derived repeatedly', () => {
    const options = { ...parts, context: { fragment: '#tok=x' } };
    const once = buildOverlayUrl(options);
    expect(buildOverlayUrl(options)).toBe(once);
    expect(buildOverlayUrl(options)).toBe(once);
    expect(once.split('#')).toHaveLength(2);
  });

  it('builds the counter URL exactly as string concatenation used to', () => {
    const channels = { twitch: 'someone' };
    const query = counterTool.serialize(channels, DEFAULT_STYLE);
    expect(
      buildOverlayUrl({
        baseUrl: 'https://example.com',
        route: counterTool.overlayRoute,
        query,
        /* The counter declares no runtime, so its context — if it had one —
           would be called with `undefined` as the runtime. */
        context: counterTool.context?.(DEFAULT_STYLE, undefined),
      }),
    ).toBe(`https://example.com${counterTool.overlayRoute}?${query}`);
  });
});
