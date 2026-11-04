
import { useMemo } from 'react';
import ChatOverlay from '@/components/overlay/ChatOverlay';
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
import { SAMPLE_COSMETICS } from '@/features/multichat/samples';

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

  const parsed = useMemo<ParsedMessage[]>(() => {
    if (!config) return [];

    const shouldDisplay =
      buildMessageFilter(config);

    const mentions = {
      enabled: config.mentionColor,
      colors: new Map<string, string>(),
    };

    const out: ParsedMessage[] = [];

    for (const message of messages) {
      if (!shouldDisplay(message)) continue;

      out.push(
        buildParsedMessage(
          message,
          config,
          cosmetics,
          mentions,
          message.timestamp,
        ),
      );
    }

    return out;
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
