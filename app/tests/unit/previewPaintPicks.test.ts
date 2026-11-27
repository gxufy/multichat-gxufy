import { describe, expect, it } from 'vitest';
import { chatPreviewConfig, chatPreviewRows, withPreviewPaintPicks } from '@/lib/chatPreviewRows';
import { previewHoverIndex } from '@/lib/badgeHomepages';
import { NO_COSMETICS, type MessageCosmetics } from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';

const JILTV_PAINT = {
  id: '01M5TCPBHMFJ8BX1VCFQWEP8ST',
  name: 'Android',
  texture: 'https://cdn.jiltv.app/paints/a.webp',
  fallback: '#5cae54ff',
  shadows: [],
};

const chatter = (login: string, senderId: string): UnifiedMessage => ({
  platform: 'twitch',
  id: `m-${login}`,
  senderId,
  senderUsername: login,
  username: login,
  color: '#ffffff',
  badges: [],
  text: 'hello',
  emotes: [],
  timestamp: 1,
  kind: 'chat',
  jiltvPaint: JILTV_PAINT,
});

/* All three wear a 7TV paint too. */
const BOTH: MessageCosmetics = {
  ...NO_COSMETICS,
  paints: [{
    id: '7tv-paint',
    name: 'Red to blue',
    func: 'LINEAR_GRADIENT',
    angle: 90,
    repeat: false,
    shadows: [],
    stops: [{ color: 0xff0000ff, at: 0 }, { color: 0x0000ffff, at: 1 }],
  }],
  entitlements: {
    'twitch:1': { paint: '7tv-paint' },
    'twitch:2': { paint: '7tv-paint' },
    'twitch:3': { paint: '7tv-paint' },
  },
};

const messages = [chatter('gxufy', '1'), chatter('jilence', '2'), chatter('someone', '3')];
const paintOf = (rows: ReturnType<typeof chatPreviewRows>, login: string) =>
  rows.find((row) => row.id.endsWith(`m-${login}`))?.identity.background ?? '';

describe('JilTV paints in the chat preview', () => {
  it('shows gxufy’s and jilence’s JilTV paint, and 7TV’s for everyone else', () => {
    const rows = chatPreviewRows(chatPreviewConfig('twitch=a'), messages, BOTH);
    expect(paintOf(rows, 'gxufy')).toContain('cdn.jiltv.app');
    expect(paintOf(rows, 'jilence')).toContain('cdn.jiltv.app');
    expect(paintOf(rows, 'someone')).toContain('linear-gradient');
    expect(paintOf(rows, 'someone')).not.toContain('jiltv');
  });

  it('still follows the JilTV Cosmetics switch', () => {
    const rows = chatPreviewRows(chatPreviewConfig('twitch=a&jiltvCosmeticsEnabled=false'), messages, BOTH);
    expect(paintOf(rows, 'gxufy')).toContain('linear-gradient');
    expect(paintOf(rows, 'jilence')).not.toContain('jiltv');
  });

  it('names the JilTV paint when hovering their name', () => {
    const index = previewHoverIndex(messages, withPreviewPaintPicks(messages, BOTH));
    expect(index.paints.get('gxufy')?.name).toContain('Android');
    expect(index.paints.get('someone')?.name).not.toContain('Android');
  });

  it('leaves the cosmetics as they are when neither is in the list or wears a JilTV paint', () => {
    const others = [chatter('someone', '3'), { ...chatter('gxufy', '1'), jiltvPaint: undefined }];
    expect(withPreviewPaintPicks(others, BOTH)).toBe(BOTH);
    /* Off Twitch, nothing to pick. */
    expect(withPreviewPaintPicks([{ ...chatter('gxufy', '1'), platform: 'kick' }], BOTH)).toBe(BOTH);
  });
});
