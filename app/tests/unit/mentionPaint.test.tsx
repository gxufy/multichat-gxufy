// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { buildParsedMessage, NO_COSMETICS } from '@/lib/multichatMessageModel';
import type { MentionContext, MentionPaint } from '@/lib/render';
import type { UnifiedMessage } from '@/lib/types';

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

afterEach(cleanup);

const PAINT = {
  id: 'pink-paint',
  func: 'LINEAR_GRADIENT',
  angle: 90,
  repeat: false,
  shadows: [{ x_offset: 0, y_offset: 0, radius: 4, color: 0xff00ffff }],
  stops: [{ color: 0xff3399ff, at: 0 }, { color: 0x9933ffff, at: 1 }],
};

const PAINTED = {
  ...NO_COSMETICS,
  paints: [PAINT],
  entitlements: { 'twitch:111': { paint: 'pink-paint' } },
};

const cfg = {
  sevenTVEmotesEnabled: true,
  sevenTVCosmeticsEnabled: true,
  showCommunityBadges: true,
  paintShadows: true,
};

function chat(id: string, senderId: string, username: string, text: string, color = '#22cc88'): UnifiedMessage {
  return {
    platform: 'twitch',
    id,
    senderId,
    username,
    color,
    badges: [],
    text,
    emotes: [],
    timestamp: 1,
    kind: 'chat',
  };
}

function context(enabled = true): MentionContext {
  return { enabled, colors: new Map(), paints: new Map<string, MentionPaint>() };
}

function html(nodes: React.ReactNode[]): string {
  return renderToStaticMarkup(<>{nodes}</>);
}

describe('painted @mentions', () => {
  it('shows a painted chatter’s paint on @mentions of them', () => {
    const mentions = context();
    const author = buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), cfg, PAINTED, mentions, 1);
    expect(author.identity.background).toContain('linear-gradient');

    const reply = buildParsedMessage(chat('b', '222', 'Friend', '@PaintedUser hey'), cfg, PAINTED, mentions, 2);
    const out = html(reply.message);
    expect(out).toContain('class="ck-mention-paint"');
    expect(out).toContain('data-gx-glyph="@PaintedUser"');
    expect(out).toContain(`background-image:${author.identity.background}`);
    expect(out).toContain('filter:drop-shadow(');
    expect(out).toContain('-webkit-text-fill-color:transparent');
  });

  it('matches the mention however it is capitalised, with trailing punctuation', () => {
    const mentions = context();
    buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), cfg, PAINTED, mentions, 1);
    const other = buildParsedMessage(chat('b', '222', 'Friend', 'yo @SomeoneElse'), cfg, PAINTED, mentions, 2);
    expect(html(other.message)).not.toContain('ck-mention-paint');
    const real = buildParsedMessage(chat('c', '222', 'Friend', 'yo @painteduser!'), cfg, PAINTED, mentions, 3);
    expect(html(real.message)).toContain('data-gx-glyph="@painteduser!"');
  });

  it('keeps plain colored mentions for chatters without a paint', () => {
    const mentions = context();
    buildParsedMessage(chat('a', '333', 'PlainUser', 'hi', '#123456'), cfg, PAINTED, mentions, 1);
    const reply = buildParsedMessage(chat('b', '222', 'Friend', '@PlainUser hey'), cfg, PAINTED, mentions, 2);
    const out = html(reply.message);
    expect(out).not.toContain('ck-mention-paint');
    expect(out).toMatch(/<strong style="color:#[0-9a-fA-F]{6};font-weight:800">@PlainUser<\/strong>/);
  });

  it('follows the paint switches and the colored-mentions switch', () => {
    const noPaints = context();
    buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), { ...cfg, sevenTVCosmeticsEnabled: false }, PAINTED, noPaints, 1);
    const plain = buildParsedMessage(chat('b', '222', 'Friend', '@PaintedUser hey'), { ...cfg, sevenTVCosmeticsEnabled: false }, PAINTED, noPaints, 2);
    expect(html(plain.message)).not.toContain('ck-mention-paint');
    expect(html(plain.message)).toContain('<strong style="color:');

    const noShadows = context();
    buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), { ...cfg, paintShadows: false }, PAINTED, noShadows, 1);
    const flat = buildParsedMessage(chat('b', '222', 'Friend', '@PaintedUser hey'), { ...cfg, paintShadows: false }, PAINTED, noShadows, 2);
    expect(html(flat.message)).toContain('ck-mention-paint');
    expect(html(flat.message)).not.toContain('drop-shadow');

    const off = context(false);
    buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), cfg, PAINTED, off, 1);
    const none = buildParsedMessage(chat('b', '222', 'Friend', '@PaintedUser hey'), cfg, PAINTED, off, 2);
    expect(html(none.message)).not.toContain('ck-mention-paint');
    expect(html(none.message)).not.toContain('<strong');
  });

  it('drops the paint again once the chatter has taken theirs off', () => {
    const mentions = context();
    buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), cfg, PAINTED, mentions, 1);
    buildParsedMessage(chat('b', '111', 'PaintedUser', 'paint off now'), cfg, NO_COSMETICS, mentions, 2);
    const reply = buildParsedMessage(chat('c', '222', 'Friend', '@PaintedUser hey'), cfg, NO_COSMETICS, mentions, 3);
    expect(html(reply.message)).not.toContain('ck-mention-paint');
    expect(html(reply.message)).toContain('<strong style="color:');
  });

  it('carries a JilTV paint the same way', () => {
    const mentions = context();
    buildParsedMessage({
      ...chat('a', '444', 'JilUser', 'hi'),
      jiltvPaint: {
        id: '01M5Q3S869E87B1QV8ZEWEHJSJ',
        name: 'Molten Gold',
        texture: 'https://cdn.jiltv.app/paints/gold.webp',
        still: 'https://cdn.jiltv.app/paints/gold-0.webp',
        fallback: '#e7be6cff',
        shadows: [],
      },
    }, cfg, NO_COSMETICS, mentions, 1);
    const reply = buildParsedMessage(chat('b', '222', 'Friend', '@JilUser hey'), cfg, NO_COSMETICS, mentions, 2);
    expect(html(reply.message)).toContain('ck-mention-paint');
    expect(html(reply.message)).toContain('cdn.jiltv.app/paints/gold');
  });

  it('keeps working for callers that pass no paint map', () => {
    const mentions: MentionContext = { enabled: true, colors: new Map() };
    buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), cfg, PAINTED, mentions, 1);
    const reply = buildParsedMessage(chat('b', '222', 'Friend', '@PaintedUser hey'), cfg, PAINTED, mentions, 2);
    expect(html(reply.message)).not.toContain('ck-mention-paint');
    expect(html(reply.message)).toContain('<strong style="color:');
  });
});

describe('painted @mentions in the overlay', () => {
  it('draws the painted mention whole, with the message outline behind it', () => {
    const config = MultichatQuerySchema.parse({ twitch: 'streamer', stroke: 'thick' });
    const mentions = context();
    const author = buildParsedMessage(chat('a', '111', 'PaintedUser', 'hi'), cfg, PAINTED, mentions, 1);
    const reply = buildParsedMessage(chat('b', '222', 'Friend', 'hey @PaintedUser what'), cfg, PAINTED, mentions, 2);
    const { container } = render(
      <ChatOverlay config={config} messages={[author, reply]} fadingIds={new Set()} showLoader={false} />,
    );

    const mention = container.querySelector('.ck-mention-paint');
    expect(mention).not.toBeNull();
    expect(mention?.getAttribute('data-gx-glyph')).toBe('@PaintedUser');
    expect(mention?.querySelector('.gx-reference-glyph')).toBeNull();
    expect(mention?.textContent).toBe('@PaintedUser');

    const css = [...container.querySelectorAll('style'), ...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(css).toMatch(/\.ck-mention-paint::before \{[^}]*content: attr\(data-gx-glyph\) \/ "";[^}]*color: transparent;[^}]*text-shadow: (?!none)[^;]+;/);
    expect(css).toMatch(/\.ck-mention-paint-fg \{[^}]*background-clip: text !important;/);
  });
});
