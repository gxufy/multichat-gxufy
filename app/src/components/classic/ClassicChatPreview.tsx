
import { useMemo } from 'react';
import ChatOverlay, { type PinnedState } from '@/components/overlay/ChatOverlay';
import IsolatedPreviewFrame, {
  PREVIEW_SCALE_DEFAULT,
} from '@/components/classic/IsolatedPreviewFrame';
import { safeParseMultichatConfig } from '@/lib/multichatConfig';
import {
  buildMessageFilter,
  buildParsedMessage,
  type MessageCosmetics,
} from '@/lib/multichatMessageModel';
import type { ParsedMessage } from '@/lib/kick';
import type { UnifiedMessage } from '@/lib/types';
import { SAMPLE_COSMETICS, SAMPLE_PIN_BY, SAMPLE_PIN_ID } from '@/features/multichat/samples';

/* Hoisted so the identity is stable across renders. A fresh Set every render
   would change ChatOverlay's props on every keystroke for no reason — and
   nothing is ever mid-fade in a static preview. */
const EMPTY_FADING: Set<string> = new Set();

/** Parse a serialized query string into the config the overlay expects. */
function configFromQuery(query: string) {
  const raw = Object.fromEntries(new URLSearchParams(query).entries());
  const parsed = safeParseMultichatConfig(raw);
  return parsed.success ? parsed.data : null;
}

export default function ClassicChatPreview({
  query,
  messages,
  cosmetics = SAMPLE_COSMETICS,
  width,
  height,
  scale = PREVIEW_SCALE_DEFAULT,
}: {
  /** The overlay query string, from the tool's own serializer. */
  query: string;
  /** Fixtures to render, in display order. Built-ins plus any custom ones. */
  messages: readonly UnifiedMessage[];
  /** 7TV fixtures the conversion draws on. Defaults to the sample set. */
  cosmetics?: MessageCosmetics;
  /** Canonical OBS width the tool declares, for the frame's aspect ratio. */
  width: number;
  /** Canonical OBS height the tool declares, for the frame's aspect ratio. */
  height: number;
  /**
   * Preview-only zoom, as a percentage. Passed straight to the frame and never
   * to the overlay: `config` is built from the serialized query and this is not
   * part of it, so nothing the renderer receives changes with the zoom.
   */
  scale?: number;
}) {
  const config = useMemo(() => configFromQuery(query), [query]);

  /* One conversion pass produces both the list and the pin, and the order within
     it matters.

     `buildParsedMessage` records each author's resolved colour in the shared
     mention context as it goes, and a mention only takes a colour if that chatter
     has already been seen — exactly as in a live stream, where the map fills as
     people talk. Converting in display order through one context is therefore what
     makes the mention sample render coloured; a fresh context per message would
     silently show plain text instead. The pin is converted in this same pass for
     that reason, not just for tidiness.

     The filter runs first, for the same reason it runs before ChatOverlay on the
     real route: botNames, userBL and prefixBL are applied while messages arrive,
     so a preview that skipped them would happily display a blacklisted name. */
  const { parsed, pinnedMessage } = useMemo<{
    parsed: ParsedMessage[];
    pinnedMessage: PinnedState | null;
  }>(() => {
    if (!config) return { parsed: [], pinnedMessage: null };
    const shouldDisplay = buildMessageFilter(config);
    const mentions = { enabled: config.mentionColor, colors: new Map<string, string>() };

    /* ChatOverlay takes the pin as a separate prop, so the designated fixture is
       converted in place below and then held out of the list. Holding it out is a
       preview decision rather than a copy of route behaviour: live, a pinned
       message usually also sits in the scrollback, but showing the same invented
       line twice on a small surface reads as a rendering bug. Switching the pin
       setting off returns it to the list as an ordinary message, so the sample
       count stays stable either way.

       Both of the route's gates are reproduced — showPinEnabled, and whether the
       pin's platform is still selected. Without the second, the pin-platform
       setting would appear to do nothing here while working in OBS.

       Only the fixture bearing SAMPLE_PIN_ID is eligible; custom messages use
       their own id namespace, so none can accidentally become the pin. */
    const pinCandidate = messages.find((message) => message.id === SAMPLE_PIN_ID) ?? null;
    const pinVisible =
      pinCandidate !== null &&
      config.showPinEnabled &&
      config.pinPlatforms.includes(pinCandidate.platform);

    const out: ParsedMessage[] = [];
    let pin: PinnedState | null = null;
    for (const message of messages) {
      if (!shouldDisplay(message)) continue;
      /* The fixture's own fixed timestamp, never Date.now() — the preview must
         paint identically on every render and in every test run. */
      const built = buildParsedMessage(message, config, cosmetics, mentions, message.timestamp);
      if (pinVisible && message === pinCandidate) {
        pin = { msg: built, pinnedBy: SAMPLE_PIN_BY };
        continue;
      }
      out.push(built);
    }
    return { parsed: out, pinnedMessage: pin };
  }, [config, messages, cosmetics]);

  if (!config) {
    /* Only reachable if the serializer emitted something its own parser rejects,
       which would be a real defect worth surfacing rather than hiding behind an
       empty preview — the generated URL would not load either. */
    return (
      <p className="preview-empty" role="status">
        These settings did not parse. That is a bug — the generated URL would not
        load either.
      </p>
    );
  }

  return (
    /* Labelled, as the live iframe is labelled by its title. Without this a
       screen reader reads a dozen lines of invented chat with nothing saying they
       are samples rather than a real stream. A group rather than a region: a
       labelled grouping inside the preview, not a landmark worth its own entry in
       the landmark list. */
    <div
      role="group"
      aria-label="Preview data — sample chat messages, not a live stream"
      data-testid="chat-fixture-preview"
    >
      <IsolatedPreviewFrame
        title="MultiChat sample preview"
        width={width}
        height={height}
        scale={scale}
        testId="chat-preview-frame"
      >
        <ChatOverlay
          /* ChatOverlay keeps batch identity by message id but resolves each row
             from the newest ParsedMessage, so conversion-time setting and resource
             changes repaint in place without replaying entrance animations. */
          config={config}
          messages={parsed}
          fadingIds={EMPTY_FADING}
          pinnedMessage={pinnedMessage}
          /* The samples are present from first paint, so a spinner would be a
             lie — there is nothing to connect to and nothing to wait for. */
          showLoader={false}
          /* The generator always holds a real sourceTag choice, but the serializer
             omits sourceTag=icon as its default. Relying on the round trip alone
             would silently turn an explicit 'icon' selection into the legacy
             single-platform fallback of showing no marker at all. */
          sourceTagExplicit
          sourceTagOverride="icon"
        />
      </IsolatedPreviewFrame>
    </div>
  );
}
