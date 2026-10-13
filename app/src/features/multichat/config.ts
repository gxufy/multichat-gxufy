/* MultiChat tool descriptor — registered, and hosted at /tools/multichat.
 *
 * This adapts the existing MultiChat generator for the workspace shell the way
 * lib/tools/counter/config.ts adapts the viewer counter. Defaults come from
 * MULTICHAT_WORKSPACE_DEFAULTS, enums come from lib/multichatConfig, and
 * `serialize` calls buildMultichatQuery.
 *
 * Pins are retired. The legacy style fields remain in the type/config boundary
 * for compatibility, but normalization always forces them off and this tool no
 * longer contributes a Twitch connection fragment to generated URLs.
 *
 * Browser-safe — no server-only imports. 
 */
import {
  MULTICHAT_ANIMATIONS,
  MULTICHAT_ENTRY_ANIMATIONS,
  MULTICHAT_FONTS,
  MULTICHAT_FONT_WEIGHTS,
  MULTICHAT_GENERATOR_DEFAULT_CHANNELS,
  MULTICHAT_PLATFORMS,
  MULTICHAT_SOURCE_TAGS,
  MULTICHAT_REPLY_STYLES,
  MULTICHAT_STROKES,
  MULTICHAT_TEXT_SHADOWS,
  MULTICHAT_TEXT_SIZES,
  MULTICHAT_TEXT_TRANSFORMS,
  MULTICHAT_WORKSPACE_DEFAULTS,
  buildMultichatQuery,
  normalizeMultichatTextSizePx,
  type MultichatAnimation,
  type MultichatChannels,
  type MultichatFont,
  type MultichatEntryAnimation,
  type MultichatFontWeight,
  type MultichatPlatform,
  type MultichatStroke,
  type MultichatTextShadow,
  type MultichatTextSize,
  type MultichatTextTransform,
  type MultichatWorkspaceStyle,
} from '@/lib/multichatConfig';
import { normalizeBadgeLayout } from '@/lib/badgeLayout';
import type { OverlayTool, ToolChannels, ToolPlatform } from '../registry';
import { MULTICHAT_HELP } from './help';
import { MULTICHAT_OBS_SIZE } from './obs';
import {
  EMPTY_MULTICHAT_RUNTIME,
  multichatOptionAvailability,
  syncMultichatStyle,
  type MultichatRuntime,
} from './runtime';
import { MULTICHAT_CATALOG } from './settings';

export type { MultichatPlatform, MultichatWorkspaceStyle };

/** Channel state as the workspace holds it, before adapting for the serializer. */
export type MultichatToolChannels = ToolChannels<MultichatPlatform>;

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */

/** Labels and placeholders exactly as the existing generator shows them. */
const PLATFORM_FIELD: Record<
  MultichatPlatform,
  { label: string; placeholder: string }
> = {
  kick: { label: 'Kick', placeholder: 'Channel name' },
  twitch: { label: 'Twitch', placeholder: 'Channel name' },
  youtube: { label: 'YouTube', placeholder: '@handle' },
  tiktok: { label: 'TikTok', placeholder: '@username' },
};

/** Kick keeps a leading '@' — trim only. Matches buildMultichatQuery. */
export function normalizeKickChannel(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/** The other three strip one leading '@' after trimming. */
export function normalizeAtChannel(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^@/, '') : '';
}

export const MULTICHAT_PLATFORM_DEFS: readonly ToolPlatform<MultichatPlatform>[] =
  MULTICHAT_PLATFORMS.map((key) => ({
    key,
    label: PLATFORM_FIELD[key].label,
    placeholder: PLATFORM_FIELD[key].placeholder,
    normalize: key === 'kick' ? normalizeKickChannel : normalizeAtChannel,
  }));

/** Platforms whose typed channel is non-empty once normalized, in field order. */
export function configuredMultichatPlatforms(
  channels: MultichatToolChannels,
): MultichatPlatform[] {
  return MULTICHAT_PLATFORM_DEFS.filter((platform) =>
    Boolean(platform.normalize(channels[platform.key])),
  ).map((platform) => platform.key);
}

/** Widen workspace channel state into the complete shape the serializer takes. */
export function toMultichatChannels(
  channels: MultichatToolChannels,
): MultichatChannels {
  return {
    kick: channels.kick ?? MULTICHAT_GENERATOR_DEFAULT_CHANNELS.kick,
    twitch: channels.twitch ?? MULTICHAT_GENERATOR_DEFAULT_CHANNELS.twitch,
    youtube: channels.youtube ?? MULTICHAT_GENERATOR_DEFAULT_CHANNELS.youtube,
    tiktok: channels.tiktok ?? MULTICHAT_GENERATOR_DEFAULT_CHANNELS.tiktok,
  };
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

/** Keep a boolean, else take the generator default. */
function keepBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Keep a string, else take the generator default. */
function keepString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Keep an enum member, else take the generator default. */
function keepEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/**
 * Coerce partial workspace state into a complete valid generator style.
 * Retired pin fields are forced off even when an old saved draft contains them.
 */
export function normalizeMultichatStyle(
  style: Partial<MultichatWorkspaceStyle> & {
    entryAnimation?: unknown;
    msgSlideIn?: unknown;
  },
): MultichatWorkspaceStyle {
  const d = MULTICHAT_WORKSPACE_DEFAULTS;
  const textSizePx = normalizeMultichatTextSizePx(style.textSizePx);
  const textTransform = keepEnum(
    style.textTransform,
    MULTICHAT_TEXT_TRANSFORMS,
    style.msgCaps === true ? 'uppercase' : d.textTransform,
  );
  return {
    sevenTVEmotesEnabled: keepBoolean(style.sevenTVEmotesEnabled, d.sevenTVEmotesEnabled),
    sevenTVCosmeticsEnabled: keepBoolean(
      style.sevenTVCosmeticsEnabled,
      d.sevenTVCosmeticsEnabled,
    ),
    showCommunityBadges: keepBoolean(style.showCommunityBadges, d.showCommunityBadges),
    ...(normalizeBadgeLayout(style.badgeLayout)
      ? { badgeLayout: normalizeBadgeLayout(style.badgeLayout) }
      : {}),
    textSize: keepEnum(style.textSize, MULTICHAT_TEXT_SIZES, d.textSize as MultichatTextSize),
    textSizePx: textSizePx === null ? d.textSizePx : String(textSizePx),
    font: keepEnum(style.font, MULTICHAT_FONTS, d.font as MultichatFont),
    googleFont: keepString(style.googleFont, d.googleFont),
    fontWeight: keepEnum(
      style.fontWeight,
      MULTICHAT_FONT_WEIGHTS,
      d.fontWeight as MultichatFontWeight,
    ),
    textShadow: keepEnum(
      style.textShadow,
      MULTICHAT_TEXT_SHADOWS,
      d.textShadow as MultichatTextShadow,
    ),
    stroke: keepEnum(style.stroke, MULTICHAT_STROKES, d.stroke as MultichatStroke),
    animation: keepEnum(
      style.animation,
      MULTICHAT_ANIMATIONS,
      d.animation as MultichatAnimation,
    ),
    entryAnimation: (MULTICHAT_ENTRY_ANIMATIONS as readonly unknown[]).includes(
      style.entryAnimation,
    )
      ? style.entryAnimation as MultichatEntryAnimation
      : style.msgSlideIn === true
        ? 'slideRight'
        : d.entryAnimation,
    fade: keepString(style.fade, d.fade),
    fadeEnabled: keepBoolean(style.fadeEnabled, d.fadeEnabled),
    showPinEnabled: false,
    sourceTag: keepEnum(style.sourceTag, MULTICHAT_SOURCE_TAGS, d.sourceTag),
    mentionColor: keepBoolean(style.mentionColor, d.mentionColor),
    bgColor: keepString(style.bgColor, d.bgColor),
    emoteScale: keepString(style.emoteScale, d.emoteScale),
    gifs: keepBoolean(style.gifs, d.gifs),
    gifSize: keepString(style.gifSize, d.gifSize),
    msgBold: keepBoolean(style.msgBold, d.msgBold),
    msgCaps: textTransform === 'uppercase',
    textTransform: textTransform as MultichatTextTransform,
    fontItalic: keepBoolean(style.fontItalic, d.fontItalic),
    smoothScroll: keepBoolean(style.smoothScroll, d.smoothScroll),
    sharedChatEnabled: keepBoolean(style.sharedChatEnabled, d.sharedChatEnabled),
    replyStyle: keepEnum(style.replyStyle, MULTICHAT_REPLY_STYLES, d.replyStyle),
    restoreOnReload: keepBoolean(style.restoreOnReload, d.restoreOnReload),
    maxMessageLines: keepString(style.maxMessageLines, d.maxMessageLines),
    maxMessageAge: keepString(style.maxMessageAge, d.maxMessageAge),
    showSystemMsgs: keepBoolean(style.showSystemMsgs, d.showSystemMsgs),
    showFirstMessages: keepBoolean(style.showFirstMessages, d.showFirstMessages),
    showRedeems: keepBoolean(style.showRedeems, d.showRedeems),
    modAction: keepBoolean(style.modAction, d.modAction),
    paintShadows: keepBoolean(style.paintShadows, d.paintShadows),
    fontColor: keepString(style.fontColor, d.fontColor),
    pinPlatforms: [],
    hideNames: keepBoolean(style.hideNames, d.hideNames),
    botNames: keepString(style.botNames, d.botNames),
    userBL: keepString(style.userBL, d.userBL),
    prefixBL: keepString(style.prefixBL, d.prefixBL),
  };
}

/** Retired compatibility helper. Pin selections always normalize to empty. */
export function normalizePinPlatforms(
  _value: unknown,
): readonly MultichatPlatform[] {
  return [];
}

/* ------------------------------------------------------------------ */
/* Descriptor                                                          */
/* ------------------------------------------------------------------ */

export const multichatTool: OverlayTool<
  MultichatWorkspaceStyle,
  MultichatPlatform,
  MultichatRuntime
> = {
  id: 'multichat',
  label: 'MultiChat',
  overlayRoute: '/multichat',
  platforms: MULTICHAT_PLATFORM_DEFS,
  catalog: MULTICHAT_CATALOG,
  defaults: MULTICHAT_WORKSPACE_DEFAULTS,
  normalize: normalizeMultichatStyle,
  serialize: (channels, style) =>
    buildMultichatQuery(toMultichatChannels(channels), style),
  configuredPlatforms: configuredMultichatPlatforms,
  obs: MULTICHAT_OBS_SIZE,
  previewNote:
    'Sample messages until you enter a channel, so you can judge every setting straight away. Once a channel is set this becomes a real /multichat overlay at the exact URL below, showing that channel’s actual messages — and staying empty while it is offline or quiet.',
  help: MULTICHAT_HELP,
  runtime: {
    initial: EMPTY_MULTICHAT_RUNTIME,
    sync: syncMultichatStyle,
    fromChannels: (runtime, channels) => {
      const next = normalizeAtChannel(channels.twitch);
      return next === runtime.twitchChannel ? runtime : { ...runtime, twitchChannel: next };
    },
    optionAvailability: multichatOptionAvailability,
  },
};
