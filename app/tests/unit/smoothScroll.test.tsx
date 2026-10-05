import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { buildParsedMessage } from '@/lib/multichatMessageModel';
import { MULTICHAT_GENERATOR_DEFAULTS, MULTICHAT_WORKSPACE_DEFAULTS, MultichatQuerySchema, buildMultichatQuery } from '@/lib/multichatConfig';
import { SAMPLE_COSMETICS, SAMPLE_MESSAGES } from '@/features/multichat/samples';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const channels = { kick: '', twitch: 'gxufy', youtube: '', tiktok: '' };

describe('smooth message handling', () => {
  it('makes smooth handling the workspace default without changing legacy URL strings', () => {
    // The parser remains a compatibility surface; the /multichat page promotes
    // omission to smooth at runtime. Legacy serialization therefore stays exact.
    expect(MultichatQuerySchema.parse({}).smoothScroll).toBe(false);
    expect(MULTICHAT_GENERATOR_DEFAULTS.smoothScroll).toBe(false);
    expect(MULTICHAT_WORKSPACE_DEFAULTS.smoothScroll).toBe(true);

    const legacy = new URLSearchParams(buildMultichatQuery(channels, MULTICHAT_GENERATOR_DEFAULTS));
    const workspace = new URLSearchParams(buildMultichatQuery(channels, MULTICHAT_WORKSPACE_DEFAULTS));
    const workspaceLegacyFallback = new URLSearchParams(buildMultichatQuery(channels, {
      ...MULTICHAT_WORKSPACE_DEFAULTS,
      smoothScroll: false,
    }));

    expect(legacy.has('smoothScroll')).toBe(false);
    expect(workspace.has('smoothScroll')).toBe(false);
    expect(workspaceLegacyFallback.get('smoothScroll')).toBe('0');
  });

  it('accepts both 1 and true query spellings', () => {
    expect(MultichatQuerySchema.parse({ smoothScroll: '1' }).smoothScroll).toBe(true);
    expect(MultichatQuerySchema.parse({ smoothScroll: 'true' }).smoothScroll).toBe(true);
    expect(MultichatQuerySchema.parse({ smoothScroll: '0' }).smoothScroll).toBe(false);
  });

  it('keeps Slide off the smooth-scroll follower while using the measured height spacer', () => {
    const observerConstructed = vi.fn();
    vi.stubGlobal('MutationObserver', class {
      constructor() { observerConstructed(); }
      observe() {}
      disconnect() {}
    });
    const config = MultichatQuerySchema.parse({ twitch: 'gxufy', animation: 'slide', smoothScroll: '1' });
    const raw = SAMPLE_MESSAGES[0].message;
    const parsed = buildParsedMessage(raw, config, SAMPLE_COSMETICS, { enabled: config.mentionColor, colors: new Map() }, raw.timestamp);
    const { container } = render(<ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()} pinnedMessage={null} showLoader={false} sourceTagExplicit />);
    const chat = container.querySelector('#chat_container') as HTMLElement;
    expect(chat.style.display).toBe('');
    expect(chat.style.maxHeight).toBe('');
    expect(container.querySelector('.gx-message-slide-in')).toBeNull();
    expect(observerConstructed).not.toHaveBeenCalled();
  });

  it('keeps smooth scrolling available for non-Slide animation modes', () => {
    const observerConstructed = vi.fn();
    vi.stubGlobal('MutationObserver', class {
      constructor() { observerConstructed(); }
      observe() {}
      disconnect() {}
    });
    const config = MultichatQuerySchema.parse({ twitch: 'gxufy', animation: 'fade', smoothScroll: '1' });
    const raw = SAMPLE_MESSAGES[0].message;
    const parsed = buildParsedMessage(raw, config, SAMPLE_COSMETICS, { enabled: config.mentionColor, colors: new Map() }, raw.timestamp);
    const { container } = render(<ChatOverlay config={config} messages={[parsed]} fadingIds={new Set()} pinnedMessage={null} showLoader={false} sourceTagExplicit />);
    const chat = container.querySelector('#chat_container') as HTMLElement;
    expect(chat.style.display).toBe('flex');
    expect(chat.style.maxHeight).toBe('calc(100vh - 20px)');
    expect(observerConstructed).toHaveBeenCalledTimes(1);
  });
});
