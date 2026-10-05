import type { EventCategory, UnifiedMessage } from './types';

export const MULTICHAT_EVENT_CATEGORIES = [
  'subscription',
  'gift',
  'raid',
  'cheer',
  'milestone',
  'follow',
  'announcement',
] as const satisfies readonly EventCategory[];

export type MultichatRuntimeEventFeature =
  | EventCategory
  | 'firstmessages'
  | 'redeems';

export type MultichatRuntimeEventTarget = MultichatRuntimeEventFeature | 'all';

type RuntimeEventListener = (
  target: MultichatRuntimeEventTarget,
  visible: boolean,
) => void;

const FEATURES: readonly MultichatRuntimeEventFeature[] = [
  ...MULTICHAT_EVENT_CATEGORIES,
  'firstmessages',
  'redeems',
];

const visibility = new Map<MultichatRuntimeEventFeature, boolean>(
  FEATURES.map((feature) => [feature, true]),
);
const listeners = new Set<RuntimeEventListener>();

export function runtimeEventFeatureVisible(feature: MultichatRuntimeEventFeature): boolean {
  return visibility.get(feature) !== false;
}

export function setRuntimeEventFeatureVisible(
  target: MultichatRuntimeEventTarget,
  visible: boolean,
): void {
  if (target === 'all') {
    for (const feature of FEATURES) visibility.set(feature, visible);
  } else {
    visibility.set(target, visible);
  }
  for (const listener of listeners) {
    try { listener(target, visible); } catch { /* observer fault */ }
  }
}

export function runtimeEventMessageVisible(message: UnifiedMessage): boolean {
  if (message.kind === 'system') {
    const category = message.category ?? 'announcement';
    if (!runtimeEventFeatureVisible(category)) return false;
  }
  if (message.firstMessage && !runtimeEventFeatureVisible('firstmessages')) return false;
  if (message.redeem && !runtimeEventFeatureVisible('redeems')) return false;
  return true;
}

export function subscribeRuntimeEventVisibility(listener: RuntimeEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test/reset helper. A browser-source reload naturally recreates this module state. */
export function resetRuntimeEventVisibility(): void {
  for (const feature of FEATURES) visibility.set(feature, true);
  for (const listener of listeners) {
    try { listener('all', true); } catch { /* observer fault */ }
  }
}
