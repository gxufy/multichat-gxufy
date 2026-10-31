import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_WORKSPACE_DEFAULTS,
  MultichatQuerySchema,
  buildMultichatQuery,
} from '@/lib/multichatConfig';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';

describe('MultiChat Twitch media and Google Font config', () => {
  it('keeps the legacy GIF flag parseable and bounds direct URL gifSize', () => {
    expect(MultichatQuerySchema.parse({}).gifs).toBe(false);
    expect(MultichatQuerySchema.parse({ gifs: 'true' }).gifs).toBe(true);
    expect(MultichatQuerySchema.parse({}).gifSize).toBe(140);
    expect(MultichatQuerySchema.parse({ gifs: 'true', gifSize: '9999' }).gifSize).toBe(512);
  });

  it('preserves legacy unknown font values without turning them into an explicit custom selection', () => {
    expect(MultichatQuerySchema.parse({ font: 'Press Start 2P' }).font).toBe('Press Start 2P');
  });

  it('serializes Google font override explicitly through the existing font parameter', () => {
    const query = buildMultichatQuery(
      { kick: '', twitch: 'streamer', youtube: '', tiktok: '' },
      { ...MULTICHAT_WORKSPACE_DEFAULTS, googleFont: 'Press Start 2P' },
    );
    const params = new URLSearchParams(query);
    expect(params.get('font')).toBe('google:Press Start 2P');
    expect(params.has('googleFont')).toBe(false);
  });

  it('falls back to the selected preset when the custom family is unsafe', () => {
    const query = buildMultichatQuery(
      { kick: '', twitch: 'streamer', youtube: '', tiktok: '' },
      { ...MULTICHAT_WORKSPACE_DEFAULTS, font: 'lato', googleFont: "Bad'; color:red" },
    );
    expect(new URLSearchParams(query).get('font')).toBe('lato');
  });

  it('never emits the retired GIF toggle and serializes a non-default size independently', () => {
    const channels = { kick: '', twitch: 'streamer', youtube: '', tiktok: '' };
    const disabled = new URLSearchParams(buildMultichatQuery(channels, MULTICHAT_WORKSPACE_DEFAULTS));
    expect(disabled.has('gifs')).toBe(false);
    expect(disabled.has('gifSize')).toBe(false);

    const customized = new URLSearchParams(buildMultichatQuery(channels, {
      ...MULTICHAT_WORKSPACE_DEFAULTS,
      gifs: true,
      gifSize: '180',
    }));
    expect(customized.has('gifs')).toBe(false);
    expect(customized.get('gifSize')).toBe('180');
  });

  it('does not expose a display-GIF toggle in the settings catalog', () => {
    expect(MULTICHAT_CATALOG.some((setting) => setting.key === 'gifs')).toBe(false);
    expect(MULTICHAT_CATALOG.some((setting) => setting.key === 'gifSize')).toBe(true);
  });
});
