import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  previewsBadgeAssetForMonths,
  previewsBadgeThresholdForMonths,
  previewsBadgeTitle,
  resolvePreviewsBadge,
  sha256Hex,
} from '@/lib/previewsBadges';

describe('Previews subscriber badges', () => {
  it('matches the extension month thresholds', () => {
    expect(previewsBadgeThresholdForMonths(0)).toBe(0);
    expect(previewsBadgeThresholdForMonths(1)).toBe(1);
    expect(previewsBadgeThresholdForMonths(2)).toBe(1);
    expect(previewsBadgeThresholdForMonths(3)).toBe(3);
    expect(previewsBadgeThresholdForMonths(5)).toBe(3);
    expect(previewsBadgeThresholdForMonths(6)).toBe(6);
    expect(previewsBadgeThresholdForMonths(11)).toBe(6);
    expect(previewsBadgeThresholdForMonths(12)).toBe(12);
    expect(previewsBadgeThresholdForMonths(23)).toBe(12);
    expect(previewsBadgeThresholdForMonths(24)).toBe(24);
    expect(previewsBadgeThresholdForMonths(35)).toBe(24);
    expect(previewsBadgeThresholdForMonths(36)).toBe(36);
    expect(previewsBadgeThresholdForMonths(47)).toBe(36);
    expect(previewsBadgeThresholdForMonths(48)).toBe(48);
    expect(previewsBadgeThresholdForMonths(120)).toBe(48);
  });

  it('uses the original Previews badge asset names', () => {
    expect(previewsBadgeAssetForMonths(0))
      .toBe('/badges/previews/badge_m0.webp');

    expect(previewsBadgeAssetForMonths(21))
      .toBe('/badges/previews/badge_m12.webp');

    expect(previewsBadgeAssetForMonths(60))
      .toBe('/badges/previews/badge_m48.webp');
  });

  it('matches the extension tooltip wording', () => {
    expect(previewsBadgeTitle(0)).toBe('Previews Subscriber');
    expect(previewsBadgeTitle(1)).toBe('Previews Subscriber  1mo');
    expect(previewsBadgeTitle(21)).toBe('Previews Subscriber  21mo');
  });

  it('uses SHA-256 hexadecimal username keys', async () => {
    await expect(sha256Hex('test')).resolves.toBe(
      '9f86d081884c7d659a2feaa0c55ad015'
      + 'a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
  });

  it('lowercases canonical Twitch logins before lookup', async () => {
    const hash = await sha256Hex('someuser');

    const resolved = await resolvePreviewsBadge(
      'SomeUser',
      {
        [hash]: 21,
      },
    );

    expect(resolved).toEqual({
      hash,
      months: 21,
      threshold: 12,
      url: '/badges/previews/badge_m12.webp',
      title: 'Previews Subscriber  21mo',
    });
  });

  it('returns no badge for users absent from the assignment table', async () => {
    await expect(
      resolvePreviewsBadge('notassigned', {}),
    ).resolves.toBeNull();
  });
});