import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const motionMock = vi.hoisted(() => ({ reducedMotion: false }));

vi.mock('motion/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useReducedMotion: () => motionMock.reducedMotion,
    motion: {
      div: React.forwardRef<HTMLDivElement, Record<string, any>>(function MotionDiv(
        { initial, animate, transition, onAnimationComplete, onUpdate, style, ...props },
        ref,
      ) {
        return React.createElement('div', {
          ...props,
          ref,
          style: { ...style, ...(initial && typeof initial === 'object' ? initial : {}) },
          'data-motion-initial': JSON.stringify(initial),
          'data-motion-animate': JSON.stringify(animate),
          'data-motion-transition': JSON.stringify(transition),
          onTransitionEnd: () => onUpdate?.({
            height: typeof animate?.height === 'number' ? animate.height - 0.49 : animate?.height,
          }),
          onAnimationEnd: onAnimationComplete,
        });
      }),
    },
  };
});

import ChatOverlay, { SLIDE_HEIGHT_SPRING } from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { MESSAGE_FADE_TRANSITION_MS } from '@/lib/messageFadeScheduler';
import {
  MESSAGE_ENTRY_SPRING,
  isSlideHeightVisuallyComplete,
} from '@/lib/messageEntryAnimation';
import {
  AUTO_ANIMATION_BYPASS_BATCH_SIZE,
  AUTO_ANIMATION_BYPASS_HOLD_MS,
  recordRuntimeAnimationBatch,
  resetRuntimeAnimationState,
  setRuntimeAnimationMode,
} from '@/lib/multichatAnimationRuntime';
import type { ParsedMessage } from '@/lib/kick';
import type { Platform } from '@/lib/types';

const parsed = (platform: Platform, id: string, body = id): ParsedMessage => ({
  id: `${platform}:${id}`,
  platform,
  kind: 'chat',
  identity: { username: id, color: '#fff', background: '', filter: '', badges: [] },
  message: [body],
});

const props = (animation: 'slide' | 'fade' | 'none', platform: Platform = 'twitch') => ({
  config: MultichatQuerySchema.parse({ [platform]: 'channel', animation }),
  fadingIds: new Set<string>(),
  pinnedMessage: null,
  showLoader: false as const,
  sourceTagExplicit: true,
});

const rect = (height: number): DOMRect => ({
  x: 0, y: 0, width: 600, height, top: 0, right: 600, bottom: height, left: 0,
  toJSON: () => ({}),
} as DOMRect);

function mockSlideMeasure(height: number) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return (this as HTMLElement).classList.contains('gx-slide-measure') ? rect(height) : rect(0);
  });
}

function mockMeasuredRows(rowHeight: number) {
  let passes = 0;
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (!(this as HTMLElement).classList.contains('gx-slide-measure')) return rect(0);
    passes += 1;
    return rect((this as HTMLElement).querySelectorAll('.gx-message-row').length * rowHeight);
  });
  return { spy, passes: () => passes };
}

function completeSlideSpacers(container: HTMLElement) {
  for (const spacer of container.querySelectorAll('[data-slide-motion-spacer]')) {
    fireEvent.animationEnd(spacer);
  }
}

afterEach(() => {
  cleanup();
  resetRuntimeAnimationState();
  motionMock.reducedMotion = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('measured Slide batch entrance', () => {
  it('uses a fractional visual threshold to settle the Slide wrapper', () => {
    expect(isSlideHeightVisuallyComplete(164.51, 165)).toBe(true);
    expect(isSlideHeightVisuallyComplete('164.5px', 165)).toBe(true);
    expect(isSlideHeightVisuallyComplete(164.49, 165)).toBe(false);
    expect(isSlideHeightVisuallyComplete(Number.NaN, 165)).toBe(false);
  });

  it('shows the real row during opening and removes the wrapper at visual completion', () => {
    vi.useFakeTimers();
    mockSlideMeasure(55.25);
    const { container } = render(
      <ChatOverlay {...props('slide')} messages={[parsed('twitch', 'visual-target')]} />,
    );
    const spacer = container.querySelector('[data-slide-motion-spacer]') as HTMLElement;
    expect(spacer).not.toBeNull();

    /* The actual row is present while height is still animating. */
    expect(spacer.matches('[data-slide-live]')).toBe(true);
    expect(spacer.querySelector('.gx-message-row')).not.toBeNull();
    expect(spacer.textContent).toContain('visual-target');

    fireEvent.transitionEnd(spacer);
    expect(container.querySelector('[data-slide-motion-spacer]')).toBeNull();
    expect(container.querySelectorAll('#chat_container > .gx-message-row')).toHaveLength(1);

    fireEvent.animationEnd(spacer);
    expect(container.querySelectorAll('#chat_container > .gx-message-row')).toHaveLength(1);
  });

  it('uses the 150ms swing transition for spacer height only', () => {
    expect(SLIDE_HEIGHT_SPRING.type).toBe('tween');
    expect(SLIDE_HEIGHT_SPRING.duration).toBe(0.15);

    const ease = SLIDE_HEIGHT_SPRING.ease;
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      expect(ease(progress)).toBeCloseTo(
        0.5 - Math.cos(progress * Math.PI) / 2,
        10,
      );
    }
  });

  it.each(['twitch', 'kick', 'youtube', 'tiktok'] as const)('measures one hidden %s bucket, then animates the real rows with the measured height', (platform) => {
    vi.useFakeTimers();
    mockSlideMeasure(165);
    const messages = [parsed(platform, 'one'), parsed(platform, 'two'), parsed(platform, 'three')];
    const { container } = render(<ChatOverlay {...props('slide', platform)} messages={messages} />);

    const opening = container.querySelector('.gx-slide-group') as HTMLElement;
    expect(opening).not.toBeNull();
    expect(opening.getAttribute('data-render-batch-id')).toBe('1');
    expect(container.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slide-live]')).toHaveLength(1);
    expect(opening.style.height).toBe('0px');

    expect(opening.dataset.motionInitial).toBe(JSON.stringify({ height: 0 }));
    expect(opening.dataset.motionAnimate).toBe(JSON.stringify({ height: 165 }));
    expect(opening.dataset.motionTransition).toBe(JSON.stringify(SLIDE_HEIGHT_SPRING));
    expect(container.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slide-live]')).toHaveLength(1);

    completeSlideSpacers(container);
    expect(container.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
    expect(container.querySelectorAll('.gx-slide-group')).toHaveLength(0);
    expect(container.querySelectorAll('.ck-body')).toHaveLength(3);
  });

  it('reveals immediately when reduced motion is requested', () => {
    motionMock.reducedMotion = true;
    const measure = mockSlideMeasure(110);
    const { container } = render(
      <ChatOverlay {...props('slide')} messages={[
        parsed('twitch', 'reduced-one'),
        parsed('twitch', 'reduced-two'),
      ]} />,
    );

    expect(container.querySelector('[data-slide-motion-spacer]')).toBeNull();
    expect(container.querySelector('[data-slide-ghost]')).toBeNull();
    expect(container.querySelectorAll('.ck-body')).toHaveLength(2);
    expect(measure).not.toHaveBeenCalled();
  });

  it.each([1, 5, 10, 25, 50])(
    'keeps a %i-message parent render in one measured atomic batch',
    (count) => {
      vi.useFakeTimers();
      setRuntimeAnimationMode('on');
      const rowHeight = 55;
      const measure = mockMeasuredRows(rowHeight);
      const messages = Array.from(
        { length: count },
        (_, index) => parsed('twitch', `batch-${count}-${index}`, `body-${index}`),
      );
      const { container, rerender } = render(
        <ChatOverlay {...props('slide')} messages={messages} />,
      );

      const spacers = container.querySelectorAll('.gx-slide-group');
      expect(spacers).toHaveLength(1);
      expect(spacers[0]?.getAttribute('data-render-batch-id')).toBe('1');
      expect(container.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slide-live]')).toHaveLength(1);
      expect(measure.passes()).toBe(1);
      expect((measure.spy.mock.results[0]?.value as DOMRect).height).toBe(count * rowHeight);
      expect(container.querySelectorAll('#chat_container > .gx-message-row')).toHaveLength(0);
      for (const row of container.querySelectorAll('.gx-message-row')) {
        expect((row as HTMLElement).style.transform).toBe('translate3d(0, 0, 0)');
      }

      expect((container.querySelector('.gx-slide-group') as HTMLElement).dataset.motionAnimate)
        .toBe(JSON.stringify({ height: count * rowHeight }));
      completeSlideSpacers(container);
      expect(container.querySelectorAll('.gx-slide-group')).toHaveLength(0);
      expect(container.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
      expect(container.querySelectorAll('#chat_container > .gx-message-row')).toHaveLength(count);
      expect([...container.querySelectorAll('.ck-body')].map((node) => node.textContent))
        .toEqual(messages.map((_, index) => `body-${index}`));

      rerender(
        <ChatOverlay
          {...props('slide')}
          messages={messages.map((message) => (
            message.id === messages[0]?.id ? { ...message, message: ['repainted'] } : message
          ))}
        />,
      );
      expect(container.querySelectorAll('.gx-slide-group')).toHaveLength(0);
      expect(measure.passes()).toBe(1);
      expect(container.querySelectorAll('.gx-message-row')).toHaveLength(count);
    },
  );

  it('forms later batches for 10ms parent renders without corrupting order or IDs', () => {
    vi.useFakeTimers();
    setRuntimeAnimationMode('on');
    const measure = mockMeasuredRows(55);
    const all = Array.from({ length: 20 }, (_, index) => parsed('twitch', `rapid-${index}`));
    const observedBatchIds = new Set<string>();
    const { container, rerender } = render(
      <ChatOverlay {...props('slide')} messages={[all[0]]} />,
    );

    for (let count = 1; count <= all.length; count += 1) {
      if (count > 1) {
        act(() => vi.advanceTimersByTime(10));
        rerender(<ChatOverlay {...props('slide')} messages={all.slice(0, count)} />);
      }
      for (const node of container.querySelectorAll('.gx-slide-group')) {
        observedBatchIds.add(node.getAttribute('data-render-batch-id') ?? '');
        expect(node.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
        expect(node.matches('[data-slide-live]')).toBe(true);
      }
    }

    expect(observedBatchIds.size).toBe(20);
    expect(measure.passes()).toBe(20);
    completeSlideSpacers(container);
    const bodies = [...container.querySelectorAll('.ck-body')].map((node) => node.textContent);
    expect(bodies).toEqual(all.map((message) => message.message[0]));
    expect(new Set(bodies).size).toBe(20);
    expect(container.querySelectorAll('.gx-slide-group')).toHaveLength(0);
  });

  it('keeps the 100-row presentation cap while pruning expired batch members', () => {
    vi.useFakeTimers();
    setRuntimeAnimationMode('on');
    mockMeasuredRows(55);
    const all = Array.from({ length: 101 }, (_, index) => parsed('twitch', `cap-${index}`));
    const { container, rerender } = render(
      <ChatOverlay {...props('slide')} messages={all.slice(0, 100)} />,
    );
    completeSlideSpacers(container);

    rerender(<ChatOverlay {...props('slide')} messages={all.slice(1)} />);
    completeSlideSpacers(container);
    const bodies = [...container.querySelectorAll('.ck-body')].map((node) => node.textContent);
    expect(bodies).toHaveLength(100);
    expect(bodies[0]).toBe('cap-1');
    expect(bodies.at(-1)).toBe('cap-100');
    expect(new Set(bodies).size).toBe(100);
  });

  it('bypasses a 4-row batch, holds adjacent batches, and resumes after 1000ms', () => {
    vi.useFakeTimers();
    vi.setSystemTime(40_000);
    const measure = mockMeasuredRows(55);
    setRuntimeAnimationMode('auto');
    const all = Array.from({ length: 12 }, (_, index) => parsed('twitch', `auto-${index}`));
    recordRuntimeAnimationBatch(3, Date.now());
    const { container, rerender } = render(
      <ChatOverlay {...props('slide')} messages={all.slice(0, 3)} />,
    );
    expect(measure.passes()).toBe(1);
    completeSlideSpacers(container);

    vi.setSystemTime(40_200);
    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, Date.now());
    rerender(<ChatOverlay {...props('slide')} messages={all.slice(0, 7)} />);
    expect(measure.passes()).toBe(1);

    vi.setSystemTime(40_600);
    recordRuntimeAnimationBatch(3, Date.now());
    rerender(<ChatOverlay {...props('slide')} messages={all.slice(0, 10)} />);
    expect(measure.passes()).toBe(1);

    vi.setSystemTime(40_200 + AUTO_ANIMATION_BYPASS_HOLD_MS);
    recordRuntimeAnimationBatch(1, Date.now());
    rerender(<ChatOverlay {...props('slide')} messages={all} />);
    expect(measure.passes()).toBe(2);
    expect(container.querySelector('.gx-slide-group')).not.toBeNull();
    expect(container.querySelectorAll('.gx-message-row')).toHaveLength(12);
  });

  it('creates one immutable batch per parent commit and distinct batches for later commits', () => {
    vi.useFakeTimers();
    mockSlideMeasure(55);
    const one = parsed('twitch', 'one');
    const two = parsed('twitch', 'two');
    const three = parsed('twitch', 'three');
    const { container, rerender } = render(
      <ChatOverlay {...props('slide')} messages={[one, two]} />,
    );

    const firstBatch = container.querySelector('.gx-slide-group');
    expect(firstBatch?.getAttribute('data-render-batch-id')).toBe('1');
    expect(firstBatch?.querySelectorAll('.ck-body')).toHaveLength(2);

    rerender(<ChatOverlay {...props('slide')} messages={[one, two, three]} />);
    const batchIds = [...container.querySelectorAll('.gx-slide-group')]
      .map((node) => node.getAttribute('data-render-batch-id'));
    expect(batchIds).toEqual(['1', '2']);
  });

  it.each(['slideRight', 'slideLeft'] as const)(
    'runs %s exactly once while Main Slide settles',
    (direction) => {
      vi.useFakeTimers();
      mockSlideMeasure(55);

      const animated = {
        ...props('slide'),
        config: MultichatQuerySchema.parse({
          twitch: 'channel',
          animation: 'slide',
          entryAnimation: direction,
        }),
      };

      const { container } = render(
        <ChatOverlay
          {...animated}
          messages={[parsed('twitch', `single-${direction}`)]}
        />,
      );

      const spacer = container.querySelector(
        '[data-slide-motion-spacer]',
      ) as HTMLElement;

      expect(spacer).not.toBeNull();

      const entryBefore = container.querySelector(
        `[data-entry-animation="${direction}"]`,
      );

      expect(entryBefore).not.toBeNull();

      const xBefore = entryBefore?.querySelector(
        '[data-entry-motion-x]',
      ) as HTMLElement;

      expect(xBefore).not.toBeNull();
      expect(xBefore.dataset.motionInitial).toBe(
        JSON.stringify({
          x: direction === 'slideRight' ? '100%' : '-100%',
        }),
      );
      expect(xBefore.dataset.motionAnimate).toBe(
        JSON.stringify({ x: 0 }),
      );
      expect(xBefore.dataset.motionTransition).toBe(
        JSON.stringify({ x: MESSAGE_ENTRY_SPRING }),
      );

      fireEvent.animationEnd(spacer);

      const entryAfter = container.querySelector(
        `[data-entry-animation="${direction}"]`,
      );

      expect(entryAfter).toBe(entryBefore);
      expect(
        container.querySelector('[data-slide-motion-spacer]'),
      ).toBeNull();
      expect(
        container.querySelector('.gx-slide-directional-settled'),
      ).not.toBeNull();
    },
  );
  it('repaints a same-ID badge enrichment without replaying Slide or directional entrance', () => {
    vi.useFakeTimers();
    mockSlideMeasure(55);
    const before = parsed('twitch', 'stable', 'before');
    const animated = {
      ...props('slide'),
      config: MultichatQuerySchema.parse({
        twitch: 'channel', animation: 'slide', entryAnimation: 'slideRight',
      }),
    };
    const { container, rerender } = render(<ChatOverlay {...animated} messages={[before]} />);
    completeSlideSpacers(container);
    expect(container.querySelector('[data-slide-ghost]')).toBeNull();
    const entry = container.querySelector('[data-entry-animation="slideRight"]');
    expect(entry).not.toBeNull();

    rerender(<ChatOverlay {...animated} messages={[parsed('twitch', 'stable', 'after')]} />);
    expect(container.querySelector('[data-slide-ghost]')).toBeNull();
    expect(container.textContent).toContain('after');
    expect(container.querySelector('[data-entry-animation="slideRight"]')).toBe(entry);
  });

  it('removes a deleted member without replaying the surviving batch', () => {
    vi.useFakeTimers();
    mockSlideMeasure(110);
    const one = parsed('twitch', 'one');
    const two = parsed('twitch', 'two');
    const { container, rerender } = render(<ChatOverlay {...props('slide')} messages={[one, two]} />);
    completeSlideSpacers(container);
    rerender(<ChatOverlay {...props('slide')} messages={[one]} />);
    expect(container.querySelector('[data-slide-ghost]')).toBeNull();
    expect(container.textContent).toContain('one');
    expect(container.textContent).not.toContain('two');
  });

  it('renders restored rows immediately without replaying their entrance', () => {
    vi.useFakeTimers();
    mockSlideMeasure(55);
    const restored = { ...parsed('twitch', 'restored'), suppressEntryAnimation: true };
    const { container } = render(<ChatOverlay {...props('slide')} messages={[restored]} />);
    expect(container.querySelector('.gx-slide-group')).toBeNull();
    expect(container.querySelector('[data-slide-ghost]')).toBeNull();
    expect(container.textContent).toContain('restored');
  });

  it.each(['fade', 'none'] as const)('%s remains independent from the Slide spacer', (animation) => {
    const messages = [parsed('twitch', 'one'), parsed('twitch', 'two')];
    const { container } = render(<ChatOverlay {...props(animation)} messages={messages} />);
    expect(container.querySelectorAll('.ck-body')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slide-ghost]')).toHaveLength(0);
    expect(container.querySelectorAll('.gx-fade-group')).toHaveLength(animation === 'fade' ? 1 : 0);
  });

  it('never horizontally translates actual message rows', () => {
    vi.useFakeTimers();
    mockSlideMeasure(55);
    const { container } = render(
      <ChatOverlay {...props('slide')} messages={[parsed('twitch', 'plain')]} />,
    );
    const row = container.querySelector('.gx-message-row') as HTMLElement;
    expect(row.style.transform).toBe('translate3d(0, 0, 0)');
    expect(container.querySelector('[data-entry-animation]')).toBeNull();
    expect(container.querySelector('.gx-message-slide-in')).toBeNull();
  });

  it('fades and collapses an expiring row in one eased exit', () => {
    const message = parsed('twitch', 'old');
    const { container, rerender } = render(<ChatOverlay {...props('none')} messages={[message]} />);
    let row = container.querySelector('.gx-message-row') as HTMLElement;
    expect(row.style.gridTemplateRows).toBe('1fr');
    expect(row.style.opacity).toBe('1');

    rerender(
      <ChatOverlay
        {...props('none')}
        fadingIds={new Set([message.id])}
        messages={[message]}
      />,
    );

    row = container.querySelector('.gx-message-row') as HTMLElement;
    expect(row.style.gridTemplateRows).toBe('0fr');
    expect(row.style.opacity).toBe('0');
    expect(row.style.transform).toBe('translate3d(0, -6px, 0)');
    expect(row.style.transition).toContain(`grid-template-rows ${MESSAGE_FADE_TRANSITION_MS}ms`);
    expect(row.style.transition).toContain(`opacity ${MESSAGE_FADE_TRANSITION_MS}ms`);
    expect((row.firstElementChild as HTMLElement).style.overflow).toBe('hidden');
  });

  it('auto mode bypasses the Slide spacer for a heavy presentation batch', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    mockSlideMeasure(220);
    setRuntimeAnimationMode('auto');
    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, Date.now());

    const messages = Array.from(
      { length: AUTO_ANIMATION_BYPASS_BATCH_SIZE },
      (_, index) => parsed('twitch', `burst-${index}`),
    );
    const { container } = render(
      <ChatOverlay {...props('slide')} messages={messages} />,
    );

    expect(container.querySelector('.gx-slide-group')).toBeNull();
    expect(container.querySelector('[data-slide-ghost]')).toBeNull();
    expect(container.querySelectorAll('.ck-body')).toHaveLength(AUTO_ANIMATION_BYPASS_BATCH_SIZE);
  });

  it('auto mode restores the configured entrance animation after the burst hold expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    mockSlideMeasure(55);
    setRuntimeAnimationMode('auto');
    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, Date.now());

    const first = parsed('twitch', 'burst');
    const { container, rerender } = render(
      <ChatOverlay {...props('slide')} messages={[first]} />,
    );
    expect(container.querySelector('.gx-slide-group')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(AUTO_ANIMATION_BYPASS_HOLD_MS);
    });
    recordRuntimeAnimationBatch(1, Date.now());
    const second = parsed('twitch', 'normal');
    rerender(
      <ChatOverlay {...props('slide')} messages={[first, second]} />,
    );

    expect(container.querySelector('.gx-slide-group')).not.toBeNull();
  });

  it('applies the shared runtime on/off decision to the restored Slide spacer', () => {
    vi.useFakeTimers();
    mockSlideMeasure(55);
    setRuntimeAnimationMode('off');
    recordRuntimeAnimationBatch(1, 30_000);
    const off = render(
      <ChatOverlay {...props('slide')} messages={[parsed('twitch', 'off')]} />,
    );
    expect(off.container.querySelector('.gx-slide-group')).toBeNull();
    off.unmount();

    setRuntimeAnimationMode('on');
    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 30_001);
    const on = render(
      <ChatOverlay {...props('slide')} messages={[parsed('twitch', 'on')]} />,
    );
    expect(on.container.querySelector('.gx-slide-group')).not.toBeNull();
  });
});
