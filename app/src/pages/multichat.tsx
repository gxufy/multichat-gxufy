'use client';

import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import {
  hasConfiguredMultichatChannel,
  MULTICHAT_MAX_MESSAGE_LINES,
  multichatKickChannel,
  multichatPlatformCount,
  safeParseMultichatConfig,
  type MultichatConfig,
} from '../lib/multichatConfig';
import {
  getSevenTVGlobalEmotes,
  getSevenTVChannelEmotes,
  type KickChannel,
  type SevenTVEmote,
  type SevenTVBadge,
  type SevenTVPaint,
  type Entitlements,
  type ParsedMessage,
} from '../lib/kick';
import type { Connector, Platform, UnifiedMessage, UnifiedPin } from '../lib/types';
import { createKickConnector } from '../lib/connectors/kick';
import { createTwitchConnector } from '../lib/connectors/twitch';
import { createYouTubeConnector } from '../lib/connectors/youtube';
import { createTikTokConnector } from '../lib/connectors/tiktok';
import { fallbackColor } from '../lib/render';
/* The one UnifiedMessage → ParsedMessage conversion, and the one display filter,
   shared with the generator preview so both apply the parse-time settings and the
   blacklists identically. */
import { buildMessageFilter, buildParsedMessage } from '../lib/multichatMessageModel';
import { loadTwitchEmotes } from '../lib/twitchEmotes';
import { clearSevenTVEmoteSetCache } from '../lib/sevenTVEmoteSetCache';
import { createCosmeticsFetcher } from '../lib/cosmetics';
import { createSevenTVBadgeFromEvent, parseSevenTVPaint } from '../lib/cosmeticMetadata';
import { createMessageFadeScheduler } from '../lib/messageFadeScheduler';
import { startTwitchPinPoller } from '../lib/twitchPinPoller';
import type { TwitchPinApiMessage } from '../lib/twitchPinClient';
import {
  resolveMultichatRoute,
  wantsCounterSection,
} from '../lib/multichatRouting';
import {
  RELOAD_STAMP_KEY,
  createMultichatCommandRunner,
} from '../lib/multichatCommandRuntime';
import { publishCounterBackgroundControl } from '../lib/multichatControlBus';
import ChatOverlay, {
  type PinnedState,
  type StartupLoaderPhase,
} from '../components/overlay/ChatOverlay';
import { SunsetBanner } from '../components/SunsetBanner';
import { drainBurstPresentationQueue, startBurstPresentationTicker } from '../lib/chatBurstPresentation';
import {
  loadRestoredMultichatMessages,
  multichatMessageStorageKey,
  multichatSessionStorage,
  saveRestoredMultichatMessages,
} from '../lib/multichatMessagePersistence';
import { createOverlayUsageReporter } from '../lib/overlayUsage';
import { multichatBadgeSlotSizePx } from '../lib/limerinoBadges';

/* The generator is a large editing UI that OBS never renders. Keep the overlay
 * renderer in the main /multichat bundle so its startup appearance is unchanged,
 * but load the generator chunk only when the channel-less generator branch is
 * actually rendered. This removes generator controls/previews/simulators from
 * the browser-source parse/evaluation path without creating a second renderer. */
const ClassicGenerator = dynamic(() => import('../components/classic/ClassicGenerator'));

/* Twitch pin polling: the generator appends an opaque connection id as a
 * URL fragment. Validated here, never rewritten, never logged. */
const TWITCH_CONN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Delay between successful pin polls. 5s is the poller's own floor
 *  (MIN_INTERVAL_MS), so this is the fastest cadence it will honour. */
const TWITCH_PIN_INTERVAL_MS = 5_000;
const RESTORE_WRITE_DELAY_MS = 100;

/**
 * How long a displayed Twitch pin may go unconfirmed before it is dropped.
 *
 * Transient lookup failures are retried with backoff and deliberately not shown
 * to the viewer, but a pin on screen is a claim that something is pinned *now*.
 * If the API stops answering after a pin is displayed, that claim goes
 * unverifiable — and if the streamer unpins during the outage, the overlay would
 * otherwise keep showing it for the rest of the stream.
 *
 * 60s is a deliberate trade. Showing a pin the streamer deliberately removed is
 * worse than briefly dropping one that is still up: the removed pin may be a
 * stale link or a correction, and a still-pinned message reappears on the next
 * successful poll a few seconds later. The window is long enough that ordinary
 * blips and a redeploy never clear anything.
 */
const TWITCH_PIN_STALE_AFTER_MS = 60_000;

/** Startup presentation timing for a configured production Chat overlay. */
export const STARTUP_LOADER_MIN_MS = 700;
export const STARTUP_LOADER_MAX_MS = 8_000;
export const STARTUP_LOADER_FADE_MS = 250;

/** True when *value* looks like a Twitch connection id. */
function isTwitchConnectionId(value: string): boolean {
  return TWITCH_CONN_RE.test(value);
}

/** TwitchPinApiMessage → UnifiedPin, using only fields the pins API returns.
 *  The id carries updatedAt so an edited pin becomes a distinct message. */
function toUnifiedTwitchPin(pin: TwitchPinApiMessage, badgeMap: Record<string, string> = {}): UnifiedPin {
  return {
    message: {
      platform: 'twitch',
      id: `${pin.messageId}:${pin.updatedAt}`,
      senderId: pin.senderUserId,  // real Twitch id — keys 7TV entitlements
      username: pin.senderUserName,
      color: pin.color,    // '' → fallbackColor()
      badges: pin.badges.map((badge) => {
        const url = badgeMap[`${badge.type}/${badge.version}`] ?? badgeMap[`${badge.type}/1`];
        return url ? { ...badge, url } : { ...badge };
      }),
      text: pin.text,
      emotes: pin.emotes,
      timestamp: Date.parse(pin.startsAt) || Date.now(),
      kind: 'chat',
    },
    pinnedBy: pin.pinnedByUserName,
  };
}

/* The query schema, defaults, aliases, and serializer now live in
 * lib/multichatConfig.ts. OverlayConfig is kept as an alias so the many
 * references below (and ChatOverlay's own typing) read unchanged. */
export type OverlayConfig = MultichatConfig;

/**
 * `/multichat` — the overlay OBS loads, and the generator that produces its URL.
 *
 * One route serves both, decided by whether the URL names a channel. That is not
 * a convenience: every scene collection anybody has ever configured points a
 * browser source at this path with channel parameters, and those files are not
 * going to be edited. So a channel-carrying URL renders the overlay, permanently,
 * and nothing about it redirects.
 *
 * A visit with no channel is somebody opening the site rather than a browser
 * source starting up, so it renders the generator. `/tools/multichat`,
 * `/tools/counter`, and `/classic/multichat` all redirect here.
 *
 * The two are separate components rather than branches inside one, because the
 * overlay's effects — IRC connections, cosmetics fetches, the pin poller — must
 * not run on a generator visit. Not rendering the component is what guarantees
 * that, rather than a growing set of early returns inside each effect.
 */
export default function Page() {
  const router = useRouter();

  /* The URL fragment, captured once on the client.
   *
   * Fragments are never sent to the server and never appear in `router.query`,
   * so this is the only way anything here can see one. Held in state and set
   * from an effect rather than read during render: reading
   * `window.location.hash` while rendering would differ between the server pass
   * (no window) and the client pass, which is exactly the hydration mismatch
   * this page cannot afford. `null` means "not looked yet". */
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    /* Effects are client-only, so window is available here and only here. */
    setHash(window.location.hash);
  }, []);

  /* Overlay or generator, by one pure rule (lib/multichatRouting). Channel
     parameters are checked first and always win. */
  const route = resolveMultichatRoute(router.isReady ? router.query : {});

  /* Nothing is decided until the query is parsed. Rendering the generator here
     would mount it for a split second on every overlay load in OBS. */
  if (!router.isReady) return null;

  if (route.kind === 'generator') {
    /* Waiting for the fragment read, so a visitor returning from OAuth is not
       shown the generator before the connection in the fragment can be adopted.
       One client render, not a network round trip. */
    if (hash === null) return null;
    return (
      <ClassicGenerator
        focusCounter={wantsCounterSection(router.query, hash)}
      />
    );
  }

  return <MultichatOverlay />;
}

/** The overlay itself. Mounted only for a channel-carrying URL. */
function MultichatOverlay() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [sharedChatEnabled, setSharedChatEnabled] = useState(false);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [loaderPhase, setLoaderPhase] = useState<StartupLoaderPhase>('hidden');
  const [pinnedMessage, setPinnedMessage] = useState<PinnedState | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── Twitch pin polling state ──
   * pinHandlerRef bridges to the main effect's handlePin so buildParsed
   * (and all cosmetics/emote logic) is reused rather than duplicated. */
  const pinHandlerRef = useRef<((pin: UnifiedPin | null) => void) | null>(null);
  /** Bridge to the main effect's cosmetics fetcher — pin authors may never chat. */
  const cosmeticsWantRef = useRef<((platform: 'kick' | 'twitch', senderId: string) => void) | null>(null);
  /** msg.id of the pin this poller installed, or '' when it owns none. */
  const twitchPinIdRef = useRef('');
  /** messageId:updatedAt of the last pin handed to the pin handler. */
  const twitchPinKeyRef = useRef('');
  /** Latest official Twitch badge artwork, including channel subscriber badges. */
  const twitchBadgeMapRef = useRef<Record<string, string>>({});
  /** Messages already handed to ChatOverlay. New arrivals wait only for the next browser paint. */
  const presentedMessagesRef = useRef<ParsedMessage[]>([]);
  const pendingMessagesRef = useRef<ParsedMessage[]>([]);

  /**
   * Clear the pinned message only when this poller still owns it.
   *
   * Uses a functional update so the decision is made against live state:
   * a newer Kick / YouTube / TikTok pin is never removed.
   */
  const clearOwnedTwitchPin = useCallback(() => {
    const installed = twitchPinIdRef.current;
    twitchPinIdRef.current = '';
    twitchPinKeyRef.current = '';
    if (!installed) return;
    setPinnedMessage(prev =>
      prev && prev.msg.platform === 'twitch' && prev.msg.id === installed ? null : prev);
  }, []);

  // Mutable state that doesn't trigger rerenders
  const stateRef = useRef<{
    emotes: { kick: SevenTVEmote[]; twitch: SevenTVEmote[]; youtube: SevenTVEmote[] };
    badges: SevenTVBadge[];
    paints: SevenTVPaint[];
    entitlements: Entitlements;
    messages: ParsedMessage[];
    channel: KickChannel | null;
    config: OverlayConfig | null;
  }>({
    emotes: { kick: [], twitch: [], youtube: [] },
    badges: [],
    paints: [],
    entitlements: {},
    messages: [],
    channel: null,
    config: null,
  });

  useEffect(() => {
    if (!router.isReady) return;
    setReady(true);

    const parsed = safeParseMultichatConfig(router.query);
    if (!parsed.success) return;
    const cfg = {
      ...parsed.data,
      // Smooth handling is the normal runtime path. Existing/generated URLs do
      // not need a flag; smoothScroll=0/false is the explicit legacy fallback.
      smoothScroll: router.query.smoothScroll === undefined
        ? true
        : parsed.data.smoothScroll,
    };
    const kickChannel = multichatKickChannel(cfg);
    const platformCount = multichatPlatformCount(cfg);
    if (!hasConfiguredMultichatChannel(cfg)) return;

    setConfig(cfg);
    setSharedChatEnabled(cfg.sharedChatEnabled);
    setError(null);
    stateRef.current.config = cfg;
    setLoaderPhase('visible');

    const loaderStartedAt = Date.now();
    let loaderDismissRequested = false;
    let loaderMinimumTimer: ReturnType<typeof setTimeout> | null = null;
    let loaderFadeTimer: ReturnType<typeof setTimeout> | null = null;
    let loaderMaximumTimer: ReturnType<typeof setTimeout> | null = null;

    function beginLoaderFade() {
      if (loaderDismissRequested) return;
      loaderDismissRequested = true;
      setLoaderPhase('fading');
      loaderFadeTimer = setTimeout(() => setLoaderPhase('hidden'), STARTUP_LOADER_FADE_MS);
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

    const s = stateRef.current;
    s.messages = [];
    presentedMessagesRef.current = [];
    pendingMessagesRef.current = [];
    setMessages([]);
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
        /* Repaint the visible Twitch pin too: pin authors are queued
           separately and their cosmetics usually land after the banner
           was built. Reuses msg.id, so PinBanner's cycle never restarts. */
        setPinnedMessage(prev => {
          if (!prev) return prev;
          const { platform, senderId, raw } = prev.msg;
          if (platform !== 'twitch' || !senderId || !raw) return prev;
          if (!keySet.has(`twitch:${senderId}`)) return prev;
          return {
            ...prev,
            msg: rebuildParsed(prev.msg, raw as UnifiedMessage),
          };
        });
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
          showFloat(1, 'Multi-Chat Overlay made by @Gxufy', 5000, 0.3);
        }
      }
    }

    
    const mentionColors = new Map<string, string>();
    const mentionCtx = { enabled: cfg.mentionColor, colors: mentionColors };

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

    const rebuildParsed = (
      previous: ParsedMessage,
      raw = previous.raw as UnifiedMessage,
    ): ParsedMessage => ({
      ...buildParsed(raw),
      id: previous.id,
      timestamp: previous.timestamp,
      ...(previous.suppressEntryAnimation ? { suppressEntryAnimation: true } : {}),
    });

    /* Bots and blacklists, from the same helper the generator's preview uses.
       These gates run before ChatOverlay sees a message, so the preview has to
       apply the identical predicate to respond to the filter settings at all. */
    const shouldDisplay = buildMessageFilter(cfg);

    /* Twitch supplies a real first-message flag. Other providers do not, so
       their equivalent is the first live message observed from each chatter
       during this browser-source session. Backlog rows are excluded by time. */
    const sessionStartedAt = Date.now();
    const sessionFirstSeen = new Set<string>();
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

    function publishMessages(next: ParsedMessage[]) {
      presentedMessagesRef.current = next;
      setMessages(next);
    }

    function latestPresentedMessages() {
      const byId = new Map(s.messages.map((message) => [message.id, message] as const));
      return presentedMessagesRef.current
        .filter((message) => byId.has(message.id))
        .map((message) => byId.get(message.id)!);
    }

    function flushMessages() {
      if (!dirty) return;
      dirty = false;
      publishMessages(latestPresentedMessages());
    }

    function markDirty() {
      dirty = true;
      if (!smoothRuntime || flushFrame !== null) return;
      flushFrame = requestAnimationFrame(() => {
        flushFrame = null;
        flushMessages();
      });
    }

    function flushBurstPresentation() {
      const liveIds = new Set(s.messages.map((message) => message.id));
      pendingMessagesRef.current = pendingMessagesRef.current.filter((message) => liveIds.has(message.id));
      const batch = drainBurstPresentationQueue(pendingMessagesRef.current);

      if (batch.length) {
        const byId = new Map(s.messages.map((message) => [message.id, message] as const));
        const current = latestPresentedMessages();
        const currentIds = new Set(current.map((message) => message.id));
        for (const message of batch) {
          const latest = byId.get(message.id);
          if (!latest || currentIds.has(message.id)) continue;
          current.push(latest);
          currentIds.add(message.id);
        }
        publishMessages(current.slice(-100));
      }
    }

    function enqueueBurstPresentation(message: ParsedMessage) {
      if (
        presentedMessagesRef.current.some((presented) => presented.id === message.id)
        || pendingMessagesRef.current.some((pending) => pending.id === message.id)
      ) return;
      pendingMessagesRef.current.push(message);
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
      s.messages,
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
   * Pins, floats/media, speech, visibility controls, runtime feature switches,
   * and provider connectors live outside these stores and are intentionally left
   * alone. Persist immediately so a browser-source reload cannot race a delayed
   * write and restore rows that the command just removed.
   */
  function clearOrdinaryChatMessages() {
    s.messages = [];
    pendingMessagesRef.current = [];
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

    function setPlatformChatVisible(platform: Platform, visible: boolean) {
      if (visible) {
        hiddenPlatforms.delete(platform);
        return;
      }
      hiddenPlatforms.add(platform);
      s.messages = s.messages.filter((message) => message.platform !== platform);
      scheduleMessagePersistence();
      markDirty();
    }

    function setSharedChatVisible(visible: boolean) {
      sharedChatRuntime = visible;
      setSharedChatEnabled(visible);
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

    function removeMessages(platform: string, opts: { id?: string; username?: string; senderId?: string }) {
      if (!cfg.modAction) return;
      if (opts.id) {
        s.messages = s.messages.filter(m => m.id !== `${platform}:${opts.id}`);
      } else if (opts.senderId) {
        s.messages = s.messages.filter(m => !(m.platform === platform && m.senderId === opts.senderId));
      } else if (opts.username) {
        s.messages = s.messages.filter(m => !(m.platform === platform && m.identity.username.toLowerCase() === opts.username!.toLowerCase()));
      } else {
        s.messages = s.messages.filter(m => m.platform !== platform);
      }
      scheduleMessagePersistence();
      markDirty();
    }

    function handlePin(pin: UnifiedPin | null) {
      if (!cfg.showPinEnabled) return;
      // per-platform pin toggle: latest pin from an enabled platform wins
      if (pin && !cfg.pinPlatforms.includes(pin.message.platform)) return;
      setPinnedMessage(pin ? { msg: buildParsed(pin.message), pinnedBy: pin.pinnedBy } : null);
    }

    /* Expose the pin pipeline to the Twitch polling effect below, so
       polled pins reuse buildParsed instead of duplicating it. */
    pinHandlerRef.current = handlePin;
    cleanups.push(() => { pinHandlerRef.current = null; });

    /* Same bridge for cosmetics: pin authors are queued explicitly because
       they may never send a chat message during this session. */
    cosmeticsWantRef.current = (platform, senderId) => {
      if (cfg.sevenTVCosmeticsEnabled) cosmeticsFetcher.want(platform, senderId);
    };
    cleanups.push(() => { cosmeticsWantRef.current = null; });

    /* ── Kick (incl. 7TV emotes/cosmetics) ── */
    if (kickChannel) {
      const kick = createKickConnector({
        channel: kickChannel,
        onMessage: addMessage,
        onDelete: o => removeMessages('kick', o),
        onPin: handlePin,
        onStatus: (status, detail) => {
          if (status === 'connected') {
            settle('kick');
            if (kickUsageChannel) usageReporter.resolved('kick', kickUsageChannel);
          }
          if (status === 'error') { setError(detail ?? 'Kick connection error'); settle('kick'); }
        },
        onChannelInfo: async channel => {
          s.channel = channel;
          kickUsageChannel = channel.slug;
          if (!cfg.sevenTVEmotesEnabled && !cfg.sevenTVCosmeticsEnabled) return;

          const {
            emotes: channelEmotes,
            setId,
            stvUserId,
          } = await getSevenTVChannelEmotes(channel.user_id.toString());

          if (cfg.sevenTVEmotesEnabled) {
            const globalEmotes = await getSevenTVGlobalEmotes();
            const kickEmotes = new Map(globalEmotes.map((emote) => [emote.name, emote]));
            for (const emote of channelEmotes) kickEmotes.set(emote.name, emote);
            s.emotes.kick = [...kickEmotes.values()];
          }

          if (cfg.sevenTVCosmeticsEnabled) {
            const sseUrl = `https://events.7tv.io/v3@entitlement.*<ctx=channel;platform=KICK;id=${channel.user.id}>,cosmetic.*<ctx=channel;platform=KICK;id=${channel.user.id}>${setId ? `,emote_set.*<object_id=${setId}>` : ''}`;
            open7TVEvents(sseUrl, 'kick', stvUserId, channel.user.id.toString());
          }
        },
      });
      connectors.push(kick);
    }

    /* ── Twitch (anonymous IRC; 7TV emotes via room-id) ── */
    if (cfg.twitch) {
      twitchBadgeMapRef.current = {};
      connectors.push(createTwitchConnector({
        channel: cfg.twitch,
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
        onPin: handlePin, // never fires — Twitch pins need OAuth
        onBadgeMap: (badgeMap) => {
          twitchBadgeMapRef.current = badgeMap;
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

          /* A pin can arrive before the badge HTTP request finishes. Rebuild
             that same parsed pin when artwork lands, preserving msg.id so
             PinBanner does not restart its five-second display cycle. */
          setPinnedMessage(prev => {
            if (!prev || prev.msg.platform !== 'twitch' || !prev.msg.raw) return prev;
            const raw = prev.msg.raw as UnifiedMessage;
            const badges = raw.badges.map((badge) => {
              const version = badge.version ?? (badge.count ? String(badge.count) : '1');
              const url = badgeMap[`${badge.type}/${version}`] ?? badgeMap[`${badge.type}/1`];
              return url ? { ...badge, url } : badge;
            });
            const changed = badges.some((badge, index) => badge.url !== raw.badges[index]?.url);
            if (!changed) return prev;
            return {
              ...prev,
              msg: rebuildParsed(prev.msg, { ...raw, badges }),
            };
          });
        },
        onStatus: (status, detail) => {
          if (status !== 'connecting') settle('twitch');
          if (status === 'error' && platformCount === 1) setError(detail ?? 'Twitch connection error');
        },
        onRoomId: async roomId => {
          twitchRoomId = roomId;
          usageReporter.resolved('twitch', cfg.twitch);

          if (cfg.sevenTVEmotesEnabled) {
            // FFZ → BTTV → 7TV (later wins), scoped to Twitch so a same-name
            // Kick emote can never alter Twitch rendering.
            s.emotes.twitch = await loadTwitchEmotes(roomId);
            let touched = false;
            s.messages = s.messages.map((message) => {
              if (message.platform !== 'twitch' || message.raw == null) return message;
              touched = true;
              return rebuildParsed(message);
            });
            if (touched) markDirty();
          }

          // Cosmetics are independent from the emote toggle.
          if (cfg.sevenTVCosmeticsEnabled) {
            let setId: string | null = null;
            let stvUserId: string | null = null;
            try {
              const r = await fetch(`https://7tv.io/v3/users/twitch/${roomId}`);
              if (r.ok) {
                const j = await r.json();
                // The event service remains v3; this profile lookup only gives
                // the presence user id and optional emote-set subscription id.
                setId = j?.emote_set_id ?? j?.emote_set?.id ?? null;
                stvUserId = j?.user?.id ?? null;
              }
            } catch { /* no 7tv profile */ }
            const sseUrl = `https://events.7tv.io/v3@entitlement.*<ctx=channel;platform=TWITCH;id=${roomId}>,cosmetic.*<ctx=channel;platform=TWITCH;id=${roomId}>${setId ? `,emote_set.*<object_id=${setId}>` : ''}`;
            open7TVEvents(sseUrl, 'twitch', stvUserId, roomId);
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
        onPin: handlePin,
        onChannelInfo: async ({ channelId }) => {
          youtubeChannelId = channelId;
          usageReporter.resolved('youtube', cfg.youtube);
          if (!cfg.sevenTVEmotesEnabled) return;
          const global = await getSevenTVGlobalEmotes();
          const { emotes: channelEmotes } = await getSevenTVChannelEmotes(channelId, 'youtube');
          const merged = new Map(global.map((emote) => [emote.name, emote]));
          for (const emote of channelEmotes) merged.set(emote.name, emote);
          s.emotes.youtube = [...merged.values()];
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
          if (status === 'error' && platformCount === 1) setError(detail ?? 'YouTube connection error');
        },
      }));
    }

    /* ── TikTok ── */
    if (cfg.tiktok) {
      connectors.push(createTikTokConnector({
        channel: cfg.tiktok,
        onMessage: addMessage,
        onDelete: o => removeMessages('tiktok', o),
        onPin: handlePin,
        onStatus: (status, detail) => {
          if (status !== 'connecting') settle('tiktok');
          if (status === 'connected') usageReporter.resolved('tiktok', cfg.tiktok);
          if (status === 'error' && platformCount === 1) setError(detail ?? 'TikTok connection error');
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
        const global = await getSevenTVGlobalEmotes();
        const kick = new Map(global.map((emote) => [emote.name, emote]));
        const ch = s.channel;
        if (ch) {
          const { emotes: channelEmotes } = await getSevenTVChannelEmotes(ch.user_id.toString());
          for (const emote of channelEmotes) kick.set(emote.name, emote);
        }
        const twitch = twitchRoomId ? await loadTwitchEmotes(twitchRoomId) : [];
        const youtube = new Map(global.map((emote) => [emote.name, emote]));
        if (youtubeChannelId) {
          const { emotes: channelEmotes } = await getSevenTVChannelEmotes(youtubeChannelId, 'youtube');
          for (const emote of channelEmotes) youtube.set(emote.name, emote);
        }
        // Replace complete provider catalogs atomically after every source settles.
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

    /** Everything on screen or in the speakers, gone on unmount. */
    cleanups.push(removeAllFloats);

    
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

        // the most common and MUST be ignored (treating them as paints
        // clobbered every real paint ref with an emote-set id)
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

      // land without a reload
      if (data.type === 'emote_set.update') {
        const body = data.body;
        for (const p of body.pulled ?? []) {
          const name = p.old_value?.name;
          if (name) s.emotes[platform] = s.emotes[platform].filter(e => e.name !== name);
        }
        for (const p of body.pushed ?? []) {
          const v = p.value;
          if (!v?.id) continue;
          s.emotes[platform] = s.emotes[platform].filter(e => e.name !== v.name);
          s.emotes[platform].push({
            name: v.name,
            image: `https://cdn.7tv.app/emote/${v.id}/4x.webp`,
            height: 28, width: 28,
            zeroWidth: ((v.data?.flags ?? 0) & 256) === 256,
            upscale: ((v.data?.flags ?? 0) & 128) === 128,
          });
        }
        for (const p of body.updated ?? []) {
          const oldName = p.old_value?.name, v = p.value;
          if (!oldName || !v) continue;
          const em = s.emotes[platform].find(e => e.name === oldName);
          if (em) em.name = v.name;
        }
      }
    }

    
    function open7TVEvents(sseUrl: string, platform: 'kick' | 'twitch', stvUserId: string | null, channelId: string) {
      let sse = new EventSource(sseUrl);
      let closed = false;
      const onDispatch = (e: MessageEvent) => {
        try { handle7TVDispatch(JSON.parse(e.data), platform); }
        catch { /* malformed third-party events are ignored locally */ }
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
            sse = new EventSource(sseUrl);
            attach();
          }, 3000);
        };
      };
      attach();
      cleanups.push(() => { closed = true; sse.close(); });
    }

    connectors.forEach(c => c.start());

    if (cfg.fade !== false) {
      fadeScheduler = createMessageFadeScheduler({
        getMessages: () => s.messages,
        fadeMs: (cfg.fade as number) * 1000,
        onFadingChange: setFadingIds,
        onRemove: (id) => {
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
      stopBurstPresentationTicker();
      fadeScheduler?.stop();
      connectors.forEach(c => c.stop());
      cleanups.forEach(fn => fn());
    };
  }, [router.isReady]);

  /* Twitch pins need an authorized poll — anonymous IRC carries no pin
     events (see lib/connectors/twitch.ts). Kept as its own effect so a
     pin-config change never tears down the chat connectors. */
  const twitchPinLogin = config?.twitch ? config.twitch.trim().toLowerCase().replace(/^@/, '') : '';
  const twitchPinsEnabled = !!config?.showPinEnabled && !!config?.pinPlatforms.includes('twitch');

  useEffect(() => {
    if (!twitchPinsEnabled || !twitchPinLogin) return;
    if (!pinHandlerRef.current) return;

    // Effects are client-only, so window is available. The fragment is
    // read without being rewritten or exposed.
    const connectionId = new URLSearchParams(window.location.hash.slice(1)).get('twitchConnectionId') ?? '';
    if (!isTwitchConnectionId(connectionId)) return;

    /* When the pins API last answered. Scoped to this effect run, so a
       reconnect or a config change starts the staleness clock fresh rather than
       inheriting a deadline from a previous poller. */
    let lastPinConfirmedAt = Date.now();

    const stopPolling = startTwitchPinPoller({
      connectionId,
      login: twitchPinLogin,
      intervalMs: TWITCH_PIN_INTERVAL_MS,
      onPin: pin => {
        /* Any answer confirms the API is reachable — including "nothing is
           pinned", which is what clears a pin on an ordinary unpin. */
        lastPinConfirmedAt = Date.now();
        if (pin === null) {
          clearOwnedTwitchPin();
          return;
        }
        // Unchanged pin — skip so the banner's hide cycle isn't restarted.
        const key = `${pin.messageId}:${pin.updatedAt}`;
        if (twitchPinKeyRef.current === key) return;
        const unified = toUnifiedTwitchPin(pin, twitchBadgeMapRef.current);
        // Queue the author for 7TV cosmetics. Past the dedupe guard, so this
        // runs once per distinct pin; the fetcher dedupes by key as well.
        if (unified.message.senderId) {
          cosmeticsWantRef.current?.('twitch', unified.message.senderId);
        }
        pinHandlerRef.current?.(unified);
        // Refs track ownership only after the handler has run.
        twitchPinKeyRef.current = key;
        twitchPinIdRef.current = `twitch:${unified.message.id}`;
      },
      onError: (error, fatal) => {
        // The fatal branch can fire at most once per poller.
        if (fatal) {
          if (error.code === 'invalid-request') {
            console.warn(
              'Twitch pin connection is no longer usable. Reconnect Twitch in the generator.',
            );
          } else if (error.code === 'channel-not-found') {
            console.warn(
              'Twitch pin polling stopped because the configured Twitch channel was not found.',
            );
          } else {
            console.warn('Twitch pin polling stopped.');
          }
          clearOwnedTwitchPin();
          return;
        }
        /* lookup-failed is retried with backoff and stays silent — a viewer
           should not see transport noise. But a pin we are still showing has now
           gone unconfirmed, so once the outage passes the staleness window, drop
           it rather than assert indefinitely that it is still pinned. */
        if (Date.now() - lastPinConfirmedAt > TWITCH_PIN_STALE_AFTER_MS) {
          clearOwnedTwitchPin();
        }
      },
    });

    return () => {
      stopPolling();
      clearOwnedTwitchPin();
    };
  }, [twitchPinsEnabled, twitchPinLogin, clearOwnedTwitchPin]);

  if (!ready) return null;

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white p-8">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold mb-2">Connection Error</h1>
          <p className="text-gray-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <>
      <Head>
        <title>multichat-gxufy</title>
      </Head>
      <SunsetBanner variant="overlay" />
      <ChatOverlay
        config={config}
        messages={messages}
        fadingIds={fadingIds}
        pinnedMessage={pinnedMessage}
        showLoader={loaderPhase}
        sharedChatEnabled={sharedChatEnabled}
        /* The parser defaults sourceTag to 'icon', so only the raw query can say
           whether the user actually asked for a mode. */
        sourceTagExplicit={router.query.sourceTag !== undefined}
      />
    </>
  );
}
