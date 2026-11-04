export type DirectionalMessageEntry = 'slideRight' | 'slideLeft';

export const MESSAGE_ENTRY_SPRING = {
  type: 'spring',
  stiffness: 1200,
  damping: 50,
  mass: 0.3,
} as const;

export const MESSAGE_ENTRY_INITIAL_X = {
  slideRight: '100%',
  slideLeft: '-100%',
} as const satisfies Record<DirectionalMessageEntry, string>;

export const SLIDE_VISUAL_COMPLETION_TOLERANCE_PX = 0.5;

/** Motion can spend perceptible time in an invisible spring tail after the
 * spacer is already at its target. Treat sub-pixel proximity as visual
 * completion so the spacer-to-row handoff follows what the viewer sees. */
export function isSlideHeightVisuallyComplete(
  currentHeight: unknown,
  targetHeight: number,
  tolerance = SLIDE_VISUAL_COMPLETION_TOLERANCE_PX,
): boolean {
  const current = typeof currentHeight === 'number'
    ? currentHeight
    : typeof currentHeight === 'string'
      ? Number.parseFloat(currentHeight)
      : Number.NaN;
  return Number.isFinite(current)
    && Number.isFinite(targetHeight)
    && targetHeight >= 0
    && tolerance >= 0
    && Math.abs(current - targetHeight) <= tolerance;
}

export function messageEntryInitialState(
  direction: DirectionalMessageEntry,
  ownsOpacity: boolean,
): { x: string; opacity?: number } {
  return {
    x: MESSAGE_ENTRY_INITIAL_X[direction],
    ...(ownsOpacity ? { opacity: 0 } : {}),
  };
}

export function messageEntryTargetState(
  ownsOpacity: boolean,
): { x: number; opacity?: number } {
  return {
    x: 0,
    ...(ownsOpacity ? { opacity: 1 } : {}),
  };
}
