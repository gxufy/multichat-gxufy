import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_ANIMATION_BYPASS_BATCH_SIZE,
  AUTO_ANIMATION_BYPASS_HOLD_MS,
  AUTO_ANIMATION_FAST_CHAT_ROWS,
  AUTO_ANIMATION_FAST_CHAT_WINDOW_MS,
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

  it('stays static while the chat keeps a fast pace, and resumes only after it has been calm', () => {
    setRuntimeAnimationMode('auto');
    const start = 10_000;
    const filler = Math.ceil((AUTO_ANIMATION_FAST_CHAT_ROWS - AUTO_ANIMATION_BYPASS_BATCH_SIZE) / 2);

    expect(recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, start)).toBe(false);

    /* Smaller batches that keep the trailing pace at the threshold keep chat
       static and push the window out instead of Slide flickering back. */
    expect(recordRuntimeAnimationBatch(filler, start + 200)).toBe(false);
    const stillFastAt = start + 400;
    expect(recordRuntimeAnimationBatch(filler, stillFastAt)).toBe(false);

    /* Slower now, but inside the extended window: static, without extending. */
    expect(recordRuntimeAnimationBatch(1, start + 1_300)).toBe(false);
    expect(runtimeEntranceAnimationEnabled()).toBe(false);

    /* Calm for a full hold since the last fast moment: Slide returns. */
    expect(recordRuntimeAnimationBatch(1, stillFastAt + AUTO_ANIMATION_BYPASS_HOLD_MS)).toBe(true);
    expect(runtimeEntranceAnimationEnabled()).toBe(true);
  });

  it('treats a steady pace of small batches as fast chat', () => {
    setRuntimeAnimationMode('auto');
    const perTick = 2;
    const ticks = AUTO_ANIMATION_FAST_CHAT_ROWS / perTick;
    for (let i = 0; i < ticks - 1; i += 1) {
      expect(recordRuntimeAnimationBatch(perTick, 1_000 + i * 200)).toBe(true);
    }
    expect(recordRuntimeAnimationBatch(perTick, 1_000 + (ticks - 1) * 200)).toBe(false);
  });

  it('keeps a moderately busy chat (one row every tick) animated', () => {
    setRuntimeAnimationMode('auto');
    for (let i = 0; i < 25; i += 1) {
      expect(recordRuntimeAnimationBatch(1, 1_000 + i * 200)).toBe(true);
    }
  });

  it('keeps a calm chat animated however long it runs', () => {
    setRuntimeAnimationMode('auto');
    for (let i = 0; i < 30; i += 1) {
      expect(recordRuntimeAnimationBatch(1, 1_000 + i * (AUTO_ANIMATION_FAST_CHAT_WINDOW_MS / 2))).toBe(true);
    }
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
