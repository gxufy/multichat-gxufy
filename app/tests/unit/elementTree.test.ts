/*
 * Shared chat parts (lib/render/elementTree.ts): what the message builders
 * produce, and the HTML the overlay inserts for them. The snapshots are the
 * markup React wrote for the same parts (the HTML writer was checked against
 * it, part for part over the whole sample corpus, before React was retired).
 */
import { describe, expect, it } from 'vitest';
import {
  el,
  imageFailureFor,
  isChatElement,
  partsToHtml,
  styleText,
  type ChatPart,
} from '@/lib/render/elementTree';
import { buildMessageFilter, buildParsedMessage } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { sourceTagPart, type MentionPaint, type SourceTagMode } from '@/lib/renderCore';
import { twitchGifPart } from '@/lib/twitchGif';
import { SAMPLE_COSMETICS, sampleAllMessages } from '@/features/multichat/samples';
import type { Platform, UnifiedMessage } from '@/lib/types';

/** Every part list the message model makes for the sample corpus. */
function corpusParts(query: Record<string, string>): ChatPart[][] {
  const config = MultichatQuerySchema.parse({ twitch: 'a', kick: 'b', youtube: 'c', tiktok: 'd', ...query });
  const show = buildMessageFilter(config);
  const mentions = { enabled: config.mentionColor, colors: new Map<string, string>(), paints: new Map<string, MentionPaint>() };
  const lists: ChatPart[][] = [];
  const extra: UnifiedMessage = {
    platform: 'twitch', id: 'e', senderId: 'e', username: 'quoter', color: '#123', badges: [],
    text: `a & b < c > "d" 'e' ${SAMPLE_COSMETICS.emotes.twitch?.[0]?.name ?? ''} ffzX`, emotes: [], timestamp: 1, kind: 'chat',
  };
  for (const message of [...sampleAllMessages(), extra]) {
    if (!show(message)) continue;
    const parsed = buildParsedMessage(message, config, SAMPLE_COSMETICS, mentions, 1);
    lists.push(parsed.message as ChatPart[], parsed.identity.badges as ChatPart[]);
    if (parsed.reply?.renderedText) lists.push(parsed.reply.renderedText as ChatPart[]);
  }
  return lists;
}

function* elements(parts: readonly ChatPart[]): Generator<Extract<ChatPart, object>> {
  for (const part of parts) {
    if (!isChatElement(part)) continue;
    yield part;
    yield* elements(part.children ?? []);
  }
}

describe('shared chat parts', () => {
  it('builders return only parts (no React elements) for the whole sample corpus', () => {
    for (const parts of corpusParts({})) {
      for (const part of parts) expect(typeof part === 'string' || isChatElement(part)).toBe(true);
    }
  });

  it('writes every source tag and the GIF image as React did', () => {
    for (const platform of ['twitch', 'kick', 'youtube', 'tiktok'] as Platform[]) {
      for (const mode of ['dot', 'label', 'icon'] as SourceTagMode[]) {
        const tag = sourceTagPart(platform, mode, mode === 'icon' ? 'drop-shadow(0 0 2px #000)' : '')!;
        expect(partsToHtml([tag])).toMatchSnapshot(`${platform} ${mode}`);
      }
    }
    const gif = twitchGifPart('https://media.example.com/a.gif', 180)!;
    expect(partsToHtml([gif])).toMatchSnapshot('gif');
  });

  it('every image says on its own what a load failure does, matching its handler', () => {
    let images = 0;
    const lists = [
      ...corpusParts({}),
      (['twitch', 'kick', 'youtube', 'tiktok'] as Platform[]).map((p) => sourceTagPart(p, 'icon')!),
      [twitchGifPart('https://media.example.com/a.gif', 180)!],
    ];
    for (const parts of lists) {
      for (const element of elements(parts)) {
        if (element.tag !== 'img') continue;
        images += 1;
        const attrs = element.attrs ?? {};
        const image = { getAttribute: (name: string) => (attrs[name] === undefined ? null : String(attrs[name])) };
        expect(imageFailureFor(image)).toBe(element.onError ?? null);
      }
    }
    expect(images).toBeGreaterThan(20);
  });

  it('writes styles as React does (units, unitless numbers, vendor prefixes, empties left out)', () => {
    expect(styleText({ width: 10, lineHeight: 0, fontWeight: 800, opacity: 0.5, zIndex: 2, flex: 1, margin: 0 }))
      .toBe('width: 10px; line-height: 0; font-weight: 800; opacity: 0.5; z-index: 2; flex: 1; margin: 0;');
    expect(styleText({ WebkitTextFillColor: 'transparent', WebkitBackgroundClip: 'text', msTransform: 'none', filter: undefined, color: '' }))
      .toBe('-webkit-text-fill-color: transparent; -webkit-background-clip: text; -ms-transform: none;');
    const part = el('span', { style: { borderRadius: 9999, lineHeight: 0, padding: '0.12em 0.4em', filter: undefined } }, ['x']);
    expect(partsToHtml([part])).toMatchSnapshot();
  });

  it('escapes text and attributes the way React does', () => {
    const part = el('span', { title: `"quoted" & <tagged> it's` }, [`<b>bold</b> & 'single' "double"`]);
    expect(partsToHtml([part])).toMatchSnapshot();
  });
});
