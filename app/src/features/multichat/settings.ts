/* MultiChat workspace control catalog.
 *
 * One entry per current user-adjustable field of MultichatWorkspaceStyle. Every
 * default is read from MULTICHAT_WORKSPACE_DEFAULTS rather than written out,
 * and every option list comes from a tuple lib/multichatConfig exports.
 *
 * `sourceTag` is a four-option select here, not the legacy `platformIcons`
 * boolean: generator state carries the full enum the overlay implements.
 *
 * RETIRED / HIDDEN:
 *   - showPinEnabled and pinPlatforms remain addressable descriptors because the
 *     Classic layout resolves every descriptor at module scope, but both are
 *     hidden. ClassicSetting honors `hidden` by returning null, so no pin control
 *     is shown while old internal lookups remain safe.
 *   - ttsEnabled and showAvatars are parser compatibility fields and are not
 *     catalog settings.
 *   - Channel fields are platform descriptors, not settings.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import {
  MULTICHAT_ANIMATIONS,
  MULTICHAT_ENTRY_ANIMATIONS,
  MULTICHAT_FONTS,
  MULTICHAT_FONT_WEIGHTS,
  MULTICHAT_PLATFORMS,
  MULTICHAT_REPLY_STYLES,
  MULTICHAT_SOURCE_TAG_ORDER,
  MULTICHAT_STROKES,
  MULTICHAT_TEXT_SHADOWS,
  MULTICHAT_TEXT_SIZES,
  MULTICHAT_TEXT_TRANSFORMS,
  MULTICHAT_WORKSPACE_DEFAULTS as D,
  type MultichatWorkspaceStyle,
} from '@/lib/multichatConfig';
import {
  optionsFrom,
  titleCase,
  type SettingCatalog,
  type SettingOption,
} from '@/lib/tools/settingTypes';
import {
  FONT_WEIGHT_LABELS,
  OVERLAY_FONT_LABELS,
  TEXT_TRANSFORM_LABELS,
} from '@/lib/overlayFonts';

const MULTICHAT_FONT_OPTIONS: readonly SettingOption[] = optionsFrom(
  MULTICHAT_FONTS,
  (value) => OVERLAY_FONT_LABELS[value] ?? titleCase(value),
);

/** Retained only for the hidden compatibility pin descriptor. */
const PIN_OPTIONS: readonly SettingOption[] = optionsFrom(
  MULTICHAT_PLATFORMS,
  titleCase,
);

/** Platform tag modes, in workspace display order: icon, dot, label, none. */
const SOURCE_TAG_LABEL: Record<string, string> = {
  icon: 'Platform icon',
  dot: 'Colored dot',
  label: 'Platform name',
  none: 'Off',
};

const SOURCE_TAG_OPTIONS: readonly SettingOption[] = optionsFrom(
  MULTICHAT_SOURCE_TAG_ORDER,
  (value) => SOURCE_TAG_LABEL[value] ?? titleCase(value),
);

const REPLY_STYLE_LABEL: Record<string, string> = {
  full: 'Full',
  mention: '@mention',
  off: 'Off',
};

const REPLY_STYLE_OPTIONS: readonly SettingOption[] = optionsFrom(
  MULTICHAT_REPLY_STYLES,
  (value) => REPLY_STYLE_LABEL[value] ?? titleCase(value),
);

const ENTRY_ANIMATION_LABEL: Record<string, string> = {
  none: 'Off',
  slideRight: 'From right',
  slideLeft: 'From left',
};

const ENTRY_ANIMATION_OPTIONS: readonly SettingOption[] = optionsFrom(
  MULTICHAT_ENTRY_ANIMATIONS,
  (value) => ENTRY_ANIMATION_LABEL[value] ?? titleCase(value),
);

/** 'Off' reads better than 'None' on these two, matching the generator. */
const offFirst = (value: string) => (value === 'none' ? 'Off' : titleCase(value));

/** Appearance and behaviour controls, in display order. */
export const MULTICHAT_CATALOG: SettingCatalog<MultichatWorkspaceStyle> = [
  {
    key: 'textSize',
    param: 'textSize',
    type: 'select',
    label: 'Size',
    options: optionsFrom(MULTICHAT_TEXT_SIZES, titleCase),
    default: D.textSize,
  },
  {
    key: 'textSizePx',
    param: 'textSizePx',
    type: 'text',
    label: 'Text Size',
    description: 'Set chat text between 24 and 64 pixels. Legacy preset URLs keep their original geometry.',
    placeholder: '34',
    default: D.textSizePx,
    hidden: true,
  },
  {
    key: 'font',
    param: 'font',
    type: 'select',
    label: 'Font',
    options: MULTICHAT_FONT_OPTIONS,
    default: D.font,
  },
  {
    key: 'googleFont',
    param: 'googleFont',
    type: 'text',
    label: 'Google font',
    description: 'Optional Google Fonts family name. When set, this overrides the preset Font above.',
    placeholder: 'Press Start 2P',
    default: D.googleFont,
  },
  {
    key: 'fontWeight',
    param: 'fontWeight',
    type: 'select',
    label: 'Style',
    options: optionsFrom(
      MULTICHAT_FONT_WEIGHTS,
      (value) => FONT_WEIGHT_LABELS[value] ?? value,
    ),
    default: D.fontWeight,
  },
  {
    key: 'textTransform',
    param: 'textTransform',
    type: 'select',
    label: 'Transform',
    options: optionsFrom(
      MULTICHAT_TEXT_TRANSFORMS,
      (value) => TEXT_TRANSFORM_LABELS[value] ?? titleCase(value),
    ),
    default: D.textTransform,
  },
  {
    key: 'fontItalic',
    param: 'fontItalic',
    type: 'toggle',
    label: 'Enable Italic',
    description: 'Apply an italic or slanted style to chat text.',
    default: D.fontItalic,
  },
  {
    key: 'stroke',
    param: 'stroke',
    type: 'select',
    label: 'Stroke',
    options: optionsFrom(MULTICHAT_STROKES, offFirst),
    default: D.stroke,
  },
  {
    key: 'textShadow',
    param: 'textShadow',
    type: 'select',
    label: 'Shadow',
    options: optionsFrom(MULTICHAT_TEXT_SHADOWS, offFirst),
    default: D.textShadow,
  },
  {
    key: 'animation',
    param: 'animation',
    type: 'select',
    label: 'Animation',
    options: optionsFrom(MULTICHAT_ANIMATIONS, (value) =>
      value === 'fade' ? 'Fade in' : titleCase(value),
    ),
    default: D.animation,
  },
  {
    key: 'entryAnimation',
    param: 'entryAnimation',
    type: 'select',
    label: 'New message entrance',
    description: 'Optional full-width spring entrance applied separately from the main animation.',
    options: ENTRY_ANIMATION_OPTIONS,
    default: D.entryAnimation,
  },
  {
    key: 'emoteScale',
    param: 'emoteScale',
    type: 'text',
    label: 'Emote scale (0–3)',
    description: 'Blank uses the overlay default.',
    placeholder: '1.0',
    default: D.emoteScale,
  },
  {
    key: 'gifs',
    param: 'gifs',
    type: 'toggle',
    label: 'Twitch GIFs',
    description: 'Display Twitch native GIF-tag messages. Off keeps the provider fallback text.',
    default: D.gifs,
  },
  {
    key: 'gifSize',
    param: 'gifSize',
    type: 'text',
    label: 'GIF size (px)',
    description: 'Maximum Twitch GIF height in pixels. Used only while Twitch GIFs is on.',
    placeholder: '100',
    default: D.gifSize,
  },
  {
    key: 'sevenTVEmotesEnabled',
    param: 'sevenTVEmotesEnabled',
    type: 'toggle',
    label: '7TV Emotes',
    default: D.sevenTVEmotesEnabled,
  },
  {
    key: 'sevenTVCosmeticsEnabled',
    param: 'sevenTVCosmeticsEnabled',
    type: 'toggle',
    label: '7TV Cosmetics',
    default: D.sevenTVCosmeticsEnabled,
  },
  {
    key: 'showCommunityBadges',
    param: 'showCommunityBadges',
    type: 'toggle',
    label: 'Show community badges',
    description: 'Show third-party badges from Chatterino, FFZ community badges, Chatterino Homies, Moltorino and similar registries. Native platform badges such as Moderator, VIP, Subscriber and Broadcaster are unaffected.',
    default: D.showCommunityBadges,
  },
  {
    key: 'fadeEnabled',
    param: 'fade',
    type: 'toggle',
    label: 'Fade out old messages',
    description: 'Off removes the parameter entirely.',
    default: D.fadeEnabled,
  },
  {
    key: 'fade',
    param: 'fade',
    type: 'text',
    label: 'Fade after (seconds)',
    description: 'Only used while Fade out old messages is on.',
    placeholder: '30',
    default: D.fade,
  },
  {
    key: 'msgBold',
    param: 'msgBold',
    type: 'toggle',
    label: 'Bold messages',
    default: D.msgBold,
  },
  {
    key: 'msgCaps',
    param: 'msgCaps',
    type: 'toggle',
    label: 'UPPERCASE messages',
    default: D.msgCaps,
    hidden: true,
  },
  {
    key: 'smoothScroll',
    param: 'smoothScroll',
    type: 'toggle',
    label: 'Smooth message scroll',
    description: 'Default message handling: smooth for ordinary arrivals, instant during rapid bursts so animations never pile up.',
    default: D.smoothScroll,
  },
  {
    key: 'sharedChatEnabled',
    param: 'sharedChatEnabled',
    type: 'toggle',
    label: 'Twitch Shared Chat',
    description: 'Off ignores partner Shared Chat messages. On includes them and identifies each Twitch source streamer by profile picture only.',
    default: D.sharedChatEnabled,
  },
  {
    key: 'replyStyle',
    param: 'replyStyle',
    type: 'select',
    label: 'Reply style',
    description: 'Full keeps the existing reply context line. @mention prefixes the replied-to username. Off hides reply context.',
    options: REPLY_STYLE_OPTIONS,
    default: D.replyStyle,
  },
  {
    key: 'restoreOnReload',
    param: 'restoreOnReload',
    type: 'toggle',
    label: 'Restore messages on reload',
    description: 'Keeps recent messages in this browser-source tab and restores them after a reload.',
    default: D.restoreOnReload,
  },
  {
    key: 'maxMessageLines',
    param: 'maxMessageLines',
    type: 'text',
    label: 'Restore message limit',
    description: 'Maximum number of recent messages kept for reload restoration (1-100).',
    placeholder: '100',
    default: D.maxMessageLines,
  },
  {
    key: 'maxMessageAge',
    param: 'maxMessageAge',
    type: 'text',
    label: 'Restore max age (seconds)',
    description: 'Only restore messages this recent. Blank or 0 means unlimited.',
    placeholder: 'Unlimited',
    default: D.maxMessageAge,
  },
  {
    key: 'showSystemMsgs',
    param: 'showSystemMsgs',
    type: 'toggle',
    label: 'Platform event popups',
    description: 'Show platform-generated event cards such as subscriptions, gifts, Super Chats, memberships, follows, shares, hosts and announcements. Applies across every connected platform that exposes those events.',
    default: D.showSystemMsgs,
  },
  {
    key: 'showFirstMessages',
    param: 'showFirstMessages',
    type: 'toggle',
    label: 'First messages',
    description: 'Twitch uses the provider’s real first-message flag. Kick, YouTube and TikTok use the chatter’s first live message observed since this overlay loaded.',
    default: D.showFirstMessages,
  },
  {
    key: 'showRedeems',
    param: 'showRedeems',
    type: 'toggle',
    label: 'Channel point / reward redeems',
    description: 'Show highlighted channel-point and reward redemption messages where supported (currently Twitch and Kick).',
    default: D.showRedeems,
  },
  {
    key: 'modAction',
    param: 'modAction',
    type: 'toggle',
    label: 'Moderation actions',
    description: 'Deletions, timeouts, bans and clears remove messages from the overlay.',
    default: D.modAction,
  },
  {
    key: 'paintShadows',
    param: 'paintShadows',
    type: 'toggle',
    label: 'Paint shadows',
    description: 'Shadows on 7TV paints — may cost performance.',
    default: D.paintShadows,
  },
  {
    key: 'hideNames',
    param: 'hideNames',
    type: 'toggle',
    label: 'Hide usernames',
    default: D.hideNames,
  },
  {
    key: 'showPinEnabled',
    param: 'showPinEnabled',
    type: 'toggle',
    label: 'Pinned messages',
    description: 'Retired compatibility setting. Pins are disabled.',
    hidden: true,
    disabled: true,
    default: D.showPinEnabled,
  },
  {
    key: 'pinPlatforms',
    param: 'pinPlatforms',
    type: 'multiselect',
    label: 'Pins from',
    description: 'Retired compatibility setting. Pins are disabled.',
    options: PIN_OPTIONS,
    hidden: true,
    disabled: true,
    default: D.pinPlatforms,
  },
  {
    key: 'sourceTag',
    param: 'sourceTag',
    type: 'select',
    label: 'Platform tag',
    description: 'Colored dot, Platform name, and Off apply exactly as chosen. Platform icon keeps the original URL format, where a single configured platform shows no marker; with several platforms, icons identify each message’s source.',
    options: SOURCE_TAG_OPTIONS,
    default: D.sourceTag,
  },
  {
    key: 'mentionColor',
    param: 'mentionColor',
    type: 'toggle',
    label: 'Colored mentions',
    description: 'Highlight @mentions in the mentioned user’s name color. They must have chatted before.',
    default: D.mentionColor,
  },
  {
    key: 'bgColor',
    param: 'bgColor',
    type: 'color',
    label: 'Background',
    description: 'Blank is transparent, the default.',
    allowTransparent: true,
    default: D.bgColor,
  },
  {
    key: 'fontColor',
    param: 'fontColor',
    type: 'color',
    label: 'Text Colour',
    description: 'Blank uses the overlay default.',
    allowTransparent: true,
    default: D.fontColor,
  },
  {
    key: 'botNames',
    param: 'botNames',
    type: 'text',
    label: 'Extra bots to hide (comma-separated)',
    placeholder: 'nightbot, streamelements…',
    default: D.botNames,
  },
  {
    key: 'userBL',
    param: 'userBL',
    type: 'text',
    label: 'Username blacklist (space-separated)',
    placeholder: 'spammer1 botuser',
    default: D.userBL,
  },
  {
    key: 'prefixBL',
    param: 'prefixBL',
    type: 'text',
    label: 'Message-prefix blacklist (space-separated)',
    placeholder: 'https:// scam ',
    default: D.prefixBL,
  },
];
