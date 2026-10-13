import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_ANIMATION_BYPASS_BATCH_SIZE,
  AUTO_ANIMATION_BYPASS_HOLD_MS,
  getRuntimeAnimationMode,
  recordRuntimeAnimationBatch,
  resetRuntimeAnimationState,
  runtimeEntranceAnimationEnabled,
  setRuntimeAnimationMode,
} from '@/lib/multichatAnimationRuntime';

beforeEach(() => resetRuntimeAnimationState());
afterEach(() => resetRuntimeAnimationState());

describe('runtime chat animation control', () => {
  it('defaults to adaptive auto mode while keeping normal traffic animated', () => {
    expect(getRuntimeAnimationMode()).toBe('auto');
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
    expect(recordRuntimeAnimationBatch(1, 1_000)).toBe(true);
  });

  it('defaults to bypassing a heavy presentation batch', () => {
    expect(getRuntimeAnimationMode()).toBe('auto');
    expect(recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 1_000)).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);
  });

  it('turns all new entrance animations off until explicitly restored', () => {
    setRuntimeAnimationMode('off');
    expect(getRuntimeAnimationMode()).toBe('off');
    expect(recordRuntimeAnimationBatch(1, 1_000)).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    setRuntimeAnimationMode('on');
    expect(recordRuntimeAnimationBatch(20, 99_000)).toBe(true);
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('keeps normal traffic animated in auto mode', () => {
    setRuntimeAnimationMode('auto');
    expect(recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE - 1, 1_000)).toBe(true);
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('bypasses a heavy presentation batch and holds later small batches while the burst settles', () => {
    setRuntimeAnimationMode('auto');
    const startedAt = 10_000;

    expect(recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, startedAt)).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);
    expect(recordRuntimeAnimationBatch(1, startedAt + 400)).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    expect(recordRuntimeAnimationBatch(1, startedAt + AUTO_ANIMATION_BYPASS_HOLD_MS)).toBe(true);
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('extends the quiet-period hold when another heavy batch arrives', () => {
    setRuntimeAnimationMode('auto');
    expect(recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 1_000)).toBe(false);
    expect(recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 1_700)).toBe(false);
    expect(recordRuntimeAnimationBatch(1, 2_699)).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);
    expect(recordRuntimeAnimationBatch(1, 2_700)).toBe(true);
  });

  it('keeps a heavy-batch decision immutable until another real batch is classified', () => {
    setRuntimeAnimationMode('auto');
    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 5_000);

    expect(runtimeEntranceAnimationEnabled()).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    expect(recordRuntimeAnimationBatch(1, 5_000 + AUTO_ANIMATION_BYPASS_HOLD_MS)).toBe(true);
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('switching on clears an auto-mode burst hold immediately', () => {
    setRuntimeAnimationMode('auto');
    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 5_000);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    setRuntimeAnimationMode('on');
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });
});
