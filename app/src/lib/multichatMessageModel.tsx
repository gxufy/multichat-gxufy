/* UnifiedMessage → ParsedMessage: the one place that conversion happens.
 *
 * This was previously a closure inside the overlay route's connect effect, which
 * meant nothing else could perform the conversion without reimplementing it.
 * Five appearance settings are applied *here* rather than in ChatOverlay:
 *
 *   sevenTVEmotesEnabled     decides whether community emotes are swapped into
 *                            the text at all (by passing an empty emote list)
 *   sevenTVCosmeticsEnabled  decides whether a paint or 7TV badge is attached
 *   showCommunityBadges      decides whether community badge nodes
 *                            are rendered while leaving native badges untouched
 *   hideBadges               drops every badge (usernames only); paints stay
 *   paintShadows             decides whether a paint contributes drop-shadows
 *   mentionColor             decides whether @tokens become coloured strongs
 *
 * A caller that skipped this step and built ParsedMessage values by hand would
 * therefore be unable to respond to any of those settings, however faithfully it
 * copied the rest. That is why the generator's preview renders fixtures through
 * this function instead of shipping pre-rendered nodes: the settings have to pass
 * through the same code on the way to the screen.
 *
 * `timestamp` is a parameter rather than a `Date.now()` call, so a
 * deterministic caller can supply a fixed instant; the overlay passes
 * `Date.now()`.
 *
 * Browser-safe — no server-only imports, no secrets, no network.
 */
import { buildJilTVPaintStyle } from './jiltvCosmeticsContract';
import { shownPaintSource } from './paintChoice';
import {
  type ParsedMessage,
  type SevenTVBadge,
  type SevenTVEmote,
  type SevenTVPaint,
} from './kick';
import {
  badgeParts,
  fallbackColor,
  isYouTubeOwner,
  messageTextParts,
  readableColor,
  type MentionContext,
} from './renderCore';
import { el, fragment, type ChatElement, type ChatPart } from './render/elementTree';
import { runtimeEventMessageVisible } from './multichatEventRuntime';
import { ensureStartupDebugPanel, reportStartupAcceptedMessage } from './startupDebug';
import { DEFAULT_TWITCH_GIF_SIZE_PX, twitchGifPart } from './twitchGif';
import type { Platform, UnifiedMessage } from './types';
import { badgeProviderFromType, parseBadgeLayout } from './badgeLayout';
import { applyViewerBadgeLayout, viewerBadgeSlot, type ViewerBadgeSlot } from './viewerBadgeLayout';
import { withPersonalEmotes } from './sevenTVPersonalEmotes';
import {
  NO_COSMETICS,
  buildPaintStyle,
  type MessageCosmetics,
  type ThirdPartyEmoteCatalog,
} from './messageCosmetics';

/* The cosmetics data and paint CSS live in messageCosmetics.ts, so
   pages that only need them do not load the overlay renderer. Re-exported here
   for existing callers. */
export { NO_COSMETICS, buildPaintStyle, type MessageCosmetics, type ThirdPartyEmoteCatalog };

/** The subset of overlay configuration that changes how a message is built. */
export type MessageStyleConfig = {
  sevenTVEmotesEnabled: boolean;
  sevenTVCosmeticsEnabled: boolean;
  /** Twitch emotes from JilTV. Omitted means off. */
  jiltvEmotesEnabled?: boolean;
  /** JilTV paints. Omitted means on. */
  jiltvCosmeticsEnabled?: boolean;
  /** Shadows on JilTV paints. Omitted means on. */
  jiltvPaintShadows?: boolean;
  /** Omitted means on, preserving existing callers and old overlay URLs. */
  showCommunityBadges?: boolean;
  /** Usernames only: no badges at all. Omitted means off. */
  hideBadges?: boolean;
  badgeLayout?: string;
  paintShadows: boolean;
  /** Retired query compatibility field; Twitch-supplied GIF metadata is always rendered. */
  gifs?: boolean;
  /** Independent Twitch GIF cap in pixels. */
  gifSize?: number;
};

/** The subset of overlay configuration that decides whether a message is shown. */
export type MessageFilterConfig = {
  /** Comma- or space-separated extra bot names to hide. */
  botNames: string;
  /** Comma- or space-separated built-in/extra bot names to permit. */
  permittedBots?: string;
  /** Space-separated usernames to hide. */
  userBL: string;
  /** Space-separated text prefixes to hide. */
  prefixBL: string;
  showSystemMsgs: boolean;
  showFirstMessages: boolean;
  showRedeems: boolean;
};

const KNOWN_BOTS: ReadonlySet<string> = new Set([
  'streamelements', 'streamlabs', 'nightbot', 'moobot',
  'titlechange_bot', 'supibot', 'pajbot', 'huwobot',
  'oshbt', 'spanixbot', 'potatbotat', 'streamqbot', 'twirapp',
  'fossabot', 'wizebot', 'botisimo', 'sery_bot', 'soundalerts',
]);

/* YouTube names arrive as "@Handle"; the same account on Twitch is "handle".
   Comparing without the "@" lets one bot list cover both. */
function chatNameKey(name: string): string {
  return name.trim().replace(/^@/, '').toLowerCase();
}

/**
 * Build the "should this message be displayed" predicate for a configuration.
 *
 * Kept outside the overlay's connect effect for the same reason as the
 * conversion above: these four settings — botNames, userBL, prefixBL, and the
 * system/redeem toggles — are applied *before* ChatOverlay ever sees a message,
 * so a preview that rendered a fixture list directly could not respond to any of
 * them. It would show a blacklisted name happily sitting on screen.
 *
 * Returns a fresh predicate rather than filtering a list, because the overlay
 * applies it to one arriving message at a time while the preview applies it to a
 * fixture array. Parsing the blacklists once per configuration rather than once
 * per message is deliberate.
 */
export function buildMessageFilter(
  cfg: MessageFilterConfig,
): (um: UnifiedMessage) => boolean {
  ensureStartupDebugPanel();
  const extraBots = new Set(
    (cfg.botNames || '')
      .split(',')
      .flatMap((b) => b.trim().split(' '))
      .map(chatNameKey)
      .filter(Boolean),
  );
  const permittedBots = new Set(
    (cfg.permittedBots || '')
      .split(',')
      .flatMap((b) => b.trim().split(/\s+/))
      .map(chatNameKey)
      .filter(Boolean),
  );
  /* Space-separated, matching the labels on both fields. */
  const userBlacklist = new Set(
    (cfg.userBL || '').split(/\s+/).map(chatNameKey).filter(Boolean),
  );
  const prefixBlacklist = (cfg.prefixBL || '').split(/\s+/).filter(Boolean);

  return (um: UnifiedMessage): boolean => {
    const names = [...new Set([
      um.senderUsername,
      um.senderDisplayName,
      um.username,
    ].map((value) => chatNameKey(value ?? '')).filter(Boolean))];
    if (names.some((name) => userBlacklist.has(name))) return false;
    const permitted = names.some((name) => permittedBots.has(name));
    if (!permitted && names.some((name) => KNOWN_BOTS.has(name) || extraBots.has(name))) return false;
    /* Prefixes apply to chat only: an event card's text is composed by the
       connector, not typed by the chatter, so blacklisting "!" should not hide a
       subscription. */
    if (um.kind === 'chat' && prefixBlacklist.some((p) => um.text.startsWith(p))) return false;
    if (!runtimeEventMessageVisible(um)) return false;
    if (um.kind === 'system' && !cfg.showSystemMsgs) return false;
    if (um.firstMessage && !cfg.showFirstMessages) return false;
    if (um.redeem && !cfg.showRedeems) return false;
    return true;
  };
}

function renderTwitchMessageBody(
  message: UnifiedMessage,
  emotes: SevenTVEmote[],
  mentions: MentionContext,
  gifSize: number,
): ChatPart[] {
  if (message.platform !== 'twitch' || message.kind !== 'chat') {
    return messageTextParts(message, emotes, mentions);
  }

  if (message.twitchGifs?.length) {
    const chars = Array.from(message.text);
    const nodes: ChatPart[] = [];
    let cursor = 0;
    const renderTextRange = (start: number, end: number, key: string) => {
      if (end <= start) return;
      const rangeMessage: UnifiedMessage = {
        ...message,
        text: chars.slice(start, end).join(''),
        emotes: message.emotes.flatMap((emote) => (
          emote.begin >= start && emote.end <= end
            ? [{ ...emote, begin: emote.begin - start, end: emote.end - start }]
            : []
        )),
        twitchGifs: undefined,
        gifUrl: undefined,
      };
      nodes.push(fragment(key, messageTextParts(rangeMessage, emotes, mentions)));
    };

    for (let index = 0; index < message.twitchGifs.length; index += 1) {
      const gif = message.twitchGifs[index];
      if (gif.start < cursor || gif.end <= gif.start || gif.end > chars.length) continue;
      renderTextRange(cursor, gif.start, `gif-text-${index}`);
      const image = twitchGifPart(gif.url, gifSize, `twitch-native-gif-${gif.id}-${index}`);
      if (image) nodes.push(image);
      else renderTextRange(gif.start, gif.end, `gif-fallback-${index}`);
      cursor = gif.end;
    }
    renderTextRange(cursor, chars.length, 'gif-text-tail');
    return nodes;
  }

  if (message.gifUrl) {
    const image = twitchGifPart(message.gifUrl, gifSize);
    if (image) return [image];
  }
  return messageTextParts(message, emotes, mentions);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const BADGES_BY_ID = new WeakMap<SevenTVBadge[], Map<string, SevenTVBadge>>();
const PAINTS_BY_ID = new WeakMap<SevenTVPaint[], Map<string, SevenTVPaint>>();
const READABLE_COLOR_CACHE_MAX = 256;
const READABLE_COLORS = new Map<string, string>();

function badgeById(badges: SevenTVBadge[], id: string): SevenTVBadge | undefined {
  let lookup = BADGES_BY_ID.get(badges);
  if (!lookup) {
    lookup = new Map<string, SevenTVBadge>();
    for (const badge of badges) if (!lookup.has(badge.id)) lookup.set(badge.id, badge);
    BADGES_BY_ID.set(badges, lookup);
  }
  return lookup.get(id);
}

function paintById(paints: SevenTVPaint[], id: string): SevenTVPaint | undefined {
  let lookup = PAINTS_BY_ID.get(paints);
  if (!lookup) {
    lookup = new Map<string, SevenTVPaint>();
    for (const paint of paints) if (!lookup.has(paint.id)) lookup.set(paint.id, paint);
    PAINTS_BY_ID.set(paints, lookup);
  }
  return lookup.get(id);
}

/**
 * Chatter colors repeat heavily, especially on Twitch. Keep a small bounded
 * validation cache keyed by the exact upstream string. readableColor preserves
 * valid provider hex colours and returns an empty string for malformed values,
 * allowing the deterministic provider fallback to take over safely.
 */
function cachedReadableColor(color: string): string {
  const cached = READABLE_COLORS.get(color);
  if (cached !== undefined) return cached;
  const resolved = readableColor(color);
  if (READABLE_COLORS.size >= READABLE_COLOR_CACHE_MAX) {
    const oldest = READABLE_COLORS.keys().next().value as string | undefined;
    if (oldest !== undefined) READABLE_COLORS.delete(oldest);
  }
  READABLE_COLORS.set(color, resolved);
  return resolved;
}

/**
 * Convert one normalized message into the renderable form ChatOverlay consumes.
 *
 * Side effect, and it is load-bearing: the author's resolved colour is recorded
 * in `mentions.colors` under their lowercased name. That is how mention colouring
 * works — a mention only takes a colour if that chatter has been seen already —
 * so callers must convert a list in display order and reuse one context across
 * it, exactly as the overlay does.
 */
export function buildParsedMessage(
  um: UnifiedMessage,
  cfg: MessageStyleConfig,
  cosmetics: MessageCosmetics,
  mentions: MentionContext,
  timestamp: number,
): ParsedMessage {
  reportStartupAcceptedMessage(um);
  const layout = parseBadgeLayout(cfg.badgeLayout);
  /* Hide all badges: nothing is visible, so no badge of any kind is kept or
     drawn, while names, colours and paints below are unchanged. */
  const visible = new Set(cfg.hideBadges
    ? []
    : layout.filter((entry) => entry.visible).map((entry) => entry.provider));
  const grouped = new Map<string, UnifiedMessage['badges']>();
  for (const badge of um.badges) {
    if (cfg.showCommunityBadges === false && badge.type.startsWith('community:')) continue;
    const provider = badgeProviderFromType(badge.type);
    if (!visible.has(provider)) continue;
    const bucket = grouped.get(provider) ?? [];
    bucket.push(badge);
    grouped.set(provider, bucket);
  }

  let background = '';
  let filter = '';
  let sevenTVPaint: { background: string; filter: string } | null = null;
  let sevenTVBadge: ChatElement | null = null;

  if (
    (um.platform === 'kick' || um.platform === 'twitch') &&
    cfg.sevenTVCosmeticsEnabled &&
    um.senderId
  ) {
    const entitlement = cosmetics.entitlements[`${um.platform}:${um.senderId}`];
    if (entitlement) {
      if (entitlement.badge && visible.has('7tv')) {
        const badge = badgeById(cosmetics.badges, entitlement.badge);
        if (badge) {
          sevenTVBadge = el('img', {
            class: 'ck-badge-img',
            src: badge.image,
            alt: '7tv badge',
            title: '7TV badge',
            width: 72,
            height: 72,
          }, undefined, { key: '7tv-badge', onError: 'hide' });
        }
      }
      if (entitlement.paint) {
        const paint = paintById(cosmetics.paints, entitlement.paint);
        if (paint) {
          const style = buildPaintStyle(paint, cfg.paintShadows);
          if (style.background) sevenTVPaint = style;
        }
      }
    }
  }

  /* JilTV paint (its own release gate, set by the Twitch connector), while
     JilTV Cosmetics is on, with its own shadows setting. A chatter wearing
     both shows 7TV's unless they asked for JilTV's here (paintChoice.ts). */
  let backgroundSize: string | undefined;
  let backgroundRepeat: string | undefined;
  const jiltv = um.jiltvPaint && um.platform === 'twitch' && cfg.jiltvCosmeticsEnabled !== false
    ? buildJilTVPaintStyle(um.jiltvPaint, cfg.jiltvPaintShadows !== false, prefersReducedMotion())
    : null;
  const shown = shownPaintSource(
    Boolean(sevenTVPaint),
    Boolean(jiltv?.background),
    cosmetics.paintSources?.get(`${um.platform}:${um.senderId}`),
  );
  if (shown === 'jiltv' && jiltv) {
    ({ background, filter } = jiltv);
    backgroundSize = jiltv.size;
    backgroundRepeat = jiltv.repeat;
  } else if (shown === '7tv' && sevenTVPaint) {
    ({ background, filter } = sevenTVPaint);
  }
  const paintSizing = {
    ...(backgroundSize ? { backgroundSize } : {}),
    ...(backgroundRepeat ? { backgroundRepeat } : {}),
  };

  const badgeNodes: ChatPart[] = [];
  /* A Twitch chatter's own badge layout (Moltorino) hides kinds they hid and
     puts theirs in their order, inside what the streamer's layout shows. */
  const viewerLayout = um.platform === 'twitch' ? um.viewerBadgeLayout : undefined;
  const placed: { slot: ViewerBadgeSlot | null; value: ChatPart[] }[] = [];
  for (const entry of layout) {
    if (!entry.visible) continue;
    if (entry.provider === '7tv') {
      if (sevenTVBadge) placed.push({ slot: '7', value: [sevenTVBadge] });
      continue;
    }
    const badges = grouped.get(entry.provider);
    if (!badges?.length) continue;
    if (!viewerLayout) {
      placed.push({ slot: null, value: badgeParts({ ...um, badges }, cosmetics.channel?.subscriber_badges ?? []) });
      continue;
    }
    for (const badge of badges) {
      const index = placed.length;
      placed.push({
        slot: viewerBadgeSlot(badge),
        /* One badge at a time, so keys get a per-badge prefix to stay unique. */
        value: badgeParts({ ...um, badges: [badge] }, cosmetics.channel?.subscriber_badges ?? [])
          .map((node) => ({ ...node, key: `v${index}-${node.key ?? ''}` })),
      });
    }
  }
  for (const nodes of viewerLayout ? applyViewerBadgeLayout(placed, viewerLayout) : placed.map((item) => item.value)) {
    badgeNodes.push(...nodes);
  }
  // YouTube may include @ in authorName; keep it in the normalized message for
  // commands/moderation, but do not show the handle marker as part of the name.
  const displayUsername = um.platform === 'youtube' ? um.username.replace(/^@/, '') : um.username;
  // mention map: remember every chatter's color under both upstream and display
  // spellings so presentation cleanup does not change mention resolution.
  const upstreamColor = um.color ? cachedReadableColor(um.color) : '';
  const fallback = upstreamColor
    ? ''
    : fallbackColor(um.platform, um.username, um.senderId);
  const displayColor = upstreamColor || cachedReadableColor(fallback);
  const upstreamNameKey = um.username.toLowerCase();
  const displayNameKey = displayUsername.toLowerCase();
  mentions.colors.set(upstreamNameKey, displayColor);
  if (displayNameKey !== upstreamNameKey) mentions.colors.set(displayNameKey, displayColor);
  /* Their paint goes with them: an @mention of a painted chatter shows the
     same paint. A chatter who took theirs off is shown in plain colour again. */
  if (mentions.paints) {
    for (const key of [upstreamNameKey, displayNameKey]) {
      if (background) mentions.paints.set(key, { background, filter, ...paintSizing });
      else mentions.paints.delete(key);
    }
  }
  /* With only JilTV emotes on, Twitch's list holds JilTV's alone
     (multichatRuntime), so it is used as it is. */
  const messageEmotes =
    (um.platform === 'kick' || um.platform === 'twitch' || um.platform === 'youtube')
      && (cfg.sevenTVEmotesEnabled || (um.platform === 'twitch' && cfg.jiltvEmotesEnabled === true))
      ? cosmetics.emotes[um.platform] ?? []
      : [];
  /* The sender's personal 7TV emotes apply to their own words only (not to a
     quoted reply, which is someone else's message). */
  const senderEmotes = (um.platform === 'kick' || um.platform === 'twitch') && cfg.sevenTVEmotesEnabled && um.senderId
    ? withPersonalEmotes(messageEmotes, cosmetics.personalEmotes?.[`${um.platform}:${um.senderId}`])
    : messageEmotes;
  const message = renderTwitchMessageBody(
    um,
    senderEmotes,
    mentions,
    cfg.gifSize ?? DEFAULT_TWITCH_GIF_SIZE_PX,
  );

  const reply = um.reply
    ? {
        ...um.reply,
        renderedText: um.reply.text
          ? messageTextParts(
              {
                ...um,
                text: um.reply.text,
                emotes: um.reply.emotes ?? [],
                reply: undefined,
                twitchGifs: undefined,
                gifUrl: undefined,
              },
              messageEmotes,
              mentions,
            )
          : [],
      }
    : undefined;

  return {
    id: `${um.platform}:${um.id}`,
    platform: um.platform,
    ...(um.displayPlatform ? { displayPlatform: um.displayPlatform } : {}),
    senderId: um.senderId,
    kind: um.kind,
    category: um.category,
    hypeTrain: um.hypeTrain,
    twitchCheer: um.twitchCheer,
    twitchSubscription: um.twitchSubscription,
    twitchSubscriptionTransition: um.twitchSubscriptionTransition,
    twitchGift: um.twitchGift,
    twitchRaid: um.twitchRaid,
    twitchAnnouncement: um.twitchAnnouncement,
    twitchMilestone: um.twitchMilestone,
    redeem: um.redeem,
    ...(um.gigantifiedEmote ? { gigantifiedEmote: true } : {}),
    avatar: um.avatar,
    sourceChannel: um.sourceChannel,
    reply,
    raw: um,
    timestamp,
    identity: {
      username: displayUsername,
      color: displayColor,
      background,
      filter,
      ...paintSizing,
      badges: badgeNodes,

      ...(isYouTubeOwner(um) ? { namePill: '#ffd600|#111111' } : {}),
    },
    message,
  };
}
