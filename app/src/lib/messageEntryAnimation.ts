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
