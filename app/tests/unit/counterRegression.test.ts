/* Viewer Counter regression coverage while it shares the Classic generator with
 * MultiChat. The Counter remains an independent tool: no Twitch connection,
 * no chat state, and the same /counter serializer everywhere.
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { counterTool } from '@/features/counter/config';
import { COUNTER_CATALOG } from '@/features/counter/settings';

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('descriptor boundary', () => {
  it('declares no runtime or URL context', () => {
    expect(counterTool.runtime).toBeUndefined();
    expect(counterTool.context).toBeUndefined();
  });

  it('has twelve visible settings plus the hidden custom-font mirror', () => {
    expect(COUNTER_CATALOG).toHaveLength(13);
    expect(COUNTER_CATALOG.filter((setting) => !setting.hidden)).toHaveLength(12);
    for (const setting of COUNTER_CATALOG) {
      expect(setting.disabled).toBeUndefined();
      expect(String(setting.key)).not.toMatch(/pin/i);
    }
  });
});
