/* Preview-only zoom regression coverage.
 *
 * Zoom changes only the isolated preview frame. It never enters the MultiChat
 * config, generated URL, or production renderer settings. Retired pin state is
 * intentionally ignored by the serializer and therefore cannot resurrect a pin
 * banner in Preview Data.
 */
import { describe, expect, it } from 'vitest';
import { multichatTool } from '@/features/multichat/config';
import { MULTICHAT_CATALOG } from '@/features/multichat/settings';

const queryFor = (style: Partial<Record<string, unknown>> = {}) =>
  multichatTool.serialize({}, { ...multichatTool.defaults, ...style } as never);

describe('preview scale', () => {
  it('is not a serializable MultiChat setting', () => {
    const keys = MULTICHAT_CATALOG.map((setting) => String(setting.key));
    for (const forbidden of ['previewScale', 'scale', 'zoom', 'previewZoom']) {
      expect(keys).not.toContain(forbidden);
    }
    expect(queryFor()).not.toMatch(/previewScale|previewZoom|zoom=/i);
  });
});

describe('retired pins do not affect preview zoom', () => {
  it('ignores a legacy showPinEnabled request in the serialized preview query', () => {
    const query = queryFor({ showPinEnabled: true, pinPlatforms: ['twitch'] });
    expect(query).not.toContain('showPinEnabled');
    expect(query).not.toContain('pinPlatforms');
  });

});
