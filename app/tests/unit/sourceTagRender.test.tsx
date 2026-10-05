/* Source-tag rendering at the production DOM boundary. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import {
  PROVIDERS,
  PROVIDER_ICON_OPTICS,
  sourceTag,
  type SourceTagMode,
} from '@/lib/render';
import { MULTICHAT_SOURCE_TAGS, MultichatQuerySchema } from '@/lib/multichatConfig';
import type { ParsedMessage } from '@/lib/kick';
import { TWITCH_PLATFORM_ICON_SRC } from '@/lib/platformAssets';
import type { Platform } from '@/lib/types';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const PLATFORMS: readonly Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];
afterEach(cleanup);

function msg(
  platform: Platform,
  opts: { id?: string; badges?: boolean; kind?: 'chat' | 'system'; category?: string } = {},
): ParsedMessage {
  return {
    id: opts.id ?? `${platform}-1`,
    platform,
    kind: opts.kind ?? 'chat',
    ...(opts.category ? { category: opts.category } : {}),
    identity: {
      username: 'somebody',
      color: '#ffffff',
      background: '',
      filter: '',
      badges: opts.badges
        ? [<span key="b" data-test-badge="moderator">MOD</span>]
        : [],
    },
    message: ['hello'],
  };
}

function renderTag(platform: Platform, mode: SourceTagMode) {
  const { container } = render(<div>{sourceTag(platform, mode)}</div>);
  return {
    container,
    marker: container.querySelector('[data-source-tag]'),
    markers: container.querySelectorAll('[data-source-tag]'),
  };
}

function overlay(query: Record<string, string>, messages = [msg('twitch')]) {
  const config = MultichatQuerySchema.parse(query);
  const { container } = render(
    <ChatOverlay
      config={config}
      messages={messages}
      fadingIds={new Set()}
      pinnedMessage={null}
      showLoader={false}
      sourceTagExplicit={query.sourceTag !== undefined}
    />,
  );
  return {
    container,
    markers: container.querySelectorAll('[data-source-tag]'),
    mode: container.querySelector('[data-source-tag]')?.getAttribute('data-source-tag'),
  };
}

describe('source marker primitive', () => {
  it('renders nothing for none and one marker for the other modes', () => {
    for (const platform of PLATFORMS) {
      expect(renderTag(platform, 'none').markers).toHaveLength(0);
      cleanup();
      for (const mode of ['icon', 'dot', 'label'] as const) {
        const { markers } = renderTag(platform, mode);
        expect(markers).toHaveLength(1);
        expect(markers[0].getAttribute('data-source-tag')).toBe(mode);
        expect(markers[0].getAttribute('data-platform')).toBe(platform);
        cleanup();
      }
    }
  });

  it('renders the provider name for label mode', () => {
    for (const platform of PLATFORMS) {
      const { marker } = renderTag(platform, 'label');
      expect(marker?.textContent).toBe(PROVIDERS[platform].label);
      cleanup();
    }
  });

  it('uses one stable non-clipping box with checked optical scales', () => {
    expect(PROVIDER_ICON_OPTICS).toEqual({
      twitch: { scale: 0.96, offsetY: 0 },
      kick: { scale: 0.86, offsetY: 0 },
      youtube: { scale: 0.97, offsetY: 0 },
      tiktok: { scale: 0.96, offsetY: 0 },
    });

    for (const platform of PLATFORMS) {
      const marker = renderTag(platform, 'icon').marker as HTMLElement;
      const icon = marker.querySelector('img, svg') as HTMLElement;
      const { scale, offsetY } = PROVIDER_ICON_OPTICS[platform];

      expect(marker.style.display).toBe('inline-flex');
      expect(marker.style.width).toBe('1.15em');
      expect(marker.style.height).toBe('1.15em');
      expect(marker.style.flex).toBe('0 0 1.15em');
      expect(marker.style.lineHeight).toBe('0');
      expect(marker.style.verticalAlign).toBe('-0.1em');
      expect(marker.style.marginRight).toBe('0.4em');
      expect(marker.style.overflow).toBe('visible');
      expect(marker.getAttribute('aria-hidden')).toBe('true');

      expect(icon.style.width).toBe('100%');
      expect(icon.style.height).toBe('100%');
      expect(icon.style.objectFit).toBe('contain');
      expect(icon.style.overflow).toBe('visible');
      expect(icon.style.transform).toBe(`translateY(${offsetY}em) scale(${scale})`);
      cleanup();
    }

    const twitch = renderTag('twitch', 'icon').marker;
    expect(twitch?.querySelector('img')?.getAttribute('src')).toBe(TWITCH_PLATFORM_ICON_SRC);
    cleanup();
    expect(PROVIDER_ICON_OPTICS.youtube.scale).toBeGreaterThan(PROVIDER_ICON_OPTICS.kick.scale);
  });

  it('produces distinct DOM for all four modes', () => {
    for (const platform of PLATFORMS) {
      const html = MULTICHAT_SOURCE_TAGS.map((mode) => {
        const { container } = render(<div>{sourceTag(platform, mode)}</div>);
        const value = container.innerHTML;
        cleanup();
        return value;
      });
      expect(new Set(html).size).toBe(MULTICHAT_SOURCE_TAGS.length);
    }
  });
});

describe('ChatOverlay sourceTag behavior', () => {
  it('keeps the live-strength icon shadow without provider oversizing rules', () => {
    const { container } = overlay(
      { kick: 'k', twitch: 't', youtube: 'y', tiktok: 'tt', sourceTag: 'icon' },
      PLATFORMS.map((platform) => msg(platform)),
    );
    const css = Array.from(container.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');

    expect(css).toContain('#chat_container [data-source-tag="icon"]');
    expect(css).toContain('drop-shadow(2px 2px 3px rgba(0, 0, 0, 1))');
    expect(css).not.toContain('[data-platform="kick"] svg');
    expect(css).not.toContain('[data-platform="tiktok"] img');
  });

  it.each(['small', 'medium', 'large'] as const)(
    'keeps the same em-based icon box at %s chat size',
    (textSize) => {
      const { container } = overlay(
        { kick: 'k', twitch: 't', youtube: 'y', tiktok: 'tt', sourceTag: 'icon', textSize },
        PLATFORMS.map((platform) => msg(platform)),
      );
      for (const marker of container.querySelectorAll<HTMLElement>('[data-source-tag="icon"]')) {
        expect(marker.style.width).toBe('1.15em');
        expect(marker.style.height).toBe('1.15em');
        expect(marker.style.marginRight).toBe('0.4em');
      }
    },
  );

  it('keeps single Twitch, Kick, and TikTok marker-free when sourceTag is omitted', () => {
    for (const platform of ['twitch', 'kick', 'tiktok'] as const) {
      const { markers } = overlay({ [platform]: 'someone' }, [msg(platform)]);
      expect(markers).toHaveLength(0);
      cleanup();
    }
  });

  it('uses the icon by default for YouTube-only and multi-platform overlays', () => {
    expect(overlay({ youtube: 'someone' }, [msg('youtube')]).mode).toBe('icon');
    cleanup();
    expect(
      overlay({ twitch: 'a', kick: 'b' }, [msg('twitch'), msg('kick')]).mode,
    ).toBe('icon');
  });

  it('honors every explicit sourceTag on a single platform', () => {
    for (const mode of ['icon', 'dot', 'label'] as const) {
      expect(overlay({ twitch: 'someone', sourceTag: mode }).mode).toBe(mode);
      cleanup();
    }
    expect(overlay({ twitch: 'someone', sourceTag: 'none' }).markers).toHaveLength(0);
  });

  it('gives mixed-platform messages their own label markers', () => {
    const { markers } = overlay(
      { kick: 'k', twitch: 't', youtube: 'y', tiktok: 'tt', sourceTag: 'label' },
      PLATFORMS.map((platform) => msg(platform)),
    );
    expect(Array.from(markers).map((marker) => marker.getAttribute('data-platform')))
      .toEqual(['kick', 'twitch', 'youtube', 'tiktok']);
    expect(Array.from(markers).map((marker) => marker.textContent))
      .toEqual(['Kick', 'Twitch', 'YouTube', 'TikTok']);
  });

  it('keeps user badges independent from source markers', () => {
    const { container, markers } = overlay(
      { twitch: 'someone', sourceTag: 'none' },
      [msg('twitch', { badges: true })],
    );
    expect(markers).toHaveLength(0);
    expect(container.querySelectorAll('[data-test-badge]')).toHaveLength(1);
  });
});

describe('retired pin banner', () => {
  it('parser forces legacy showPinEnabled=true back to false', () => {
    expect(
      MultichatQuerySchema.parse({ twitch: 'someone', showPinEnabled: 'true' })
        .showPinEnabled,
    ).toBe(false);
  });

  it('does not render a supplied pinned message from a legacy pin URL', () => {
    const config = MultichatQuerySchema.parse({
      twitch: 'someone',
      showPinEnabled: 'true',
      pinPlatforms: 'twitch',
      sourceTag: 'label',
    });
    const { container } = render(
      <ChatOverlay
        config={config}
        messages={[]}
        fadingIds={new Set()}
        pinnedMessage={{ msg: msg('twitch', { id: 'pin-1' }) }}
        showLoader={false}
        sourceTagExplicit
      />,
    );
    expect(container.textContent).not.toContain('Pinned Message');
    expect(container.querySelectorAll('[data-source-tag]')).toHaveLength(0);
  });
});
