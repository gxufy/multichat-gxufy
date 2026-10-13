import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_BADGE_ASSET_MAX_URL_LENGTH,
  validateCommunityBadgeAssetUrl,
  type CommunityBadgeAssetProvider,
} from '@/lib/server/communityBadgeAsset';

describe('community badge browser asset URL policy', () => {
  it.each([
    ['chatty', 'https://api.ffzap.com/v1/user/badge/123/4'],
    ['chatty', 'https://cdn.frankerfacez.com/badge/3/4'],
    ['chatty', 'https://tduva.com/img/chatty_badge_4.png'],
    ['chatsen', 'https://raw.githubusercontent.com/chatsen/resources/master/badges/supporter.png'],
    ['dankchat', 'https://flxrs.com/dankchat/badges/dank.png'],
    ['ffzap', 'https://api.ffzap.com/v1/user/badge/123/3'],
    ['purpletv', 'https://nopbreak.ru/shared/badge.png'],
    ['jilchat', 'https://api.jil.chat/uploads/badges/badge.png'],
    ['limerino', 'https://api.limerino.com/v1/badges/art/founder/4/4x.webp'],
  ] as const)('accepts a current %s asset host: %s', (provider, url) => {
    expect(validateCommunityBadgeAssetUrl(url, provider)).toBe(url);
  });

  it('normalizes host casing and an explicit default HTTPS port', () => {
    expect(validateCommunityBadgeAssetUrl(
      'https://FLXRS.COM:443/dankchat/badges/dank.png?version=2',
      'dankchat',
    )).toBe('https://flxrs.com/dankchat/badges/dank.png?version=2');
  });

  it.each([
    'http://flxrs.com/dankchat/badges/dank.png',
    'ftp://flxrs.com/dankchat/badges/dank.png',
    'data:image/png;base64,AA==',
    'javascript:alert(1)',
    '//flxrs.com/dankchat/badges/dank.png',
    'https://user@flxrs.com/dankchat/badges/dank.png',
    'https://user:pass@flxrs.com/dankchat/badges/dank.png',
    'https://flxrs.com:444/dankchat/badges/dank.png',
    'https://flxrs.com/dankchat/badges/dank.png#fragment',
    'https://flxrs.com/dankchat/badges/dank.png#',
  ])('rejects an unsafe URL component: %s', (url) => {
    expect(validateCommunityBadgeAssetUrl(url, 'dankchat')).toBeNull();
  });

  it.each([
    'https://localhost/badge.png',
    'https://localhost./badge.png',
    'https://sub.localhost/badge.png',
    'https://foo.local/badge.png',
    'https://10.0.0.1/badge.png',
    'https://127.0.0.1/badge.png',
    'https://169.254.169.254/latest/meta-data',
    'https://172.16.0.1/badge.png',
    'https://192.168.1.1/badge.png',
    'https://224.0.0.1/badge.png',
    'https://255.255.255.255/badge.png',
    'https://[::1]/badge.png',
    'https://[fc00::1]/badge.png',
    'https://[fe80::1]/badge.png',
    'https://[::ffff:127.0.0.1]/badge.png',
  ])('rejects a local, private, or special destination: %s', (url) => {
    expect(validateCommunityBadgeAssetUrl(url, 'dankchat')).toBeNull();
  });

  it.each([
    'https://2130706433/badge.png',
    'https://0x7f000001/badge.png',
    'https://017700000001/badge.png',
    'https://127.1/badge.png',
    'https://0x7f.0.0.1/badge.png',
    'https://[::1/badge.png',
    ' https://flxrs.com/dankchat/badges/dank.png',
    'https://flxrs.com/dankchat/badges/dank.png\n',
    'https://flxrs.com./dankchat/badges/dank.png',
    'https://flxrs.com.evil.test/badge.png',
    'https://evilflxrs.com/badge.png',
    'https://flxrс.com/badge.png',
  ])('rejects a parser or hostname-confusion bypass: %s', (url) => {
    expect(validateCommunityBadgeAssetUrl(url, 'dankchat')).toBeNull();
  });

  it('keeps provider host allowlists isolated', () => {
    const cases: Array<[CommunityBadgeAssetProvider, string]> = [
      ['chatty', 'https://flxrs.com/dankchat/badges/dank.png'],
      ['chatsen', 'https://api.ffzap.com/v1/user/badge/123/4'],
      ['dankchat', 'https://raw.githubusercontent.com/chatsen/resources/master/badge.png'],
      ['ffzap', 'https://cdn.frankerfacez.com/badge/3/4'],
      ['purpletv', 'https://api.nopbreak.ru/shared/badge.png'],
      ['jilchat', 'https://jil.chat/badge.png'],
    ];
    for (const [provider, url] of cases) {
      expect(validateCommunityBadgeAssetUrl(url, provider)).toBeNull();
    }
  });

  it('rejects missing, malformed, arbitrary-host, and overlong values', () => {
    expect(validateCommunityBadgeAssetUrl(undefined, 'chatty')).toBeNull();
    expect(validateCommunityBadgeAssetUrl('', 'chatty')).toBeNull();
    expect(validateCommunityBadgeAssetUrl('not a URL', 'chatty')).toBeNull();
    expect(validateCommunityBadgeAssetUrl('https://images.example.net/badge.png', 'chatty'))
      .toBeNull();
    expect(validateCommunityBadgeAssetUrl(
      `https://api.ffzap.com/${'a'.repeat(COMMUNITY_BADGE_ASSET_MAX_URL_LENGTH)}`,
      'chatty',
    )).toBeNull();
  });
});
