/* Configured-platform detection: what makes the workspace show a preview and
 * enable Copy, and what keeps a half-typed name out of the overlay URL.
 */
import { describe, expect, it } from 'vitest';
import { PLATFORM_ORDER, type ViewerPlatform } from '@/lib/viewerCounterConfig';
import { configuredCounterPlatforms, counterTool } from '@/features/counter/config';

const configured = (channels: Partial<Record<ViewerPlatform, string>>) =>
  configuredCounterPlatforms(channels);

describe('unconfigured states', () => {
  it('an empty channel map is unconfigured', () => {
    expect(configured({})).toEqual([]);
  });

  it('blank and whitespace-only fields are unconfigured', () => {
    expect(configured({ twitch: '', kick: '   ', youtube: undefined })).toEqual([]);
  });

  it('a lone "@" is unconfigured', () => {
    expect(configured({ tiktok: '@' })).toEqual([]);
  });

  it('the tool descriptor agrees with the helper', () => {
    expect(counterTool.configuredPlatforms({})).toEqual([]);
    expect(counterTool.configuredPlatforms({ twitch: 'a' })).toEqual(['twitch']);
  });
});

describe('each platform configures independently', () => {
  it.each(PLATFORM_ORDER)('%s alone is enough', (platform) => {
    expect(configured({ [platform]: 'somebody' })).toEqual([platform]);
  });

  it('reports multiple platforms in display order', () => {
    expect(
      configured({ tiktok: 'd', twitch: 'a', kick: 'c', youtube: 'b' }),
    ).toEqual([...PLATFORM_ORDER]);
  });
});

describe('invalid channels are omitted, not rejected wholesale', () => {
  it('an invalid name beside a valid one leaves the valid one configured', () => {
    expect(configured({ twitch: 'good_name', kick: 'bad name!' })).toEqual([
      'twitch',
    ]);
  });

  it('an over-long name is omitted', () => {
    expect(configured({ youtube: 'a'.repeat(51) })).toEqual([]);
    expect(configured({ youtube: 'a'.repeat(50) })).toEqual(['youtube']);
  });

  it('an invalid name never reaches the generated URL', () => {
    const query = counterTool.serialize(
      { twitch: 'good', kick: 'bad name!' },
      counterTool.defaults,
    );
    const params = new URLSearchParams(query);
    expect(params.get('twitch')).toBe('good');
    expect(params.has('kick')).toBe(false);
  });

  it('a leading @ is accepted and normalized into the URL', () => {
    const params = new URLSearchParams(
      counterTool.serialize({ tiktok: '@someone' }, counterTool.defaults),
    );
    expect(params.get('tiktok')).toBe('someone');
  });
});

describe('clearing the final channel', () => {
  it('returns to unconfigured', () => {
    const withChannel = { twitch: 'someone' };
    expect(configured(withChannel).length).toBe(1);
    expect(configured({ ...withChannel, twitch: '' })).toEqual([]);
  });

  it('stays configured while another valid platform remains', () => {
    expect(configured({ twitch: '', kick: 'still_here' })).toEqual(['kick']);
  });
});
