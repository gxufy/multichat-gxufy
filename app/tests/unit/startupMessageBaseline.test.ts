import { describe, expect, it } from 'vitest';
import { isMessageFromCurrentOverlaySession } from '@/lib/startupMessageBaseline';

describe('overlay startup message baseline', () => {
  it('rejects provider rows from before this browser-source instance', () => {
    expect(isMessageFromCurrentOverlaySession(9_999, 10_000)).toBe(false);
  });

  it('accepts rows at or after the browser-source baseline', () => {
    expect(isMessageFromCurrentOverlaySession(10_000, 10_000)).toBe(true);
    expect(isMessageFromCurrentOverlaySession(10_001, 10_000)).toBe(true);
  });

  it('fails open when a provider has no usable timestamp', () => {
    expect(isMessageFromCurrentOverlaySession(undefined, 10_000)).toBe(true);
    expect(isMessageFromCurrentOverlaySession('', 10_000)).toBe(true);
    expect(isMessageFromCurrentOverlaySession('not-a-time', 10_000)).toBe(true);
  });
});
