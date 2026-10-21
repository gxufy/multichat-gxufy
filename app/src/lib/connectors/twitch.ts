import type { Connector, ConnectorCallbacks, UnifiedBadge, UnifiedEmote, UnifiedMessage } from '../types';
import { normalizeChatChannel } from '../channelValidation';
import { parseTwitchGifTag } from '../twitchGif';
import { loadFFZRoomBadges } from '../twitchEmotes';
import { fetchTwitchProfile } from '../twitchProfileClient';
import { resolveTwitchCheerMessage } from '../twitchCheermotes';
import { resolveTwitchCommunityBadges } from '../communityBadges';
import type { LimerinoBadgeRenderOptions } from '../limerinoBadges';

/** bChat parity: preserve Twitch's display casing when login/display differ
 * only by case; otherwise show the canonical login followed by display name. */
export function formatTwitchVisibleUsername(login: string, displayName: string): string {
  const normalizedLogin = login.trim().toLowerCase();
  const normalizedDisplayName = displayName.trim().toLowerCase();
  return normalizedLogin === normalizedDisplayName
    ? displayName || 'Unknown'
    : `${login || 'Unknown'} (${displayName || 'Unknown'})`;
}

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

const PRIORITY_BADGES = ['predictions', 'admin', 'global_mod', 'staff', 'twitchbot', 'broadcaster', 'lead_moderator', 'moderator', 'vip'];

const TAG_ESCAPES: Record<string, string> = { '\\:': ';', '\\s': ' ', '\\\\': '\\', '\\r': '\r', '\\n': '\n' };
const MAX_ENRICHMENT_MESSAGES = 250;

function unescapeTag(v: string): string {
  return v.replace(/\\[:s\\rn]/g, m => TAG_ESCAPES[m] ?? m);
}

function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) tags[part] = '';
    else tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1));
  }
  return tags;
}

interface IrcLine {
  tags: Record<string, string>;
  prefix: string | null;
  command: string;
  params: string[];
  trailing: string | null;
}

/** IRC line: [@tags ][:prefix ]COMMAND [params][ :trailing] */
export function parseLine(line: string): IrcLine | null {
  let rest = line;
  let tags: Record<string, string> = {};
  let prefix: string | null = null;

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  let trailing: string | null = null;
  const ti = rest.indexOf(' :');
  if (ti !== -1) {
    trailing = rest.slice(ti + 2);
    rest = rest.slice(0, ti);
  }

  const parts = rest.split(' ').filter(Boolean);
  if (!parts.length) return null;
  return { tags, prefix, command: parts[0], params: parts.slice(1), trailing };
}

/** emotes tag "25:0-4,12-16/1902:6-10" → UnifiedEmote[] (code-point offsets). */
export function parseTwitchEmotes(rawTag: string, text: string): UnifiedEmote[] {
  if (!rawTag) return [];
  const chars = Array.from(text);
  const emotes: UnifiedEmote[] = [];
  for (const group of rawTag.split('/')) {
    const colon = group.indexOf(':');
    if (colon === -1) continue;
    const id = group.slice(0, colon);
    for (const range of group.slice(colon + 1).split(',')) {
      const [b, e] = range.split('-');
      const begin = parseInt(b), end = parseInt(e) + 1;
      if (isNaN(begin) || isNaN(end)) continue;
      emotes.push({
        begin, end,
        text: chars.slice(begin, end).join(''),
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/3.0`,
      });
    }
  }
  return emotes.sort((a, b) => a.begin - b.begin);
}

function parseBadges(rawTag: string, badgeMap: Record<string, string>): UnifiedBadge[] {
  if (!rawTag) return [];
  const all = rawTag.split(',').filter(Boolean).map(b => {
    const [type, version] = b.split('/');
    return {
      type,
      version,
      count: /^\d+$/.test(version) ? parseInt(version, 10) : undefined,
      url: badgeMap[b] ?? badgeMap[`${type}/1`],
    };
  });
  return [
    ...all.filter(b => PRIORITY_BADGES.includes(b.type)),
    ...all.filter(b => !PRIORITY_BADGES.includes(b.type)),
  ];
}

/** Accept only the exact safe map promised by /api/twitch/badges. */
export function parseBadgeMap(value: unknown): Record<string, string> | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'badges' in value
  ) {
    value = (value as { badges?: unknown }).badges;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const entries = Object.entries(value);
  for (const [key, url] of entries) {
    const parts = key.split('/');
    if (parts.length !== 2 || parts.some((part) => !part)) return null;
    if (typeof url !== 'string') return null;
    try {
      if (new URL(url).protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function prefixText(prefix: string, text: string, emotes: UnifiedEmote[]): { text: string; emotes: UnifiedEmote[] } {
  if (!text) return { text: prefix, emotes: [] };
  const shift = [...prefix].length + 2;
  return {
    text: `${prefix}: ${text}`,
    emotes: emotes.map(e => ({ ...e, begin: e.begin + shift, end: e.end + shift })),
  };
}

/** The overlay URL is immutable for one connector lifetime, so this is a cheap
 * runtime gate that also keeps tests/server callers default-on when no window
 * exists. */
function communityBadgesEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return new URLSearchParams(window.location.search).get('showCommunityBadges') !== 'false';
}

export interface TwitchConnectorOpts extends ConnectorCallbacks {
  channel: string;
  /** room-id from ROOMSTATE — used for 7TV Twitch channel emotes */
  onRoomId?(roomId: string): void;
  /** Badge art changed after messages may already have been delivered. */
  onBadgeMap?(badgeMap: Readonly<Record<string, string>>): void;
  /** Runtime gate for source-streamer profile enrichment. */
  shouldEnrichSourceChannel?(): boolean;
  /** Current overlay badge geometry used for Limerino's responsive art set. */
  communityBadgeRenderOptions?: LimerinoBadgeRenderOptions;
}

export function createTwitchConnector(opts: TwitchConnectorOpts): Connector {
  const channel = normalizeChatChannel('twitch', opts.channel).toLowerCase();
  let ws: WebSocket | null = null;
  let stopped = false;
  let backoff = 1000;
  let roomIdSent = false;
  // "<setID>/<version>" → imageURL; empty until the fetch resolves
  // (messages arriving before then just render without badge art)
  let badgeMap: Record<string, string> = {};
  let generation = 0;
  const deliveredMessages = new Map<string, UnifiedMessage>();

  /*
   * Community gifts arrive as one submysterygift announcement followed by
   * individual subgift USERNOTICE children sharing an origin id.
   * Keep one visible parent row and repaint it as recipients arrive.
   */
  const giftBombParents =
    new Map<string, string>();

  const pendingGiftChildren =
    new Map<
      string,
      Array<{
        messageId: string;
        recipient: NonNullable<
          NonNullable<UnifiedMessage['twitchGift']>['recipient']
        >;
      }>
    >();

  const MAX_GIFT_BOMBS = 200;

  if (channel) {
    fetch(`/api/twitch/badges?channel=${encodeURIComponent(channel)}`)
      .then(r => r.ok ? r.json() : null)
      .then(value => {
        const parsed = parseBadgeMap(value);
        if (parsed) {
          badgeMap = parsed;
          opts.onBadgeMap?.(badgeMap);
        }
      })
      .catch(() => { /* fall back to bare types */ });
  }

  function remember(message: UnifiedMessage): void {
    deliveredMessages.set(message.id, message);
    while (deliveredMessages.size > MAX_ENRICHMENT_MESSAGES) {
      const oldest = deliveredMessages.keys().next().value as string | undefined;
      if (!oldest) break;
      deliveredMessages.delete(oldest);
    }
  }

  function withCurrentNativeBadgeArt(message: UnifiedMessage): UnifiedMessage {
    const badges = message.badges.map((badge) => {
      if (badge.type.startsWith('community:') || badge.url) return badge;
      const version = badge.version ?? (badge.count ? String(badge.count) : '1');
      const url = badgeMap[`${badge.type}/${version}`] ?? badgeMap[`${badge.type}/1`];
      return url ? { ...badge, url } : badge;
    });
    return { ...message, badges };
  }

  function enrichSharedMessage(message: UnifiedMessage): void {
    const roomId = message.sourceChannel?.roomId;
    if (!roomId) return;
    /* The room id stays on every Twitch row so Shared Chat can be enabled at
       runtime, but profile traffic is skipped while the feature is off. A
       local !multichat sharedon command flips the gate during onMessage, before
       deliver() reaches this enrichment step, so that very message can receive
       its source avatar without reconnecting. */
    if (opts.shouldEnrichSourceChannel?.() === false) return;
    const ownedGeneration = generation;
    void fetchTwitchProfile(roomId).then(profile => {
      if (stopped || generation !== ownedGeneration || !profile) return;
      const current = deliveredMessages.get(message.id);
      if (!current || current.sourceChannel?.roomId !== roomId) return;
      const enriched = { ...current, sourceChannel: profile };
      remember(enriched);
      opts.onMessageUpdate?.(enriched);
    });
  }

  function enrichCommunityBadges(message: UnifiedMessage): void {
    if (!communityBadgesEnabled() || !message.senderId) return;
    const ownedGeneration = generation;
    void resolveTwitchCommunityBadges(
      {
        userId: message.senderId,
        login: message.senderUsername ?? '',
        displayName: message.senderDisplayName ?? '',
      },
      opts.communityBadgeRenderOptions,
    ).then(communityBadges => {
      if (stopped || generation !== ownedGeneration || !communityBadges.length) return;
      const current = deliveredMessages.get(message.id);
      if (!current || current.senderId !== message.senderId) return;
      const native = withCurrentNativeBadgeArt(current).badges.filter((badge) => !badge.type.startsWith('community:'));
      const enriched = { ...current, badges: [...native, ...communityBadges] };
      remember(enriched);
      opts.onMessageUpdate?.(enriched);
    });
  }

  function buildMessage(p: IrcLine, kind: 'chat' | 'system', text: string, emotes: UnifiedEmote[], category?: UnifiedMessage['category']): UnifiedMessage {
    const tags = p.tags;
    const prefixLogin = p.prefix?.includes('!') ? p.prefix.split('!')[0] : '';
    const login = tags['login'] || prefixLogin;
    const sourceRoomId = tags['source-room-id'];
    const localRoomId = tags['room-id'];
    const sharedChat = Boolean(sourceRoomId && sourceRoomId !== localRoomId);
    const displayName = tags['display-name'] || '';
    const replyUsername = tags['reply-parent-display-name'] || tags['reply-parent-user-login'];
    const hasReplyBody = Object.prototype.hasOwnProperty.call(tags, 'reply-parent-msg-body');
    const replyMessageId = tags['reply-parent-msg-id'];
    const replyText = tags['reply-parent-msg-body'] ?? '';
    const observedParent = replyMessageId ? deliveredMessages.get(replyMessageId) : undefined;
    const replyEmotes = observedParent && observedParent.text === replyText
      ? observedParent.emotes.map((emote) => ({ ...emote }))
      : [];
    const reply = replyUsername && (replyMessageId || hasReplyBody)
      ? {
          username: replyUsername,
          text: replyText,
          ...(replyMessageId ? { messageId: replyMessageId } : {}),
          ...(tags['reply-parent-user-id'] ? { senderId: tags['reply-parent-user-id'] } : {}),
          ...(replyEmotes.length ? { emotes: replyEmotes } : {}),
        }
      : undefined;
    const twitchGifs = kind === 'chat' ? parseTwitchGifTag(tags['gifs'], text) : [];
    const message: UnifiedMessage = {
      platform: 'twitch',
      id: tags['id'] || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      senderId: tags['user-id'] ?? '',
      ...(login ? { senderUsername: login } : {}),
      ...(displayName ? { senderDisplayName: displayName } : {}),
      username: formatTwitchVisibleUsername(login, displayName),
      color: tags['color'] || '',
      badges: parseBadges(tags['badges'] ?? '', badgeMap),
      text,
      emotes,
      timestamp: parseInt(tags['tmi-sent-ts']) || Date.now(),
      kind,
      category,
      ...(twitchGifs.length ? { twitchGifs } : {}),
      ...(reply ? { reply } : {}),
      ...(sourceRoomId ? { sourceChannel: { roomId: sourceRoomId } } : {}),
      ...(sharedChat ? { sharedChat: true } : {}),
    };
    return message;
  }

  function withCurrentCheermotes(
    message: UnifiedMessage,
  ): UnifiedMessage {
    if (!message.twitchCheer) {
      return message;
    }

    const nativeEmotes =
      message.emotes.filter(
        (emote) =>
          emote.kind !==
          'cheermote',
      );

    const resolved =
      resolveTwitchCheerMessage(
        message.text,
        message.twitchCheer.bits,
      );

    return {
      ...message,
      twitchCheer:
        resolved.cheer,
      emotes: [
        ...nativeEmotes,
        ...resolved.emotes,
      ].sort(
        (a, b) =>
          a.begin -
          b.begin,
      ),
    };
  }

  function deliver(message: UnifiedMessage): void {
    remember(message);
    opts.onMessage(message);
    enrichSharedMessage(message);
    enrichCommunityBadges(message);
  }

  function usernoticeCategory(msgId: string): UnifiedMessage['category'] {
    if (['sub','resub','primepaidupgrade','giftpaidupgrade','anongiftpaidupgrade','standardpayforward','communitypayforward','sharedchatnotice'].includes(msgId)) return 'subscription';
    if (['subgift','submysterygift','anonsubgift','anonsubmysterygift'].includes(msgId)) return 'gift';
    if (msgId === 'raid' || msgId === 'unraid') return 'raid';
    if (['viewermilestone','watchstreak','bitsbadgetier'].includes(msgId)) return 'milestone';
    if (msgId === 'charitydonation') return 'cheer';
    return 'announcement';
  }

  function positiveInt(
    value: string | undefined,
  ): number | undefined {
    if (!value) {
      return undefined;
    }

    const parsed =
      Number.parseInt(
        value,
        10,
      );

    return (
      Number.isInteger(parsed) &&
      parsed > 0
    )
      ? parsed
      : undefined;
  }

  function buildSubscriptionUsernotice(
    p: IrcLine,
  ): UnifiedMessage | null {
    const msgId =
      p.tags['msg-id'] ?? '';

    if (
      msgId !== 'sub' &&
      msgId !== 'resub'
    ) {
      return null;
    }

    /*
     * USERNOTICE carries the viewer's authored resub message in trailing.
     * Keep that body untouched so native Twitch emote offsets remain valid.
     * Subscription metadata comes exclusively from anonymous IRC tags.
     */
    const userMsg =
      p.trailing ?? '';

    const emotes =
      userMsg
        ? parseTwitchEmotes(
            p.tags['emotes'] ?? '',
            userMsg,
          )
        : [];

    const cumulative =
      positiveInt(
        p.tags[
          'msg-param-cumulative-months'
        ],
      );

    const streak =
      p.tags[
        'msg-param-should-share-streak'
      ] === '1'
        ? positiveInt(
            p.tags[
              'msg-param-streak-months'
            ],
          )
        : undefined;

    const message =
      buildMessage(
        p,
        'system',
        userMsg,
        emotes,
        'subscription',
      );

    message.twitchSubscription = {
      type:
        msgId,
      plan:
        p.tags[
          'msg-param-sub-plan'
        ] ?? '',
      months:
        cumulative ??
        1,
      ...(streak
        ? {
            streakMonths:
              streak,
          }
        : {}),
      ...(p.tags['system-msg']
        ? {
            systemMessage:
              p.tags[
                'system-msg'
              ],
          }
        : {}),
    };

    return message;
  }

  function giftOrigin(
    p: IrcLine,
  ): string | undefined {
    return (
      p.tags[
        'msg-param-origin-id'
      ] ||
      p.tags[
        'msg-param-community-gift-id'
      ] ||
      undefined
    );
  }

  function giftRecipient(
    p: IrcLine,
  ):
    | NonNullable<
        NonNullable<
          UnifiedMessage['twitchGift']
        >['recipient']
      >
    | undefined {
    const displayName =
      p.tags[
        'msg-param-recipient-display-name'
      ] ||
      p.tags[
        'msg-param-recipient-user-name'
      ];

    if (!displayName) {
      return undefined;
    }

    return {
      displayName,
      ...(p.tags[
        'msg-param-recipient-user-name'
      ]
        ? {
            username:
              p.tags[
                'msg-param-recipient-user-name'
              ],
          }
        : {}),
      ...(p.tags[
        'msg-param-recipient-id'
      ]
        ? {
            userId:
              p.tags[
                'msg-param-recipient-id'
              ],
          }
        : {}),
    };
  }

  function sameGiftRecipient(
    a: NonNullable<
      NonNullable<
        UnifiedMessage['twitchGift']
      >['recipient']
    >,
    b: NonNullable<
      NonNullable<
        UnifiedMessage['twitchGift']
      >['recipient']
    >,
  ): boolean {
    if (
      a.userId &&
      b.userId
    ) {
      return (
        a.userId ===
        b.userId
      );
    }

    return (
      (
        a.username ??
        a.displayName
      ).toLowerCase() ===
      (
        b.username ??
        b.displayName
      ).toLowerCase()
    );
  }

  function appendGiftRecipient(
    originId: string,
    recipient: NonNullable<
      NonNullable<
        UnifiedMessage['twitchGift']
      >['recipient']
    >,
  ): boolean {
    const parentId =
      giftBombParents.get(
        originId,
      );

    if (!parentId) {
      return false;
    }

    const current =
      deliveredMessages.get(
        parentId,
      );

    if (
      !current?.twitchGift ||
      current.twitchGift.type !==
        'community'
    ) {
      return false;
    }

    const recipients =
      [
        ...(
          current.twitchGift
            .recipients ??
          []
        ),
      ];

    if (
      recipients.some(
        (existing) =>
          sameGiftRecipient(
            existing,
            recipient,
          ),
      )
    ) {
      return true;
    }

    recipients.push(
      recipient,
    );

    const updated:
      UnifiedMessage = {
      ...current,
      twitchGift: {
        ...current.twitchGift,
        recipients,
      },
    };

    remember(updated);

    opts.onMessageUpdate?.(
      updated,
    );

    return true;
  }

  function pruneGiftBombMaps():
    void {
    while (
      giftBombParents.size >
      MAX_GIFT_BOMBS
    ) {
      const oldest =
        giftBombParents
          .keys()
          .next()
          .value as
          string | undefined;

      if (!oldest) {
        break;
      }

      giftBombParents.delete(
        oldest,
      );

      pendingGiftChildren.delete(
        oldest,
      );
    }

    while (
      pendingGiftChildren.size >
      MAX_GIFT_BOMBS
    ) {
      const oldest =
        pendingGiftChildren
          .keys()
          .next()
          .value as
          string | undefined;

      if (!oldest) {
        break;
      }

      pendingGiftChildren.delete(
        oldest,
      );
    }
  }

  function handleGiftUsernotice(
    p: IrcLine,
  ): boolean {
    const msgId =
      p.tags['msg-id'] ?? '';

    const isCommunity =
      msgId ===
        'submysterygift' ||
      msgId ===
        'anonsubmysterygift';

    const isChild =
      msgId ===
        'subgift' ||
      msgId ===
        'anonsubgift';

    if (
      !isCommunity &&
      !isChild
    ) {
      return false;
    }

    const anonymous =
      msgId ===
        'anonsubgift' ||
      msgId ===
        'anonsubmysterygift';

    const originId =
      giftOrigin(p);

    const plan =
      p.tags[
        'msg-param-sub-plan'
      ] ?? '';

    if (isCommunity) {
      const count =
        positiveInt(
          p.tags[
            'msg-param-mass-gift-count'
          ],
        ) ??
        1;

      const senderCount =
        positiveInt(
          p.tags[
            'msg-param-sender-count'
          ],
        );

      const pending =
        originId
          ? (
              pendingGiftChildren.get(
                originId,
              ) ??
              []
            )
          : [];

      const message =
        buildMessage(
          p,
          'system',
          '',
          [],
          'gift',
        );

      if (anonymous) {
        message.username =
          'Anonymous';

        message.senderUsername =
          'anonymous';

        message.senderId =
          '';
      }

      message.twitchGift = {
        type:
          'community',
        anonymous,
        plan,
        count,
        ...(senderCount
          ? {
              senderCount,
            }
          : {}),
        ...(originId
          ? {
              originId,
            }
          : {}),
        ...(pending.length
          ? {
              recipients:
                pending.map(
                  (item) =>
                    item.recipient,
                ),
            }
          : {}),
      };

      deliver(message);

      if (originId) {
        giftBombParents.set(
          originId,
          message.id,
        );

        /*
         * If an unusual ordering delivered child rows before the parent,
         * fold those temporary rows away once the announcement arrives.
         */
        for (
          const child of
          pending
        ) {
          opts.onDelete({
            id:
              child.messageId,
          });
        }

        pendingGiftChildren.delete(
          originId,
        );

        pruneGiftBombMaps();
      }

      return true;
    }

    const recipient =
      giftRecipient(p);

    if (
      originId &&
      recipient &&
      appendGiftRecipient(
        originId,
        recipient,
      )
    ) {
      return true;
    }

    const message =
      buildMessage(
        p,
        'system',
        '',
        [],
        'gift',
      );

    if (anonymous) {
      message.username =
        'Anonymous';

      message.senderUsername =
        'anonymous';

      message.senderId =
        '';
    }

    message.twitchGift = {
      type:
        'gift',
      anonymous,
      plan,
      count:
        1,
      ...(recipient
        ? {
            recipient,
          }
        : {}),
      ...(originId
        ? {
            originId,
          }
        : {}),
    };

    deliver(message);

    if (
      originId &&
      recipient
    ) {
      const pending =
        pendingGiftChildren.get(
          originId,
        ) ??
        [];

      pending.push({
        messageId:
          message.id,
        recipient,
      });

      pendingGiftChildren.set(
        originId,
        pending,
      );

      pruneGiftBombMaps();
    }

    return true;
  }

  function safeHttpsTag(
    value: string | undefined,
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    try {
      const url =
        new URL(value);

      return url.protocol ===
        'https:'
        ? url.toString()
        : undefined;
    } catch {
      return undefined;
    }
  }

  function buildRaidUsernotice(
    p: IrcLine,
  ): UnifiedMessage | null {
    if (
      p.tags['msg-id'] !==
      'raid'
    ) {
      return null;
    }

    const viewers =
      positiveInt(
        p.tags[
          'msg-param-viewerCount'
        ],
      ) ??
      1;

    const raiderLogin =
      p.tags[
        'msg-param-login'
      ] ||
      p.tags['login'] ||
      undefined;

    const raiderDisplayName =
      p.tags[
        'msg-param-displayName'
      ] ||
      p.tags[
        'display-name'
      ] ||
      raiderLogin ||
      'Raider';

    const profileImageUrl =
      safeHttpsTag(
        p.tags[
          'msg-param-profileImageURL'
        ],
      );

    const message =
      buildMessage(
        p,
        'system',
        '',
        [],
        'raid',
      );

    /*
     * USERNOTICE identity tags can vary, but the raid-specific msg-param
     * fields are Twitch's authoritative raider identity.
     */
    message.username =
      raiderDisplayName;

    message.senderUsername =
      raiderLogin ??
      raiderDisplayName
        .toLowerCase();

    message.twitchRaid = {
      raiderDisplayName,
      viewers,
      ...(raiderLogin
        ? {
            raiderLogin,
          }
        : {}),
      ...(profileImageUrl
        ? {
            profileImageUrl,
          }
        : {}),
      ...(p.tags['system-msg']
        ? {
            systemMessage:
              p.tags[
                'system-msg'
              ],
          }
        : {}),
    };

    return message;
  }

  function buildAnnouncementUsernotice(
    p: IrcLine,
  ): UnifiedMessage | null {
    if (
      p.tags['msg-id'] !==
      'announcement'
    ) {
      return null;
    }

    const text =
      p.trailing ?? '';

    const emotes =
      text
        ? parseTwitchEmotes(
            p.tags['emotes'] ?? '',
            text,
          )
        : [];

    const message =
      buildMessage(
        p,
        'system',
        text,
        emotes,
        'announcement',
      );

    message.twitchAnnouncement = {
      color:
        (
          p.tags[
            'msg-param-color'
          ] ??
          'PRIMARY'
        ).toUpperCase(),
      ...(p.tags['system-msg']
        ? {
            systemMessage:
              p.tags[
                'system-msg'
              ],
          }
        : {}),
    };

    return message;
  }

  function buildMilestoneUsernotice(
    p: IrcLine,
  ): UnifiedMessage | null {
    const msgId =
      p.tags['msg-id'] ?? '';

    let type:
      | 'watch-streak'
      | 'bits-badge'
      | 'modiversary'
      | null = null;

    let value:
      number | undefined;

    if (
      msgId ===
        'viewermilestone' &&
      (
        p.tags[
          'msg-param-category'
        ] ??
        ''
      ).toLowerCase() ===
        'watch-streak'
    ) {
      type =
        'watch-streak';

      value =
        positiveInt(
          p.tags[
            'msg-param-value'
          ],
        );
    }
    else if (
      msgId ===
      'watchstreak'
    ) {
      type =
        'watch-streak';

      value =
        positiveInt(
          p.tags[
            'msg-param-value'
          ],
        ) ??
        positiveInt(
          p.tags[
            'msg-param-streak-months'
          ],
        );
    }
    else if (
      msgId ===
      'bitsbadgetier'
    ) {
      type =
        'bits-badge';

      value =
        positiveInt(
          p.tags[
            'msg-param-threshold'
          ],
        );
    }
    else if (
      msgId ===
      'modiversary'
    ) {
      type =
        'modiversary';

      value =
        positiveInt(
          p.tags[
            'msg-param-months'
          ],
        );
    }

    if (
      !type ||
      !value
    ) {
      return null;
    }

    const text =
      p.trailing ?? '';

    const emotes =
      text
        ? parseTwitchEmotes(
            p.tags['emotes'] ?? '',
            text,
          )
        : [];

    const channelPoints =
      positiveInt(
        p.tags[
          'msg-param-copoReward'
        ],
      );

    const message =
      buildMessage(
        p,
        'system',
        text,
        emotes,
        'milestone',
      );

    message.twitchMilestone = {
      type,
      value,
      ...(channelPoints
        ? {
            channelPoints,
          }
        : {}),
      ...(p.tags['system-msg']
        ? {
            systemMessage:
              p.tags[
                'system-msg'
              ],
          }
        : {}),
    };

    return message;
  }

  function trueTag(
    value: string | undefined,
  ): boolean {
    if (!value) {
      return false;
    }

    const normalized =
      value.toLowerCase();

    return (
      normalized === '1' ||
      normalized === 'true'
    );
  }

  function buildSubscriptionTransitionUsernotice(
    p: IrcLine,
  ): UnifiedMessage | null {
    const msgId =
      p.tags['msg-id'] ?? '';

    let type:
      | 'prime-paid-upgrade'
      | 'gift-paid-upgrade'
      | 'anonymous-gift-paid-upgrade'
      | 'standard-pay-forward'
      | 'community-pay-forward'
      | null = null;

    switch (msgId) {
      case 'primepaidupgrade':
        type =
          'prime-paid-upgrade';
        break;

      case 'giftpaidupgrade':
        type =
          'gift-paid-upgrade';
        break;

      case 'anongiftpaidupgrade':
        type =
          'anonymous-gift-paid-upgrade';
        break;

      case 'standardpayforward':
        type =
          'standard-pay-forward';
        break;

      case 'communitypayforward':
        type =
          'community-pay-forward';
        break;

      default:
        return null;
    }

    const text =
      p.trailing ?? '';

    const emotes =
      text
        ? parseTwitchEmotes(
            p.tags['emotes'] ?? '',
            text,
          )
        : [];

    const message =
      buildMessage(
        p,
        'system',
        text,
        emotes,
        'subscription',
      );

    const priorAnonymous =
      type ===
        'anonymous-gift-paid-upgrade' ||
      trueTag(
        p.tags[
          'msg-param-prior-gifter-anonymous'
        ],
      );

    const priorGifterDisplayName =
      priorAnonymous
        ? undefined
        : (
            p.tags[
              'msg-param-sender-name'
            ] ||
            p.tags[
              'msg-param-prior-gifter-display-name'
            ] ||
            p.tags[
              'msg-param-sender-login'
            ] ||
            p.tags[
              'msg-param-prior-gifter-user-name'
            ] ||
            undefined
          );

    const recipientDisplayName =
      p.tags[
        'msg-param-recipient-display-name'
      ] ||
      p.tags[
        'msg-param-recipient-user-name'
      ] ||
      undefined;

    const promoGiftTotal =
      positiveInt(
        p.tags[
          'msg-param-promo-gift-total'
        ],
      );

    const promoName =
      p.tags[
        'msg-param-promo-name'
      ] ||
      undefined;

    const plan =
      p.tags[
        'msg-param-sub-plan'
      ] ||
      undefined;

    message.twitchSubscriptionTransition = {
      type,
      ...(plan
        ? {
            plan,
          }
        : {}),
      ...(priorGifterDisplayName
        ? {
            priorGifterDisplayName,
          }
        : {}),
      ...(priorAnonymous
        ? {
            priorGifterAnonymous:
              true,
          }
        : {}),
      ...(recipientDisplayName
        ? {
            recipientDisplayName,
          }
        : {}),
      ...(promoName
        ? {
            promoName,
          }
        : {}),
      ...(promoGiftTotal
        ? {
            promoGiftTotal,
          }
        : {}),
      ...(p.tags['system-msg']
        ? {
            systemMessage:
              p.tags[
                'system-msg'
              ],
          }
        : {}),
    };

    return message;
  }

  function handleLine(line: string) {
    const p = parseLine(line);
    if (!p) return;

    switch (p.command) {
      case 'PING':
        ws?.send(`PONG :${p.trailing ?? 'tmi.twitch.tv'}`);
        break;
      case 'JOIN':
        if ((p.prefix ?? '').startsWith('justinfan')) opts.onStatus('connected');
        break;
      case 'ROOMSTATE': {
        const roomId = p.tags['room-id'];
        if (roomId && !roomIdSent) {
          roomIdSent = true;
          opts.onRoomId?.(roomId);


          loadFFZRoomBadges(roomId)
            .then(overrides => {
              Object.assign(badgeMap, overrides);
              opts.onBadgeMap?.(badgeMap);
            })
            .catch(() => { /* keep stock art */ });
        }
        break;
      }
      case 'PRIVMSG': {
        const text = p.trailing ?? '';
        let emotes = parseTwitchEmotes(p.tags['emotes'] ?? '', text);
        const bits = p.tags['bits'];
        if (bits) {
          const parsedBits =
            Number.parseInt(
              bits,
              10,
            );

          const message =
            buildMessage(
              p,
              'system',
              text,
              emotes,
              'cheer',
            );

          message.twitchCheer = {
            bits:
              Number.isFinite(
                parsedBits,
              )
                ? Math.max(
                    0,
                    parsedBits,
                  )
                : 0,
            cheermotes: [],
          };

          deliver(
            withCurrentCheermotes(
              message,
            ),
          );
        } else {
          const msg = buildMessage(p, 'chat', text, emotes);
          if (p.tags['first-msg'] === '1') msg.firstMessage = true;
          // channel-point redeems: custom-reward-id / highlighted-message tag
          if (p.tags['custom-reward-id'] || p.tags['msg-id'] === 'highlighted-message') {
            msg.redeem = p.tags['custom-reward-id'] || 'highlighted';
          }
          deliver(msg);
        }
        break;
      }
      case 'USERNOTICE': {
        /*
         * New subs/resubs get structured rows. Everything else keeps the
         * existing generic USERNOTICE behavior until its dedicated card lands.
         */
        if (
          handleGiftUsernotice(
            p,
          )
        ) {
          break;
        }

        const raid =
          buildRaidUsernotice(
            p,
          );

        if (raid) {
          deliver(raid);
          break;
        }

        const announcement =
          buildAnnouncementUsernotice(
            p,
          );

        if (announcement) {
          deliver(
            announcement,
          );
          break;
        }

        const milestone =
          buildMilestoneUsernotice(
            p,
          );

        if (milestone) {
          deliver(
            milestone,
          );
          break;
        }

        const transition =
          buildSubscriptionTransitionUsernotice(
            p,
          );

        if (transition) {
          deliver(
            transition,
          );
          break;
        }

        const subscription =
          buildSubscriptionUsernotice(
            p,
          );

        if (subscription) {
          deliver(subscription);
          break;
        }

        const systemMsg =
          (
            p.tags[
              'system-msg'
            ] ?? ''
          ).trim();

        const userMsg =
          p.trailing ?? '';

        let emotes =
          userMsg
            ? parseTwitchEmotes(
                p.tags[
                  'emotes'
                ] ?? '',
                userMsg,
              )
            : [];

        let text:
          string;

        if (
          systemMsg &&
          userMsg
        ) {
          ({
            text,
            emotes,
          } = prefixText(
            systemMsg,
            userMsg,
            emotes,
          ));
        }
        else {
          text =
            systemMsg ||
            userMsg;
        }

        if (text) {
          deliver(
            buildMessage(
              p,
              'system',
              text,
              emotes,
              usernoticeCategory(
                p.tags[
                  'msg-id'
                ] ?? '',
              ),
            ),
          );
        }

        break;
      }
      case 'CLEARMSG': {
        const id = p.tags['target-msg-id'];
        if (id) opts.onDelete({ id });
        break;
      }
      case 'CLEARCHAT': {
        // Trailing user = ban/timeout; no trailing = full clear
        const login = (p.trailing ?? '').toLowerCase();
        opts.onDelete(login ? { username: login } : {});
        break;
      }
      case 'RECONNECT':
        ws?.close();
        break;
    }
  }

  function connect() {
    if (stopped) return;
    opts.onStatus('connecting');
    ws = new WebSocket(IRC_URL);
    ws.onopen = () => {
      backoff = 1000;
      ws!.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws!.send(`NICK justinfan${Math.floor(10000 + Math.random() * 90000)}`);
      ws!.send(`JOIN #${channel}`);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (line) handleLine(line);
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      opts.onStatus('connecting', `Reconnecting in ${Math.round(backoff / 1000)}s`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
    ws.onerror = () => ws?.close();
  }

  return {
    start() {
      if (!channel) {
        opts.onStatus('error', 'Invalid Twitch channel');
        return;
      }
      connect();
    },
    stop() {
      stopped = true;
      generation += 1;
      deliveredMessages.clear();
      ws?.close();
    },
  };
}
