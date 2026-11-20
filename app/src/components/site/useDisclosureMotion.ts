/*
 * Smooth expand/collapse for a region that is shown and hidden with the
 * `hidden` attribute. Rendering stays exactly as before — React owns `hidden`
 * — and this only adds a height/opacity animation in real browsers:
 *   - opening: React removes `hidden`, then the region grows from 0;
 *   - closing: React sets `hidden`; we keep it visible (and inert) for the
 *     collapse, then hide it.
 * No animation on the first render, under reduced motion, or where the Web
 * Animations API is missing (jsdom, very old browsers), so tests and
 * reduced-motion users see the original instant behavior.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { COLLAPSE_MS, EASE_OUT, EASE_STANDARD, EXPAND_MS, prefersReducedMotion } from './motion';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useDisclosureMotion(ref: RefObject<HTMLElement | null>, open: boolean): void {
  const firstRender = useRef(true);
  const running = useRef<Animation | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Animations pause in background tabs; never leave a region half-open. */
  const settleLater = (animation: Animation, ms: number) => {
    if (safety.current) clearTimeout(safety.current);
    safety.current = setTimeout(() => {
      if (animation.playState !== 'finished' && animation.playState !== 'idle') animation.finish();
    }, ms + 120);
  };

  useIsoLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const element = ref.current;
    if (!element || typeof element.animate !== 'function' || prefersReducedMotion()) return;

    running.current?.cancel();
    const style = getComputedStyle(element);
    const reset = () => {
      element.style.overflow = '';
      element.inert = false;
    };

    if (open) {
      const full = {
        height: `${element.scrollHeight}px`,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        opacity: 1,
      };
      element.style.overflow = 'hidden';
      const animation = element.animate(
        [{ height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }, full],
        { duration: EXPAND_MS, easing: EASE_OUT },
      );
      animation.onfinish = reset;
      animation.oncancel = reset;
      running.current = animation;
      settleLater(animation, EXPAND_MS);
      return;
    }

    /* Closing: React has already set `hidden`; show it for the collapse. */
    element.hidden = false;
    element.inert = true;
    element.style.overflow = 'hidden';
    const animation = element.animate(
      [
        {
          height: `${element.scrollHeight}px`,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          opacity: 1,
        },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      ],
      { duration: COLLAPSE_MS, easing: EASE_STANDARD },
    );
    animation.onfinish = () => {
      element.hidden = true;
      reset();
    };
    animation.oncancel = reset;
    running.current = animation;
    settleLater(animation, COLLAPSE_MS);
  }, [open]);

  useEffect(() => () => {
    if (safety.current) clearTimeout(safety.current);
    running.current?.cancel();
  }, []);
}
