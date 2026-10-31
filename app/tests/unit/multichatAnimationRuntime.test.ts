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
    expect(
      recordRuntimeAnimationBatch(
        AUTO_ANIMATION_BYPASS_BATCH_SIZE,
        1_000,
      ),
    ).toBe(false);
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

    expect(
      recordRuntimeAnimationBatch(
        AUTO_ANIMATION_BYPASS_BATCH_SIZE - 1,
        1_000,
      ),
    ).toBe(true);

    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('keeps smaller batches static during the existing burst hold without extending it', () => {
    setRuntimeAnimationMode('auto');

    const startedAt = 10_000;
    const adjacentAt =
      startedAt
      + Math.floor(
        AUTO_ANIMATION_BYPASS_HOLD_MS / 2,
      );
    const resumeAt =
      startedAt + AUTO_ANIMATION_BYPASS_HOLD_MS;

    expect(
      recordRuntimeAnimationBatch(
        AUTO_ANIMATION_BYPASS_BATCH_SIZE,
        startedAt,
      ),
    ).toBe(false);

    expect(
      runtimeEntranceAnimationEnabled(),
    ).toBe(false);

    /*
     * This is real traffic, but it is below the heavy-batch threshold. It
     * remains static because the protection window is still active, without
     * moving the original deadline.
     */
    expect(
      recordRuntimeAnimationBatch(
        1,
        adjacentAt,
      ),
    ).toBe(false);

    expect(
      runtimeEntranceAnimationEnabled(),
    ).toBe(false);

    /*
     * The original heavy-batch protection window has now elapsed. Motion may
     * return even though a smaller batch occurred during that window.
     */
    expect(
      recordRuntimeAnimationBatch(
        1,
        resumeAt,
      ),
    ).toBe(true);

    expect(
      runtimeEntranceAnimationEnabled(),
    ).toBe(true);
  });

  it('extends burst protection when another heavy batch arrives', () => {
    setRuntimeAnimationMode('auto');

    const firstHeavyAt = 1_000;

    const secondHeavyAt =
      firstHeavyAt
      + Math.floor(
        AUTO_ANIMATION_BYPASS_HOLD_MS / 2,
      );

    const smallerTrafficAt =
      secondHeavyAt
      + AUTO_ANIMATION_BYPASS_HOLD_MS
      - 1;

    const resumeAt =
      secondHeavyAt
      + AUTO_ANIMATION_BYPASS_HOLD_MS;

    expect(
      recordRuntimeAnimationBatch(
        AUTO_ANIMATION_BYPASS_BATCH_SIZE,
        firstHeavyAt,
      ),
    ).toBe(false);

    expect(
      recordRuntimeAnimationBatch(
        AUTO_ANIMATION_BYPASS_BATCH_SIZE,
        secondHeavyAt,
      ),
    ).toBe(false);

    /*
     * The second heavy batch legitimately extended protection. A smaller batch
     * immediately before that new deadline remains static but cannot extend it
     * again.
     */
    expect(
      recordRuntimeAnimationBatch(
        1,
        smallerTrafficAt,
      ),
    ).toBe(false);

    expect(
      runtimeEntranceAnimationEnabled(),
    ).toBe(false);

    expect(
      recordRuntimeAnimationBatch(
        1,
        resumeAt,
      ),
    ).toBe(true);

    expect(
      runtimeEntranceAnimationEnabled(),
    ).toBe(true);
  });

  it('keeps a heavy-batch decision immutable until another real batch is classified', () => {
    setRuntimeAnimationMode('auto');

    recordRuntimeAnimationBatch(
      AUTO_ANIMATION_BYPASS_BATCH_SIZE,
      5_000,
    );

    expect(runtimeEntranceAnimationEnabled()).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    expect(
      recordRuntimeAnimationBatch(
        1,
        5_000 + AUTO_ANIMATION_BYPASS_HOLD_MS,
      ),
    ).toBe(true);

    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('switching on clears an auto-mode burst hold immediately', () => {
    setRuntimeAnimationMode('auto');

    recordRuntimeAnimationBatch(
      AUTO_ANIMATION_BYPASS_BATCH_SIZE,
      5_000,
    );

    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    setRuntimeAnimationMode('on');

    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });
});
