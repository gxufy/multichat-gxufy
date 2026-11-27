/* The two Pogly preview pages (/pogly-preview/multichat and
 * /pogly-preview/counter): fixed sample content drawn with the real chat
 * overlay and viewer counter, made to be embedded as a preview of each.
 *
 * Shared by both apps' pages, so whichever app answers draws the same thing.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import { SAMPLE_COSMETICS, sampleMessages } from '@/features/multichat/samples';
import { sampleCounterStatuses } from '@/features/counter/samples';
import type { ParsedMessage } from '@/lib/kick';
import { MultichatQuerySchema } from '@/lib/multichatConfig';
import { buildParsedMessage } from '@/lib/multichatMessageModel';
import type { MentionPaint } from '@/lib/renderCore';
import { DEFAULT_STYLE, type PlatformStatuses, type ViewerCounterStyle } from '@/lib/viewerCounterConfig';

/** The chat preview's settings: every platform, 7TV on, plain text. */
export const POGLY_CHAT_CONFIG = MultichatQuerySchema.parse({
  kick: 'gxufy-preview',
  twitch: 'gxufy-preview',
  youtube: 'gxufy-preview',
  tiktok: 'gxufy-preview',
  sevenTVEmotesEnabled: 'true',
  sevenTVCosmeticsEnabled: 'true',
  showCommunityBadges: 'true',
  textShadow: 'none',
  textSize: 'medium',
  animation: 'none',
  mentionColor: 'true',
  sourceTag: 'icon',
  font: 'opensans',
  stroke: 'none',
  emoteScale: '1',
  msgBold: 'false',
  msgCaps: 'false',
  smoothScroll: 'false',
  paintShadows: 'true',
  showSystemMsgs: 'true',
  showFirstMessages: 'true',
  showRedeems: 'true',
});

/** The chat preview's rows: one sample message from each platform. */
export function poglyChatMessages(): ParsedMessage[] {
  const showcase = sampleMessages();
  // One row from each platform, in an order that keeps the YouTube mention
  // sample after the Twitch author it references.
  const selected = [showcase[0], showcase[1], showcase[3], showcase[4]].filter(Boolean);
  const mentions = {
    enabled: POGLY_CHAT_CONFIG.mentionColor,
    colors: new Map<string, string>(),
    paints: new Map<string, MentionPaint>(),
  };
  return selected.map((message) =>
    buildParsedMessage(
      message,
      POGLY_CHAT_CONFIG,
      SAMPLE_COSMETICS,
      mentions,
      message.timestamp,
    ),
  );
}

/** The chat preview's page: transparent, filling the frame, no scrollbars.
 *  (#__next was the old page root; it matches nothing now and is harmless.) */
export const POGLY_CHAT_PAGE_CSS = `
  html, body, #__next {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
  }
`;

/** The counter preview's sample counts. */
export function poglyCounterStatuses(): PlatformStatuses {
  return sampleCounterStatuses();
}

/** The counter preview's look: the default counter, centred. */
export const POGLY_COUNTER_STYLE: ViewerCounterStyle = { ...DEFAULT_STYLE, align: 'center' };

/** The counter preview's page: the same rules as the chat preview's. */
export const POGLY_COUNTER_PAGE_CSS = POGLY_CHAT_PAGE_CSS;

/** The box the counter sits in: the whole frame, centred both ways, 8px in. */
export const POGLY_COUNTER_BOX_STYLE = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '8px',
  boxSizing: 'border-box',
} as const;
