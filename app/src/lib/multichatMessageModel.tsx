/* UnifiedMessage → ParsedMessage: the one place that conversion happens.
 *
 * This was previously a closure inside the overlay route's connect effect, which
 * meant nothing else could perform the conversion without reimplementing it.
 * Five appearance settings are applied *here* rather than in ChatOverlay:
 *
 *   sevenTVEmotesEnabled     decides whether third-party emotes are swapped into
 *                            the text at all (by passing an empty emote list)
 *   sevenTVCosmeticsEnabled  decides whether a paint or 7TV badge is attached
 *   showCommunityBadges      decides whether third-party/community badge nodes
 *                            are rendered while leaving native badges untouched
 *   paintShadows             decides whether a paint contributes drop-shadows
 *   mentionColor             decides whether @tokens become coloured strongs
 *
 * A caller that skipped this step and built ParsedMessage values by hand would
 * therefore be unable to respond to any of those settings, however faithfully it
 * copied the rest. That is why the generator's preview renders fixtures through
 * this function instead of shipping pre-rendered nodes: the settings have to pass
 * through the same code on the way to the screen.
 *
 * Moved verbatim from pages/multichat.tsx. The only deliberate change is that
 * `timestamp` is a parameter rather than a `Date.now()` call, so a deterministic
 * caller can supply a fixed instant. The overlay passes `Date.now()` and is
 * unaffected.
 *
 * Browser-safe — no server-only imports, no secrets, no network.
 */
import {
  decimalToRGBA,
  type Entitlements,
  type KickChannel,
  type ParsedMessage,
  type SevenTVBadge,
  type SevenTVEmote,
  type SevenTVPaint,
} from './kick';
import {
  fallbackColor,
  isYouTubeOwner,
  readableColor,
  renderBadges,
  renderMessageText,
  type MentionContext,
} from './render';
import { handleAssetError } from './render/imageFallback';
import { parseSevenTVPaint } from './cosmeticMetadata';
import { runtimeEventMessageVisible } from './multichatEventRuntime';
import { ensureStartupDebugPanel, reportStartupAcceptedMessage } from './startupDebug';
import { DEFAULT_TWITCH_GIF_SIZE_PX, renderTwitchGif } from './twitchGif';
import type { Platform, UnifiedMessage } from './types';
import { badgeProviderFromType, parseBadgeLayout } from './badgeLayout';

/**
 * The cosmetic data a conversion reads from.
 *
 * The overlay fills this from live 7TV lookups as they resolve; the generator
 * preview fills it from fixtures. Both shapes are the same, so neither needs a
 * special case in the conversion itself.
 */
export type ThirdPartyEmoteCatalog = Partial<
  Record<Extract<Platform, 'kick' | 'twitch' | 'youtube'>, SevenTVEmote[]>
>;

export type MessageCosmetics = {
  /** Third-party emotes scoped by platform; providers never cross chat services. */
  emotes: ThirdPartyEmoteCatalog;
  badges: SevenTVBadge[];
  paints: SevenTVPaint[];
  /** Keyed `${platform}:${senderId}`, as the cosmetics fetcher keys them. */
  entitlements: Entitlements;
  /** Kick channel, for its subscriber badge tiers. Null when not loaded. */
  channel: KickChannel | null;
};

/** The subset of overlay configuration that changes how a message is built. */
export type MessageStyleConfig = {
  sevenTVEmotesEnabled: boolean;
  sevenTVCosmeticsEnabled: boolean;
  /** Omitted means on, preserving existing callers and old overlay URLs. */
  showCommunityBadges?: boolean;
  badgeLayout?: string;
  paintShadows: boolean;
  /** Twitch native GIF messages are opt-in so old overlays keep their text body. */
  gifs?: boolean;
  /** Independent Twitch GIF cap in pixels. */
  gifSize?: number;
};

/** The subset of overlay configuration that decides whether a message is shown. */
export type MessageFilterConfig = {
  /** Comma- or space-separated extra bot names to hide. */
  botNames: string;
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

/**
 * Build the "should this message be displayed" predicate for a configuration.
 *
 * Lifted out of the overlay's connect effect for the same reason as the
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
      .filter(Boolean)
      .map((b) => b.toLowerCase()),
  );
  /* Space-separated, matching the labels on both fields. */
  const userBlacklist = new Set(
    (cfg.userBL || '').split(/\s+/).filter(Boolean).map((u) => u.toLowerCase()),
  );
  const prefixBlacklist = (cfg.prefixBL || '').split(/\s+/).filter(Boolean);

  return (um: UnifiedMessage): boolean => {
    const name = um.username.toLowerCase();
    if (KNOWN_BOTS.has(name) || extraBots.has(name) || userBlacklist.has(name)) return false;
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

/** Empty cosmetics, for a caller with no 7TV data at all. */
export const NO_COSMETICS: MessageCosmetics = {
  emotes: {},
  badges: [],
  paints: [],
  entitlements: {},
  channel: null,
};

/**
 * A 7TV paint as CSS: a gradient (or image) for `background`, shadows for
 * `filter`.
 *
 * `paintShadows` is honoured by returning an empty filter rather than by
 * dropping the paint, so turning shadows off leaves the gradient intact — which
 * is what the setting claims to do.
 */
export function buildPaintStyle(
  paint: SevenTVPaint,
  paintShadows: boolean,
): { background: string; filter: string } {
  const normalizedPaint = parseSevenTVPaint(paint);
  if (!normalizedPaint) return { background: '', filter: '' };
  paint = normalizedPaint;
  const parts: string[] = [];
  const shadows: string[] = [];
  let prefix = '';
  if (paint.func === 'URL') {
    parts.push(paint.image_url ?? '');
  } else {
    if (paint.func === 'LINEAR_GRADIENT') parts.push(`${paint.angle ?? 0}deg`);
    else if (paint.func === 'RADIAL_GRADIENT') parts.push(paint.shape ?? 'circle');
    prefix = paint.repeat ? 'repeating-' : '';
    for (const stop of paint.stops) {
      parts.push(`${decimalToRGBA(stop.color)} ${stop.at * 100}%`);
    }
  }
  for (const shadow of paint.shadows) {
    if (!paintShadows) break;
    shadows.push(
      `drop-shadow(${decimalToRGBA(shadow.color)} ${shadow.x_offset / 14}em ${shadow.y_offset / 14}em ${shadow.radius / 14}em)`,
    );
  }
  /* Replace every underscore, not just the first: REPEATING_LINEAR_GRADIENT
     would otherwise emit repeating-linear_gradient() and the whole paint would
     be dropped as an invalid value. */
  const func = paint.func.toLowerCase().replace(/_/g, '-');
  const background =
    paint.func === 'URL'
      ? // quoted: an unquoted url() breaks on ")" or whitespace in the URL
        `url("${parts[0].replace(/["\\]/g, (c) => `\\${c}`)}")`
      : `${prefix}${func}(${parts.join(', ')})`;
  const filter = paintShadows ? ['drop-shadow(rgba(0, 0, 0, 0.8) 2px 3px 0.15rem)', ...shadows].join(' ') : '';
  return { background, filter };
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
 * Chatter colors repeat heavily, especially on Twitch. Normalizing a dark color
 * performs regex parsing plus RGB/HSL conversion, so keep a small bounded cache
 * keyed by the exact upstream string. Invalid/non-hex colors are safe too:
 * readableColor returns them byte-for-byte and the exact key preserves that.
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
  const visible = new Set(layout.filter((entry) => entry.visible).map((entry) => entry.provider));
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
  let sevenTVBadge: React.ReactNode = null;

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
          sevenTVBadge = (
            <img key="7tv-badge" className="ck-badge-img" src={badge.image} alt="7tv badge" onError={handleAssetError} />
          );
        }
      }
      if (entitlement.paint) {
        const paint = paintById(cosmetics.paints, entitlement.paint);
        if (paint) ({ background, filter } = buildPaintStyle(paint, cfg.paintShadows));
      }
    }
  }

  const badgeNodes: React.ReactNode[] = [];
  for (const entry of layout) {
    if (!entry.visible) continue;
    if (entry.provider === '7tv') {
      if (sevenTVBadge) badgeNodes.push(sevenTVBadge);
      continue;
    }
    const badges = grouped.get(entry.provider);
    if (!badges?.length) continue;
    badgeNodes.push(...renderBadges({ ...um, badges }, cosmetics.channel?.subscriber_badges ?? []));
  }
  // YouTube may include @ in authorName; keep it in the normalized message for
  // commands/moderation, but do not show the handle marker as part of the name.
  const displayUsername = um.platform === 'youtube' ? um.username.replace(/^@/, '') : um.username;
  // mention map: remember every chatter's color under both upstream and display
  // spellings so presentation cleanup does not change mention resolution.
  const displayColor = um.color
    ? cachedReadableColor(um.color)
    : fallbackColor(um.platform, um.username, um.senderId);
  const upstreamNameKey = um.username.toLowerCase();
  const displayNameKey = displayUsername.toLowerCase();
  mentions.colors.set(upstreamNameKey, displayColor);
  if (displayNameKey !== upstreamNameKey) mentions.colors.set(displayNameKey, displayColor);
  const message = um.platform === 'twitch' && um.kind === 'chat' && cfg.gifs && um.gifUrl
    ? [renderTwitchGif(um.gifUrl, cfg.gifSize ?? DEFAULT_TWITCH_GIF_SIZE_PX)]
    : renderMessageText(
        um,
        (um.platform === 'kick' || um.platform === 'twitch' || um.platform === 'youtube') && cfg.sevenTVEmotesEnabled
          ? cosmetics.emotes[um.platform] ?? []
          : [],
        mentions,
      );

  return {
    id: `${um.platform}:${um.id}`,
    platform: um.platform,
    ...(um.displayPlatform ? { displayPlatform: um.displayPlatform } : {}),
    senderId: um.senderId,
    kind: um.kind,
    category: um.category,
    redeem: um.redeem,
    avatar: um.avatar,
    sourceChannel: um.sourceChannel,
    reply: um.reply,
    raw: um,
    timestamp,
    identity: {
      username: displayUsername,
      color: displayColor,
      background,
      filter,
      badges: badgeNodes,

      ...(isYouTubeOwner(um) ? { namePill: '#ffd600|#111111' } : {}),
    },
    message,
  };
}
