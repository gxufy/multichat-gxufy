/*
 * The chat overlay's engine (web/src/lib/overlay/chat/MultichatOverlay.svelte):
 * connectors for Kick, Twitch, YouTube and TikTok;
 * 7TV/BTTV/FFZ emotes and 7TV cosmetics (with live 7TV events); the message
 * model; the presentation clock (with the moderation and cosmetics holds);
 * fades; moderator deletes; restore on reload; the Hype Train row; !flosschat
 * commands, floats and speech; usage reporting and the owner's refresh
 * commands.
 *
 * A page starts it with the URL query and a host that receives what to draw;
 * it returns the stop function (null when the query names no channel or does
 * not parse). It needs a browser: it uses window, document and EventSource.
 */
import {
  hasConfiguredMultichatChannel,
  MULTICHAT_MAX_MESSAGE_LINES,
  multichatKickChannel,
  multichatPlatformCount,
  safeParseMultichatConfig,
  type MultichatConfig,
} from './multichatConfig';
import {
  getSevenTVGlobalEmotes,
  getSevenTVChannelEmotes,
  type KickChannel,
  type SevenTVEmote,
  type SevenTVBadge,
  type SevenTVPaint,
  type Entitlements,
  type ParsedMessage,
} from './kick';
import type { Connector, Platform, UnifiedMessage } from './types';
import { createKickConnector } from './connectors/kick';
import { createTwitchConnector } from './connectors/twitch';
import { createYouTubeConnector } from './connectors/youtube';
import { createTikTokConnector } from './connectors/tiktok';
/* The one UnifiedMessage → ParsedMessage conversion, and the one display filter,
   shared with the generator preview so both apply the parse-time settings and the
   blacklists identically. */
import { buildMessageFilter, buildParsedMessage } from './multichatMessageModel';
import type { MentionPaint } from './renderCore';
import { subscribeRuntimeEventVisibility } from './multichatEventRuntime';
import { clearTwitchEmoteResourceCache, loadTwitchEmotes } from './twitchEmotes';
import { isJilTVEmoteImage, loadJilTVTwitchEmotes } from './jiltvEmotes';
import { JILTV_COSMETICS_ENABLED } from './jiltvCosmetics';
import { buildSevenTVEventUrl } from './sevenTVEventUrl';
import { routeSevenTVDispatch } from './sevenTVEventRouting';
import { SevenTVPersonalEmoteStore } from './sevenTVPersonalEmotes';
import { clearSevenTVEmoteSetCache } from './sevenTVEmoteSetCache';
import { createCosmeticsFetcher } from './cosmetics';
import { createSevenTVBadgeFromEvent, parseSevenTVPaint } from './cosmeticMetadata';
import { createMessageFadeScheduler, MOD_DELETE_COLLAPSE_MS } from './messageFadeScheduler';
import {
  startTwitchHypeTrainPoller,
  type TwitchHypeTrainEvent,
  type TwitchHypeTrainPoller,
} from './twitchHypeTrainPoller';
import {
  RELOAD_STAMP_KEY,
  createMultichatCommandRunner,
} from './multichatCommandRuntime';
import { publishCounterBackgroundControl } from './multichatControlBus';
import {
  BURST_PRESENT_INTERVAL_MS,
  MOD_REMOVAL_HOLD_MS,
  drainBurstPresentationQueue,
  startBurstPresentationTicker,
  takeReadyPresentationPrefix,
} from './chatBurstPresentation';
import {
  loadRestoredMultichatMessages,
  multichatMessageStorageKey,
  multichatSessionStorage,
  saveRestoredMultichatMessages,
} from './multichatMessagePersistence';
import { createOverlayUsageReporter } from './overlayUsage';
import { startOverlayRefreshWatcher, type OverlayChannel } from './overlayRefreshWatcher';
import { multichatBadgeSlotSizePx } from './limerinoBadges';
import { applyLimerinoLiveUpdate } from './communityBadges';
import { readStoredEmotes, storeEmotes, type StoredEmotePlatform } from './emoteListStore';
import {
  STARTUP_LOADER_FADE_MS,
  STARTUP_LOADER_MAX_MS,
  STARTUP_LOADER_MIN_MS,
  type StartupLoaderPhase,
} from './startupLoader';
import { BoundedMap, BoundedSet, CHATTER_MEMORY_LIMIT, MENTION_MEMORY_LIMIT } from './boundedCollections';
import { startOverlayStreamMux } from './overlayEventStream';
import { hypeTrainUpdate } from './render/hypeTrainCard';
import { createPaintChoices, type PaintSource } from './paintChoice';

/* Longest a smooth-mode update waits for an animation frame before it is
   drawn anyway (OBS may not give a hidden source frames). */
const FRAME_FLUSH_FALLBACK_MS = 250;

const RESTORE_WRITE_DELAY_MS = 100;

/** The URL query as a page has it (parsed search params; a repeated key is a list). */
export type MultichatQuery = Readonly<Record<string, string | string[] | undefined>>;

/** What the runtime tells the page to draw. */
export interface MultichatRuntimeHost {
  /** The parsed settings, once, before anything else. */
  onConfig(config: MultichatConfig): void;
  /** The startup card's phase. */
  onLoaderPhase(phase: StartupLoaderPhase): void;
  /** The rows on screen now, oldest first (a new array each time). */
  onMessages(messages: ParsedMessage[]): void;
  /** The rows fading out now (a new set each time). */
  onFadingIds(ids: Set<string>): void;
  /** Whether Shared Chat partner rows are shown (changed by sharedon/sharedoff). */
  onSharedChat(enabled: boolean): void;
  /** A connection error to show instead of chat (null clears it). */
  onError(message: string | null): void;
}

/** Live 7TV state the message model reads; mutable, so later arrivals apply on the next rebuild. */
type RuntimeState = {
  emotes: { kick: SevenTVEmote[]; twitch: SevenTVEmote[]; youtube: SevenTVEmote[] };
  badges: SevenTVBadge[];
  paints: SevenTVPaint[];
  entitlements: Entitlements;
  /** Chatters' personal 7TV emotes, keyed `${platform}:${senderId}`. */
  personalEmotes: Record<string, SevenTVEmote[]>;
  /** Which paint chatters wearing both asked for (paintChoice.ts). */
  paintSources: ReadonlyMap<string, PaintSource>;
  messages: ParsedMessage[];
  channel: KickChannel | null;
  config: MultichatConfig | null;
};

/** Starts the overlay for this query; returns its stop function, or null if there is nothing to show. */
/** The live Hype Train card (one row in the chat; see upsertHypeTrainEvent). */
function isHypeTrainRow(message: { category?: string }): boolean {
  return message.category === 'hypetrain';
}

export function startMultichatRuntime(query: MultichatQuery, host: MultichatRuntimeHost): (() => void) | null {
  const state: RuntimeState = {
    emotes: { kick: [], twitch: [], youtube: [] },
    badges: [],
    paints: [],
    entitlements: {},
    personalEmotes: {},
    paintSources: new Map(),
    messages: [],
    channel: null,
    config: null,
  };
  /** Rows already handed to the page, and rows waiting for the presentation clock. */
  const queues: { presented: ParsedMessage[]; pending: ParsedMessage[] } = { presented: [], pending: [] };

  const parsed = safeParseMultichatConfig(query);
  if (!parsed.success) return null;
  const cfg = {
    ...parsed.data,
    // Smooth handling is the normal runtime path. Existing/generated URLs do
    // not need a flag; smoothScroll=0/false is the explicit legacy fallback.
    smoothScroll: query.smoothScroll === undefined
      ? true
      : parsed.data.smoothScroll,
  };
  const kickChannel = multichatKickChannel(cfg);
  const platformCount = multichatPlatformCount(cfg);
  if (!hasConfiguredMultichatChannel(cfg)) return null;

  host.onConfig(cfg);
  host.onSharedChat(cfg.sharedChatEnabled);
  host.onError(null);
  state.config = cfg;
  host.onLoaderPhase('visible');

  const loaderStartedAt = Date.now();
  let loaderDismissRequested = false;
  let loaderMinimumTimer: ReturnType<typeof setTimeout> | null = null;
  let loaderFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let loaderMaximumTimer: ReturnType<typeof setTimeout> | null = null;

  function beginLoaderFade() {
    if (loaderDismissRequested) return;
    loaderDismissRequested = true;
    host.onLoaderPhase('fading');
    loaderFadeTimer = setTimeout(() => host.onLoaderPhase('hidden'), STARTUP_LOADER_FADE_MS);
  }

  function dismissLoaderWhenEligible() {
    if (loaderDismissRequested || loaderMinimumTimer) return;
    const remaining = STARTUP_LOADER_MIN_MS - (Date.now() - loaderStartedAt);
    if (remaining <= 0) {
      beginLoaderFade();
      return;
    }
    loaderMinimumTimer = setTimeout(() => {
      loaderMinimumTimer = null;
      beginLoaderFade();
    }, remaining);
  }

  loaderMaximumTimer = setTimeout(beginLoaderFade, STARTUP_LOADER_MAX_MS);

  const s = state;
  /* Twitch is where chatters wear JilTV paints, so its channel names the
     remembered choices. */
  const paintChoices = createPaintChoices(cfg.twitch ? `twitch:${cfg.twitch.trim().toLowerCase()}` : '');
  s.paintSources = paintChoices.sources;
  s.messages = [];
  queues.presented = [];
  queues.pending = [];
  host.onMessages([]);
  /* The overlay's server streams (owner commands, Kick, YouTube, TikTok) share
     one connection from here on (lib/overlayEventStream). */
  const stopStreamMux = startOverlayStreamMux();
  const connectors: Connector[] = [];
  const cleanups: (() => void)[] = [];
  let twitchRoomId: string | null = null; // for !multichat refresh emotes
  let youtubeChannelId: string | null = null;
  let kickUsageChannel = '';
  const usageReporter = createOverlayUsageReporter([
    ...(kickChannel ? ['kick' as const] : []),
    ...(cfg.twitch ? ['twitch' as const] : []),
    ...(cfg.youtube ? ['youtube' as const] : []),
    ...(cfg.tiktok ? ['tiktok' as const] : []),
  ]);
  cleanups.push(() => usageReporter.stop());


  const cosmeticsFetcher = createCosmeticsFetcher(
    {
      get paints() { return s.paints; },
      set paints(value) { s.paints = value; },
      get badges() { return s.badges; },
      set badges(value) { s.badges = value; },
      entitlements: s.entitlements,
    },
    (keys) => {
      const keySet = new Set(keys);
      let touched = false;
      s.messages = s.messages.map(m => {
        if (!m.platform || !m.senderId || !m.raw) return m;
        if (!keySet.has(`${m.platform}:${m.senderId}`)) return m;
        touched = true;
        return rebuildParsed(m);
      });
      if (touched) markDirty();
    },
  );
  cleanups.push(() => cosmeticsFetcher.stop());
  // Loader hides once every requested platform has reported some status
  const settled = new Set<string>();
  let greeted = false;
  function settle(platform: string) {
    settled.add(platform);
    if (settled.size >= platformCount) {
      dismissLoaderWhenEligible();

      if (!greeted) {
        greeted = true;
        showFloat(1, 'FlossChat by @Gxufy', 5000, 0.3);
      }
    }
  }


  /* Bounded so a long stream in a big channel doesn't grow memory for hours. */
  const mentionColors = new BoundedMap<string, string>(MENTION_MEMORY_LIMIT);
  const mentionCtx = {
    enabled: cfg.mentionColor,
    colors: mentionColors,
    paints: new BoundedMap<string, MentionPaint>(MENTION_MEMORY_LIMIT),
  };

  /* UnifiedMessage → ParsedMessage. The conversion itself now lives in
     lib/multichatMessageModel, because the generator's preview has to perform
     exactly the same one — four settings (both 7TV toggles, paintShadows,
     mentionColor) are applied during this step rather than by ChatOverlay, so a
     preview that built nodes by hand could not respond to any of them.

     `s` is passed as the cosmetics source: its emotes/badges/paints/
     entitlements/channel fields are precisely what the conversion reads, and
     they are live, so a paint arriving later applies on the next rebuild. */
  const buildParsed = (um: UnifiedMessage): ParsedMessage =>
    buildParsedMessage(um, cfg, s, mentionCtx, Date.now());

  /* Twitch's emote list for this overlay: FFZ, BTTV, JilTV (when on) and 7TV
     with 7TV emotes on, JilTV's alone with only JilTV emotes on, else none. */
  function loadOverlayTwitchEmotes(
    roomId: string,
    fresh: boolean,
    sevenTVChannel?: Parameters<typeof loadTwitchEmotes>[3],
  ): Promise<SevenTVEmote[]> {
    if (cfg.sevenTVEmotesEnabled) {
      return loadTwitchEmotes(roomId, undefined, fresh, sevenTVChannel, cfg.jiltvEmotesEnabled);
    }
    if (cfg.jiltvEmotesEnabled) return loadJilTVTwitchEmotes(roomId, undefined, fresh);
    return Promise.resolve([]);
  }

  function replacePlatformEmotes(
    platform: 'kick' | 'twitch',
    emotes: SevenTVEmote[],
  ) {
    if (!cfg.sevenTVEmotesEnabled && !(platform === 'twitch' && cfg.jiltvEmotesEnabled)) return;

    s.emotes[platform] = emotes;

    let touched = false;
    s.messages = s.messages.map((message) => {
      if (message.platform !== platform || message.raw == null) return message;
      touched = true;
      return rebuildParsed(message);
    });

    if (touched) markDirty();
  }

  const rebuildParsed = (
    previous: ParsedMessage,
    raw = previous.raw as UnifiedMessage,
  ): ParsedMessage => ({
    ...buildParsed(raw),
    id: previous.id,
    timestamp: previous.timestamp,
    ...(previous.suppressEntryAnimation ? { suppressEntryAnimation: true } : {}),
  });

  /* Last session's emote list for this channel, shown straight away while
     the fresh one loads; the fresh list replaces it the normal way (see
     lib/emoteListStore). Only used while no list is loaded yet. */
  function applyStoredEmotes(platform: StoredEmotePlatform, channelId: string) {
    if (!cfg.sevenTVEmotesEnabled || s.emotes[platform].length) return;
    let stored = readStoredEmotes(platform, channelId);
    /* A list kept while JilTV emotes were on still has them; leave them out
       now that they're off. */
    if (stored && !cfg.jiltvEmotesEnabled) stored = stored.filter((emote) => !isJilTVEmoteImage(emote.image));
    if (!stored?.length) return;
    s.emotes[platform] = stored;
    let touched = false;
    s.messages = s.messages.map((message) => {
      if (message.platform !== platform || message.raw == null) return message;
      touched = true;
      return rebuildParsed(message);
    });
    if (touched) markDirty();
  }

  /* Personal 7TV emotes: one store per overlay session, read by the message
     model through `s.personalEmotes`. Only the messages of chatters whose
     personal emotes changed are rebuilt. */
  const personalEmoteStore = new SevenTVPersonalEmoteStore();
  s.personalEmotes = personalEmoteStore.byUser;
  const rebuildSenders = (keys: string[]) => {
    if (!keys.length) return;
    const keySet = new Set(keys);
    let touched = false;
    s.messages = s.messages.map((message) => {
      if (!message.platform || !message.senderId || !message.raw) return message;
      if (!keySet.has(`${message.platform}:${message.senderId}`)) return message;
      touched = true;
      return rebuildParsed(message);
    });
    if (touched) markDirty();
  };

  /* Bots and blacklists, from the same helper the generator's preview uses.
     These gates run before ChatOverlay sees a message, so the preview has to
     apply the identical predicate to respond to the filter settings at all. */
  const shouldDisplay = buildMessageFilter(cfg);

  /* Twitch supplies a real first-message flag. Other providers do not, so
     their equivalent is the first live message observed from each chatter
     during this browser-source session. Backlog rows are excluded by time. */
  const sessionStartedAt = Date.now();
  const sessionFirstSeen = new BoundedSet<string>(CHATTER_MEMORY_LIMIT);
  function withSessionFirstMessage(message: UnifiedMessage): UnifiedMessage {
    if (message.platform === 'twitch' || message.kind !== 'chat') return message;
    if ((message.timestamp ?? 0) < sessionStartedAt - 2_000) return message;
    const identity = message.senderId || message.username.trim().toLowerCase();
    if (!identity) return message;
    const key = `${message.platform}:${identity}`;
    if (sessionFirstSeen.has(key)) return message;
    sessionFirstSeen.add(key);
    return { ...message, firstMessage: true };
  }

  /* Runtime visibility controls deliberately do not stop connectors. That is
     what lets a moderator issue twitchon/youtubeon from a platform that is
     currently hidden without reloading the browser source. */
  const hiddenPlatforms = new Set<Platform>();
  let sharedChatRuntime = cfg.sharedChatEnabled;
  let chatPresentationPaused = false;
  let pausedChatMessages: UnifiedMessage[] = [];


  /* Match the production phase-locked presentation clock: one 200 ms interval
     commits whatever connector messages are waiting. Repaint-only mutations
     keep their existing OBS-safe frame path and never reveal queued arrivals
     ahead of that clock. */
  const smoothRuntime = cfg.smoothScroll;
  let dirty = false;
  let flushFrame: number | null = null;
  let flushFallback: ReturnType<typeof setTimeout> | null = null;

  /* When each row first appeared on screen. The fade timer counts from this
     (local clock), not from the platform's own timestamp, which can be
     seconds off between Twitch, Kick, YouTube and TikTok. */
  const shownAtById = new Map<string, number>();

  function publishMessages(next: ParsedMessage[]) {
    queues.presented = next;
    host.onMessages(next);
  }

  function latestPresentedMessages() {
    const byId = new Map(s.messages.map((message) => [message.id, message] as const));
    return queues.presented
      .filter((message) => byId.has(message.id))
      .map((message) => byId.get(message.id)!);
  }

  function flushMessages() {
    if (!dirty) return;
    dirty = false;
    publishMessages(latestPresentedMessages());
  }

  function runFrameFlush() {
    if (flushFrame !== null) cancelAnimationFrame(flushFrame);
    if (flushFallback !== null) clearTimeout(flushFallback);
    flushFrame = null;
    flushFallback = null;
    flushMessages();
  }

  function markDirty() {
    dirty = true;
    if (!smoothRuntime || flushFrame !== null) return;
    flushFrame = requestAnimationFrame(runFrameFlush);
    /* A hidden browser source may get no animation frames; this still drains. */
    flushFallback = setTimeout(runFrameFlush, FRAME_FLUSH_FALLBACK_MS);
  }

  /* When each waiting message arrived, for the removal hold and the 7TV
     cosmetics hold. */
  const pendingArrivedAt = new Map<string, number>();
  /* Hold each new message for half a second so a quick delete, timeout or
     ban (moderation bots act within about 0.4 s) lands before it is shown:
     removeMessages drops messages that are not on screen yet. Pointless when
     moderation actions are turned off. */
  const removalHoldMs = cfg.modAction ? MOD_REMOVAL_HOLD_MS : 0;

  function flushBurstPresentation() {
    const liveIds = new Set(s.messages.map((message) => message.id));
    queues.pending = queues.pending.filter((message) => liveIds.has(message.id));
    for (const id of pendingArrivedAt.keys()) if (!liveIds.has(id)) pendingArrivedAt.delete(id);
    /* Rows that have left the list (the 100-message cap, clears, hidden
       platforms) no longer need their on-screen time; without this a long
       stream would keep one entry per message it ever showed. */
    for (const id of shownAtById.keys()) if (!liveIds.has(id)) shownAtById.delete(id);
    /* A new chatter's first message waits (briefly) for their 7TV paint and
       badge so it is shown complete; see takeReadyPresentationPrefix. */
    const ready = takeReadyPresentationPrefix(
      queues.pending,
      (message) => Boolean(message.platform)
        && cosmeticsFetcher.isPending(message.platform ?? '', message.senderId),
      (message) => pendingArrivedAt.get(message.id),
      Date.now(),
      removalHoldMs,
    );
    for (const message of ready) pendingArrivedAt.delete(message.id);
    const batch = drainBurstPresentationQueue(ready);

    if (batch.length) {
      const byId = new Map(s.messages.map((message) => [message.id, message] as const));
      let current = latestPresentedMessages();
      const currentIds = new Set(current.map((message) => message.id));
      for (const message of batch) {
        const latest = byId.get(message.id);
        if (!latest || currentIds.has(message.id)) continue;
        current.push(latest);
        currentIds.add(message.id);
        if (!shownAtById.has(message.id)) shownAtById.set(message.id, Date.now());
      }
      /* The Hype Train card moves down: its new copy takes the old one's
         place in the same tick, so the card is never missing in between. */
      const hypeRows = current.filter(isHypeTrainRow);
      if (hypeRows.length > 1) {
        const superseded = new Set(hypeRows.slice(0, -1).map((message) => message.id));
        current = current.filter((message) => !superseded.has(message.id));
        s.messages = s.messages.filter((message) => !superseded.has(message.id));
      }
      publishMessages(current.slice(-100));
      /* Arm the fade countdown for the rows just shown. When they arrived
         they were still held back (not on screen), so a quiet chat had
         nothing to arm it with and the last rows stayed until the next
         message came. (Called from the ticker, after setup has run.) */
      fadeScheduler?.wake();
    }
  }

  function enqueueBurstPresentation(message: ParsedMessage) {
    if (
      queues.presented.some((presented) => presented.id === message.id)
      || queues.pending.some((pending) => pending.id === message.id)
    ) return;
    queues.pending.push(message);
    pendingArrivedAt.set(message.id, Date.now());
  }

  const stopBurstPresentationTicker = startBurstPresentationTicker(flushBurstPresentation);

  const restoreStorage = cfg.restoreOnReload ? multichatSessionStorage() : null;
  const restoreStorageKey = restoreStorage ? multichatMessageStorageKey(cfg) : '';
  const restoreOptions = {
    maxMessages: cfg.maxMessageLines,
    maxAgeSeconds: cfg.maxMessageAge,
  };
  let restoreWriteTimer: ReturnType<typeof setTimeout> | null = null;

  function persistMessagesNow() {
    if (!restoreStorage) return;
    if (restoreWriteTimer) {
      clearTimeout(restoreWriteTimer);
      restoreWriteTimer = null;
    }
    saveRestoredMultichatMessages(
      restoreStorage,
      restoreStorageKey,
      s.messages.filter(
        (message) =>
          message.category !==
          'hypetrain'
          && !message.deleted,
      ),
      restoreOptions,
    );
  }

  function scheduleMessagePersistence() {
    if (!restoreStorage || restoreWriteTimer) return;
    restoreWriteTimer = setTimeout(persistMessagesNow, RESTORE_WRITE_DELAY_MS);
  }

  function pauseChatPresentation() {
    chatPresentationPaused = true;
  }

  function resumeChatPresentation() {
    if (!chatPresentationPaused) return;
    chatPresentationPaused = false;
    const buffered = pausedChatMessages;
    pausedChatMessages = [];
    for (const message of buffered) addMessage(message);
  }

  function toggleChatPresentation() {
    if (chatPresentationPaused) resumeChatPresentation();
    else pauseChatPresentation();
  }

  function bufferPausedChatMessage(message: UnifiedMessage) {
    pausedChatMessages.push(message);
    const overflow = pausedChatMessages.length - MULTICHAT_MAX_MESSAGE_LINES;
    if (overflow > 0) pausedChatMessages.splice(0, overflow);
  }

  /**
   * Clear every ordinary-message layer in one command turn.
   *
   * Floats/media, speech, visibility controls, runtime feature switches,
   * and provider connectors live outside these stores and are intentionally left
   * alone. Persist immediately so a browser-source reload cannot race a delayed
   * write and restore rows that the command just removed.
   */
  function clearOrdinaryChatMessages() {
    s.messages = [];
    queues.pending = [];
    pausedChatMessages = [];
    dirty = false;
    publishMessages([]);
    persistMessagesNow();
  }

  if (restoreStorage) {
    const restored = loadRestoredMultichatMessages(
      restoreStorage,
      restoreStorageKey,
      restoreOptions,
    )
      .filter(({ raw }) => !(raw.platform === 'twitch' && raw.sharedChat && !sharedChatRuntime))
      .filter(({ raw }) => shouldDisplay(raw))
      .map(({ raw, displayedAt }) => ({
        ...buildParsed(raw),
        timestamp: displayedAt,
        suppressEntryAnimation: true,
      }));
    s.messages = restored;
    publishMessages(restored);
    for (const message of restored) {
      if (
        cfg.sevenTVCosmeticsEnabled
        && (message.platform === 'kick' || message.platform === 'twitch')
        && message.senderId
      ) {
        cosmeticsFetcher.want(message.platform, message.senderId);
      }
    }
    window.addEventListener('pagehide', persistMessagesNow);
    cleanups.push(() => {
      window.removeEventListener('pagehide', persistMessagesNow);
      persistMessagesNow();
    });
  }

  const flushInterval: ReturnType<typeof setInterval> | null = smoothRuntime
    ? null
    : setInterval(flushMessages, 200);
  let fadeScheduler: ReturnType<typeof createMessageFadeScheduler> | null = null;

  /* The live Hype Train is one row in the chat. Each time the train changes
     the card is drawn again as the newest row (a fresh id, so it arrives like
     a new event) and the old one goes; its level-up celebration comes with
     its data (render/hypeTrainCard: hypeTrainUpdate). */
  let latestHypeTrainEvent:
    TwitchHypeTrainEvent
    | null = null;

  let hypeTrainHideTimer:
    ReturnType<
      typeof setTimeout
    >
    | null = null;

  let hypeTrainRowSequence = 0;

  /* Started with the connectors (Twitch only); poked by contributions in chat. */
  let hypeTrainPoller: TwitchHypeTrainPoller | null = null;


  function removeHypeTrainRow(
    clearLatest = false,
  ) {
    /*
     * A completed train is intentionally ephemeral. If visibility changes
     * while its five-second completion state is showing, never preserve that
     * ended state for a later events-on/platform-on command.
     */
    if (
      latestHypeTrainEvent?.phase ===
      'end'
    ) {
      clearLatest = true;
    }

    if (
      hypeTrainHideTimer
    ) {
      clearTimeout(
        hypeTrainHideTimer,
      );

      hypeTrainHideTimer =
        null;
    }

    const before =
      s.messages.length;

    s.messages =
      s.messages.filter(
        (message) =>
          !isHypeTrainRow(message),
      );

    queues.pending =
      queues.pending.filter(
        (message) =>
          !isHypeTrainRow(message),
      );

    if (clearLatest) {
      latestHypeTrainEvent =
        null;
    }

    if (
      s.messages.length !==
      before
    ) {
      markDirty();
    }
  }

  function upsertHypeTrainEvent(
    incoming:
      TwitchHypeTrainEvent,
  ) {
    /* A celebration starts here, once, as the update arrives. */
    const event =
      hypeTrainUpdate(
        latestHypeTrainEvent,
        incoming,
        Date.now(),
      );

    latestHypeTrainEvent =
      event;

    if (
      hypeTrainHideTimer
    ) {
      clearTimeout(
        hypeTrainHideTimer,
      );

      hypeTrainHideTimer =
        null;
    }

    hypeTrainRowSequence += 1;

    const raw:
      UnifiedMessage = {
      platform: 'twitch',
      id: `hype-train-${hypeTrainRowSequence}`,
      senderId:
        'twitch-hype-train',
      username: 'Twitch',
      color: '#9147ff',
      badges: [],
      text:
        event.phase ===
        'end'
          ? `Hype Train complete at Level ${event.level}`
          : `Hype Train Level ${event.level}: ${event.progress} / ${event.goal}`,
      emotes: [],
      timestamp:
        Date.now(),
      kind: 'system',
      category:
        'hypetrain',
      hypeTrain:
        event,
    };

    if (
      hiddenPlatforms.has(
        'twitch',
      ) ||
      !shouldDisplay(raw)
    ) {
      removeHypeTrainRow();
      return;
    }

    /* The new card arrives as the newest row and replaces the old one as it
       is shown (see the presentation tick); a copy not yet shown is dropped. */
    queues.pending =
      queues.pending.filter(
        (message) =>
          !isHypeTrainRow(message),
      );

    const parsed =
      buildParsed(raw);

    s.messages.push(
      parsed,
    );

    if (
      s.messages.length >
      100
    ) {
      s.messages.shift();
    }

    enqueueBurstPresentation(
      parsed,
    );

    markDirty();

    if (
      event.phase ===
      'end'
    ) {
      const hideAfter =
        Math.max(
          0,
          event.hideAfterMs ??
            5_000,
        );

      hypeTrainHideTimer =
        setTimeout(
          () => {
            hypeTrainHideTimer =
              null;

            latestHypeTrainEvent =
              null;

            removeHypeTrainRow(
              true,
            );
          },
          hideAfter,
        );
    }
  }

  const stopHypeTrainVisibility =
    subscribeRuntimeEventVisibility(
      (
        target,
        visible,
      ) => {
        if (
          target !== 'all' &&
          target !==
            'hypetrain'
        ) {
          return;
        }

        if (!visible) {
          removeHypeTrainRow();
          return;
        }

        if (
          latestHypeTrainEvent
        ) {
          upsertHypeTrainEvent(
            latestHypeTrainEvent,
          );
        }
      },
    );

  cleanups.push(
    stopHypeTrainVisibility,
  );

  cleanups.push(() => {
    if (
      hypeTrainHideTimer
    ) {
      clearTimeout(
        hypeTrainHideTimer,
      );
    }

    hypeTrainHideTimer =
      null;

    latestHypeTrainEvent =
      null;
  });

  function setPlatformChatVisible(platform: Platform, visible: boolean) {
    if (visible) {
      hiddenPlatforms.delete(platform);

      if (
        platform === 'twitch' &&
        latestHypeTrainEvent
      ) {
        upsertHypeTrainEvent(
          latestHypeTrainEvent,
        );
      }

      return;
    }
    hiddenPlatforms.add(platform);
    s.messages = s.messages.filter((message) => message.platform !== platform);
    scheduleMessagePersistence();
    markDirty();
  }

  function setSharedChatVisible(visible: boolean) {
    sharedChatRuntime = visible;
    host.onSharedChat(visible);
    if (visible) return;
    s.messages = s.messages.filter((message) => {
      if (message.platform !== 'twitch' || !message.raw) return true;
      return !(message.raw as UnifiedMessage).sharedChat;
    });
    scheduleMessagePersistence();
    markDirty();
  }

  function addMessage(incoming: UnifiedMessage) {
    const um = withSessionFirstMessage(incoming);
    /* Shared partner traffic is completely outside the overlay while the
       feature is off, including its commands. Local Twitch chat remains live
       and can turn Shared Chat on at any time. */
    if (um.platform === 'twitch' && um.sharedChat && !sharedChatRuntime) return;
    const restoredDuplicate = cfg.restoreOnReload && s.messages.some((message) => {
      if (!message.raw) return false;
      const raw = message.raw as UnifiedMessage;
      return raw.platform === um.platform && raw.id === um.id;
    });
    /* A sub, gift or cheer can start or move a Hype Train: look now rather
       than at the next scheduled check. */
    if (
      !restoredDuplicate
      && um.platform === 'twitch'
      && (um.category === 'subscription' || um.category === 'gift' || um.category === 'cheer')
    ) {
      hypeTrainPoller?.poke();
    }
    const handledCommand = restoredDuplicate
      ? null
      : handleCommand(um); // !multichat commands work from any enabled source chat
    /* Commands run before platform suppression so a hidden platform can issue
       its own ...on command. A sharedoff command can also remove its own
       partner row immediately after it executes. */
    if (um.platform === 'twitch' && um.sharedChat && !sharedChatRuntime) return;
    /* Successful history/presentation controls should not become ordinary
       chat rows themselves. Other commands keep their historical rendering
       behavior, including while paused. */
    if (
      handledCommand?.name === 'clear'
      || handledCommand?.name === 'pause'
      || handledCommand?.name === 'resume'
      || handledCommand?.name === 'togglepause'
    ) return;
    if (hiddenPlatforms.has(um.platform)) return;
    if (!shouldDisplay(um)) return;
    if (chatPresentationPaused && um.kind === 'chat') {
      bufferPausedChatMessage(um);
      return;
    }
    // queue this chatter for GQL cosmetics (kick/twitch only)
    if (cfg.sevenTVCosmeticsEnabled && (um.platform === 'kick' || um.platform === 'twitch')) {
      cosmeticsFetcher.want(um.platform, um.senderId);
    }
    const parsedMessage = buildParsed(um);
    const existingIndex = cfg.restoreOnReload
      ? s.messages.findIndex((message) => message.id === parsedMessage.id)
      : -1;
    if (existingIndex >= 0) {
      parsedMessage.timestamp = s.messages[existingIndex]!.timestamp;
      s.messages[existingIndex] = parsedMessage;
      scheduleMessagePersistence();
      markDirty();
      fadeScheduler?.wake();
      dismissLoaderWhenEligible();
      return;
    }
    s.messages.push(parsedMessage);
    if (s.messages.length > 100) s.messages.shift();
    scheduleMessagePersistence();
    enqueueBurstPresentation(parsedMessage);
    fadeScheduler?.wake();
    dismissLoaderWhenEligible();
  }

  /*
   * Moderator deletes/bans/clears. A row that is already on screen is marked
   * deleted: its content vanishes at once and its space closes smoothly
   * (MOD_DELETE_COLLAPSE_MS), so the rows above glide down instead of
   * jumping, and no gap is left behind. Once closed it is taken out of the
   * list, which moves nothing because it has no height left. A message that
   * has not been shown yet is simply dropped.
   */
  const deleteCollapseTimers = new Set<ReturnType<typeof setTimeout>>();
  cleanups.push(() => {
    for (const timer of deleteCollapseTimers) clearTimeout(timer);
    deleteCollapseTimers.clear();
  });

  function dropCollapsedRows(ids: readonly string[]) {
    const gone = new Set(ids);
    const before = s.messages.length;
    s.messages = s.messages.filter((m) => !gone.has(m.id));
    for (const id of ids) shownAtById.delete(id);
    if (s.messages.length === before) return;
    scheduleMessagePersistence();
    markDirty();
    fadeScheduler?.wake();
  }

  function removeMessages(platform: string, opts: { id?: string; username?: string; senderId?: string }) {
    if (!cfg.modAction) return;
    const matches = (m: ParsedMessage) => {
      if (opts.id) return m.id === `${platform}:${opts.id}`;
      if (opts.senderId) return m.platform === platform && m.senderId === opts.senderId;
      if (opts.username) return m.platform === platform && m.identity.username.toLowerCase() === opts.username.toLowerCase();
      return m.platform === platform;
    };
    const onScreen = new Set(queues.presented.map((m) => m.id));
    const collapsing: string[] = [];
    let changed = false;
    s.messages = s.messages.flatMap((m) => {
      if (!matches(m)) return [m];
      changed = true;
      if (!onScreen.has(m.id)) return [];
      if (m.deleted) return [m];
      collapsing.push(m.id);
      return [{ ...m, deleted: true }];
    });
    if (!changed) return;
    scheduleMessagePersistence();
    markDirty();
    if (!collapsing.length) return;
    /* The flag reaches the screen on the next presentation tick; allow for
       that plus the full collapse before the row is removed. */
    const timer = setTimeout(() => {
      deleteCollapseTimers.delete(timer);
      dropCollapsedRows(collapsing);
    }, BURST_PRESENT_INTERVAL_MS + MOD_DELETE_COLLAPSE_MS + 50);
    deleteCollapseTimers.add(timer);
  }

  if (kickChannel) {
    const kick = createKickConnector({
      channel: kickChannel,
      onMessage: addMessage,
      onDelete: o => removeMessages('kick', o),
      onStatus: (status, detail) => {
        if (status === 'connected') {
          settle('kick');
          if (kickUsageChannel) usageReporter.resolved('kick', kickUsageChannel);
        }
        if (status === 'error') { host.onError(detail ?? 'Kick connection error'); settle('kick'); }
      },
      onChannelInfo: async channel => {
        s.channel = channel;
        kickUsageChannel = channel.slug;
        if (!cfg.sevenTVEmotesEnabled && !cfg.sevenTVCosmeticsEnabled) return;

        applyStoredEmotes('kick', channel.user_id.toString());
        /* Channel and global sets load together, not one after the other. */
        const globalLoad = cfg.sevenTVEmotesEnabled ? getSevenTVGlobalEmotes() : null;
        const {
          emotes: channelEmotes,
          setId,
          stvUserId,
        } = await getSevenTVChannelEmotes(channel.user_id.toString());

        if (cfg.sevenTVEmotesEnabled) {
          const global = (await globalLoad) ?? [];
          const combined = new Map(global.map((emote) => [emote.name, emote]));
          for (const emote of channelEmotes) combined.set(emote.name, emote);
          s.emotes.kick = [...combined.values()];
          if (setId || channelEmotes.length) storeEmotes('kick', channel.user_id.toString(), s.emotes.kick);
        }

        if (cfg.sevenTVCosmeticsEnabled || cfg.sevenTVEmotesEnabled) {
          const eventChannelId = channel.user.id.toString();
          const connectionId = channel.user_id.toString();
          const sseUrl = buildSevenTVEventUrl('kick', eventChannelId, stvUserId, setId);

          open7TVEvents(
            sseUrl,
            'kick',
            stvUserId,
            setId,
            eventChannelId,
            async () => {
              clearSevenTVEmoteSetCache();
              const latest = await getSevenTVChannelEmotes(connectionId, 'kick', true);
              if (cfg.sevenTVEmotesEnabled) {
                const global = await getSevenTVGlobalEmotes(true);
                const combined = new Map(global.map((emote) => [emote.name, emote]));
                for (const emote of latest.emotes) combined.set(emote.name, emote);
                replacePlatformEmotes('kick', [...combined.values()]);
                if (latest.setId || latest.emotes.length) storeEmotes('kick', connectionId, s.emotes.kick);
              }

              return {
                sseUrl: buildSevenTVEventUrl(
                  'kick',
                  eventChannelId,
                  latest.stvUserId,
                  latest.setId,
                ),
                stvUserId: latest.stvUserId,
                setId: latest.setId,
              };
            },
          );
        }
      },
    });
    connectors.push(kick);
  }

  /* ── Twitch (anonymous IRC; 7TV emotes via room-id) ── */
  if (cfg.twitch) {
    connectors.push(createTwitchConnector({
      channel: cfg.twitch,
      /* No JilTV paint lookups at all with JilTV Cosmetics off. */
      jiltvCosmetics: JILTV_COSMETICS_ENABLED && cfg.jiltvCosmeticsEnabled,
      communityBadgeRenderOptions: {
        slotSizePx: multichatBadgeSlotSizePx(cfg.textSize, cfg.textSizePx),
        displayScale: window.devicePixelRatio || 1,
        reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      },
      onMessage: addMessage,
      shouldEnrichSourceChannel: () => sharedChatRuntime,
      onMessageUpdate: updated => {
        let touched = false;
        s.messages = s.messages.map(message => {
          if (message.id !== `twitch:${updated.id}` || message.platform !== 'twitch' || !message.raw) return message;
          const raw = message.raw as UnifiedMessage;
          if (raw.sourceChannel?.roomId !== updated.sourceChannel?.roomId) return message;
          touched = true;
          return rebuildParsed(message, updated);
        });
        if (touched) {
          scheduleMessagePersistence();
          markDirty();
        }
      },
      onDelete: o => removeMessages('twitch', o),
      onBadgeMap: (badgeMap) => {
        let touched = false;
        s.messages = s.messages.map((message) => {
          if (message.platform !== 'twitch' || !message.raw) return message;
          const raw = message.raw as UnifiedMessage;
          const badges = raw.badges.map((badge) => {
            const version = badge.version ?? (badge.count ? String(badge.count) : '1');
            const url = badgeMap[`${badge.type}/${version}`] ?? badgeMap[`${badge.type}/1`];
            return url ? { ...badge, url } : badge;
          });
          touched = true;
          return rebuildParsed(message, { ...raw, badges });
        });
        if (touched) {
          scheduleMessagePersistence();
          markDirty();
        }

      },
      onStatus: (status, detail) => {
        if (status !== 'connecting') settle('twitch');
        if (status === 'error' && platformCount === 1) host.onError(detail ?? 'Twitch connection error');
      },
      onRoomId: async roomId => {
        twitchRoomId = roomId;
        usageReporter.resolved('twitch', cfg.twitch);

        /* One 7TV channel request (several MB on big channels) serves both
           the emote catalog and the event subscription below. */
        const sevenTVChannel = cfg.sevenTVEmotesEnabled || cfg.sevenTVCosmeticsEnabled
          ? getSevenTVChannelEmotes(roomId, 'twitch')
          : null;

        if (cfg.sevenTVEmotesEnabled || cfg.jiltvEmotesEnabled) {
          applyStoredEmotes('twitch', roomId);
          // FFZ → BTTV → JilTV → 7TV (later wins), scoped to Twitch so a
          // same-name Kick emote can never alter Twitch rendering.
          s.emotes.twitch = await loadOverlayTwitchEmotes(roomId, false, sevenTVChannel ?? undefined);
          let touched = false;
          s.messages = s.messages.map((message) => {
            if (message.platform !== 'twitch' || message.raw == null) return message;
            touched = true;
            return rebuildParsed(message);
          });
          if (touched) markDirty();
        }

        // The 7TV event connection maintains live emote sets and cosmetics independently.
        if (sevenTVChannel) {
          const initial = await sevenTVChannel;
          /* Keep the list for next time, but only when 7TV answered: a list
             missing its 7TV half would be a poor stand-in. */
          if (cfg.sevenTVEmotesEnabled && (initial.setId || initial.emotes.length)) {
            storeEmotes('twitch', roomId, s.emotes.twitch);
          }
          const sseUrl = buildSevenTVEventUrl(
            'twitch',
            roomId,
            initial.stvUserId,
            initial.setId,
          );

          open7TVEvents(
            sseUrl,
            'twitch',
            initial.stvUserId,
            initial.setId,
            roomId,
            async () => {
              clearSevenTVEmoteSetCache();
              const latest = await getSevenTVChannelEmotes(roomId, 'twitch', true);

              if (cfg.sevenTVEmotesEnabled) {
                replacePlatformEmotes(
                  'twitch',
                  await loadOverlayTwitchEmotes(roomId, true, latest),
                );
                if (latest.setId || latest.emotes.length) storeEmotes('twitch', roomId, s.emotes.twitch);
              }

              return {
                sseUrl: buildSevenTVEventUrl(
                  'twitch',
                  roomId,
                  latest.stvUserId,
                  latest.setId,
                ),
                stvUserId: latest.stvUserId,
                setId: latest.setId,
              };
            },
          );
        }
      },
    }));
  }

  /* ── YouTube ── */
  if (cfg.youtube) {
    connectors.push(createYouTubeConnector({
      channel: cfg.youtube,
      onMessage: addMessage,
      onDelete: o => removeMessages('youtube', o),
      onChannelInfo: async ({ channelId }) => {
        youtubeChannelId = channelId;
        usageReporter.resolved('youtube', cfg.youtube);
        if (!cfg.sevenTVEmotesEnabled) return;
        applyStoredEmotes('youtube', channelId);
        const [{ emotes: channelEmotes, setId: youtubeSetId }, global] = await Promise.all([
          getSevenTVChannelEmotes(channelId, 'youtube'),
          getSevenTVGlobalEmotes(),
        ]);
        const combined = new Map(global.map((emote) => [emote.name, emote]));
        for (const emote of channelEmotes) combined.set(emote.name, emote);
        s.emotes.youtube = [...combined.values()];
        if (youtubeSetId || channelEmotes.length) storeEmotes('youtube', channelId, s.emotes.youtube);
        let touched = false;
        s.messages = s.messages.map((message) => {
          if (message.platform !== 'youtube' || !message.raw) return message;
          touched = true;
          return rebuildParsed(message);
        });
        if (touched) markDirty();
      },
      onStatus: (status, detail) => {
        if (status !== 'connecting') settle('youtube');
        if (status === 'error' && platformCount === 1) host.onError(detail ?? 'YouTube connection error');
      },
    }));
  }

  /* ── TikTok ── */
  if (cfg.tiktok) {
    connectors.push(createTikTokConnector({
      channel: cfg.tiktok,
      onMessage: addMessage,
      onDelete: o => removeMessages('tiktok', o),
      onStatus: (status, detail) => {
        if (status !== 'connecting') settle('tiktok');
        if (status === 'connected') usageReporter.resolved('tiktok', cfg.tiktok);
        if (status === 'error' && platformCount === 1) host.onError(detail ?? 'TikTok connection error');
      },
    }));
  }

  const floats: { [id: number]: { el: HTMLElement; timer: ReturnType<typeof setTimeout> | null } } = {};
  function showFloat(id: number, msg: string, timeoutMs = 5000, alpha = 0.3) {
    removeFloat(id);
    const el = document.createElement('pre');
    el.style.cssText = [
      'position:fixed','left:50%','bottom:1%','max-width:99%','white-space:pre-wrap',
      'margin:0','padding:2px',`background:rgba(0,0,0,${alpha})`,'color:#fff',
      'font-weight:800','font-size:18px','z-index:9999','transform:translate(-50%,0)',
      'pointer-events:none','font-family:inherit',
    ].join(';');
    el.textContent = msg;
    document.body.appendChild(el);
    floats[id] = { el, timer: timeoutMs > 0 ? setTimeout(() => removeFloat(id), timeoutMs) : null };
  }
  function removeFloat(id: number) {
    if (floats[id]) {
      if (floats[id].timer) clearTimeout(floats[id].timer!);
      floats[id].el.remove();
      delete floats[id];
    }
  }
  function removeAllFloats() { Object.keys(floats).forEach(id => removeFloat(Number(id))); }

  function setChatVisible(v: boolean) {
    const el = document.getElementById('chat_container');
    if (el) el.style.display = v ? '' : 'none';
  }

  /* ── !multichat commands ──
     The dispatcher is lib/multichatCommandRuntime: platform-neutral, and driven
     in tests through the real connectors. Everything platform-specific or
     effect-local is supplied here as the host.

     Audio and speech are tracked so `stop`, a further `tts`, and unmount can all
     silence them. Previously each `tts` created an Audio nobody held a reference
     to, so two commands talked over each other and neither stopped. */
  let activeAudio: HTMLAudioElement | null = null;
  let activeAudioUrl = '';

  function stopSpeaking() {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.src = '';
      activeAudio = null;
    }
    if (activeAudioUrl) {
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = '';
    }
    window.speechSynthesis?.cancel();
  }
  cleanups.push(stopSpeaking);

  /** Browser voice, used when the server proxy fails. */
  function speakFallback(t: string) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(t);
    utt.volume = 1.0;
    const go = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(v => v.name === 'Google UK English Male')
        || voices.find(v => v.lang === 'en-GB')
        || voices.find(v => v.lang.startsWith('en')) || null;
      if (v) utt.voice = v;
      window.speechSynthesis.speak(utt);
    };
    window.speechSynthesis.getVoices().length
      ? go()
      : window.speechSynthesis.addEventListener('voiceschanged', go, { once: true });
  }

  const commandRunner = createMultichatCommandRunner({
    channels: {
      kick: kickChannel,
      twitch: cfg.twitch ?? '',
      youtube: cfg.youtube ?? '',
      tiktok: cfg.tiktok ?? '',
    },
    getBroadcasterId: platform => (
      platform === 'youtube' ? youtubeChannelId ?? undefined : undefined
    ),
    showFloat,
    removeFloat,
    removeAllFloats,
    clearChatMessages: clearOrdinaryChatMessages,
    choosePaint(key, choice) {
      if (paintChoices.choose(key, choice)) rebuildSenders([key]);
    },
    setChatPresentationPaused(paused) {
      if (paused) pauseChatPresentation();
      else resumeChatPresentation();
    },
    toggleChatPresentationPaused: toggleChatPresentation,
    mountFloat(slot, el, timeoutMs) {
      removeFloat(slot);
      document.body.appendChild(el);
      floats[slot] = { el, timer: setTimeout(() => removeFloat(slot), timeoutMs) };
    },
    createElement: (tag) => document.createElement(tag),
    setChatVisible,
    setPlatformChatVisible,
    setSharedChatVisible,
    setCounterBackground(visible) {
      publishCounterBackgroundControl({
        kick: kickChannel,
        twitch: cfg.twitch ?? '',
        youtube: cfg.youtube ?? '',
        tiktok: cfg.tiktok ?? '',
      }, visible);
    },
    reload: () => window.location.reload(),
    async refreshEmotes() {
      // A manual refresh means "go get the current sets now", so drop the
      // by-id cache first — otherwise a set fetched under the TTL would be
      // served from memory and the command would be a silent no-op.
      clearSevenTVEmoteSetCache();
      clearTwitchEmoteResourceCache();
      const global = await getSevenTVGlobalEmotes(true);
      const ch = s.channel;
      const kick = new Map(global.map((emote) => [emote.name, emote]));
      if (ch) {
        const latest = await getSevenTVChannelEmotes(ch.user_id.toString(), 'kick', true);
        for (const emote of latest.emotes) kick.set(emote.name, emote);
      }
      const twitch = twitchRoomId
        ? await loadOverlayTwitchEmotes(twitchRoomId, true)
        : [];
      const youtube = new Map(global.map((emote) => [emote.name, emote]));
      if (youtubeChannelId) {
        const latest = await getSevenTVChannelEmotes(youtubeChannelId, 'youtube', true);
        for (const emote of latest.emotes) youtube.set(emote.name, emote);
      }
      // Commit a complete refresh only after all required fetches succeed.
      s.emotes = { kick: [...kick.values()], twitch, youtube: [...youtube.values()] };
      s.messages = s.messages.map((message) => rebuildParsed(message));
      markDirty();
    },
    findEmoteUrl: (name) => {
      if (!name) return null;
      return s.emotes.kick.find((emote) => emote.name === name)?.image
        ?? s.emotes.twitch.find((emote) => emote.name === name)?.image
        ?? s.emotes.youtube.find((emote) => emote.name === name)?.image
        ?? null;
    },
    speak(t) {
      stopSpeaking();
      fetch(`/api/tts?voice=Brian&text=${encodeURIComponent(t)}`)
        .then(r => { if (!r.ok) throw new Error('proxy failed'); return r.blob(); })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.volume = 1.0;
          activeAudio = audio;
          activeAudioUrl = url;
          audio.addEventListener('canplaythrough', () => audio.play().catch(() => {}));
          audio.addEventListener('ended', () => {
            if (activeAudio === audio) stopSpeaking();
          });
          audio.load();
        })
        .catch(() => speakFallback(t));
    },
    stopSpeaking,
    readReloadStamp() {
      const raw = window.sessionStorage?.getItem(RELOAD_STAMP_KEY);
      const at = raw === null || raw === undefined ? NaN : Number(raw);
      return Number.isFinite(at) ? at : null;
    },
    writeReloadStamp(at) {
      try { window.sessionStorage?.setItem(RELOAD_STAMP_KEY, String(at)); }
      catch { /* private mode: the cooldown degrades, the command still works */ }
    },
    now: () => Date.now(),
  });

  function handleCommand(um: UnifiedMessage) {
    return commandRunner.handle(um);
  }

  /* A command sent from Owner tools for this channel: run it exactly as if
     the streamer had typed it in chat. */
  let ownerCommandCount = 0;
  function runOwnerCommand(text: string) {
    ownerCommandCount += 1;
    handleCommand({
      platform: shownChannels[0]?.platform ?? 'twitch',
      id: `flosschat-owner-${Date.now()}-${ownerCommandCount}`,
      senderId: 'flosschat-owner',
      username: 'FlossChat',
      color: '',
      badges: [{ type: 'broadcaster' }],
      text: `!flosschat ${text}`,
      emotes: [],
      timestamp: Date.now(),
      kind: 'chat',
    });
  }

  /** Everything on screen or in the speakers, gone on unmount. */
  cleanups.push(removeAllFloats);

  /* Owner's "refresh all overlays" / "refresh one channel": reload the
     moment the server says so (see lib/overlayRefreshWatcher). */
  const shownChannels: OverlayChannel[] = [
    { platform: 'kick' as const, channel: kickChannel },
    { platform: 'twitch' as const, channel: cfg.twitch ?? '' },
    { platform: 'youtube' as const, channel: cfg.youtube ?? '' },
    { platform: 'tiktok' as const, channel: cfg.tiktok ?? '' },
  ].filter((shown) => Boolean(shown.channel));
  cleanups.push(startOverlayRefreshWatcher({
    channels: () => shownChannels,
    onRefresh: () => window.location.reload(),
    onCommand: runOwnerCommand,
    /* Twitch chat shows Limerino badges: take their changes live. */
    onLimerino: cfg.twitch ? applyLimerinoLiveUpdate : undefined,
  }));


  function handle7TVDispatch(data: any, platform: 'kick' | 'twitch') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const eventObject = data?.body && typeof data.body.object === 'object'
      && data.body.object !== null && !Array.isArray(data.body.object)
      ? data.body.object
      : null;
    if (data.type === 'cosmetic.create') {
      if (!eventObject) return;
      // cosmetic id lives on body.object.id (body.id is the event id —
      // storing that orphaned every entitlement lookup)
      const obj = eventObject;
      const id = obj?.id ?? data.body.id;
      if (obj.kind === 'BADGE') {
        const badge = createSevenTVBadgeFromEvent(id, obj.data?.host?.url);
        if (badge) s.badges.push(badge);
      }
      if (obj.kind === 'PAINT') {
        const d = obj.data;
        const paint = parseSevenTVPaint({ ...d, id });
        if (paint) s.paints.push(paint);
      }
    }
    if (data.type === 'entitlement.create') {
      if (!eventObject) return;
      const kind = eventObject.kind;

      // Personal emote sets are tracked separately; they must never be
      // stored as badge/paint refs (that clobbered every real paint ref).
      if (kind === 'EMOTE_SET') {
        if (cfg.sevenTVEmotesEnabled) rebuildSenders(personalEmoteStore.entitlement(true, eventObject, platform));
        return;
      }
      if (kind !== 'BADGE' && kind !== 'PAINT') return;
      const plat = platform === 'kick' ? 'KICK' : 'TWITCH';
      for (const conn of (eventObject.user?.connections ?? [])) {
        if (conn.platform === plat) {
          s.entitlements[`${platform}:${conn.id}`] = {
            ...s.entitlements[`${platform}:${conn.id}`],
            [kind === 'BADGE' ? 'badge' : 'paint']: eventObject.ref_id,
          };
        }
      }
    }
    if (data.type === 'entitlement.delete') {
      if (!eventObject) return;
      const kind = eventObject.kind;
      if (kind === 'EMOTE_SET') {
        if (cfg.sevenTVEmotesEnabled) rebuildSenders(personalEmoteStore.entitlement(false, eventObject, platform));
        return;
      }
      if (kind !== 'BADGE' && kind !== 'PAINT') return;
      const plat = platform === 'kick' ? 'KICK' : 'TWITCH';
      for (const conn of (eventObject.user?.connections ?? [])) {
        if (conn.platform === plat) {
          const key = kind === 'BADGE' ? 'badge' : 'paint';
          if (s.entitlements[`${platform}:${conn.id}`]?.[key] === eventObject.ref_id) {
            s.entitlements[`${platform}:${conn.id}`] = { ...s.entitlements[`${platform}:${conn.id}`], [key]: undefined };
          }
        }
      }
    }
    if (data.type === 'cosmetic.delete') {
      const obj = eventObject;
      if (obj?.kind === 'BADGE') s.badges = s.badges.filter(b => b.id !== obj.id);
      if (obj?.kind === 'PAINT') s.paints = s.paints.filter(p => p.id !== obj.id);
    }


  }


  function open7TVEvents(
    initialUrl: string,
    platform: 'kick' | 'twitch',
    initialStvUserId: string | null,
    initialSetId: string | null,
    channelId: string,
    refreshState: () => Promise<{ sseUrl: string; stvUserId: string | null; setId: string | null }>,
  ) {
    let sseUrl = initialUrl;
    let stvUserId = initialStvUserId;
    let activeSetId = initialSetId;
    let sse = new EventSource(sseUrl);
    let closed = false;
    let reconnecting = false;

    const reconnectWithAuthoritativeState = async () => {
      if (closed || reconnecting) return;
      reconnecting = true;

      try {
        const next = await refreshState();
        if (next?.sseUrl) sseUrl = next.sseUrl;
        stvUserId = next?.stvUserId ?? null;
        activeSetId = next?.setId ?? null;
      } catch {
        // Keep the last known subscription URL when the provider is transiently unavailable.
      }

      if (!closed) {
        sse.close();
        sse = new EventSource(sseUrl);
        attach();
      }

      reconnecting = false;
    };

    let catalogRefreshRunning = false;
    let catalogRefreshNeeded = false;
    const refreshCatalogFromActiveSet = async () => {
      catalogRefreshNeeded = true;
      if (catalogRefreshRunning) return;
      catalogRefreshRunning = true;
      try {
        while (!closed && catalogRefreshNeeded) {
          catalogRefreshNeeded = false;
          try {
            const next = await refreshState();
            if (next) activeSetId = next.setId ?? null;
          } catch { /* Retain the last complete catalog. */ }
        }
      } finally {
        catalogRefreshRunning = false;
      }
    };

    const onDispatch = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const route = routeSevenTVDispatch(data, { activeSetId, stvUserId });
        if (route === 'channel-set') {
          void refreshCatalogFromActiveSet();
          return;
        }
        if (route === 'personal-set') {
          if (!cfg.sevenTVEmotesEnabled) return;
          if (data.type === 'emote_set.create') rebuildSenders(personalEmoteStore.createSet(data.body));
          else if (data.type === 'emote_set.update') rebuildSenders(personalEmoteStore.updateSet(data.body));
          else if (data.type === 'emote_set.delete') rebuildSenders(personalEmoteStore.deleteSet(data.body));
          return;
        }
        handle7TVDispatch(data, platform);

        // A user update can switch the broadcaster's active emote set.
        // Re-resolve the connection and rebuild the subscription so the old
        // set cannot remain active in this overlay session.
        if (route === 'broadcaster-user') {
          void reconnectWithAuthoritativeState();
        }
      } catch { /* malformed provider events are ignored locally */ }
    };

    const onHello = (e: MessageEvent) => {
      if (!stvUserId) return;
      try {
        const sessionId = JSON.parse(e.data)?.session_id;
        if (!sessionId) return;
        fetch(`https://7tv.io/v3/users/${stvUserId}/presences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 1,
            passive: true,
            session_id: sessionId,
            data: { platform: platform.toUpperCase(), id: channelId },
          }),
        }).catch(() => { /* cosmetics degrade to delta-only */ });
      } catch { /* malformed hello */ }
    };

    const attach = () => {
      sse.addEventListener('dispatch', onDispatch);
      sse.addEventListener('hello', onHello);
      sse.onerror = () => {
        sse.close();
        if (closed) return;

        setTimeout(() => {
          if (closed) return;
          void reconnectWithAuthoritativeState();
        }, 3000);
      };
    };

    attach();
    cleanups.push(() => { closed = true; sse.close(); });
  }

  connectors.forEach(c => c.start());

  if (cfg.twitch) {
    hypeTrainPoller =
      startTwitchHypeTrainPoller({
        channel: cfg.twitch,
        onEvent:
          upsertHypeTrainEvent,
      });

    cleanups.push(
      hypeTrainPoller,
    );
  }

  if (cfg.fade !== false) {
    fadeScheduler = createMessageFadeScheduler({
      /* Screen order (oldest first); rows that have not been shown yet are
         not on screen, so they cannot be the one to fade next. */
      getMessages: () => {
        const onScreen = new Set(queues.presented.map((message) => message.id));
        return s.messages
          .filter((message) => message.category !== 'hypetrain' && onScreen.has(message.id))
          .map((message) => ({ id: message.id, timestamp: message.timestamp, shownAt: shownAtById.get(message.id) }));
      },
      fadeMs: (cfg.fade as number) * 1000,
      onFadingChange: (ids) => host.onFadingIds(ids),
      onRemove: (id) => {
        shownAtById.delete(id);
        s.messages = s.messages.filter((message) => message.id !== id);
        scheduleMessagePersistence();
        markDirty(); // removal uses the active flush policy
      },
    });
    // A connector may synchronously seed messages during start(). Arm the
    // first deadline once here even when addMessage ran before the scheduler
    // existed; later arrivals call wake() themselves.
    fadeScheduler.wake();
  }

  return () => {
    if (loaderMinimumTimer) clearTimeout(loaderMinimumTimer);
    if (loaderFadeTimer) clearTimeout(loaderFadeTimer);
    if (loaderMaximumTimer) clearTimeout(loaderMaximumTimer);
    if (flushInterval) clearInterval(flushInterval);
    if (flushFrame !== null) cancelAnimationFrame(flushFrame);
    if (flushFallback !== null) clearTimeout(flushFallback);
    stopBurstPresentationTicker();
    fadeScheduler?.stop();
    connectors.forEach(c => c.stop());
    cleanups.forEach(fn => fn());
    stopStreamMux();
  };
}
