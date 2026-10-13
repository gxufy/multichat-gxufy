import Head from 'next/head';
import ChatOverlay from '@/components/overlay/ChatOverlay';
import { SAMPLE_COSMETICS, sampleMessages } from '@/features/multichat/samples';
import { buildParsedMessage } from '@/lib/multichatMessageModel';
import { MultichatQuerySchema } from '@/lib/multichatConfig';

const EMPTY_FADING = new Set<string>();

const PREVIEW_CONFIG = MultichatQuerySchema.parse({
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

function previewMessages() {
  const showcase = sampleMessages();
  // One row from each platform, in an order that keeps the YouTube mention
  // sample after the Twitch author it references.
  const selected = [showcase[0], showcase[1], showcase[3], showcase[4]].filter(Boolean);
  const mentions = {
    enabled: PREVIEW_CONFIG.mentionColor,
    colors: new Map<string, string>(),
  };
  return selected.map((message) =>
    buildParsedMessage(
      message,
      PREVIEW_CONFIG,
      SAMPLE_COSMETICS,
      mentions,
      message.timestamp,
    ),
  );
}

const PREVIEW_MESSAGES = previewMessages();

export default function PoglyMultiChatPreview() {
  return (
    <>
      <Head>
        <title>Gxufy MultiChat Preview</title>
        <meta name="robots" content="noindex,nofollow" />
        <style>{`
          html, body, #__next {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
            background: transparent;
          }
        `}</style>
      </Head>
      <ChatOverlay
        config={PREVIEW_CONFIG}
        messages={PREVIEW_MESSAGES}
        fadingIds={EMPTY_FADING}
        pinnedMessage={null}
        showLoader={false}
        sourceTagExplicit
        sourceTagOverride="icon"
      />
    </>
  );
}
