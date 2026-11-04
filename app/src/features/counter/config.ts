/* Viewer Counter tool descriptor.
 *
 * This module adapts the existing lib/viewerCounterConfig for the workspace.
 * It does NOT reimplement or relocate it: /counter and the current generator
 * keep importing lib/viewerCounterConfig directly, and this descriptor calls
 * the very same serializer, so a URL built here is byte-identical to one built
 * by the existing generator.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import {
  DEFAULT_STYLE,
  PLATFORM_ORDER,
  buildViewerCounterQuery,
  normalizeChannel,
  normalizeCounterStyle,
  type ViewerCounterStyle,
  type ViewerPlatform,
} from '@/lib/viewerCounterConfig';
import type { OverlayTool, ToolChannels, ToolPlatform } from '../registry';
import { COUNTER_CATALOG } from './settings';

/** Re-exported for workspace code so it has one import site for counter types. */
export type { ViewerCounterStyle, ViewerPlatform };
export { DEFAULT_STYLE, PLATFORM_ORDER, normalizeChannel };

/**
 * The style normalizer, re-exported from the authoritative module.
 *
 * It used to be defined here. It moved because `buildViewerCounterQuery` now
 * applies it itself — a partial style previously serialized as the literal
 * string 'undefined' — and the serializer cannot import from this file without a
 * cycle. Re-exported rather than replaced so existing import sites and tests are
 * unchanged, and so there is still exactly one set of fallbacks.
 */
export { normalizeCounterStyle };

/** Platforms whose typed channel normalizes to a usable name, in display order. */
export function configuredCounterPlatforms(
  channels: ToolChannels<ViewerPlatform>,
): ViewerPlatform[] {
  return PLATFORM_ORDER.filter((platform) =>
    Boolean(normalizeChannel(channels[platform])),
  );
}

/** Field labels, unchanged from the ones the channel panel used to hold. */
const PLATFORM_LABEL: Record<ViewerPlatform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick',
  tiktok: 'TikTok',
};

/**
 * Channel inputs, ordered by the overlay's own PLATFORM_ORDER.
 *
 * Derived rather than written out again, so display order, serialization order,
 * and poll-key order cannot drift apart. Every platform validates with the
 * overlay's own normalizeChannel — no second rule.
 */
export const COUNTER_PLATFORMS: readonly ToolPlatform<ViewerPlatform>[] =
  PLATFORM_ORDER.map((key) => ({
    key,
    label: PLATFORM_LABEL[key],
    placeholder: 'channel name',
    normalize: normalizeChannel,
    invalidMessage: 'Only letters, numbers, "." "_" "-" (max 50 chars).',
  }));

export const counterTool: OverlayTool<ViewerCounterStyle, ViewerPlatform> = {
  id: 'counter',
  label: 'Viewer Counter',
  overlayRoute: '/counter',
  platforms: COUNTER_PLATFORMS,
  catalog: COUNTER_CATALOG,
  defaults: DEFAULT_STYLE,
  normalize: normalizeCounterStyle,
  /* The overlay's own serializer, unmodified — this is what guarantees the
     workspace and the existing generator produce identical URLs. */
  serialize: (channels, style) => buildViewerCounterQuery(channels, style),
  configuredPlatforms: configuredCounterPlatforms,
  /* Matches the fixed 34 px type plus the overlay's 8 px padding; width is the
     common single-row browser-source size used in the existing docs. */
  obs: { width: 400, height: 80 },
  /* Both states, for the same reason as the chat note: sample counts before a
     channel exists, the real polling overlay after one does. */
  previewNote:
    'Sample counts until you enter a channel, so every setting is visible straight away. Once a channel is set this becomes a real /counter overlay at the exact URL below, polling live counts like any browser source.',
};
