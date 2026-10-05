/* The multichat-gxufy generator: the original Classic page, revamped.
 *
 * This is the canonical generator, served at a channel-less /multichat. It keeps
 * the Classic identity — centred branded header, platform badges, the dark
 * gradient background, one polished card per section, compact platform inputs,
 * the two-column control table, the pill switches — and replaces what used to sit
 * underneath it.
 *
 * What changed underneath, and why it matters:
 *
 *   - Controls are rendered from the tool catalogs rather than hand-written
 *     <select>s and hardcoded <option> lists. The
 *     Classic page previously restated every label and option, so a catalog entry
 *     could change without this page noticing. Now it cannot.
 *   - `sourceTag` is the full four-value enum, not the legacy platformIcons
 *     boolean that could only reach 'icon' and 'none'.
 *   - Both previews are real overlays in iframes at the exact generated URLs, so
 *     Preview, URL, Copy, and Open cannot disagree.
 *   - The Viewer Counter is embedded as a companion panel driven by the same
 *     counterTool descriptor — the same defaults, normalizer, serializer, and
 *     preview frame as the standalone tool had. There is no second Counter.
 *
 * Layout, which is load-bearing rather than cosmetic: one column per tool. The
 * chat and Counter outputs sit aligned beside each other in the first row, and
 * each settings card sits directly beneath its own output in the second, with
 * commands and OBS setup full width below. The DOM order is the stacked order —
 * header, channels, chat preview and URL, chat settings, Counter preview and URL,
 * Counter settings, commands, OBS setup — so a phone gets that sequence with no
 * reordering, and the desktop arrangement is named grid areas over that same tree
 * rather than a second one.
 *
 * Browser-safe: no server-only imports. The Twitch connection id is never
 * rendered, logged, or placed in a query string — it reaches only the generated
 * overlay URL's fragment, through the descriptor's own `context`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import OverlayPreviewFrame from '@/components/workspace/OverlayPreviewFrame';
import ClassicChatPreview from './ClassicChatPreview';
import ClassicCounterPreview from './ClassicCounterPreview';
import ClassicBadgeOrderVisibility from './ClassicBadgeOrderVisibility';
import ClassicSetting, { type SettingRange } from './ClassicSetting';
import TwitchChannelAutocomplete from './TwitchChannelAutocomplete';
import KickChannelAutocomplete from './KickChannelAutocomplete';
import YouTubeChannelAutocomplete from './YouTubeChannelAutocomplete';
import TikTokChannelAutocomplete from './TikTokChannelAutocomplete';
import MultichatFontPicker, {
  type MultichatFontSelection,
} from './MultichatFontPicker';
import ClassicCollapsibleSection, {
  browserLocalStorage,
  defaultCollapsedSections,
  readCollapsedSections,
  writeCollapsedSections,
  type ClassicCollapsibleSectionId,
} from './ClassicCollapsibleSection';
import ClassicTwitchConnect from './ClassicTwitchConnect';
import ClassicPreviewBackgroundControl, {
  DEFAULT_PREVIEW_CUSTOM_COLOR,
  effectivePreviewBackground,
  previewBackgroundFromDraft,
  previewSurfaceClass,
  type PreviewBgMode,
} from './ClassicPreviewBackgroundControl';
import ClassicCounterFeedControls from './ClassicCounterFeedControls';
import { useChatPreviewSimulator } from './useChatPreviewSimulator';
import { useTwitchPreviewRoster } from './useTwitchPreviewRoster';
import { buildPreviewIdentityCosmetics } from '@/features/multichat/previewIdentity';
import { NO_COSMETICS } from '@/lib/multichatMessageModel';
import { PREVIEW_ROSTER } from '@/features/multichat/previewRoster';
import { useCounterPreviewSimulator } from './useCounterPreviewSimulator';
import { combinationLabel } from '@/features/counter/previewSimulator';
import { CLASSIC_GENERATOR_CSS } from './classicStyles';
import { MULTICHAT_COMMANDS, MULTICHAT_COMMAND_ALIAS, MULTICHAT_COMMAND_TRIGGER } from '@/lib/multichatCommands';
import {
  LOCAL_OVERLAY_FONT_CSS,
  OVERLAY_FONT_SPECS,
  UI_FONT_SPECS,
  googleFontsImportCss,
} from '@/lib/overlayFonts';
import { FONT_FAMILIES } from '@/components/overlay/ChatOverlay';
import { MULTICHAT_OBS_RECOMMENDED, MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
import { multichatTool } from '@/features/multichat/config';
import { samplePinMessage } from '@/features/multichat/samples';
import { counterTool } from '@/features/counter/config';
import {
  SAMPLE_COUNTER_COUNTS,
  parseCounterCount,
  sampleCounterStatuses,
} from '@/features/counter/samples';
import { EMPTY_MULTICHAT_RUNTIME, type MultichatRuntime } from '@/features/multichat/runtime';
import type { MultichatPlatform, MultichatWorkspaceStyle } from '@/lib/multichatConfig';
import { PLATFORM_ORDER } from '@/lib/viewerCounterConfig';
import {
  COUNTER_FONT_FAMILY,
  DEFAULT_STYLE as COUNTER_DEFAULT_STYLE,
  type ViewerCounterStyle,
  type ViewerPlatform,
} from '@/lib/viewerCounterConfig';
import type { ToolChannels } from '@/features/registry';
import type { CatalogAvailability, SettingValue } from '@/lib/tools/settingTypes';
import {
  colorSetting,
  multiSelectSetting,
  selectSetting,
  textSetting,
  toggleSetting,
} from '@/lib/tools/settingTypes';
import { buildOverlayUrl } from '@/lib/tools/toolContext';
import { consumeWorkspaceDraft, writeWorkspaceDraft } from '@/lib/workspaceStorage';
import { COUNTER_SECTION_ID } from '@/lib/multichatRouting';
import { CANONICAL_ORIGIN } from '@/lib/domains.mjs';

/* Every face this page needs: its own UI typography plus all overlay families,
   because the font picker renders each option in the face it names. The overlay
   routes deliberately request only the single family their URL selected.

   An @import inside a <style>, never a stylesheet <link> — next/head warns about
   the latter on every render, and a repo test greps for it. */
const GENERATOR_FONT_CSS = googleFontsImportCss([
  ...Object.values(UI_FONT_SPECS),
  ...Object.values(OVERLAY_FONT_SPECS),
]);

const COUNTER_FONT_FAMILIES: Readonly<Record<string, string>> = {
  ...FONT_FAMILIES,
  dejavu: COUNTER_FONT_FAMILY,
};

/** How long transient Copy and settings-reset confirmations remain announced. */
const COPIED_MS = 2000;
const RESET_STATUS_MS = 3000;

/* The pin fixture, which is a library fixture rather than a showcase row. Held
   here so the feed can offer a banner without the fixture occupying the default
   six-row viewport. Null-safe because the accessor resolves it by id. */
const SAMPLE_PIN_MESSAGE = samplePinMessage();

/* The built-in counts as field strings, for the editable preview inputs.
   A fresh object per call, deliberately: this seeds state and backs Restore, and
   a shared object would let one of those mutate the other's baseline. */
function initialSampleCountFields(): Record<ViewerPlatform, string> {
  const fields = {} as Record<ViewerPlatform, string>;
  for (const platform of PLATFORM_ORDER) {
    fields[platform] = String(SAMPLE_COUNTER_COUNTS[platform]);
  }
  return fields;
}

/* The two catalogs, looked up once at module scope. Every lookup asserts the key
   exists with the expected control type, so a catalog rename breaks the build
   here rather than silently dropping a control from the page. */
const MC = multichatTool.catalog;
const VC = counterTool.catalog;

const MC_FONT = selectSetting(MC, 'font');
const MC_TEXT_SIZE = selectSetting(MC, 'textSize');
const MC_FONT_WEIGHT = selectSetting(MC, 'fontWeight');
const MC_TEXT_TRANSFORM = selectSetting(MC, 'textTransform');
const MC_FONT_ITALIC = toggleSetting(MC, 'fontItalic');
const MC_STROKE = selectSetting(MC, 'stroke');
const MC_TEXT_SHADOW = selectSetting(MC, 'textShadow');
const MC_ANIMATION = selectSetting(MC, 'animation');
const MC_ENTRY_ANIMATION = selectSetting(MC, 'entryAnimation');
const MC_EMOTE_SCALE = textSetting(MC, 'emoteScale');
const MC_GIFS = toggleSetting(MC, 'gifs');
const MC_GIF_SIZE = textSetting(MC, 'gifSize');
const MC_SOURCE_TAG = selectSetting(MC, 'sourceTag');
const MC_SEVENTV_EMOTES = toggleSetting(MC, 'sevenTVEmotesEnabled');
const MC_SEVENTV_COSMETICS = toggleSetting(MC, 'sevenTVCosmeticsEnabled');
const MC_COMMUNITY_BADGES = toggleSetting(MC, 'showCommunityBadges');
const MC_PAINT_SHADOWS = toggleSetting(MC, 'paintShadows');
const MC_FADE_ENABLED = toggleSetting(MC, 'fadeEnabled');
const MC_FADE = textSetting(MC, 'fade');
const MC_MSG_BOLD = toggleSetting(MC, 'msgBold');
const MC_SMOOTH_SCROLL = toggleSetting(MC, 'smoothScroll');
const MC_SHARED_CHAT = toggleSetting(MC, 'sharedChatEnabled');
const MC_REPLY_STYLE = selectSetting(MC, 'replyStyle');
const MC_RESTORE_ON_RELOAD = toggleSetting(MC, 'restoreOnReload');
const MC_MAX_MESSAGE_LINES = textSetting(MC, 'maxMessageLines');
const MC_MAX_MESSAGE_AGE = textSetting(MC, 'maxMessageAge');
const MC_SHOW_SYSTEM_MSGS = toggleSetting(MC, 'showSystemMsgs');
const MC_SHOW_FIRST_MESSAGES = toggleSetting(MC, 'showFirstMessages');
const MC_SHOW_REDEEMS = toggleSetting(MC, 'showRedeems');
const MC_HIDE_NAMES = toggleSetting(MC, 'hideNames');
const MC_MOD_ACTION = toggleSetting(MC, 'modAction');
const MC_MENTION_COLOR = toggleSetting(MC, 'mentionColor');
const MC_SHOW_PIN = toggleSetting(MC, 'showPinEnabled');
const MC_PIN_PLATFORMS = multiSelectSetting(MC, 'pinPlatforms');
const MC_BG_COLOR = colorSetting(MC, 'bgColor');
const MC_FONT_COLOR = colorSetting(MC, 'fontColor');
const MC_BOT_NAMES = textSetting(MC, 'botNames');
const MC_USER_BL = textSetting(MC, 'userBL');
const MC_PREFIX_BL = textSetting(MC, 'prefixBL');

const VC_COMBINED = toggleSetting(VC, 'combined');
const VC_ICONS = toggleSetting(VC, 'icons');
const VC_BG = toggleSetting(VC, 'bg');
const VC_ALIGN = selectSetting(VC, 'align');
const VC_FONT = selectSetting(VC, 'font');
const VC_FONT_WEIGHT = selectSetting(VC, 'fontWeight');
const VC_TEXT_TRANSFORM = selectSetting(VC, 'textTransform');
const VC_FONT_ITALIC = toggleSetting(VC, 'fontItalic');
const VC_TEXT_SIZE = selectSetting(VC, 'textSize');
const VC_FONT_COLOR = colorSetting(VC, 'fontColor');
const VC_TEXT_SHADOW = selectSetting(VC, 'textShadow');
const VC_STROKE = selectSetting(VC, 'stroke');

/* The two settings that are genuinely numeric, drawn as sliders.
   Bounds are the ones the overlay's own parser accepts, not new limits: the fade
   parser is parseInt on a seconds value, and emoteScale is documented in its own
   label as 0–3. Both keep their blank state, which suppresses the parameter — a
   slider alone cannot express that, hence the button. */
const FADE_RANGE: SettingRange = {
  min: 1,
  max: 120,
  step: 1,
  unit: 's',
  blankLabel: 'Never',
};

const EMOTE_SCALE_RANGE: SettingRange = {
  min: 0.5,
  max: 3,
  step: 0.1,
  unit: '×',
  blankLabel: 'Default',
};

/* Counter platform labels, taken from the descriptor's own channel fields rather
   than written out again. The counter panel already labels its channel inputs
   from this list, so the preview-count fields cannot end up disagreeing with
   them about what a platform is called. */
const COUNTER_PLATFORM_LABEL = Object.fromEntries(
  counterTool.platforms.map((platform) => [platform.key, platform.label]),
) as Record<ViewerPlatform, string>;

/* Platform chip classes, matching the Classic tag colours. */
const PLATFORM_TAG: Record<string, string> = {
  kick: 'kick-tag',
  twitch: 'tw-tag',
  youtube: 'yt-tag',
  tiktok: 'tt-tag',
};

export default function ClassicGenerator({
  /** True when the visitor arrived asking to start at the Viewer Counter. */
  focusCounter = false,
}: {
  focusCounter?: boolean;
}) {
  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  const [chatStyle, setChatStyle] = useState<MultichatWorkspaceStyle>(
    multichatTool.defaults,
  );
  const [counterStyle, setCounterStyle] = useState<ViewerCounterStyle>(
    counterTool.defaults,
  );
  /* One channel map, shared by both tools. The Classic page has always had a
     single set of platform inputs feeding chat and the counter alike, and that is
     the point of the embedded panel — you fill in your channels once. The two
     tools' styles stay completely separate objects, so restyling chat cannot
     alter an already-generated counter URL. */
  const [channels, setChannels] = useState<ToolChannels<string>>({});
  const [runtime, setRuntime] = useState<MultichatRuntime>(EMPTY_MULTICHAT_RUNTIME);
  /* The preview-only backdrop, one mode per preview so the two are independent
     browser sources judged against different scenes. Custom carries its own
     remembered colour, so a detour through another mode and back restores it.
     None of this is serialized — see ClassicPreviewBackgroundControl. */
  const [chatBgMode, setChatBgMode] = useState<PreviewBgMode>('checker');
  const [chatBgColor, setChatBgColor] = useState(DEFAULT_PREVIEW_CUSTOM_COLOR);
  const [counterBgMode, setCounterBgMode] = useState<PreviewBgMode>('checker');
  const [counterBgColor, setCounterBgColor] = useState(DEFAULT_PREVIEW_CUSTOM_COLOR);
  const [baseUrl, setBaseUrl] = useState(CANONICAL_ORIGIN);
  const [copiedChat, setCopiedChat] = useState(false);
  const [copiedCounter, setCopiedCounter] = useState(false);
  const [chatResetStatus, setChatResetStatus] = useState('');
  const [counterResetStatus, setCounterResetStatus] = useState('');
  const [collapsedSections, setCollapsedSections] = useState(
    defaultCollapsedSections,
  );
  const [collapsePreferencesReady, setCollapsePreferencesReady] = useState(false);
  const chatResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Chat preview mode is generator-only: it reaches no URL and no saved draft.
     Fixtures stay the safe default even when channels are configured; the live
     overlay is an explicit opt-in and is unmounted whenever this returns to data. */
  const [chatPreviewMode, setChatPreviewMode] = useState<'data' | 'live'>('data');
  /* The curated Preview Data roster is generator-only. It loads through
     the validated Preview Identity client, incrementally and independently, while
     its deterministic fallback rows remain visible from the first paint. */
  const previewRoster = useTwitchPreviewRoster();
  const identityTemplates = previewRoster.templates;
  const feedTemplates = previewRoster.feedTemplates;

  /* Preview Data always moves at the requested Fast cadence. Neither this state nor
     the roster can enter the generated URL or an OAuth draft. */
  const feed = useChatPreviewSimulator({
    enabled: true,
    initialSpeed: 'fast',
    identityTemplates: feedTemplates,
  });

  /* Fold every available identity into one production-renderer cosmetics model.
     Fixed roster order, rather than completion order, makes emote collisions stable. */
  const previewCosmetics = useMemo(
    () => PREVIEW_ROSTER.reduce((current, entry) => {
      const response = previewRoster.responses.get(entry.login);
      return response ? buildPreviewIdentityCosmetics(response, current) : current;
    }, NO_COSMETICS),
    [previewRoster.responses],
  );

  /* What the fixture preview renders: the samples, then anything composed, then
     whatever the feed has generated. A new array only when one of those three
     actually changes, so typing in a settings field does not re-convert every
     message.

     The pin fixture is *added* only while the feed says a pin is currently
     offered, which is never on arrival. It is a library fixture, not one of the
     six showcase rows, precisely so the default viewport is not covered: the
     banner is opaque, top-anchored and about three rows tall. That is also the
     whole pin mechanism — `ClassicChatPreview` decides whether to pin by looking
     for SAMPLE_PIN_ID in this array, so appending the fixture raises a banner and
     dropping it retires one, with no clock or random source inside the preview,
     which two existing suites assert it has none of. */
  const previewMessages = useMemo(() => {
    const pin = feed.pinVisible ? SAMPLE_PIN_MESSAGE : null;
    const showcase = identityTemplates.map((template, index) => ({
      ...template,
      id: `identity-showcase-${index + 1}`,
      timestamp: index + 1,
    }));
    const fixtures = pin ? [...showcase, pin] : showcase;
    return feed.messages.length ? [...fixtures, ...feed.messages] : fixtures;
  }, [feed.messages, feed.pinVisible, identityTemplates]);

  /* The platforms the Counter would actually poll for, from the tool's own
     normalizer rather than from a truthiness check on the raw fields — a name
     that is valid for chat is not necessarily valid here. */
  const counterPlatforms = useMemo(
    () => counterTool.configuredPlatforms(channels as ToolChannels<ViewerPlatform>),
    [channels],
  );
  const counterConfigured = counterPlatforms.length > 0;

  /* The live Counter rotation. Generator-only in the same way the chat feed is:
     it produces `PlatformStatuses` — the shape the live overlay folds real
     /api/viewers results into — and hands them to the same production renderer
     the fixtures went through. No request, no polling, no provider connection,
     and nothing it produces is serialized.

     Declared above the manual fields because typing in one switches the mode. */
  const counterSim = useCounterPreviewSimulator();

  /* Pulled out by itself so the callback below can depend on it. It is a
     `useState` setter, so its identity is stable for the life of the component —
     depending on the whole `counterSim` object instead would rebuild that
     callback on every render, since the hook returns a fresh object each time. */
  const { setMode: setCounterMode } = counterSim;

  /* Sample viewer counts, as typed. Strings rather than numbers, because the
     field has to be able to hold "" — the state the renderer draws as an em dash
     — and a numeric state would have to encode that absence some other way.
     Generator-only, exactly like the composed messages: never serialized, never
     written to the draft, never sent to /api/viewers. */
  const [sampleCounts, setSampleCounts] = useState<Record<ViewerPlatform, string>>(
    () => initialSampleCountFields(),
  );

  const setSampleCount = useCallback(
    (platform: ViewerPlatform, raw: string) => {
      /* Rejected keystrokes are dropped rather than corrected: silently rewriting
         what someone typed is worse than refusing it, and the field is already
         constrained to seven digits. An empty field is always allowed through —
         it is a meaningful value here, not an invalid one. */
      if (raw !== '' && parseCounterCount(raw) === null) return;
      /* Typing is the switch into Manual. Without this the rotation would
         overwrite the typed value at the next tick and the field would look
         broken; there is no reading of "edit a number but keep cycling" that a
         person would actually want. Restore simulation goes back. */
      setCounterMode('manual');
      setSampleCounts((current) => ({ ...current, [platform]: raw }));
    },
    [setCounterMode],
  );

  const restoreSampleCounts = useCallback(
    () => setSampleCounts(initialSampleCountFields()),
    [],
  );

  /* The statuses the manual fields describe. Every field is parsed through the
     shared helper, so a blank field becomes 'live-unknown' and the renderer's own
     unavailable presentation is what appears — no second reading of the counts
     here. */
  const manualStatuses = useMemo(() => {
    const counts: Partial<Record<ViewerPlatform, number>> = {};
    for (const platform of PLATFORM_ORDER) {
      const parsed = parseCounterCount(sampleCounts[platform]);
      if (parsed !== null) counts[platform] = parsed;
    }
    return sampleCounterStatuses(counts);
  }, [sampleCounts]);

  /* Which numbers the preview shows.
     The rotation's statuses win while it is live and has produced a state, and
     the manual fields are the fallback in every other case. The order matters
     twice over: `counterSim.statuses` is null until the first tick, so the very
     first paint — server and client alike — is the deterministic fixture set and
     there is no hydration mismatch; and switching to Manual hands control back
     to the fields immediately rather than after the pending delay expires. */
  const counterStatuses =
    counterSim.mode === 'live' && counterSim.statuses !== null
      ? counterSim.statuses
      : manualStatuses;

  /* Rendered origin. Kept out of the initial state so the server-rendered markup
     and the first client render agree; the effect corrects it immediately. */
  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  /* Layout preferences are intentionally separate from workspace settings and
     generated URLs. Start from deterministic defaults for SSR, then restore the
     validated local preference after hydration. */
  useEffect(() => {
    setCollapsedSections(readCollapsedSections(browserLocalStorage()));
    setCollapsePreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!collapsePreferencesReady) return;
    writeCollapsedSections(browserLocalStorage(), collapsedSections);
  }, [collapsePreferencesReady, collapsedSections]);

  /* Arrived from the retired /tools/counter route, or with ?tab=counter from an
     old bookmark. The Counter panel is a real anchor target, so the browser
     handles a plain `#viewer-counter` itself — but `?tab=counter` has no
     fragment to act on, and a fragment that arrives before hydration can be
     scrolled past as the rest of the page mounts. Scrolling here covers both. */
  useEffect(() => {
    if (!focusCounter) return;
    document.getElementById(COUNTER_SECTION_ID)?.scrollIntoView({ block: 'start' });
  }, [focusCounter]);

  /* ---------------------------------------------------------------- */
  /* Change handlers                                                  */
  /* ---------------------------------------------------------------- */

  const changeChat = useCallback((key: keyof MultichatWorkspaceStyle & string, next: SettingValue) => {
    setChatStyle((current) => multichatTool.normalize({ ...current, [key]: next }));
  }, []);

  const changeChatFont = useCallback((selection: MultichatFontSelection) => {
    setChatStyle((current) => multichatTool.normalize({ ...current, ...selection }));
  }, []);

  const changeCounter = useCallback((key: keyof ViewerCounterStyle & string, next: SettingValue) => {
    setCounterStyle((current) => counterTool.normalize({ ...current, [key]: next }));
  }, []);

  const changeCounterFont = useCallback((selection: MultichatFontSelection) => {
    setCounterStyle((current) => counterTool.normalize({
      ...current,
      font: selection.font as ViewerCounterStyle['font'],
      googleFont: selection.googleFont,
    }));
  }, []);

  const toggleSettingsSection = useCallback((sectionId: ClassicCollapsibleSectionId) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  const resetChatSettings = useCallback(() => {
    setChatStyle(multichatTool.normalize({ ...multichatTool.defaults }));
    setChatResetStatus('Chat settings restored to defaults.');
    if (chatResetTimerRef.current) clearTimeout(chatResetTimerRef.current);
    chatResetTimerRef.current = setTimeout(() => {
      chatResetTimerRef.current = null;
      setChatResetStatus('');
    }, RESET_STATUS_MS);
  }, []);

  const resetCounterSettings = useCallback(() => {
    setCounterStyle(counterTool.normalize({ ...counterTool.defaults }));
    setCounterResetStatus('Viewer settings restored to defaults.');
    if (counterResetTimerRef.current) clearTimeout(counterResetTimerRef.current);
    counterResetTimerRef.current = setTimeout(() => {
      counterResetTimerRef.current = null;
      setCounterResetStatus('');
    }, RESET_STATUS_MS);
  }, []);

  useEffect(() => () => {
    if (chatResetTimerRef.current) clearTimeout(chatResetTimerRef.current);
    if (counterResetTimerRef.current) clearTimeout(counterResetTimerRef.current);
  }, []);

  const changeChannel = useCallback((platform: string, raw: string) => {
    setChannels((current) => ({ ...current, [platform]: raw }));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Runtime reconciliation                                           */
  /* ---------------------------------------------------------------- */

  /* Mirror the typed Twitch channel into runtime, so the pin gating rule can be
     evaluated. Keyed on `channels` rather than done in the change handler, so
     every path that sets a channel — typing, draft restore, Use connected
     channel — folds through the same rule. */
  useEffect(() => {
    const fromChannels = multichatTool.runtime?.fromChannels;
    if (!fromChannels) return;
    setRuntime((current) => {
      const next = fromChannels(current, channels as ToolChannels<MultichatPlatform>);
      /* Bail out when nothing changed, so this cannot loop. */
      return next === current ? current : next;
    });
  }, [channels]);

  /* A runtime change can invalidate a style choice — a selected pin platform
     whose capability just disappeared. The descriptor reconciles that in `sync`.
     An effect on `runtime` rather than logic in a handler, so connecting,
     disconnecting, and editing the channel until it stops matching are all
     covered by one rule and no ordering leaves a stale selection behind. */
  useEffect(() => {
    const sync = multichatTool.runtime?.sync;
    if (!sync) return;
    setChatStyle((current) => {
      const next = sync(current, runtime);
      return next === current ? current : multichatTool.normalize(next);
    });
  }, [runtime]);

  /* ---------------------------------------------------------------- */
  /* Draft persistence across OAuth                                   */
  /* ---------------------------------------------------------------- */

  /* Live state for the draft write. A ref rather than dependencies, so
     `persistDraft` keeps a stable identity — it is handed to the connection
     panel, and a new function on every keystroke would re-render it for nothing. */
  const live = useRef({
    chatStyle,
    counterStyle,
    channels,
    chatBgMode,
    chatBgColor,
    counterBgMode,
    counterBgColor,
  });
  live.current = {
    chatStyle,
    counterStyle,
    channels,
    chatBgMode,
    chatBgColor,
    counterBgMode,
    counterBgColor,
  };

  /* Both tools' drafts, written immediately before the OAuth navigation.
     Two keys, because the storage is keyed per tool and the two styles are
     different shapes — and because the Counter's settings must survive an OAuth
     round trip the chat side initiated, which is the whole reason this writes
     twice rather than once.

     The background is the mode's own value — a named id for the three fixed
     backdrops, the hex string itself for Custom — so a chosen colour survives
     the round trip too. Still preview-only: `background` is never read into a
     tool's style and never serialized into an overlay URL. */
  const persistDraft = useCallback(() => {
    const l = live.current;
    writeWorkspaceDraft(multichatTool.id, {
      style: l.chatStyle,
      channels: l.channels,
      background: effectivePreviewBackground(l.chatBgMode, l.chatBgColor),
    });
    writeWorkspaceDraft(counterTool.id, {
      style: l.counterStyle,
      channels: l.channels,
      background: effectivePreviewBackground(l.counterBgMode, l.counterBgColor),
    });
  }, []);

  /* Restore on mount, and only on mount. Each draft is consumed as it is read,
     so a second effect run — Strict Mode double-invokes in development — finds
     nothing and leaves whatever the user has since typed alone.

     Everything restored goes through a tool's own normalizer, so a hand-edited
     sessionStorage entry can produce defaults but not invalid state. */
  useEffect(() => {
    const chatDraft = consumeWorkspaceDraft(multichatTool.id);
    const counterDraft = consumeWorkspaceDraft(counterTool.id);

    if (chatDraft) {
      setChatStyle(multichatTool.normalize(chatDraft.style as Partial<MultichatWorkspaceStyle>));
      /* The backdrop is preview-only, so it is restored into its own state and
         never handed to the tool's normalizer. An unknown string falls back to
         Transparent rather than throwing — see previewBackgroundFromDraft. */
      const chatBg = previewBackgroundFromDraft(chatDraft.background);
      setChatBgMode(chatBg.mode);
      setChatBgColor(chatBg.customColor);
    }
    if (counterDraft) {
      setCounterStyle(counterTool.normalize(counterDraft.style as Partial<ViewerCounterStyle>));
      const counterBg = previewBackgroundFromDraft(counterDraft.background);
      setCounterBgMode(counterBg.mode);
      setCounterBgColor(counterBg.customColor);
    }

    /* Channels are shared, so they are restored from whichever draft has them —
       chat first, since that is the side that initiates OAuth. Keys are filtered
       to platforms this page actually has a field for, so a draft written by a
       different version cannot introduce a channel key that would then be
       serialized into an overlay URL. */
    const source = chatDraft ?? counterDraft;
    if (source) {
      const allowed = new Set<string>([
        ...multichatTool.platforms.map((p) => p.key),
        ...counterTool.platforms.map((p) => p.key),
      ]);
      const restored: ToolChannels<string> = {};
      for (const [key, value] of Object.entries(source.channels)) {
        if (allowed.has(key)) restored[key] = value;
      }
      setChannels(restored);
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Derived URLs                                                     */
  /* ---------------------------------------------------------------- */

  /* Which pin options the descriptor currently considers unavailable.
     Recomputed from runtime, so an option can become available while the page is
     open — connecting an account does not need a reload. */
  const availability: CatalogAvailability = useMemo(
    () => (multichatTool.runtime?.optionAvailability?.(runtime) ?? {}) as CatalogAvailability,
    [runtime],
  );

  /* The descriptor's own serializer. Not a second implementation: this is the
     same call the retired workspace made and the same one the overlay parses, so
     a URL from this page is byte-identical for the same state. */
  const chatQuery = useMemo(
    () => multichatTool.serialize(channels as ToolChannels<MultichatPlatform>, chatStyle),
    [channels, chatStyle],
  );

  /* One string for the preview, the readonly field, Copy, and Open — so those
     four cannot disagree. The connection id enters only here, only as a fragment,
     and only when the descriptor's `context` says it is genuinely usable. */
  const chatUrl = useMemo(
    () =>
      buildOverlayUrl({
        baseUrl,
        route: multichatTool.overlayRoute,
        query: chatQuery,
        context: multichatTool.context?.(chatStyle, runtime),
      }),
    [baseUrl, chatQuery, chatStyle, runtime],
  );

  const counterQuery = useMemo(
    () => counterTool.serialize(channels as ToolChannels<ViewerPlatform>, counterStyle),
    [channels, counterStyle],
  );

  /* No context, so no fragment: the Counter never carries a connection id, and
     the serializer's own normalization is what keeps 'undefined' out of it. */
  const counterUrl = useMemo(
    () =>
      buildOverlayUrl({
        baseUrl,
        route: counterTool.overlayRoute,
        query: counterQuery,
      }),
    [baseUrl, counterQuery],
  );

  /* Each tool decides for itself what counts as configured — MultiChat accepts
     anything typed, the Counter validates against its own normalizer — so a name
     that is valid for chat but not for the counter shows one preview, not two.
     The Counter's own list is `counterPlatforms`, derived further up because the
     preview simulator depends on it. */
  const chatConfigured =
    multichatTool.configuredPlatforms(channels as ToolChannels<MultichatPlatform>).length > 0;

  const previousChatConfiguredRef = useRef(false);
  useEffect(() => {
    const wasConfigured = previousChatConfiguredRef.current;
    previousChatConfiguredRef.current = chatConfigured;
    if (!wasConfigured && chatConfigured) setChatPreviewMode('live');
    if (wasConfigured && !chatConfigured) setChatPreviewMode('data');
  }, [chatConfigured]);

  /* The counter preview has no readiness gate, deliberately.
   *
   * It briefly had one: the live frame mounted as soon as a channel was valid but
   * stayed hidden behind the sample counts until the embedded page posted a
   * message saying its first poll had committed. The intent was to cover the gap
   * where /counter renders nothing yet; the effect was that the real overlay was
   * on screen, polling, and invisible — and any appearance change reset the gate
   * and hid a working counter again. A later revision replaced the samples in
   * that window with em dashes derived from the configured platforms, which
   * removed the fake numbers but kept the wait.
   *
   * So there is no gate, no message listener, and no placeholder. The frame is
   * shown the moment it exists, exactly as the chat preview shows its overlay,
   * and whatever /counter renders is what the user sees — including its own
   * deliberate emptiness before the first poll settles, which is the same thing
   * OBS shows for those few hundred milliseconds. The preview's job is to be the
   * overlay, not to narrate it.
   *
   * Whether the samples are up is therefore a plain function of the channels, and
   * a channel-less URL still never reaches the frame: OverlayPreviewFrame settles
   * only configured URLs, after its 350 ms debounce. */
  const counterShowingSamples = !counterConfigured;

  /* Whether the URL actually carries a connection fragment. Drives the warning
     beside Copy — the fragment is a live credential, so the user is told before
     they paste it anywhere other than their own OBS. */
  const chatHasFragment = chatUrl.includes('#');

  const copyChat = () => {
    void navigator.clipboard?.writeText(chatUrl);
    setCopiedChat(true);
    setTimeout(() => setCopiedChat(false), COPIED_MS);
  };

  const copyCounter = () => {
    void navigator.clipboard?.writeText(counterUrl);
    setCopiedCounter(true);
    setTimeout(() => setCopiedCounter(false), COPIED_MS);
  };

  return (
    <>
      <Head>
        <title>multichat-gxufy | Kick · Twitch · YouTube · TikTok Chat Overlay</title>
        <meta
          name="description"
          content="Free multi-platform chat overlay for OBS by gxufy — Kick, Twitch, YouTube & TikTok in one browser source. 7TV/BTTV/FFZ emotes, real badges, name-paints, pins, and a live viewer counter. No login required."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* dangerouslySetInnerHTML because React would escape `&` and `'`, and a
            <style> element does not decode entities — escaped, the sheet's
            `&family=` separators would collapse to a single family. */}
        <style dangerouslySetInnerHTML={{ __html: `${GENERATOR_FONT_CSS}\n${LOCAL_OVERLAY_FONT_CSS}` }} />
        <style
          dangerouslySetInnerHTML={{
            __html:
              '@font-face{font-family:Alsina;src:url(/fonts/Alsina_Ultrajada.ttf);}',
          }}
        />
      </Head>

      <style dangerouslySetInnerHTML={{ __html: CLASSIC_GENERATOR_CSS }} />

      {/* Skip link: the header and four channel fields come before the settings,
          so a keyboard or screen-reader user otherwise tabs through all of it. */}
      <a href="#generator-main" className="skip-link">
        Skip to the generator
      </a>

      <div className="page">
        {classicHeader()}

        <main id="generator-main" tabIndex={-1}>
          {/* The page's only h1. Visually hidden: the branded wordmark above is
              the visual title, but a screen reader needs one heading that says
              what this page is before the section headings under it. */}
          <h1 className="sr-only">
            multichat-gxufy — chat overlay and viewer counter generator for OBS
          </h1>

          {/* Called as functions, not rendered as <Component /> elements. A
              component declared inside this body is a new type on every render,
              which would unmount and remount its whole subtree on every
              keystroke — losing focus in the field being typed into. Calling
              them just splices their JSX into this tree. */}
          {channelCard()}

          {/* One tree for every viewport. DOM order is the stacked phone order;
              named desktop grid areas align each output above its own settings. */}
          <div className="tool-grid">
            {chatOutputPanel()}
            {chatSettingsPanel()}
            {counterOutputPanel()}
            {counterSettingsPanel()}
            {commandsCard()}
            {obsSetupCard()}
          </div>
        </main>
      </div>

      {classicFooter()}
    </>
  );

  /* ---------------------------------------------------------------- */
  /* Sections                                                         */
  /* ---------------------------------------------------------------- */

  function classicHeader() {
    return (
      /* The original compact strip: logo, wordmark, tagline, platform chips. */
      <header className="header-strip">
        <Link href="/" className="home-link" title="Back to homepage">
          ← Home
        </Link>
        <Link href="/" aria-label="multichat-gxufy home">
          <img src="/tpl.webp" alt="" className="header-logo" />
        </Link>
        <div className="header-copy">
          <p className="header-title">multichat-gxufy</p>
          <p className="header-sub">Every chat. One overlay. No login.</p>
          <div className="platform-row">
            <span className="platform-chip kick-tag">Kick</span>
            <span className="platform-chip tw-tag">Twitch</span>
            <span className="platform-chip yt-tag">YouTube</span>
            <span className="platform-chip tt-tag">TikTok</span>
          </div>
        </div>
      </header>
    );
  }

  /** The shared platform inputs, plus the inline Twitch connection. */
  function channelCard() {
    return (
      <section className="card hero" aria-labelledby="channels-heading">
        <h2 id="channels-heading" className="section-title">
          Your channels
        </h2>

        <div className="platform-inputs">
          {multichatTool.platforms.map((platform) => {
            const inputId = `channel-${platform.key}`;
            return (
              <div className="platform-input" key={platform.key}>
                <label
                  htmlFor={inputId}
                  className={`platform-tag ${PLATFORM_TAG[platform.key] ?? ''}`}
                >
                  {platform.label}
                </label>
                {platform.key === 'twitch' ? (
                  <TwitchChannelAutocomplete
                    id={inputId}
                    name={platform.key}
                    placeholder={platform.placeholder}
                    value={channels[platform.key] ?? ''}
                    onValueChange={(value) => changeChannel(platform.key, value)}
                  />
                ) : platform.key === 'kick' ? (
                  <KickChannelAutocomplete
                    id={inputId}
                    name={platform.key}
                    placeholder={platform.placeholder}
                    value={channels[platform.key] ?? ''}
                    onValueChange={(value) => changeChannel(platform.key, value)}
                  />
                ) : platform.key === 'youtube' ? (
                  <YouTubeChannelAutocomplete
                    id={inputId}
                    name={platform.key}
                    placeholder={platform.placeholder}
                    value={channels[platform.key] ?? ''}
                    onValueChange={(value) => changeChannel(platform.key, value)}
                  />
                ) : platform.key === 'tiktok' ? (
                  <TikTokChannelAutocomplete
                    id={inputId}
                    name={platform.key}
                    placeholder={platform.placeholder}
                    value={channels[platform.key] ?? ''}
                    onValueChange={(value) => changeChannel(platform.key, value)}
                  />
                ) : (
                  <input
                    id={inputId}
                    type="text"
                    name={platform.key}
                    placeholder={platform.placeholder}
                    value={channels[platform.key] ?? ''}
                    onChange={(e) => changeChannel(platform.key, e.target.value)}
                  />
                )}
                {/* No per-field connection here any more: Twitch is a plain
                    channel-name field like the other three. The Twitch account
                    connection is optional and only for native Twitch pinned
                    messages, so it lives beside the pin controls in Chat
                    settings rather than under this input, where it read as
                    though Twitch chat needed a login. */}
              </div>
            );
          })}
        </div>

      </section>
    );
  }

  /** Chat preview, generated URL, Copy, Open. */
  function chatOutputPanel() {
    return (
      <section
        className="card panel-chat-output"
        aria-labelledby="chat-output-heading"
      >
        <div className="preview-content-head">
          <div>
            <h2 id="chat-output-heading" className="preview-content-title">
              Chat Preview
            </h2>
          </div>
          {chatPreviewMode === 'data' && (
            <span className="preview-badge">Preview Data</span>
          )}
        </div>

        <div className="preview-mode-tabs" role="tablist" aria-label="Chat preview mode">
          <button
            type="button"
            role="tab"
            id="chat-preview-mode-data"
            aria-controls="chat-preview-mode-panel"
            aria-selected={chatPreviewMode === 'data'}
            className={`preview-mode-tab${chatPreviewMode === 'data' ? ' active' : ''}`}
            onClick={() => setChatPreviewMode('data')}
          >
            Preview Data
          </button>
          <button
            type="button"
            role="tab"
            id="chat-preview-mode-live"
            aria-controls="chat-preview-mode-panel"
            aria-selected={chatPreviewMode === 'live'}
            className={`preview-mode-tab${chatPreviewMode === 'live' ? ' active' : ''}`}
            onClick={() => setChatPreviewMode('live')}
            disabled={!chatConfigured}
          >
            Live Overlay
          </button>
        </div>
        <div
          id="chat-preview-mode-panel"
          role="tabpanel"
          aria-labelledby={`chat-preview-mode-${chatPreviewMode}`}
        >
          <p className="preview-mode-label">
            {chatPreviewMode === 'data'
              ? 'Preview Data — sample messages, not live channel chat'
              : 'Live Overlay — exact generated Chat URL'}
          </p>

          {/* The backdrop is preview-only and never enters the generated URL. */}
          <div
            className={`preview-surface ${previewSurfaceClass(chatBgMode)}`}
            style={
              chatStyle.bgColor
                ? { background: chatStyle.bgColor }
                : chatBgMode === 'custom'
                  ? { background: chatBgColor }
                  : undefined
            }
          >
            {chatPreviewMode === 'live' ? (
              <OverlayPreviewFrame
                url={chatUrl}
                configured={chatConfigured}
                title="Live chat overlay preview"
                height={MULTICHAT_OBS_SIZE.height}
              />
            ) : (
              <ClassicChatPreview
                query={chatQuery}
                messages={previewMessages}
                cosmetics={previewCosmetics}
                width={MULTICHAT_OBS_SIZE.width}
                height={MULTICHAT_OBS_SIZE.height}
                scale={63}
              />
            )}
          </div>

          {chatPreviewMode === 'data' && (
            <div className="preview-data-controls preview-data-controls-compact">
              <div className="preview-primary-actions preview-roster-actions">
                <p className="preview-roster-status" role="status">
                  {previewRoster.statusText}
                </p>
              </div>

              <ClassicPreviewBackgroundControl
                idPrefix="chat"
                legend="Preview background"
                mode={chatBgMode}
                customColor={chatBgColor}
                onModeChange={setChatBgMode}
                onCustomColorChange={setChatBgColor}
              />
            </div>
          )}

          {chatPreviewMode === 'live' && (
            <ClassicPreviewBackgroundControl
              idPrefix="chat"
              legend="Preview background"
              mode={chatBgMode}
              customColor={chatBgColor}
              onModeChange={setChatBgMode}
              onCustomColorChange={setChatBgColor}
            />
          )}
        </div>

        <div className="url-box">
          <div className="url-code" aria-label="Generated MultiChat overlay URL">
            {chatUrl}
          </div>
          {/* Both actions in one group, so a URL that wraps to three lines makes
              the field taller and leaves the buttons their own height. */}
          <div className="url-actions">
            <button
              type="button"
              onClick={copyChat}
              className={`url-copy${copiedChat ? ' ok' : ''}`}
            >
              {copiedChat ? '✓ Copied' : 'Copy'}
            </button>
            <a
              className="url-open"
              href={chatUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          </div>
          {/* Announced, not just shown: the URL gains a fragment while the page
              is open, and the fragment is a live credential. */}
          <p className="url-warn" role="status">
            {chatHasFragment
              ? 'This URL ends in a private connection key for your Twitch pins. Paste it into your own OBS only — do not share it or post it publicly.'
              : ''}
          </p>
        </div>
        {/* Copy status, for assistive tech — the button's own label change is
            visual only. */}
        <p className="sr-only" role="status">
          {copiedChat ? 'MultiChat overlay URL copied to the clipboard.' : ''}
        </p>
      </section>
    );
  }

  /** Counter preview, generated URL, Copy, Open. */
  function counterOutputPanel() {
    return (
      <section
        className="card panel-counter-output"
        id={COUNTER_SECTION_ID}
        aria-labelledby="counter-output-heading"
      >
        <div className="preview-content-head">
          <div>
            <h2 id="counter-output-heading" className="preview-content-title">
              Viewer Counter
            </h2>
          </div>
          {counterShowingSamples && <span className="preview-badge">Preview Data</span>}
        </div>

        <div
          className={`preview-surface ${previewSurfaceClass(counterBgMode)}`}
          style={
            counterBgMode === 'custom' ? { background: counterBgColor } : undefined
          }
        >
          {/* One preview or the other, never both — the same shape as the chat
              preview above.
           *
              With a channel configured the real /counter route is embedded at the
              URL Copy hands out, so what is on screen here is the overlay itself:
              same document, same polling, same result, with no second
              implementation to drift. Clearing the last channel removes it in the
              same render, because `counterConfigured` is read during render rather
              than tracked in state.

              With no channel there is no live counter to show — and a frame
              holding only dashes says nothing about how the seven settings look.
              Sample counts go through the production renderer instead. That
              frame is a local blank document, not the overlay URL, so nothing
              fetches /api/viewers and nothing polls. */}
          {counterConfigured ? (
            <OverlayPreviewFrame
              url={counterUrl}
              configured={counterConfigured}
              title="Live viewer counter preview"
              height={counterTool.obs.height}
            />
          ) : (
            <ClassicCounterPreview
              query={counterQuery}
              statuses={counterStatuses}
              width={counterTool.obs.width}
              height={counterTool.obs.height}
            />
          )}
        </div>

        {/* Offered in both states for the same reason as the chat backdrop: the
            colour sits behind the live counter iframe just as it does behind the
            sample counts. */}
        <ClassicPreviewBackgroundControl
          idPrefix="counter"
          legend="Preview background"
          mode={counterBgMode}
          customColor={counterBgColor}
          onModeChange={setCounterBgMode}
          onCustomColorChange={setCounterBgColor}
        />

        {/* Paired with the fixture preview, because this is what feeds it. With a
            channel configured the panel above is the real overlay showing real
            numbers, and simulating a count would have nowhere to appear. */}
        {!counterConfigured && (
          <ClassicCounterFeedControls
            enabled={counterSim.enabled}
            paused={counterSim.paused}
            speed={counterSim.speed}
            mode={counterSim.mode}
            running={counterSim.running}
            seenCount={counterSim.seenCount}
            combinationLabel={
              counterSim.combination === null
                ? ''
                : combinationLabel(counterSim.combination, COUNTER_PLATFORM_LABEL)
            }
            counts={sampleCounts}
            platformLabel={COUNTER_PLATFORM_LABEL}
            onEnabledChange={counterSim.setEnabled}
            onTogglePaused={counterSim.togglePaused}
            onSpeedChange={counterSim.setSpeed}
            onAdvance={counterSim.advance}
            onRestore={counterSim.restore}
            onCountChange={setSampleCount}
            onRestoreCounts={restoreSampleCounts}
          />
        )}

        <div className="url-box">
          <div className="url-code" aria-label="Generated viewer counter URL">
            {counterUrl}
          </div>
          {/* The same output row as the chat panel, class for class. */}
          <div className="url-actions">
            <button
              type="button"
              onClick={copyCounter}
              className={`url-copy${copiedCounter ? ' ok' : ''}`}
            >
              {copiedCounter ? '✓ Copied' : 'Copy'}
            </button>
            <a
              className="url-open"
              href={counterUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          </div>
        </div>
        <p className="sr-only" role="status">
          {copiedCounter ? 'Viewer counter URL copied to the clipboard.' : ''}
        </p>
      </section>
    );
  }

  /** All MultiChat settings, in the Classic multi-column arrangement. */
  function chatSettingsPanel() {
    const chat = (
      setting: Parameters<typeof ClassicSetting<MultichatWorkspaceStyle>>[0]['setting'],
      extra?: {
        optionStyle?: (v: string) => React.CSSProperties | undefined;
        controlStyle?: React.CSSProperties;
        segmented?: boolean;
        range?: SettingRange;
      },
    ) => (
      <ClassicSetting
        key={setting.key}
        setting={setting}
        value={chatStyle[setting.key] as SettingValue}
        onChange={changeChat}
        availability={availability[setting.key]}
        idPrefix="mc"
        optionStyle={extra?.optionStyle}
        controlStyle={extra?.controlStyle}
        segmented={extra?.segmented}
        range={extra?.range}
      />
    );

    return (
      <section
        className="card panel-chat-settings"
        aria-labelledby="chat-settings-heading"
      >
        <div className="settings-panel-head">
          <h2 id="chat-settings-heading" className="section-title">
            Chat settings
          </h2>
          <button
            type="button"
            className="classic-conn-btn settings-reset-btn"
            aria-label="Reset Chat Settings to Default"
            onClick={resetChatSettings}
          >
            Reset Chat Defaults
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {chatResetStatus}
        </p>

        {/* Settings are grouped by what creators are trying to change rather than
            placing every message feature into one long Behaviour column. The same
            catalog controls and state paths are reused, so this is presentation only. */}
        <div className="form_table cols-3">
          <ClassicCollapsibleSection
            sectionId="chat-text"
            title="Text"
            collapsed={collapsedSections.has('chat-text')}
            onToggle={toggleSettingsSection}
            className="settings-group-wide text-settings-group"
            bodyClassName="text-settings-layout"
          >
            <div className="typography-panel">
              <div className="typography-heading">
                <h4>Typography</h4>
              </div>
              <div className="typography-primary-grid">
                <MultichatFontPicker
                  id="mc-font"
                  customInputId="mc-googleFont"
                  showCustomInput
                  label={MC_FONT.label}
                  options={MC_FONT.options}
                  presetFont={chatStyle.font}
                  customFont={chatStyle.googleFont}
                  fontFamilies={FONT_FAMILIES}
                  onChange={changeChatFont}
                />
                <div className="typography-style-field">
                  {chat(MC_FONT_WEIGHT)}
                </div>
              </div>
              <div className="typography-secondary-grid">
                {chat(MC_TEXT_TRANSFORM, { segmented: true })}
                <div className="typography-italic-field">
                  {chat(MC_FONT_ITALIC)}
                </div>
              </div>
              {chat(MC_FONT_COLOR)}
              <div className="typography-size-field">
                {chat(MC_TEXT_SIZE, { segmented: true })}
              </div>
            </div>
            <div className="typography-effects">
              <p className="typography-subheading">Effects &amp; background</p>
              {chat(MC_STROKE, { segmented: true })}
              {chat(MC_TEXT_SHADOW, { segmented: true })}
              {chat(MC_BG_COLOR)}
            </div>
          </ClassicCollapsibleSection>

          <ClassicCollapsibleSection
            sectionId="chat-appearance"
            title="Appearance"
            collapsed={collapsedSections.has('chat-appearance')}
            onToggle={toggleSettingsSection}
          >
            {chat(MC_ANIMATION, { segmented: true })}
            {chat(MC_ENTRY_ANIMATION, { segmented: true })}
            {chat(MC_SOURCE_TAG, { segmented: true })}
            {chat(MC_EMOTE_SCALE, { range: EMOTE_SCALE_RANGE })}
            {chat(MC_FADE_ENABLED)}
            {chatStyle.fadeEnabled ? chat(MC_FADE, { range: FADE_RANGE }) : null}
          </ClassicCollapsibleSection>

          <ClassicCollapsibleSection
            sectionId="chat-emotes"
            title="Emotes & Badges"
            collapsed={collapsedSections.has('chat-emotes')}
            onToggle={toggleSettingsSection}
          >
            {chat(MC_SEVENTV_EMOTES)}
            {chat(MC_SEVENTV_COSMETICS)}
            {chat(MC_GIFS)}
            {chat(MC_GIF_SIZE)}
            {chat(MC_COMMUNITY_BADGES)}
            <ClassicBadgeOrderVisibility
              value={chatStyle.badgeLayout ?? ''}
              onChange={(key, next) =>
                changeChat(key as keyof MultichatWorkspaceStyle & string, next)
              }
            />
            {chat(MC_PAINT_SHADOWS)}
          </ClassicCollapsibleSection>
        </div>

        <div className="form_table cols-3">
          <ClassicCollapsibleSection
            sectionId="chat-messages"
            title="Messages"
            collapsed={collapsedSections.has('chat-messages')}
            onToggle={toggleSettingsSection}
          >
            {chat(MC_MSG_BOLD)}
            {chat(MC_SMOOTH_SCROLL)}
            {chat(MC_REPLY_STYLE, { segmented: true })}
            {chat(MC_HIDE_NAMES)}
            {chat(MC_MENTION_COLOR)}
          </ClassicCollapsibleSection>

          <ClassicCollapsibleSection
            sectionId="chat-events"
            title="Events"
            collapsed={collapsedSections.has('chat-events')}
            onToggle={toggleSettingsSection}
          >
            {chat(MC_SHOW_SYSTEM_MSGS)}
            {chat(MC_SHOW_FIRST_MESSAGES)}
            {chat(MC_SHOW_REDEEMS)}
            {chat(MC_MOD_ACTION)}
          </ClassicCollapsibleSection>

          <ClassicCollapsibleSection
            sectionId="chat-extras"
            title="Extras"
            collapsed={collapsedSections.has('chat-extras')}
            onToggle={toggleSettingsSection}
          >
            {chat(MC_SHARED_CHAT)}
            {chat(MC_RESTORE_ON_RELOAD)}
            {chatStyle.restoreOnReload ? chat(MC_MAX_MESSAGE_LINES) : null}
            {chatStyle.restoreOnReload ? chat(MC_MAX_MESSAGE_AGE) : null}
            {chat(MC_SHOW_PIN)}
            {chatStyle.showPinEnabled ? chat(MC_PIN_PLATFORMS) : null}

            {chatStyle.showPinEnabled ? (
              <div className="mc-pin-connect">
                <ClassicTwitchConnect
                  runtime={runtime}
                  onRuntimeChange={setRuntime}
                  onUseConnectedChannel={(login) =>
                    changeChannel('twitch', login)
                  }
                  onBeforeLeave={persistDraft}
                  describedBy="mc-pin-connect-help"
                />
                <p className="sr-only" id="mc-pin-connect-help">
                  Connect your Twitch account only to display native Twitch
                  pinned messages. Chat and viewer counts do not require login.
                </p>
              </div>
            ) : null}
          </ClassicCollapsibleSection>
        </div>

        {/* Filters: three free-text lists, each needing the width of a line, so
            they take the same two tracks rather than three narrow ones. */}
        <div className="form_table cols-2 settings-filter-table">
          <ClassicCollapsibleSection
            sectionId="chat-filters"
            title="Filters"
            collapsed={collapsedSections.has('chat-filters')}
            onToggle={toggleSettingsSection}
            className="settings-group-wide"
            bodyClassName="settings-filter-grid"
          >
            <div className="form_col">
              {chat(MC_BOT_NAMES)}
              {chat(MC_PREFIX_BL)}
            </div>
            <div className="form_col">
              {chat(MC_USER_BL)}
            </div>
          </ClassicCollapsibleSection>
        </div>
      </section>
    );
  }

  /** Viewer Counter settings, with Typography isolated from Chat state. */
  function counterSettingsPanel() {
    const vc = (
      setting: Parameters<typeof ClassicSetting<ViewerCounterStyle>>[0]['setting'],
      extra?: { segmented?: boolean },
    ) => (
      <ClassicSetting
        key={setting.key}
        setting={setting}
        value={counterStyle[setting.key] as SettingValue}
        onChange={changeCounter}
        idPrefix="vc"
        segmented={extra?.segmented}
      />
    );

    return (
      <section
        className="card panel-counter-settings"
        aria-labelledby="counter-settings-heading"
      >
        <div className="settings-panel-head">
          <h2 id="counter-settings-heading" className="section-title">
            Counter settings
          </h2>
          <button
            type="button"
            className="classic-conn-btn settings-reset-btn"
            aria-label="Reset Viewer Settings to Default"
            onClick={resetCounterSettings}
          >
            Reset Counter Defaults
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {counterResetStatus}
        </p>

        <div className="form_table cols-2">
          <ClassicCollapsibleSection
            sectionId="counter-typography"
            title="Typography"
            collapsed={collapsedSections.has('counter-typography')}
            onToggle={toggleSettingsSection}
            className="settings-group-wide counter-typography-group"
          >
            <div className="typography-panel counter-typography-panel">
              <div className="typography-primary-grid">
                <MultichatFontPicker
                  id="vc-font"
                  customInputId="vc-googleFont"
                  label={VC_FONT.label}
                  options={VC_FONT.options}
                  presetFont={counterStyle.font ?? COUNTER_DEFAULT_STYLE.font!}
                  customFont={counterStyle.googleFont ?? ''}
                  fontFamilies={COUNTER_FONT_FAMILIES}
                  onChange={changeCounterFont}
                />
                <div className="typography-style-field">
                  {vc(VC_FONT_WEIGHT)}
                </div>
              </div>
              <div className="typography-secondary-grid">
                {vc(VC_TEXT_TRANSFORM, { segmented: true })}
                <div className="typography-italic-field">
                  {vc(VC_FONT_ITALIC)}
                </div>
              </div>
              {vc(VC_FONT_COLOR)}
              <div className="typography-size-field">
                {vc(VC_TEXT_SIZE, { segmented: true })}
              </div>
            </div>
          </ClassicCollapsibleSection>
          <ClassicCollapsibleSection
            sectionId="counter-layout"
            title="Layout"
            collapsed={collapsedSections.has('counter-layout')}
            onToggle={toggleSettingsSection}
          >
            {vc(VC_ALIGN, { segmented: true })}
            {vc(VC_TEXT_SHADOW, { segmented: true })}
            {vc(VC_STROKE, { segmented: true })}
          </ClassicCollapsibleSection>
          <ClassicCollapsibleSection
            sectionId="counter-display"
            title="Display"
            collapsed={collapsedSections.has('counter-display')}
            onToggle={toggleSettingsSection}
          >
            {vc(VC_COMBINED)}
            {vc(VC_ICONS)}
            {vc(VC_BG)}
          </ClassicCollapsibleSection>
        </div>

      </section>
    );
  }

  /** Commands, from the parser's own metadata. */
  function commandsCard() {
    return (
      <section className="card panel-commands" aria-labelledby="commands-heading">
        <ClassicCollapsibleSection
          sectionId="chat-commands"
          title="Commands & help"
          collapsed={collapsedSections.has('chat-commands')}
          onToggle={toggleSettingsSection}
          headingLevel="h2"
          headingId="commands-heading"
        >
          {/* Rows come from MULTICHAT_COMMANDS, which is derived from the parser's
              own command metadata — so this table cannot document a command the
              overlay does not implement. */}
          <div className="cmd-table-wrap">
            <table className="cmd-table">
              <caption className="sr-only">
                Chat commands the MultiChat overlay implements
              </caption>
              <thead>
                <tr>
                  <th scope="col">Command</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Who can use it</th>
                </tr>
              </thead>
              <tbody>
                {MULTICHAT_COMMANDS.map((command) => (
                  <tr key={command.name}>
                    <td>{command.syntax}</td>
                    <td>
                      {command.detail
                        ? `${command.summary} ${command.detail}`
                        : command.summary}
                    </td>
                    <td>Moderators and the broadcaster</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="card-note">
            Type these in any connected platform&rsquo;s chat — they act on the
            overlay itself, so they work from Kick, Twitch, YouTube, or TikTok.
            The overlay ignores them from everyone else.{' '}
            <code>{MULTICHAT_COMMAND_ALIAS}</code> works as an alias for{' '}
            <code>{MULTICHAT_COMMAND_TRIGGER}</code> everywhere above.
            Most commands act on the chat overlay. The counterbgon/counterbgoff pair also controls the separate viewer-counter browser source when it uses the same gxufy.com origin and channel set.
          </p>
        </ClassicCollapsibleSection>
      </section>
    );
  }

  /** OBS setup, for two independent browser sources. */
  function obsSetupCard() {
    return (
      <section className="card panel-obs" aria-labelledby="obs-heading">
        <h2 id="obs-heading" className="section-title">
          OBS setup
        </h2>

        <p className="card-note" style={{ margin: '0 0 14px' }}>
          The chat overlay and the viewer counter are two separate browser
          sources with two different URLs. Add whichever you want — neither needs
          the other, and they can go in different scenes, at different sizes, or
          only one at a time.
        </p>

        {/* Two independent procedures, so they sit side by side on a wide screen
            rather than stacking into twice the height. */}
        <div className="setup-cols">
        <div>
        <p className="setup-sub">Chat overlay</p>
        <ol className="steps">
          <li>
            Copy the <strong>chat overlay URL</strong> above.
          </li>
          <li>
            In OBS: <strong>Add Source → Browser</strong>, then paste it into{' '}
            <strong>URL</strong>.
          </li>
          <li>
            Size it{' '}
            <strong>
              {MULTICHAT_OBS_RECOMMENDED.width} × {MULTICHAT_OBS_RECOMMENDED.height}
            </strong>
            .
          </li>
          <li>
            Leave <strong>Shutdown source when not visible</strong> off — the
            overlay reconnects on load, so toggling it drops recent messages.
          </li>
        </ol>
        </div>

        <div>
        <p className="setup-sub">Viewer counter</p>
        <ol className="steps">
          <li>
            Copy the <strong>viewer counter URL</strong> above — it is a
            different URL, not a setting on the overlay.
          </li>
          <li>
            Add a <strong>second Browser source</strong> and paste it in.
          </li>
          <li>
            Size it{' '}
            <strong>
              {counterTool.obs.width} × {counterTool.obs.height}
            </strong>
            .
          </li>
        </ol>
        </div>
        </div>

        <p className="card-note">
          Both backgrounds are already transparent, so no custom CSS is needed.
          The preview background buttons on this page only change this page —
          they are never part of either URL and never reach OBS.
        </p>
      </section>
    );
  }

  function classicFooter() {
    return (
      <footer>
        <p>
          multichat-gxufy with 🕊️ —{' '}
          <a href="https://guns.lol/gxufy" target="_blank" rel="noreferrer">
            https://guns.lol/gxufy
          </a>
        </p>
        <p>
          <a
            href="https://github.com/gxufy/multichat-gxufy"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </p>
        <p>
          Not affiliated with{' '}
          <a href="https://kick.com" target="_blank" rel="noreferrer">
            Kick
          </a>
          ,{' '}
          <a href="https://twitch.tv" target="_blank" rel="noreferrer">
            Twitch
          </a>
          ,{' '}
          <a href="https://youtube.com" target="_blank" rel="noreferrer">
            YouTube
          </a>
          , or{' '}
          <a href="https://tiktok.com" target="_blank" rel="noreferrer">
            TikTok
          </a>
        </p>
      </footer>
    );
  }
}
