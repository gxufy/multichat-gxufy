/* The !multichat command implementation, as one platform-neutral unit.
 *
 * This used to live inside the overlay effect in pages/multichat.tsx, closed over
 * that effect's locals. It was correct there, but it could only be tested by
 * reading its own source text as a string — so "does a YouTube message reach the
 * img branch" was a question no test could actually answer, and the two defects
 * fixed alongside this extraction (a trigger that matched `!multichatting`, and an
 * image URL interpolated into innerHTML) were both invisible from that distance.
 *
 * The split is deliberate:
 *
 *   - `parseMultichatCommand` is pure. Trigger, name, args, and the remainder,
 *     from a raw message string.
 *   - `createMultichatCommandRunner` is the dispatcher. Everything it touches that
 *     is not a local — the document, timers, fetch, speech, reload — arrives as a
 *     `CommandHost`, so a test drives the real dispatcher with a recording host.
 *
 * Platform-neutrality is a property of the shape, not a promise in a comment: the
 * runner is handed a `UnifiedMessage` and reads `text`, `badges`,
 * `senderUsername`, and `platform`. There is no per-platform branch anywhere in
 * the dispatch path, so a message that a connector built cannot reach a different
 * set of commands depending on which connector built it.
 */
import type { Platform, UnifiedMessage } from './types';
import {
  MULTICHAT_ACCESS_BROADCASTER,
  MULTICHAT_ACCESS_MODERATOR,
  MULTICHAT_COMMAND_ALIAS,
  MULTICHAT_COMMAND_MIN_ACCESS,
  MULTICHAT_COMMAND_TRIGGER,
  canonicalMultichatCommandName,
} from './multichatCommands';
import {
  setRuntimeEventFeatureVisible,
  type MultichatRuntimeEventTarget,
} from './multichatEventRuntime';
import {
  setRuntimeAnimationMode,
  type MultichatRuntimeAnimationMode,
} from './multichatAnimationRuntime';
import { isSafeRemoteMediaUrl } from './remoteMediaUrl';

/** Both accepted trigger words, primary first. */
export const MULTICHAT_TRIGGERS = [
  MULTICHAT_COMMAND_TRIGGER,
  MULTICHAT_COMMAND_ALIAS,
] as const;

/** The YouTube ids `!multichat yt <preset>` accepts by name. */
export const YT_PRESETS: Readonly<Record<string, string>> = {
  bruh: '2ZIpFytCSVc',
  'vine-boom': '_vBVGjFdwk4',
  'dc-ping': 'jiWj1zZlRjQ',
  rickroll: 'dQw4w9WgXcQ',
  'win-error': 'v76-ChTSLJk',
};

const EVENT_TARGETS: Readonly<Record<string, MultichatRuntimeEventTarget>> = {
  subs: 'subscription',
  sub: 'subscription',
  subscriptions: 'subscription',
  subscription: 'subscription',
  gifts: 'gift',
  gift: 'gift',
  raids: 'raid',
  raid: 'raid',
  cheers: 'cheer',
  cheer: 'cheer',
  milestones: 'milestone',
  milestone: 'milestone',
  watchstreaks: 'milestone',
  watchstreak: 'milestone',
  follows: 'follow',
  follow: 'follow',
  announcements: 'announcement',
  announcement: 'announcement',
  firstmessages: 'firstmessages',
  firstmessage: 'firstmessages',
  redeems: 'redeems',
  redeem: 'redeems',
};

const EVENT_LABELS: Readonly<Record<MultichatRuntimeEventTarget, string>> = {
  all: 'Events',
  subscription: 'Subscriptions',
  gift: 'Gifts',
  raid: 'Raids',
  cheer: 'Cheers',
  milestone: 'Milestones / watch streaks',
  follow: 'Follows',
  announcement: 'Announcements',
  firstmessages: 'First messages',
  redeems: 'Redeems',
};

/** Float slots, one per concurrent on-screen element. */
const FLOAT_NOTICE = 1;
const FLOAT_IMAGE = 4;
const FLOAT_VIDEO = 5;
const FLOAT_EMOTES = 9;

/** Default seconds for `img` and `yt` when `-t` is absent or unparseable. */
const DEFAULT_MEDIA_SECONDS = 5;

/**
 * How long after a `reload` a further `reload` is ignored.
 *
 * A reload re-reads chat from whatever the platform hands a fresh connection, and
 * YouTube's continuation and TikTok's hub linger can both include messages from
 * moments ago. Without this, one `!multichat reload` in a replayed window reloads
 * the source again, and again. The stamp is in sessionStorage because the thing it
 * must outlive is precisely a page load.
 */
export const RELOAD_COOLDOWN_MS = 15_000;

/** sessionStorage key holding the last reload's timestamp. */
export const RELOAD_STAMP_KEY = 'multichat:lastCommandReload';

export const MULTICHAT_PERMIT_LIMIT = 25;
export const MULTICHAT_RECENT_IDENTITY_LIMIT = 200;
export const MULTICHAT_RECENT_IDENTITY_TTL_MS = 15 * 60 * 1000;

/** Commands a temporarily permitted viewer may run after alias normalization. */
export const MULTICHAT_PERMITTED_COMMANDS: ReadonlySet<string> = new Set([
  'ping',
  'clear',
  'pause',
  'resume',
  'togglepause',
  'show',
  'hide',
  'kickon',
  'kickoff',
  'twitchon',
  'twitchoff',
  'youtubeon',
  'youtubeoff',
  'tiktokon',
  'tiktokoff',
  'sharedon',
  'sharedoff',
  'animation',
  'events',
]);

const PERMIT_MUTATION_COMMANDS: ReadonlySet<string> = new Set(['permit', 'unpermit']);
const PERMIT_LIST_COMMANDS: ReadonlySet<string> = new Set(['permitted']);
const TARGET_MAX_LENGTH = 100;
const IDENTITY_NAME_MAX_LENGTH = 80;
const PUBLIC_LABEL_MAX_LENGTH = 64;
const TARGET_ERROR = 'target must have spoken recently and match exactly.';
const SUPPORTED_PLATFORMS: readonly Platform[] = ['twitch', 'kick', 'youtube', 'tiktok'];

type RecentIdentity = {
  readonly platform: Platform;
  readonly senderId: string;
  readonly senderUsername?: string;
  readonly username: string;
  readonly lastSeen: number;
};

type PermitEntry = {
  readonly platform: Platform;
  readonly senderId: string;
  label: string;
};

type ResolvedIdentity = {
  readonly key: string;
  readonly platform: Platform;
  readonly senderId: string;
  readonly label: string;
};

type TargetRequest = {
  readonly platform: Platform;
  readonly lookup: string;
};

type TargetResolution =
  | { readonly status: 'resolved'; readonly identity: ResolvedIdentity }
  | { readonly status: 'none'; readonly request: TargetRequest }
  | { readonly status: 'ambiguous' | 'invalid' };

export type ParsedCommand = {
  /** Which trigger word matched, verbatim. */
  readonly trigger: string;
  /** The canonical command word, lowercased and alias-resolved. */
  readonly name: string;
  /** Whitespace-separated tokens after the command word. */
  readonly args: readonly string[];
  /** Everything after the command word, trimmed, original casing. */
  readonly rest: string;
  /** The whole message, trimmed. Some branches scan it for flags. */
  readonly text: string;
};

/**
 * A trigger-carrying message → its command, or null.
 *
 * The trigger must be the message's *first token*. A `startsWith` test — what this
 * replaced — also matched `!multichatting is broken hide`, which parsed `is` as
 * the command and, for any word that happened to be a command name, ran it. That
 * is the "merely mentioning the command must not execute it" case, and it was a
 * real defect rather than a hypothetical: `!multichats stop` stopped the overlay.
 *
 * Leading and trailing whitespace is trimmed first, so a copy-pasted message with a
 * leading space behaves the same as one without. Casing is folded for the trigger
 * and the command name only — arguments keep theirs, because URLs and TTS text are
 * case-sensitive.
 */
export function parseMultichatCommand(raw: string): ParsedCommand | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const tokens = text.split(/\s+/);
  const first = tokens[0].toLowerCase();
  const trigger = MULTICHAT_TRIGGERS.find((t) => t === first);
  if (!trigger) return null;

  const name = canonicalMultichatCommandName((tokens[1] ?? '').toLowerCase());
  const args = tokens.slice(2);

  /* The remainder with its original casing and internal spacing. Located by
     index rather than by a regex on the trigger, so a message whose TTS text
     happens to contain the trigger word is not mangled. */
  const afterName = tokens.slice(0, 2).join(' ').length;
  const rest = text.slice(afterName).trim();

  return { trigger, name, args, rest, text };
}

/**
 * The access level a message's author has.
 *
 * Badges first, then a provider-appropriate broadcaster fallback. YouTube uses
 * the immutable author/channel ids supplied by the provider. Other platforms
 * retain their canonical provider-username fallback (TikTok sends no broadcaster
 * badge at all). Display names are intentionally never authorization keys.
 *
 * Fails closed: an unknown or badgeless author is 0, which is below the gate.
 */
export function multichatAccessLevel(
  message: UnifiedMessage,
  channels: Partial<Record<Platform, string>>,
  immutableBroadcasterId?: string,
): number {
  for (const badge of message.badges) {
    if (badge.type === 'broadcaster' || badge.type === 'owner') {
      return MULTICHAT_ACCESS_BROADCASTER;
    }
  }

  if (message.platform === 'youtube') {
    /* YouTube channel ids are case-sensitive immutable provider identities. Trim
       transport whitespace only; never case-fold them or fall back to a handle.
       Missing either side deliberately fails closed. */
    const configuredId = typeof immutableBroadcasterId === 'string'
      ? immutableBroadcasterId.trim()
      : '';
    const authorId = typeof message.senderId === 'string' ? message.senderId.trim() : '';
    if (configuredId && authorId && configuredId === authorId) {
      return MULTICHAT_ACCESS_BROADCASTER;
    }
  } else {
    /* Canonical provider usernames are case-insensitive here. A leading @ is
       superficial for configured TikTok handles. */
    const configured = (channels[message.platform] ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const author = (message.senderUsername ?? '').trim().replace(/^@/, '').toLowerCase();
    if (configured && author && configured === author) return MULTICHAT_ACCESS_BROADCASTER;
  }

  for (const badge of message.badges) {
    if (badge.type === 'moderator') return MULTICHAT_ACCESS_MODERATOR;
  }
  return 0;
}

/**
 * Whether a URL is safe to put in an image `src`.
 *
 * User-supplied media must be public HTTPS. The helper uses the same URL parser
 * as the browser, rejects direct local/private destinations, credentials,
 * fragments, and nonstandard ports, and deliberately makes no DNS-rebinding
 * guarantee.
 */
export function isSafeMediaUrl(candidate: string): boolean {
  return isSafeRemoteMediaUrl(candidate);
}

/** Everything the dispatcher needs from the world outside itself. */
export type CommandHost = {
  /** The channel names the overlay is configured for, for the access fallback. */
  readonly channels: Partial<Record<Platform, string>>;
  /** Immutable provider broadcaster identity when the connector has resolved it. */
  readonly getBroadcasterId?: (platform: Platform) => string | undefined;
  /** Show a transient notice. `slot` replaces any notice already in that slot. */
  showFloat(slot: number, message: string, timeoutMs?: number, alpha?: number): void;
  /** Remove whatever is in a slot. */
  removeFloat(slot: number): void;
  /** Remove every float, image, and video. */
  removeAllFloats(): void;
  /** Clear ordinary chat history without touching pins, media, speech, or connections. */
  clearChatMessages(): void;
  /** Pause or resume admission of new ordinary chat rows to presentation state. */
  setChatPresentationPaused(paused: boolean): void;
  /** Toggle whether new ordinary chat rows are admitted to presentation state. */
  toggleChatPresentationPaused(): void;
  /** Mount an element in a float slot for `timeoutMs`, then remove it. */
  mountFloat(slot: number, el: HTMLElement, timeoutMs: number): void;
  /** Create a detached element. Separate from mounting so tests need no document. */
  createElement(tag: string): HTMLElement;
  /** Show or hide the whole chat container. */
  setChatVisible(visible: boolean): void;
  /** Show or suppress one platform's chat rows without disconnecting it. */
  setPlatformChatVisible(platform: Platform, visible: boolean): void;
  /** Include or suppress Twitch partner Shared Chat rows. */
  setSharedChatVisible(visible: boolean): void;
  /** Override the viewer counter's pill background in the matching counter source. */
  setCounterBackground(visible: boolean): void;
  /** Reload the browser source. */
  reload(): void;
  /** Re-fetch every emote provider. Resolves when done, rejects on failure. */
  refreshEmotes(): Promise<void>;
  /** Look up a loaded emote's image URL by exact name. */
  findEmoteUrl(name: string): string | null;
  /** Speak `text`. Implementations must cancel anything already speaking. */
  speak(text: string): void;
  /** Stop any speech or audio in progress. */
  stopSpeaking(): void;
  /** Read the last reload stamp, or null. */
  readReloadStamp(): number | null;
  /** Record a reload stamp. */
  writeReloadStamp(at: number): void;
  /** Current epoch milliseconds. Injected so the cooldown is testable. */
  now(): number;
};

export type MultichatCommandRunner = {
  /**
   * Offer a message to the command system.
   *
   * Returns the command that ran, or null when nothing did — a non-trigger
   * message, an unauthorized author, an unknown command name, or a duplicate.
   * The overlay also uses the return value to keep a successful clear command
   * from becoming the first ordinary chat row after the history is emptied.
   */
  handle(message: UnifiedMessage): ParsedCommand | null;
};

/**
 * The dispatcher.
 *
 * Deduplicates by `platform:id`. A connector can deliver the same message twice —
 * YouTube's continuation is re-polled with the previous token after a failure, and
 * a reconnecting SSE hub may replay its recent buffer — and running `reload` or
 * `img` twice for one chat message is visible in the scene.
 */
export function createMultichatCommandRunner(host: CommandHost): MultichatCommandRunner {
  /* Bounded so a long stream cannot grow this without limit. Insertion-ordered,
     so the oldest key is the first one `keys()` yields. */
  const seen = new Set<string>();
  const SEEN_LIMIT = 400;
  const permits = new Map<string, PermitEntry>();
  const recentIdentities = new Map<string, RecentIdentity>();

  function boundedName(value: unknown, limit = IDENTITY_NAME_MAX_LENGTH): string {
    if (typeof value !== 'string') return '';
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return Array.from(clean).slice(0, limit).join('');
  }

  function identityKey(platform: Platform, senderId: unknown): string | null {
    if (typeof senderId !== 'string' || !senderId.trim()) return null;
    /* The provider id is deliberately kept byte-for-byte. In particular, do not
       lowercase YouTube channel ids or any future case-sensitive provider id. */
    return `${platform}:${senderId}`;
  }

  function publicLabel(senderUsername: unknown, username: unknown): string {
    return boundedName(senderUsername, PUBLIC_LABEL_MAX_LENGTH)
      || boundedName(username, PUBLIC_LABEL_MAX_LENGTH)
      || 'unknown';
  }

  function formattedPermit(entry: PermitEntry | ResolvedIdentity): string {
    const label = boundedName(entry.label, PUBLIC_LABEL_MAX_LENGTH).replace(/^@/, '') || 'unknown';
    return `${entry.platform}:@${label}`;
  }

  function normalizeLookup(value: string): string {
    return value.trim().replace(/^@/, '').toLowerCase();
  }

  function pruneRecentIdentities(now: number): void {
    const cutoff = now - MULTICHAT_RECENT_IDENTITY_TTL_MS;
    for (const [key, identity] of recentIdentities) {
      if (identity.lastSeen < cutoff) recentIdentities.delete(key);
    }
  }

  function observeIdentity(message: UnifiedMessage): void {
    const now = host.now();
    pruneRecentIdentities(now);
    const key = identityKey(message.platform, message.senderId);
    if (!key) return;

    const senderUsername = boundedName(message.senderUsername);
    const username = boundedName(message.username);
    const identity: RecentIdentity = {
      platform: message.platform,
      senderId: message.senderId,
      ...(senderUsername ? { senderUsername } : {}),
      username,
      lastSeen: now,
    };
    /* Reinsert so Map insertion order is a true least-recently-seen order. */
    recentIdentities.delete(key);
    recentIdentities.set(key, identity);

    const permit = permits.get(key);
    if (permit) permit.label = publicLabel(senderUsername, username);

    while (recentIdentities.size > MULTICHAT_RECENT_IDENTITY_LIMIT) {
      const oldest = recentIdentities.keys().next();
      if (oldest.done) break;
      recentIdentities.delete(oldest.value);
    }
  }

  function targetRequest(message: UnifiedMessage, command: ParsedCommand): TargetResolution {
    const raw = command.rest.trim();
    if (!raw) {
      const replyId = message.reply?.senderId;
      if (
        (message.platform === 'twitch' || message.platform === 'kick')
        && identityKey(message.platform, replyId)
      ) {
        return {
          status: 'resolved',
          identity: {
            key: identityKey(message.platform, replyId)!,
            platform: message.platform,
            senderId: replyId!,
            label: publicLabel(undefined, message.reply?.username),
          },
        };
      }
      return { status: 'invalid' };
    }

    if (
      Array.from(raw).length > TARGET_MAX_LENGTH
      || /[\u0000-\u001f\u007f]/.test(raw)
    ) return { status: 'invalid' };

    let platform = message.platform;
    let target = raw;
    const separator = raw.indexOf(':');
    if (separator >= 0) {
      const prefix = raw.slice(0, separator).toLowerCase();
      if (!SUPPORTED_PLATFORMS.includes(prefix as Platform)) return { status: 'invalid' };
      platform = prefix as Platform;
      target = raw.slice(separator + 1).trim();
    }

    if (!target || Array.from(target).length > TARGET_MAX_LENGTH) return { status: 'invalid' };
    const lookup = normalizeLookup(target);
    if (!lookup) return { status: 'invalid' };
    return resolveRecentTarget({ platform, lookup });
  }

  function resolveRecentTarget(request: TargetRequest): TargetResolution {
    pruneRecentIdentities(host.now());
    const matches: RecentIdentity[] = [];
    for (const identity of recentIdentities.values()) {
      if (identity.platform !== request.platform) continue;
      const canonical = identity.senderUsername
        ? normalizeLookup(identity.senderUsername)
        : '';
      const display = normalizeLookup(identity.username);
      if (canonical === request.lookup || display === request.lookup) matches.push(identity);
    }
    if (matches.length > 1) return { status: 'ambiguous' };
    if (matches.length === 0) return { status: 'none', request };
    const identity = matches[0]!;
    const key = identityKey(identity.platform, identity.senderId)!;
    return {
      status: 'resolved',
      identity: {
        key,
        platform: identity.platform,
        senderId: identity.senderId,
        label: publicLabel(identity.senderUsername, identity.username),
      },
    };
  }

  function resolveStoredPermit(request: TargetRequest): TargetResolution {
    const matches = [...permits.entries()].filter(([, permit]) => (
      permit.platform === request.platform
      && normalizeLookup(permit.label) === request.lookup
    ));
    if (matches.length > 1) return { status: 'ambiguous' };
    if (matches.length === 0) return { status: 'none', request };
    const [key, permit] = matches[0]!;
    return {
      status: 'resolved',
      identity: {
        key,
        platform: permit.platform,
        senderId: permit.senderId,
        label: permit.label,
      },
    };
  }

  function showPermissionFailure(action: 'Permit' | 'Revoke', detail = TARGET_ERROR): void {
    host.showFloat(FLOAT_NOTICE, `${action} failed: ${detail}`, 5000);
  }

  function runPermit(message: UnifiedMessage, command: ParsedCommand): void {
    const resolution = targetRequest(message, command);
    if (resolution.status !== 'resolved') {
      showPermissionFailure('Permit');
      return;
    }
    const actorKey = identityKey(message.platform, message.senderId);
    if (actorKey && actorKey === resolution.identity.key) {
      showPermissionFailure('Permit', 'cannot permit yourself.');
      return;
    }
    if (permits.has(resolution.identity.key)) {
      showPermissionFailure('Permit', 'target is already permitted.');
      return;
    }
    if (permits.size >= MULTICHAT_PERMIT_LIMIT) {
      showPermissionFailure('Permit', `maximum of ${MULTICHAT_PERMIT_LIMIT} permits reached.`);
      return;
    }
    const permit: PermitEntry = {
      platform: resolution.identity.platform,
      senderId: resolution.identity.senderId,
      label: resolution.identity.label,
    };
    permits.set(resolution.identity.key, permit);
    host.showFloat(FLOAT_NOTICE, `Permitted: ${formattedPermit(permit)}`, 4000);
  }

  function runUnpermit(message: UnifiedMessage, command: ParsedCommand): void {
    let resolution = targetRequest(message, command);
    if (resolution.status === 'none') resolution = resolveStoredPermit(resolution.request);
    if (resolution.status !== 'resolved') {
      showPermissionFailure('Revoke');
      return;
    }
    const existing = permits.get(resolution.identity.key);
    if (!existing) {
      showPermissionFailure('Revoke', 'target is not permitted.');
      return;
    }
    permits.delete(resolution.identity.key);
    host.showFloat(FLOAT_NOTICE, `Revoked: ${formattedPermit(existing)}`, 4000);
  }

  function runPermitted(): void {
    if (permits.size === 0) {
      host.showFloat(FLOAT_NOTICE, 'Permitted: none', 4000);
      return;
    }
    const visible = [...permits.values()].slice(0, 10).map(formattedPermit);
    const remaining = permits.size - visible.length;
    const suffix = remaining > 0 ? `, ... and ${remaining} more` : '';
    host.showFloat(FLOAT_NOTICE, `Permitted: ${visible.join(', ')}${suffix}`, 5000);
  }

  function mayRunCommand(
    message: UnifiedMessage,
    command: ParsedCommand,
    nativeAccess: number,
  ): boolean {
    if (PERMIT_MUTATION_COMMANDS.has(command.name)) {
      return nativeAccess >= MULTICHAT_ACCESS_BROADCASTER;
    }
    if (PERMIT_LIST_COMMANDS.has(command.name)) {
      return nativeAccess >= MULTICHAT_ACCESS_MODERATOR;
    }
    if (nativeAccess >= MULTICHAT_COMMAND_MIN_ACCESS) return true;
    const key = identityKey(message.platform, message.senderId);
    return Boolean(
      key
      && permits.has(key)
      && MULTICHAT_PERMITTED_COMMANDS.has(command.name),
    );
  }

  function alreadyHandled(message: UnifiedMessage): boolean {
    /* No id means nothing to dedupe on; treat it as fresh rather than dropping
       it, since a synthetic id would defeat the check anyway. */
    if (!message.id) return false;
    const key = `${message.platform}:${message.id}`;
    if (seen.has(key)) return true;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) {
      const oldest = seen.values().next();
      if (!oldest.done) seen.delete(oldest.value);
    }
    return false;
  }

  /** Seconds from a `-t` flag, in milliseconds, or the default. */
  function mediaTimeout(text: string): number {
    const seconds = parseFloat((text.match(/-t\s+([\d.]+)/) || [])[1] ?? '');
    return (seconds || DEFAULT_MEDIA_SECONDS) * 1000;
  }

  function runImage(command: ParsedCommand): void {
    if (command.args[0] === 'clear') {
      host.removeFloat(FLOAT_IMAGE);
      return;
    }

    /* A URL anywhere in the message, else the first argument read as an emote
       name. The emote path resolves through the loaded emote list, so it yields a
       provider CDN URL rather than anything the chatter wrote. */
    const urlMatch = command.text.match(/https?:\/\/\S+/);
    const link = urlMatch ? urlMatch[0] : host.findEmoteUrl(command.args[0] ?? '');
    if (!link) return;
    /* Checked even for the emote path: a provider URL should already be https,
       and if one ever is not, this is where that stops. */
    if (!isSafeMediaUrl(link)) return;

    const opacityRaw = parseFloat((command.text.match(/-o\s+([\d.]+)/) || [])[1] ?? '');
    /* Clamped: an opacity of 40 is not a brighter image, and a negative one is
       not an error worth surfacing to a viewer. */
    const opacity = Math.min(Math.max(opacityRaw || 1, 0), 1);

    const wrapper = host.createElement('div');
    wrapper.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;pointer-events:none;';
    /* createElement and a src *property* — never an innerHTML template. The URL
       comes from chat, and `https://x/".onerror="…` closed the attribute and ran
       script when this was interpolated into a markup string. Assigning the
       property cannot escape the attribute, because there is no attribute. */
    const img = host.createElement('img') as HTMLImageElement;
    img.src = link;
    img.alt = '';
    img.style.cssText = `width:100%;height:100%;object-fit:fill;opacity:${opacity};`;
    wrapper.appendChild(img);
    host.mountFloat(FLOAT_IMAGE, wrapper, mediaTimeout(command.text));
  }

  function runVideo(command: ParsedCommand): void {
    const urlMatch = command.text.match(
      /(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)([\w-]+)/,
    );
    const id = urlMatch ? urlMatch[1] : YT_PRESETS[command.args[0] ?? ''] ?? null;
    if (!id) return;
    /* The capture is [\w-]+, so the id cannot contain a quote, an angle bracket,
       or a scheme. Built through the DOM anyway, for the same reason as the
       image: the safety should not rest on a regex staying exactly as narrow. */
    const wrapper = host.createElement('div');
    wrapper.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;pointer-events:none;';
    const frame = host.createElement('iframe') as HTMLIFrameElement;
    const mute = command.text.includes('-m') ? '&mute=1' : '';
    frame.src = `https://www.youtube.com/embed/${id}?autoplay=1${mute}&rel=0`;
    frame.width = '100%';
    frame.height = '100%';
    frame.allow = 'autoplay';
    frame.style.cssText = 'display:block;border:none;';
    wrapper.appendChild(frame);
    host.mountFloat(FLOAT_VIDEO, wrapper, mediaTimeout(command.text));
  }

  function runReload(): void {
    const last = host.readReloadStamp();
    if (last !== null && host.now() - last < RELOAD_COOLDOWN_MS) return;
    host.writeReloadStamp(host.now());
    host.reload();
  }

  function runRefresh(command: ParsedCommand): void {
    /* Bare, or the single literal `emotes`. Anything else is a typo, and doing
       nothing is better than refreshing on a misspelled argument. */
    const argument = command.args[0];
    if (argument && argument !== 'emotes') return;
    host.showFloat(FLOAT_EMOTES, '🔄 Reloading emotes...', 10_000, 0.7);
    host
      .refreshEmotes()
      .then(() => host.showFloat(FLOAT_EMOTES, '✅ Emotes reloaded!', 2000, 0.7))
      .catch(() => host.showFloat(FLOAT_EMOTES, '❌ Emote reload failed', 2000, 0.7));
  }

  function runEvents(command: ParsedCommand): boolean {
    const args = command.args.map((arg) => arg.toLowerCase());
    if (args.length === 0) {
      host.showFloat(
        FLOAT_NOTICE,
        'Usage: !multichat events off | events on | events <feature> <on|off>',
        5000,
      );
      return true;
    }

    let target: MultichatRuntimeEventTarget | undefined;
    let action: string | undefined;

    if (args.length === 1 && (args[0] === 'on' || args[0] === 'off')) {
      target = 'all';
      action = args[0];
    } else if (args.length === 2) {
      target = EVENT_TARGETS[args[0]];
      action = args[1];
    }

    if (!target || (action !== 'on' && action !== 'off')) return false;
    const visible = action === 'on';
    setRuntimeEventFeatureVisible(target, visible);
    host.showFloat(FLOAT_NOTICE, `${EVENT_LABELS[target]} ${visible ? 'ON' : 'OFF'}`, 2500);
    return true;
  }

  function runAnimation(command: ParsedCommand): boolean {
    if (command.args.length === 0) {
      host.showFloat(FLOAT_NOTICE, 'Usage: !multichat animation <on|off|auto>', 5000);
      return true;
    }
    if (command.args.length !== 1) return false;

    const mode = command.args[0].toLowerCase() as MultichatRuntimeAnimationMode;
    if (mode !== 'on' && mode !== 'off' && mode !== 'auto') return false;

    setRuntimeAnimationMode(mode);
    const label = mode === 'auto'
      ? 'Chat animations AUTO — bypassing heavy bursts'
      : `Chat animations ${mode.toUpperCase()}`;
    host.showFloat(FLOAT_NOTICE, label, 3000);
    return true;
  }

  function runTts(command: ParsedCommand): void {
    /* `rest` is everything after the command word, so the trigger and the word
       `tts` are already gone — the previous regex-strip spoke the whole message
       including the trigger whenever the text had a leading space. */
    const text = command.rest;
    if (!text) return;
    host.speak(text);
  }

  return {
    handle(message) {
      /* Provider events and synthetic status rows may contain command-like text,
         but only ordinary user chat is eligible for command parsing, identity
         observation, permission checks, dedupe, or dispatch side effects. */
      if (message.kind !== 'chat') return null;

      /* Every ordinary chat message contributes identity context. This happens
         before parsing so recent-user targeting is not limited to people who
         have already tried a command. */
      observeIdentity(message);
      const command = parseMultichatCommand(message.text ?? '');
      if (!command) return null;
      const nativeAccess = multichatAccessLevel(
        message,
        host.channels,
        host.getBroadcasterId?.(message.platform),
      );
      if (!mayRunCommand(message, command, nativeAccess)) return null;
      /* After the gate, so an unauthorized message does not consume the id and
         suppress the same command from a moderator quoting it. */
      if (alreadyHandled(message)) return null;

      switch (command.name) {
        case 'ping':
          host.showFloat(FLOAT_NOTICE, 'Pong!\nmultichat-gxufy', 3000);
          break;
        case 'permit':
          runPermit(message, command);
          break;
        case 'unpermit':
          runUnpermit(message, command);
          break;
        case 'permitted':
          runPermitted();
          break;
        case 'reload':
          runReload();
          break;
        case 'stop':
          /* Everything the overlay put on screen or into the speakers. Speech was
             previously untouched, so `stop` left a long TTS message talking. */
          host.removeAllFloats();
          host.stopSpeaking();
          break;
        case 'clear':
          host.clearChatMessages();
          break;
        case 'pause':
          host.setChatPresentationPaused(true);
          break;
        case 'resume':
          host.setChatPresentationPaused(false);
          break;
        case 'togglepause':
          host.toggleChatPresentationPaused();
          break;
        case 'show':
          host.setChatVisible(true);
          break;
        case 'hide':
          /* Visibility only. Messages keep buffering behind it, so `show`
             restores a live chat rather than an empty container. */
          host.setChatVisible(false);
          break;
        case 'kickon':
          host.setPlatformChatVisible('kick', true);
          host.showFloat(FLOAT_NOTICE, 'Kick chat ON', 2500);
          break;
        case 'kickoff':
          host.setPlatformChatVisible('kick', false);
          host.showFloat(FLOAT_NOTICE, 'Kick chat OFF', 2500);
          break;
        case 'twitchon':
          host.setPlatformChatVisible('twitch', true);
          host.showFloat(FLOAT_NOTICE, 'Twitch chat ON', 2500);
          break;
        case 'twitchoff':
          host.setPlatformChatVisible('twitch', false);
          host.showFloat(FLOAT_NOTICE, 'Twitch chat OFF', 2500);
          break;
        case 'youtubeon':
          host.setPlatformChatVisible('youtube', true);
          host.showFloat(FLOAT_NOTICE, 'YouTube chat ON', 2500);
          break;
        case 'youtubeoff':
          host.setPlatformChatVisible('youtube', false);
          host.showFloat(FLOAT_NOTICE, 'YouTube chat OFF', 2500);
          break;
        case 'tiktokon':
          host.setPlatformChatVisible('tiktok', true);
          host.showFloat(FLOAT_NOTICE, 'TikTok chat ON', 2500);
          break;
        case 'tiktokoff':
          host.setPlatformChatVisible('tiktok', false);
          host.showFloat(FLOAT_NOTICE, 'TikTok chat OFF', 2500);
          break;
        case 'sharedon':
          host.setSharedChatVisible(true);
          host.showFloat(FLOAT_NOTICE, 'Twitch Shared Chat ON', 2500);
          break;
        case 'sharedoff':
          host.setSharedChatVisible(false);
          host.showFloat(FLOAT_NOTICE, 'Twitch Shared Chat OFF', 2500);
          break;
        case 'counterbgon':
          host.setCounterBackground(true);
          host.showFloat(FLOAT_NOTICE, 'Counter background ON', 2500);
          break;
        case 'counterbgoff':
          host.setCounterBackground(false);
          host.showFloat(FLOAT_NOTICE, 'Counter background OFF', 2500);
          break;
        case 'animation':
          if (!runAnimation(command)) return null;
          break;
        case 'events':
          if (!runEvents(command)) return null;
          break;
        case 'refresh':
          runRefresh(command);
          break;
        case 'img':
          runImage(command);
          break;
        case 'yt':
          runVideo(command);
          break;
        case 'tts':
          runTts(command);
          break;
        default:
          /* Unknown command, or a bare trigger. Ignored silently: the message is
             still rendered as ordinary chat by the caller. */
          return null;
      }
      return command;
    },
  };
}
