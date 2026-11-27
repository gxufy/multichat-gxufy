/* The Pogly previews' fixed content, shared by both apps' pages. */
import { describe, expect, it } from 'vitest';
import { sampleCounterStatuses } from '@/features/counter/samples';
import {
  POGLY_CHAT_CONFIG,
  POGLY_CHAT_PAGE_CSS,
  POGLY_COUNTER_BOX_STYLE,
  POGLY_COUNTER_STYLE,
  poglyChatMessages,
  poglyCounterStatuses,
} from '@/features/poglyPreview';
import { DEFAULT_STYLE } from '@/lib/viewerCounterConfig';

describe('the chat preview', () => {
  it('shows one sample row from each platform, in the same order every time', () => {
    const rows = poglyChatMessages();
    expect(rows.map((row) => row.platform)).toEqual(['twitch', 'kick', 'youtube', 'tiktok']);
    expect(poglyChatMessages().map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('uses the preview settings: every platform, 7TV on, plain text, the platform icon', () => {
    expect(POGLY_CHAT_CONFIG).toMatchObject({
      sevenTVEmotesEnabled: true,
      sevenTVCosmeticsEnabled: true,
      showCommunityBadges: true,
      animation: 'none',
      sourceTag: 'icon',
      font: 'opensans',
    });
  });

  it('fills a transparent frame without scrollbars', () => {
    expect(POGLY_CHAT_PAGE_CSS).toContain('background: transparent;');
    expect(POGLY_CHAT_PAGE_CSS).toContain('overflow: hidden;');
  });
});

describe('the counter preview', () => {
  it('shows the sample counts with the default counter, centred', () => {
    expect(poglyCounterStatuses()).toEqual(sampleCounterStatuses());
    expect(POGLY_COUNTER_STYLE).toEqual({ ...DEFAULT_STYLE, align: 'center' });
  });

  it('sits in a box styled with strings (usable as CSS text)', () => {
    for (const value of Object.values(POGLY_COUNTER_BOX_STYLE)) expect(typeof value).toBe('string');
  });
});
