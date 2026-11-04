import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  multichatControlScope,
  publishCounterBackgroundControl,
  readCounterBackgroundControl,
  subscribeCounterBackgroundControl,
} from '@/lib/multichatControlBus';

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance === this || instance.closed || instance.name !== this.name) continue;
      instance.onmessage?.({ data });
    }
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  window.localStorage.clear();
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('MultiChat cross-source control bus', () => {
  it('normalizes the same generator channel set to one stable scope', () => {
    expect(multichatControlScope({ kick: '@GXUFY ', twitch: ' Adapt', youtube: '@Maya' })).toBe(
      'kick:gxufy|twitch:adapt|youtube:maya|tiktok:',
    );
  });

  it('delivers and remembers a counter background override for the matching scope only', () => {
    const channels = { twitch: 'adapt', youtube: 'maya' };
    const seen: boolean[] = [];
    const stop = subscribeCounterBackgroundControl(channels, (enabled) => seen.push(enabled));

    publishCounterBackgroundControl(channels, false);
    expect(seen).toEqual([false]);
    expect(readCounterBackgroundControl(channels)).toBe(false);
    expect(readCounterBackgroundControl({ twitch: 'someone-else' })).toBeNull();

    publishCounterBackgroundControl(channels, true);
    expect(seen).toEqual([false, true]);
    expect(readCounterBackgroundControl(channels)).toBe(true);
    stop();
  });
});
