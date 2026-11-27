/* The viewer counter preview's sample counts: what the generator's preview
 * may put on screen is checked by the count parser on its own. */
import { describe, expect, it } from 'vitest';
import { COUNTER_COUNT_MAX, parseCounterCount } from '@/features/counter/samples';

describe('the count parser is strict on its own', () => {
  it('accepts plain whole numbers in range', () => {
    expect(parseCounterCount('0')).toBe(0);
    expect(parseCounterCount('842')).toBe(842);
    expect(parseCounterCount(String(COUNTER_COUNT_MAX))).toBe(COUNTER_COUNT_MAX);
  });

  it('rejects everything else, including finite-but-not-typed forms', () => {
    for (const bad of ['', ' ', '-1', '1.0', '1e3', ' 12 ', '0x10', '10000000', 'NaN']) {
      expect(parseCounterCount(bad)).toBeNull();
    }
  });
});
