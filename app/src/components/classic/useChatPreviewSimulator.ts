/* The live chat preview feed, as a hook.
 *
 * WHY THIS LIVES ABOVE THE PREVIEW. `ClassicChatPreview` is a pure function of
 * its props, and that is asserted: tests/unit/multichatPreview.test.tsx mounts it
 * twice and compares markup, and the counter's equivalent asserts its preview
 * reads neither `Date.now` nor `Math.random`. Putting a clock or a random source
 * inside either component would break those suites for good reason — a preview
 * that generates its own data cannot be reasoned about from its props. So the
 * simulator sits here, in the generator, and hands finished messages down.
 *
 * WHAT RESTARTS THE FEED, AND WHAT MUST NOT. The scheduling effect depends on
 * exactly two things: whether the feed is running, and how fast. Everything else
 * it reads — the enabled fixture sources, the sequence counter, the pin
 * countdown — is held in a ref, so adjusting a badge chip or any of the
 * twenty-four chat settings leaves the running timer alone. A feed that
 * restarted on every keystroke would reset its own cadence and never reach the
 * slow end of its interval band.
 *
 * THE FEED MOVES ON ARRIVAL. Preview Data is meant to demonstrate the overlay's
 * live behavior without pretending to be channel chat, so the default arms the
 * normal cadence immediately. The maintained fixtures still paint on the first
 * render; generated messages then enter, push older rows through the clipped
 * production viewport, and rotate through the provider showcase while someone
 * watches. Pause remains available for inspecting one frame, and callers can
 * explicitly pass `enabled: false` when a stationary preview is required.
 *
 * `pinVisible` still starts false, so the opaque top-anchored banner does not cover
 * the first paint. Its existing countdown introduces it only after movement begins.
 *
 * ONE SCHEDULER. React Strict Mode double-invokes effects in development. The
 * chain here is a single `setTimeout` re-armed from its own callback, and the
 * cleanup both clears the pending timer and sets a cancelled flag — so the first
 * invocation's chain is dead before the second one arms, and a callback already
 * in flight cannot re-arm after unmount.
 *
 * Browser-safe — no server-only imports, no network, no sockets, no polling.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAT_HISTORY_MAX,
  allSourcesEnabled,
  appendBounded,
  generateMessage,
  nextChatDelay,
  nextPinGap,
  noSourcesEnabled,
  randomSources,
  type PreviewSource,
  type PreviewSourceState,
  type PreviewSpeed,
  type RandomSource,
} from '@/features/multichat/previewSimulator';
import type { UnifiedMessage } from '@/lib/types';

/** What the generator hands the hook. All optional — the page passes nothing. */
export type PreviewIdentityTemplate = Omit<UnifiedMessage, 'id' | 'timestamp'> & {
  readonly templateId: string;
};

export type ChatSimulatorOptions = {
  /** Randomness. Defaults to `Math.random`; tests pass a seeded source. */
  random?: RandomSource;
  /** Start running. Defaults to true; pass false for a stationary first paint. */
  enabled?: boolean;
  /** Initial cadence. Defaults to normal for existing callers. */
  initialSpeed?: PreviewSpeed;
  /** Loaded identity demonstrations. When present, these replace generic draws. */
  identityTemplates?: readonly PreviewIdentityTemplate[];
};

export type ChatSimulatorState = {
  /** Generated messages, oldest first, bounded to CHAT_HISTORY_MAX. */
  readonly messages: readonly UnifiedMessage[];
  /** Whether the pin fixture should currently be offered to the preview. */
  readonly pinVisible: boolean;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly speed: PreviewSpeed;
  readonly sources: PreviewSourceState;
  /** True while a timer is armed — enabled, not paused, tab visible. */
  readonly running: boolean;
  setEnabled: (next: boolean) => void;
  togglePaused: () => void;
  resume: () => void;
  setSpeed: (next: PreviewSpeed) => void;
  /** Drop every generated message and re-arm from the fixtures. */
  reset: () => void;
  toggleSource: (source: PreviewSource) => void;
  enableAllSources: () => void;
  disableAllSources: () => void;
  randomizeSources: () => void;
  resetSources: () => void;
};

/** Whether the document is currently hidden. Safe before hydration. */
function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useChatPreviewSimulator(
  options: ChatSimulatorOptions = {},
): ChatSimulatorState {
  /* Preview Data moves without requiring discovery of a hidden switch. Callers
     that need a stationary render can still opt out explicitly. */
  const {
    enabled: initialEnabled = true,
    initialSpeed = 'normal',
    identityTemplates = [],
  } = options;
  /* `Math.random` is read here rather than defaulted in the signature so the
     identity stays stable across renders — a new function each render would be a
     new effect dependency if it were ever used as one. */
  const random = useMemo<RandomSource>(
    () => options.random ?? (() => Math.random()),
    [options.random],
  );

  const [messages, setMessages] = useState<readonly UnifiedMessage[]>([]);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<PreviewSpeed>(initialSpeed);
  const [sources, setSources] = useState<PreviewSourceState>(() => allSourcesEnabled());
  /* False on arrival. The pin banner is opaque, top-anchored and roughly three
     rows tall, so offering it by default would cover half of a showcase whose
     whole point is being visible. The countdown below turns it on once the feed
     is generating, where a moving pin is what it is there to demonstrate. */
  const [pinVisible, setPinVisible] = useState(false);
  const [hidden, setHidden] = useState(false);
  /* Bumped by Reset alone, and a dependency of the scheduling effect, so Reset
     discards the timer already in flight instead of letting a message drawn before
     the reset land a moment after it. Without this the showcase Reset just restored
     would be pushed up again by an interval nobody could see coming. */
  const [restarts, setRestarts] = useState(0);

  /* Everything the tick reads without wanting to restart the timer. */
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const identityTemplatesRef = useRef(identityTemplates);
  identityTemplatesRef.current = identityTemplates;
  const identityKey = identityTemplates
    .map((template) => `${template.senderId ?? ''}:${template.username}:${template.templateId}`)
    .join('|');
  const previousIdentityKeyRef = useRef(identityKey);
  const sequenceRef = useRef(0);
  /* The line just emitted, so the next draw can avoid repeating its identity.
     Held in a ref rather than read from `messages` so the tick stays off the
     state it sets — and so a source toggle, which does not restart the timer,
     never has to re-thread it. Cleared on reset alongside the sequence. */
  const previousRef = useRef<UnifiedMessage | null>(null);
  /* Null until the first tick draws it. Deliberately not seeded during render:
     Strict Mode renders twice, so a draw there would consume two values and the
     two renders would disagree about the gap. */
  const pinCountdownRef = useRef<number | null>(null);

  /* Pause while the tab is in the background. A feed nobody can see still costs
     a timer and a render per message, and coming back to thirty messages that
     all arrived while the tab was hidden is not what the control promises. */
  useEffect(() => {
    const sync = () => setHidden(documentHidden());
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const running = enabled && !paused && !hidden;

  useEffect(() => {
    if (previousIdentityKeyRef.current === identityKey) return;
    previousIdentityKeyRef.current = identityKey;
    setMessages([]);
    sequenceRef.current = 0;
    previousRef.current = null;
    pinCountdownRef.current = null;
    setPinVisible(false);
    setRestarts((current) => current + 1);
  }, [identityKey]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      /* A callback already queued when cleanup ran must not append or re-arm. */
      if (cancelled) return;
      sequenceRef.current += 1;
      const templates = identityTemplatesRef.current;
      const template = templates.length
        ? templates[(sequenceRef.current - 1) % templates.length]
        : null;
      const next: UnifiedMessage = template
        ? {
            ...template,
            id: `identity-sim-${sequenceRef.current}`,
            timestamp: sequenceRef.current * 1000,
          }
        : generateMessage(
            sequenceRef.current,
            sourcesRef.current,
            random,
            previousRef.current,
          );
      previousRef.current = next;
      setMessages((current) => appendBounded(current, next, CHAT_HISTORY_MAX));

      /* The pin is offered on a countdown rather than per message: production's
         PinBanner retires itself after five seconds, so a pin replaced on every
         message would never be readable. Hiding it for one tick before the next
         appearance is what lets the banner remount — its timers key on the
         message id, and the id here never changes. */
      const countdown = (pinCountdownRef.current ?? nextPinGap(random)) - 1;
      if (countdown <= 0) {
        pinCountdownRef.current = nextPinGap(random);
        setPinVisible((current) => !current);
      } else {
        pinCountdownRef.current = countdown;
      }

      schedule();
    };

    /* One delay rule, for the first message and every one after it: a draw from
       the selected speed's band. Turning the switch on is the request for a
       moving feed, so making that first message wait longer than the cadence it
       asked for would just look broken. */
    const schedule = () => {
      timer = setTimeout(tick, nextChatDelay(random, speed));
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [running, speed, random, restarts]);

  const reset = useCallback(() => {
    setMessages([]);
    sequenceRef.current = 0;
    /* Cleared so the next tick starts sequence 1 again — restarting the showcase
       from its first step — with no prior line to dedup against. */
    previousRef.current = null;
    pinCountdownRef.current = nextPinGap(random);
    /* Back to the arrival state, which is a curated showcase with no banner over
       it — so the pin is retired here rather than re-offered. The switch itself is
       deliberately untouched: Reset restores the *content*, and someone who turned
       the feed on and then reset it asked to start the run over, not to end it. */
    setPinVisible(false);
    /* The bump discards the timer already in flight. Without it a message drawn
       before the reset would land a moment after it and push the restored showcase
       straight back up, from an interval nobody could see coming. */
    setRestarts((current) => current + 1);
  }, [random]);

  const toggleSource = useCallback((source: PreviewSource) => {
    setSources((current) => ({ ...current, [source]: !current[source] }));
  }, []);

  const enableAllSources = useCallback(() => setSources(allSourcesEnabled()), []);
  const disableAllSources = useCallback(() => setSources(noSourcesEnabled()), []);
  const randomizeSources = useCallback(() => setSources(randomSources(random)), [random]);
  const resetSources = useCallback(() => setSources(allSourcesEnabled()), []);
  const togglePaused = useCallback(() => setPaused((current) => !current), []);
  const resume = useCallback(() => {
    setEnabled(true);
    setPaused(false);
    setSpeed(initialSpeed);
  }, [initialSpeed]);

  return {
    messages,
    pinVisible,
    enabled,
    paused,
    speed,
    sources,
    running,
    setEnabled,
    togglePaused,
    resume,
    setSpeed,
    reset,
    toggleSource,
    enableAllSources,
    disableAllSources,
    randomizeSources,
    resetSources,
  };
}
