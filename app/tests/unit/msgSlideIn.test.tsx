import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { normalizeMultichatStyle } from '@/features/multichat/config';
import { SAMPLE_COSMETICS, SAMPLE_MESSAGES } from '@/features/multichat/samples';
import {
  MESSAGE_ENTRY_INITIAL_X,
  MESSAGE_ENTRY_SPRING,
  messageEntryInitialState,
  messageEntryTargetState,
} from '@/lib/messageEntryAnimation';
import {
  AUTO_ANIMATION_BYPASS_BATCH_SIZE,
  recordRuntimeAnimationBatch,
  resetRuntimeAnimationState,
} from '@/lib/multichatAnimationRuntime';
import { buildParsedMessage } from '@/lib/multichatMessageModel';
import {
  MULTICHAT_GENERATOR_DEFAULTS,
  MultichatQuerySchema,
  buildMultichatQuery,
} from '@/lib/multichatConfig';

const channels = { kick: 'gxufy', twitch: '', youtube: '', tiktok: '' };

beforeEach(() => resetRuntimeAnimationState());
afterEach(() => {
  cleanup();
  resetRuntimeAnimationState();
});

function makeMessage(config: ReturnType<typeof MultichatQuerySchema.parse>, id = 'message-1') {
  const raw = { ...SAMPLE_MESSAGES[0].message, id };
  return buildParsedMessage(
    raw,
    config,
    SAMPLE_COSMETICS,
    { enabled: config.mentionColor, colors: new Map() },
    raw.timestamp,
  );
}

function renderMessage(query: Record<string, string>, messageOverride?: { suppressEntryAnimation?: boolean }) {
  const config = MultichatQuerySchema.parse({ twitch: 'somebody', animation: 'none', ...query });
  const message = { ...makeMessage(config), ...messageOverride };
  const view = render(
    <ChatOverlay config={config} messages={[message]} fadingIds={new Set()}
      pinnedMessage={null} showLoader={false} sourceTagExplicit />,
  );
  return { ...view, config, message };
}

describe('directional entrance configuration', () => {
  it('defaults Off independently of the main Slide animation', () => {
    const parsed = MultichatQuerySchema.parse({});
    expect(parsed.animation).toBe('slide');
    expect(parsed.entryAnimation).toBe('none');
  });

  it.each(['none', 'slideRight', 'slideLeft'] as const)(
    'accepts entryAnimation=%s without changing the main animation',
    (entryAnimation) => {
      const parsed = MultichatQuerySchema.parse({ animation: 'fade', entryAnimation });
      expect(parsed.animation).toBe('fade');
      expect(parsed.entryAnimation).toBe(entryAnimation);
    },
  );

  it.each(['1', 'true'])(
    'maps legacy msgSlideIn=%s to From right',
    (msgSlideIn) => {
      const parsed = MultichatQuerySchema.parse({ msgSlideIn });
      expect(parsed.entryAnimation).toBe('slideRight');
      expect('msgSlideIn' in parsed).toBe(false);
    },
  );

  it.each(['0', 'false', 'off'])(
    'keeps legacy msgSlideIn=%s Off',
    (msgSlideIn) => {
      expect(MultichatQuerySchema.parse({ msgSlideIn }).entryAnimation).toBe('none');
    },
  );

  it('lets an explicit entryAnimation value win over the legacy alias', () => {
    expect(MultichatQuerySchema.parse({ entryAnimation: 'slideLeft', msgSlideIn: '1' }).entryAnimation)
      .toBe('slideLeft');
    expect(MultichatQuerySchema.parse({ entryAnimation: 'none', msgSlideIn: 'true' }).entryAnimation)
      .toBe('none');
  });

  it('serializes only non-default modern values and never emits msgSlideIn', () => {
    for (const entryAnimation of ['none', 'slideRight', 'slideLeft'] as const) {
      const params = new URLSearchParams(buildMultichatQuery(channels, {
        ...MULTICHAT_GENERATOR_DEFAULTS,
        entryAnimation,
      }));
      expect(params.get('entryAnimation')).toBe(entryAnimation === 'none' ? null : entryAnimation);
      expect(params.has('msgSlideIn')).toBe(false);
    }
  });

  it('migrates old saved workspace state without changing the main animation', () => {
    expect(normalizeMultichatStyle({ msgSlideIn: true }).entryAnimation).toBe('slideRight');
    expect(normalizeMultichatStyle({ animation: 'fade', msgSlideIn: true })).toMatchObject({
      animation: 'fade',
      entryAnimation: 'slideRight',
    });
    expect(normalizeMultichatStyle({ entryAnimation: 'slideLeft', msgSlideIn: true }).entryAnimation)
      .toBe('slideLeft');
    expect(normalizeMultichatStyle({ entryAnimation: 'none', msgSlideIn: true }).entryAnimation)
      .toBe('none');
  });
});

describe('directional entrance rendering', () => {
  it('keeps Off free of a horizontal entrance', () => {
    const { container } = renderMessage({ entryAnimation: 'none' });
    expect(container.querySelector('[data-entry-animation]')).toBeNull();
    expect(container.querySelector('.gx-message-entry')).toBeNull();
  });

  it('uses a full-width physics spring entrance from the right', () => {
    const { container } = renderMessage({ entryAnimation: 'slideRight' });
    const entry = container.querySelector<HTMLElement>('[data-entry-animation="slideRight"]');

    expect(entry).not.toBeNull();
    expect(MESSAGE_ENTRY_INITIAL_X.slideRight).toBe('100%');
    expect(messageEntryInitialState('slideRight', true)).toEqual({ x: '100%', opacity: 0 });
    expect(messageEntryTargetState(true)).toEqual({ x: 0, opacity: 1 });
    expect(MESSAGE_ENTRY_SPRING).toEqual({
      type: 'spring',
      stiffness: 1200,
      damping: 50,
      mass: 0.3,
    });
    expect((entry?.querySelector('[data-entry-motion-x]') as HTMLElement | null)?.style.transform).toContain('translateX(100%)');
    expect(entry?.style.opacity).toBe('0');
  });

  it('uses an exact mirrored full-width entrance from the left', () => {
    const { container } = renderMessage({ entryAnimation: 'slideLeft' });
    const entry = container.querySelector<HTMLElement>('[data-entry-animation="slideLeft"]');
    expect(entry).not.toBeNull();
    expect(MESSAGE_ENTRY_INITIAL_X.slideLeft).toBe('-100%');
    expect(messageEntryInitialState('slideLeft', true)).toEqual({ x: '-100%', opacity: 0 });
    expect(messageEntryTargetState(true)).toEqual({ x: 0, opacity: 1 });
    expect(Number.parseFloat(MESSAGE_ENTRY_INITIAL_X.slideRight))
      .toBe(-Number.parseFloat(MESSAGE_ENTRY_INITIAL_X.slideLeft));
    expect((entry?.querySelector('[data-entry-motion-x]') as HTMLElement | null)?.style.transform).toContain('translateX(-100%)');
    expect(entry?.style.opacity).toBe('0');
  });

  it('leaves opacity to the main Fade animation when Fade is selected', () => {
    const { container } = renderMessage({ animation: 'fade', entryAnimation: 'slideRight' });

    expect(container.querySelector('.gx-fade-group')).not.toBeNull();
    const entry = container.querySelector<HTMLElement>('[data-entry-animation="slideRight"]');
    expect(entry).not.toBeNull();
    expect(messageEntryInitialState('slideRight', false)).toEqual({ x: '100%' });
    expect(messageEntryTargetState(false)).toEqual({ x: 0 });
    expect(entry?.style.opacity).toBe('');
  });

  it('clips full-width travel without expanding the overlay canvas', () => {
    const { container } = renderMessage({ entryAnimation: 'slideRight' });
    const chat = container.querySelector<HTMLElement>('#chat_container');
    const rowInner = container.querySelector<HTMLElement>('.gx-message-row-inner');
    const entry = container.querySelector<HTMLElement>('.gx-message-entry');

    expect(chat?.style.overflow).toBe('hidden');
    expect(rowInner?.style.overflow).toBe('hidden');
    expect(entry?.style.width).toBe('100%');
    expect(entry?.style.minWidth).toBe('0');
  });

  it('suppresses restored rows', () => {
    const restored = renderMessage(
      { entryAnimation: 'slideRight' },
      { suppressEntryAnimation: true },
    );
    expect(restored.container.querySelector('.gx-message-entry')).toBeNull();
  });

  it('animates a 3-row AUTO batch and bypasses a 4-row AUTO batch', () => {
    const config = MultichatQuerySchema.parse({
      twitch: 'somebody',
      animation: 'none',
      entryAnimation: 'slideRight',
    });
    const renderBatch = (count: number) => render(
      <ChatOverlay config={config}
        messages={Array.from({ length: count }, (_, index) => makeMessage(config, `message-${index}`))}
        fadingIds={new Set()} pinnedMessage={null} showLoader={false} sourceTagExplicit />,
    );

    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE - 1, 1_000);
    const light = renderBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE - 1);
    expect(light.container.querySelectorAll('.gx-message-entry'))
      .toHaveLength(AUTO_ANIMATION_BYPASS_BATCH_SIZE - 1);
    light.unmount();

    recordRuntimeAnimationBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE, 1_000);
    const burst = renderBatch(AUTO_ANIMATION_BYPASS_BATCH_SIZE);
    expect(burst.container.querySelectorAll('.gx-message-entry')).toHaveLength(0);
  });

  it('keeps the same DOM row on repaint and animates only a genuinely new ID', () => {
    const config = MultichatQuerySchema.parse({
      twitch: 'somebody',
      animation: 'none',
      entryAnimation: 'slideRight',
    });
    const first = makeMessage(config);
    const view = render(
      <ChatOverlay config={config} messages={[first]} fadingIds={new Set()}
        pinnedMessage={null} showLoader={false} sourceTagExplicit />,
    );
    const firstRow = view.container.querySelector('[data-entry-animation="slideRight"]');
    expect(firstRow).not.toBeNull();

    view.rerender(
      <ChatOverlay config={config} messages={[{ ...first, message: ['repainted'] }]}
        fadingIds={new Set()} pinnedMessage={null} showLoader={false} sourceTagExplicit />,
    );
    expect(view.container.querySelector('[data-entry-animation="slideRight"]')).toBe(firstRow);

    const second = makeMessage(config, 'message-2');
    view.rerender(
      <ChatOverlay config={config} messages={[{ ...first, message: ['repainted'] }, second]}
        fadingIds={new Set()} pinnedMessage={null} showLoader={false} sourceTagExplicit />,
    );
    expect(view.container.querySelectorAll('[data-entry-animation="slideRight"]')).toHaveLength(2);
  });

});
