/* Source-tag rendering at the production DOM boundary. */
import { describe, expect, it } from 'vitest';
import { MultichatQuerySchema } from '@/lib/multichatConfig';

describe('legacy URL compatibility', () => {
  it('parser forces legacy showPinEnabled=true back to false', () => {
    expect(
      MultichatQuerySchema.parse({ twitch: 'someone', showPinEnabled: 'true' })
        .showPinEnabled,
    ).toBe(false);
  });

});
