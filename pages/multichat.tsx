'use client';

import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { z } from 'zod';
import {
  getSevenTVGlobalEmotes,
  getSevenTVChannelEmotes,
  decimalToRGBA,
  type KickChannel,
  type SevenTVEmote,
  type SevenTVBadge,
  type SevenTVPaint,
  type Entitlements,
  type ParsedMessage,
} from '../lib/kick';
import type { Connector, UnifiedMessage, UnifiedPin } from '../lib/types';
import { createKickConnector } from '../lib/connectors/kick';
import { createTwitchConnector } from '../lib/connectors/twitch';
import { createYouTubeConnector } from '../lib/connectors/youtube';
import { createTikTokConnector } from '../lib/connectors/tiktok';
import { renderMessageText, renderBadges, fallbackColor, readableColor, isYouTubeOwner } from '../lib/render';
import { loadTwitchEmotes } from '../lib/twitchEmotes';
import { createCosmeticsFetcher } from '../lib/cosmetics';
import LandingPage from '../components/LandingPage';
import ChatOverlay, { type PinnedState } from '../components/ChatOverlay';
import { SunsetBanner } from '../components/SunsetBanner';
import { processPinEvent, tick as pinTick, resetState, INITIAL_PIN_STATE, type PinPhase } from '../lib/pinController';

const QuerySchema = z.object({
  /** legacy param — same as kick= */
  channel: z.string().optional(),
  kick: z.string().optional(),
  twitch: z.string().optional(),
  youtube: z.string().optional(),
  tiktok: z.string().optional(),
  sevenTVCosmeticsEnabled: z.string().optional().transform(v => v !== 'false'),
  sevenTVEmotesEnabled: z.string().optional().transform(v => v !== 'false'),
  textShadow: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'none','2':'small','3':'medium','4':'large'};
    return map[v??''] ?? (['none','small','medium','large'].includes(v??'') ? v! : 'large');
  }),
  textSize: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'small','2':'medium','3':'large'};
    return map[v??''] ?? (['small','medium','large'].includes(v??'') ? v! : 'medium');
  }),
  animation: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'none','2':'slide','3':'fade'};
    return map[v??''] ?? (['none','slide','fade'].includes(v??'') ? v! : 'slide');
  }),
  showPinEnabled: z.string().optional().transform(v => v === 'true'),
  showSystemMsgs: z.string().optional().transform(v => v !== 'false'),
  /* UChat-style colorable mentions — default ON (mentionColor=false to disable) */
  mentionColor: z.string().optional().transform(v => v !== 'false'),
  /* chat background: 'transparent' (default) or a hex color like 191919 */
  bgColor: z.string().optional().transform(v =>
    /^[0-9a-fA-F]{6}$/.test(v ?? '') ? `#${v}` : ''),
  /* channel-point redeems (kick/twitch highlighted messages) */
  showRedeems: z.string().optional().transform(v => v !== 'false'),
  /* StreamNook sourceTag: none | dot | label | icon (default icon —
     official brand marks, same art Streamlabs uses) */
  sourceTag: z.string().optional().transform(v =>
    (['none','dot','label','icon'].includes(v ?? '') ? v! : 'icon') as 'none'|'dot'|'label'|'icon'),
  /* profile pictures (yt/tiktok) — off by default */
  showAvatars: z.string().optional().transform(v => v === 'true'),
  font: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'baloo','2':'segoe','3':'roboto','4':'lato','5':'noto','6':'sourcecode','7':'impact','8':'comfortaa','9':'dancing','10':'indieflower','11':'opensans','12':'alsina'};
    return map[v??''] ?? v ?? 'opensans';
  }),
  stroke: z.string().optional().transform(v => {
    const map: Record<string,string> = {'1':'none','2':'thin','3':'medium','4':'thick','5':'thicker'};
    return map[v??''] ?? (['none','thin','medium','thick','thicker'].includes(v??'') ? v! : 'none');
  }),
  emoteScale: z.string().optional().transform(v => { const n = parseFloat(v ?? ''); return isNaN(n) ? 1 : n; }),
  fade: z.string().optional().transform(v => { const n = parseInt(v ?? ''); return isNaN(n) ? (false as const) : n; }),
  /* ── UChat-ported settings ── */
  msgBold: z.string().optional().transform(v => v !== 'false'),
  msgCaps: z.string().optional().transform(v => v === 'true'),
  fontColor: z.string().optional().transform(v =>
    /^[0-9a-fA-F]{6}$/.test(v ?? '') ? `#${v}` : ''),
  paintShadows: z.string().optional().transform(v => v !== 'false'),
  modAction: z.string().optional().transform(v => v !== 'false'),
  userBL: z.string().optional().transform(v => v ?? ''),
  prefixBL: z.string().optional().transform(v => v ?? ''),
  /* per-platform pins: CSV of kick,twitch,youtube,tiktok
   * - absent → default to all four
   * - present but empty → [] (no pins at all)
   * - valid names → only those; invalid ignored, duplicates removed */
  pinPlatforms: z.string().optional().transform(v => {
    const all = ['kick', 'twitch', 'youtube', 'tiktok'];
    if (v === undefined) return all;       // param absent → default
    if (v === '') return [];                // param explicitly empty → none
    const picked = [...new Set(v.split(',').map(s => s.trim().toLowerCase()).filter(s => all.includes(s)))];
    return picked.length ? picked : all;    // no valid names → fallback to all
  }),
  hideNames: z.string().optional().transform(v => v === 'true'),
  botNames: z.string().optional().transform(v => v ?? ''),
  ttsEnabled: z.string().optional().transform(v => v !== 'false'),
});

export type OverlayConfig = z.infer<typeof QuerySchema>;

export default function Page() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const [showLoader, setShowLoader] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedState | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Pin controller — mutable state ref + reactive phase for rerender. */
  const pinStateRef = useRef(INITIAL_PIN_STATE);
  const [pinPhase, setPinPhase] = useState<PinPhase | null>(null);

  // Mutable state that doesn't trigger rerenders
  const stateRef = useRef<{
    emotes: SevenTVEmote[];
    badges: SevenTVBadge[];
    paints: SevenTVPaint[];
    entitlements: Entitlements;
    messages: ParsedMessage[];
    channel: KickChannel | null;
    config: OverlayConfig | null;
  }>({
    emotes: [],
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

    const parsed = QuerySchema.safeParse(router.query);
    if (!parsed.success) return;
    const cfg = parsed.data;
    const kickChannel = cfg.kick || cfg.channel || '';
    const platformCount = [kickChannel, cfg.twitch, cfg.youtube, cfg.tiktok].filter(Boolean).length;
    if (platformCount === 0) return;

    setConfig(cfg);
    stateRef.current.config = cfg;
    setShowLoader(true);

    const s = stateRef.current;
    const connectors: Connector[] = [];
    const cleanups: (() => void)[] = [];
    let twitchRoomId: string | null = null; // for !multichat refresh emotes

    /* GQL cosmetics fetcher (UChat approach) — deterministic per-chatter
       lookups; EventAPI stays on for live deltas. When cosmetics land,
       rebuild that sender's buffered messages so paints apply
       retroactively, not just to their next message. */
    const cosmeticsFetcher = createCosmeticsFetcher(
      { paints: s.paints, badges: s.badges, entitlements: s.entitlements },
      (keys) => {
        const keySet = new Set(keys);
        let touched = false;
        s.messages = s.messages.map(m => {
          if (!m.platform || !m.senderId || !m.raw) return m;
          if (!keySet.has(`${m.platform}:${m.senderId}`)) return m;
          touched = true;
          return { ...buildParsed(m.raw as UnifiedMessage), timestamp: m.timestamp };
        });
        if (touched) dirty = true;
      },
    );
    cleanups.push(() => cosmeticsFetcher.stop());
    // Loader hides once every requested platform has reported some status
    const settled = new Set<string>();
    let greeted = false;
    function settle(platform: string) {
      settled.add(platform);
      if (settled.size >= platformCount) {
        setShowLoader(false);
        // chatis-style connect greeting — once, when everything's up
        if (!greeted) {
          greeted = true;
          showFloat(1, 'Multi-Chat Overlay made by @Gxufy', 5000, 0.3);
        }
      }
    }

    function buildPaintStyle(paint: SevenTVPaint): { background: string; filter: string } {
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
        if (!cfg.paintShadows) break; // UChat: paint shadows toggle
        shadows.push(`drop-shadow(${decimalToRGBA(shadow.color)} ${shadow.x_offset}px ${shadow.y_offset}px ${shadow.radius}px)`);
      }
      const background = `${prefix}${paint.func.toLowerCase().replace('_', '-')}(${parts.join(', ')})`;
      return { background, filter: shadows.join(' ') };
    }

    /* UChat mention coloring: name→color map fills as users chat */
    const mentionColors = new Map<string, string>();
    const mentionCtx = { enabled: cfg.mentionColor, colors: mentionColors };

    /** UnifiedMessage → ParsedMessage (React nodes + 7TV cosmetics for kick) */
    function buildParsed(um: UnifiedMessage): ParsedMessage {
      const badgeNodes = renderBadges(um, s.channel?.subscriber_badges ?? []);
      let background = '';
      let filter = '';
      // 7TV cosmetics apply to kick AND twitch chatters (chatis parity)
      if ((um.platform === 'kick' || um.platform === 'twitch') && cfg.sevenTVCosmeticsEnabled && um.senderId) {
        const entitlement = s.entitlements[`${um.platform}:${um.senderId}`];
        if (entitlement) {
          if (entitlement.badge) {
            const badge = s.badges.find(b => b.id === entitlement.badge);
            if (badge) badgeNodes.push(<img key="7tv-badge" className="ck-badge-img" src={badge.image} alt="7tv badge" />);
          }
          if (entitlement.paint) {
            const paint = s.paints.find(p => p.id === entitlement.paint);
            if (paint) ({ background, filter } = buildPaintStyle(paint));
          }
        }
      }
      // mention map: remember every chatter's color (lowercase name)
      const displayColor = um.color ? readableColor(um.color) : fallbackColor(um.platform, um.username, um.senderId);
      mentionColors.set(um.username.toLowerCase(), displayColor);
      return {
        id: `${um.platform}:${um.id}`,
        platform: um.platform,
        senderId: um.senderId,
        kind: um.kind,
        category: um.category,
        redeem: um.redeem,
        avatar: um.avatar,
        raw: um,
        timestamp: Date.now(),
        identity: {
          username: um.username,
          color: displayColor,
          background,
          filter,
          badges: badgeNodes,
          // StreamNook: yt channel owner name renders as a gold pill
          ...(isYouTubeOwner(um) ? { namePill: '#ffd600|#111111' } : {}),
        },
        // kick + twitch both get third-party emote word-swaps in text gaps
        message: renderMessageText(
          um,
          (um.platform === 'kick' || um.platform === 'twitch') && cfg.sevenTVEmotesEnabled ? s.emotes : [],
          mentionCtx
        ),
      };
    }

    // Global well-known bots (matches chatis list)
    const KNOWN_BOTS = new Set([
      'streamelements','streamlabs','nightbot','moobot',
      'titlechange_bot','supibot','pajbot','huwobot',
      'oshbt','spanixbot','potatbotat','streamqbot','twirapp',
      'fossabot','wizebot','botisimo','sery_bot','soundalerts',
    ]);
    const extraBots = new Set(
      (cfg.botNames || '').split(',').flatMap((b: string) => b.trim().split(' ')).filter(Boolean).map((b: string) => b.toLowerCase())
    );
    // UChat user + prefix blacklists (space-separated)
    const userBlacklist = new Set((cfg.userBL || '').split(/\s+/).filter(Boolean).map(u => u.toLowerCase()));
    const prefixBlacklist = (cfg.prefixBL || '').split(/\s+/).filter(Boolean);
    function isBot(username: string) {
      const u = username.toLowerCase();
      return KNOWN_BOTS.has(u) || extraBots.has(u) || userBlacklist.has(u);
    }
    function isBlacklistedPrefix(text: string) {
      return prefixBlacklist.some(p => text.startsWith(p));
    }

    /* chatis-exact render loop: messages buffer into s.messages and a
       single 200ms interval flushes to React (script.js update()).
       Per-message setState with 4 platforms caused re-renders mid-slide
       — that was the stutter. Deletions flush on the same tick. */
    let dirty = false;
    const flushInterval = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      setMessages([...s.messages]);
    }, 200);

    function addMessage(um: UnifiedMessage) {
      handleCommand(um); // !multichat commands work from any platform
      if (isBot(um.username)) return;
      if (um.kind === 'chat' && isBlacklistedPrefix(um.text)) return;
      if (um.kind === 'system' && !cfg.showSystemMsgs) return;
      if (um.redeem && !cfg.showRedeems) return;
      // queue this chatter for GQL cosmetics (kick/twitch only)
      if (cfg.sevenTVCosmeticsEnabled && (um.platform === 'kick' || um.platform === 'twitch')) {
        cosmeticsFetcher.want(um.platform, um.senderId);
      }
      s.messages.push(buildParsed(um));
      if (s.messages.length > 100) s.messages.shift();
      dirty = true;
    }

    function removeMessages(platform: string, opts: { id?: string; username?: string; senderId?: string }) {
      if (!cfg.modAction) return; // UChat: moderation actions can be disabled
      if (opts.id) {
        s.messages = s.messages.filter(m => m.id !== `${platform}:${opts.id}`);
      } else if (opts.senderId) {
        s.messages = s.messages.filter(m => !(m.platform === platform && m.senderId === opts.senderId));
      } else if (opts.username) {
        s.messages = s.messages.filter(m => !(m.platform === platform && m.identity.username.toLowerCase() === opts.username!.toLowerCase()));
      } else {
        s.messages = s.messages.filter(m => m.platform !== platform);
      }
      dirty = true;
    }

    function handlePin(pin: UnifiedPin | null) {
      if (!cfg.showPinEnabled) return;
      // per-platform pin toggle: latest pin from an enabled platform wins
      if (pin && !cfg.pinPlatforms.includes(pin.message.platform)) return;

      const parsed = pin ? buildParsed(pin.message) : null;
      const platform = pin?.message.platform;
      const pinId = pin?.message.id;

      if (pin && parsed && platform) {
        pinStateRef.current = processPinEvent(pinStateRef.current, 'pin', {
          msg: parsed,
          pinnedBy: pin.pinnedBy,
          platform,
          pinId,
        });
        setPinnedMessage({
          msg: parsed,
          pinnedBy: pin.pinnedBy,
          phase: pinStateRef.current.entry?.phase,
        });
        setPinPhase(pinStateRef.current.entry?.phase ?? null);
      } else {
        /* Unpin — clear everything */
        pinStateRef.current = resetState(pinStateRef.current);
        setPinnedMessage(null);
        setPinPhase(null);
      }
    }

    /* ── Kick (incl. 7TV emotes/cosmetics) ── */
    if (kickChannel) {
      const kick = createKickConnector({
        channel: kickChannel,
        onMessage: addMessage,
        onDelete: o => removeMessages('kick', o),
        onPin: handlePin,
        onStatus: (status, detail) => {
          if (status === 'connected') settle('kick');
          if (status === 'error') { setError(detail ?? 'Kick connection error'); settle('kick'); }
        },
        onChannelInfo: async channel => {
          s.channel = channel;
          if (!cfg.sevenTVEmotesEnabled) return;
          const globalEmotes = await getSevenTVGlobalEmotes();
          s.emotes.push(...globalEmotes);
          const { emotes: channelEmotes, setId, stvUserId } = await getSevenTVChannelEmotes(channel.user_id.toString());
          s.emotes.push(...channelEmotes);
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
      connectors.push(createTwitchConnector({
        channel: cfg.twitch,
        onMessage: addMessage,
        onDelete: o => removeMessages('twitch', o),
        onPin: handlePin, // never fires — Twitch pins need OAuth
        onStatus: (status, detail) => {
          if (status !== 'connecting') settle('twitch');
          if (status === 'error' && platformCount === 1) setError(detail ?? 'Twitch connection error');
        },
        onRoomId: async roomId => {
          twitchRoomId = roomId;
          if (!cfg.sevenTVEmotesEnabled) return;
          // Full chatis emote stack: FFZ → BTTV → 7TV (later wins).
          // Kick channel emotes may already be loaded — don't clobber them.
          const emotes = await loadTwitchEmotes(roomId);
          const have = new Set(s.emotes.map(e => e.name));
          s.emotes.push(...emotes.filter(e => !have.has(e.name)));
          // 7TV cosmetics for Twitch chatters (chatis genSubs :481):
          // entitlements/cosmetics for the channel ctx + live emote set
          if (cfg.sevenTVCosmeticsEnabled) {
            let setId: string | null = null;
            let stvUserId: string | null = null;
            try {
              const r = await fetch(`https://7tv.io/v3/users/twitch/${roomId}`);
              if (r.ok) {
                const j = await r.json();
                setId = j?.emote_set?.id ?? null;
                stvUserId = j?.user?.id ?? null; // user.id = 7TV user id (root id is the twitch id)
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
          if (status === 'error' && platformCount === 1) setError(detail ?? 'TikTok connection error');
        },
      }));
    }

    /* ── !multichat command handler — works from ANY platform's chat.
       Access via unified badges: broadcaster/owner = 1000, mod = 500.
       (!kickchat kept as a legacy alias.) ── */
    function getAccessLevel(um: UnifiedMessage): number {
      for (const b of um.badges) {
        if (b.type === 'broadcaster' || b.type === 'owner') return 1000;
      }
      // broadcaster fallback by name — TikTok has no broadcaster badge
      const uname = um.username.toLowerCase();
      if (
        (um.platform === 'kick' && uname === kickChannel.toLowerCase()) ||
        (um.platform === 'twitch' && uname === (cfg.twitch ?? '').toLowerCase()) ||
        (um.platform === 'tiktok' && uname === (cfg.tiktok ?? '').replace(/^@/, '').toLowerCase())
      ) return 1000;
      for (const b of um.badges) {
        if (b.type === 'moderator') return 500;
      }
      return 0;
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

    function handleCommand(um: UnifiedMessage) {
      const text: string = um.text ?? '';
      const trigger = text.toLowerCase().startsWith('!multichat') ? '!multichat'
        : text.toLowerCase().startsWith('!kickchat') ? '!kickchat' : null;
      if (!trigger) return;
      if (getAccessLevel(um) < 500) return;
      const args = text.trim().split(/\s+/);
      const cmd = (args[1] ?? '').toLowerCase();
      switch (cmd) {
        case 'ping': showFloat(1, 'Pong!\nmultichat-gxufy', 3000); break;
        case 'reload': window.location.reload(); break;
        case 'stop': removeAllFloats(); break;
        case 'show': setChatVisible(true); break;
        case 'hide': setChatVisible(false); break;
        case 'refresh':
          if (!args[2] || args[2] === 'emotes') {
            showFloat(9, '🔄 Reloading emotes...', 10000, 0.7);
            (async () => {
              try {
                const fresh: SevenTVEmote[] = await getSevenTVGlobalEmotes();
                const ch = s.channel;
                if (ch) {
                  const { emotes: ce } = await getSevenTVChannelEmotes(ch.user_id.toString());
                  fresh.push(...ce);
                }
                // Twitch FFZ/BTTV/7TV stack too (roomId captured on connect)
                if (twitchRoomId) {
                  const te = await loadTwitchEmotes(twitchRoomId);
                  const have = new Set(fresh.map(e => e.name));
                  fresh.push(...te.filter(e => !have.has(e.name)));
                }
                s.emotes = fresh;
                showFloat(9, '✅ Emotes reloaded!', 2000, 0.7);
              } catch (_) {
                showFloat(9, '❌ Emote reload failed', 2000, 0.7);
              }
            })();
          }
          break;
        case 'img': {
          if (args[2] === 'clear') { removeFloat(4); break; }
          const urlMatch = text.match(/https?:\/\/\S+/);
          const emoteName = args[2] ?? '';
          const link = urlMatch ? urlMatch[0] : s.emotes.find(e => e.name === emoteName)?.image ?? null;
          if (!link) break;
          const timeout = (parseFloat((text.match(/-t\s+([\d.]+)/) || [])[1] ?? '') || 5) * 1000;
          const opacity = parseFloat((text.match(/-o\s+([\d.]+)/) || [])[1] ?? '') || 1;
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;pointer-events:none;';
          el.innerHTML = `<img src="${link}" style="width:100%;height:100%;object-fit:fill;opacity:${opacity};" />`;
          document.body.appendChild(el);
          floats[4] = { el, timer: setTimeout(() => removeFloat(4), timeout) };
          break;
        }
        case 'yt': {
          const ytPresets: Record<string, string> = {
            'bruh': '2ZIpFytCSVc', 'vine-boom': '_vBVGjFdwk4', 'dc-ping': 'jiWj1zZlRjQ',
            'rickroll': 'dQw4w9WgXcQ', 'win-error': 'v76-ChTSLJk',
          };
          const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/watch\?v=)([\w\-]+)/);
          const ytId = urlMatch ? urlMatch[1] : ytPresets[args[2]] ?? null;
          if (!ytId) break;
          const timeout = (parseFloat((text.match(/-t\s+([\d.]+)/) || [])[1] ?? '') || 5) * 1000;
          const mute = text.includes('-m');
          const el = document.createElement('div');
          el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;pointer-events:none;';
          el.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1${mute ? '&mute=1' : ''}&rel=0"
            width="100%" height="100%" frameborder="0" allow="autoplay" style="display:block;"></iframe>`;
          document.body.appendChild(el);
          floats[5] = { el, timer: setTimeout(() => removeFloat(5), timeout) };
          break;
        }
        case 'tts': {
          const ttsText = text.replace(/^!(?:multichat|kickchat)\s+tts\s*/i, '').trim();
          if (!ttsText) break;
          const speakFallback = (t: string) => {
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
            window.speechSynthesis.getVoices().length ? go() : window.speechSynthesis.addEventListener('voiceschanged', go, { once: true });
          };
          fetch(`/api/tts?voice=Brian&text=${encodeURIComponent(ttsText)}`)
            .then(r => { if (!r.ok) throw new Error('proxy failed'); return r.blob(); })
            .then(blob => {
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.volume = 1.0;
              audio.addEventListener('canplaythrough', () => audio.play().catch(() => {}));
              audio.addEventListener('ended', () => URL.revokeObjectURL(url));
              audio.load();
            })
            .catch(() => speakFallback(ttsText));
          break;
        }
      }
    }

    /* handle7TVDispatch — ChatIS-v2 handleDispatchEvent (script.js:700).
       platform: which connection namespace the entitlements belong to;
       entitlements are keyed "<platform>:<user-id>" so kick and twitch
       users can't collide. */
    function handle7TVDispatch(data: any, platform: 'kick' | 'twitch') {
      if (data.type === 'cosmetic.create') {
        // cosmetic id lives on body.object.id (body.id is the event id —
        // storing that orphaned every entitlement lookup)
        const obj = data.body.object;
        const id = obj?.id ?? data.body.id;
        if (obj.kind === 'BADGE') {
          // badge art from the object's own host url (chatis :870)
          const host = obj.data?.host?.url;
          s.badges.push({ id, image: host ? `https:${host}/3x` : `https://cdn.7tv.app/badge/${id}/3x` });
        }
        if (obj.kind === 'PAINT') {
          const d = obj.data;
          s.paints.push({ id, func: d.function, angle: d.angle, color: d.color, repeat: d.repeat, shadows: d.shadows ?? [], stops: d.stops ?? [], image_url: d.image_url, shape: d.shape });
        }
      }
      if (data.type === 'entitlement.create') {
        const kind = data.body.object.kind;
        // chatis :829 switches on kind — EMOTE_SET/AVATAR entitlements are
        // the most common and MUST be ignored (treating them as paints
        // clobbered every real paint ref with an emote-set id)
        if (kind !== 'BADGE' && kind !== 'PAINT') return;
        const plat = platform === 'kick' ? 'KICK' : 'TWITCH';
        for (const conn of (data.body.object.user?.connections ?? [])) {
          if (conn.platform === plat) {
            s.entitlements[`${platform}:${conn.id}`] = {
              ...s.entitlements[`${platform}:${conn.id}`],
              [kind === 'BADGE' ? 'badge' : 'paint']: data.body.object.ref_id,
            };
          }
        }
      }
      if (data.type === 'entitlement.delete') {
        const kind = data.body.object.kind;
        if (kind !== 'BADGE' && kind !== 'PAINT') return;
        const plat = platform === 'kick' ? 'KICK' : 'TWITCH';
        for (const conn of (data.body.object.user?.connections ?? [])) {
          if (conn.platform === plat) {
            const key = kind === 'BADGE' ? 'badge' : 'paint';
            if (s.entitlements[`${platform}:${conn.id}`]?.[key] === data.body.object.ref_id) {
              s.entitlements[`${platform}:${conn.id}`] = { ...s.entitlements[`${platform}:${conn.id}`], [key]: undefined };
            }
          }
        }
      }
      if (data.type === 'cosmetic.delete') {
        const obj = data.body.object;
        if (obj?.kind === 'BADGE') s.badges = s.badges.filter(b => b.id !== obj.id);
        if (obj?.kind === 'PAINT') s.paints = s.paints.filter(p => p.id !== obj.id);
      }
      // Live emote updates (chatis :745): channel adds/renames/removes
      // land without a reload
      if (data.type === 'emote_set.update') {
        const body = data.body;
        for (const p of body.pulled ?? []) {
          const name = p.old_value?.name;
          if (name) s.emotes = s.emotes.filter(e => e.name !== name);
        }
        for (const p of body.pushed ?? []) {
          const v = p.value;
          if (!v?.id) continue;
          s.emotes = s.emotes.filter(e => e.name !== v.name);
          s.emotes.push({
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
          const em = s.emotes.find(e => e.name === oldName);
          if (em) em.name = v.name;
        }
      }
    }

    /* One SSE per platform context — reconnects itself on error.
       StreamNook bootstrap_presence (seventv_eventapi.rs): subscribing
       alone only delivers DELTAS; a passive presence POST (kind 1, with
       our session id from the hello frame) makes 7TV push the cosmetics
       of everyone ALREADY in the channel. Without it, paints only ever
       appeared for users who re-entered after we connected — the reason
       cosmetics seemed to never load. */
    function open7TVEvents(sseUrl: string, platform: 'kick' | 'twitch', stvUserId: string | null, channelId: string) {
      let sse = new EventSource(sseUrl);
      let closed = false;
      const onDispatch = (e: MessageEvent) => handle7TVDispatch(JSON.parse(e.data), platform);
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

    // Loader safety: never spin forever if a platform stays silent
    const loaderTimeout = setTimeout(() => setShowLoader(false), 15000);

    let fadeInterval: ReturnType<typeof setInterval> | null = null;
    if (cfg.fade !== false) {
      const fadeMs = (cfg.fade as number) * 1000;
      const fadingSet = new Set<string>();
      fadeInterval = setInterval(() => {
        const cutoff = Date.now() - fadeMs;
        const expired = s.messages.find(
          m => (m.timestamp ?? 0) <= cutoff && !fadingSet.has(m.id)
        );
        if (!expired) return;
        fadingSet.add(expired.id);
        setFadingIds(new Set(fadingSet));
        setTimeout(() => {
          fadingSet.delete(expired.id);
          s.messages = s.messages.filter(m => m.id !== expired.id);
          dirty = true; // removal flushes on the shared 200ms tick
          setFadingIds(new Set(fadingSet));
        }, 400);
      }, 200);
    }

    return () => {
      clearTimeout(loaderTimeout);
      clearInterval(flushInterval);
      if (fadeInterval) clearInterval(fadeInterval);
      connectors.forEach(c => c.stop());
      cleanups.forEach(fn => fn());
    };
  }, [router.isReady]);

  /* Pin lifecycle tick — advances entering → visible → exiting → gone every 100 ms. */
  useEffect(() => {
    const interval = setInterval(() => {
      const prevPhase = pinStateRef.current.entry?.phase;
      const next = pinTick(pinStateRef.current, Date.now());
      if (next === null) {
        /* Gone — clear everything. */
        pinStateRef.current = resetState(pinStateRef.current);
        setPinnedMessage(null);
        setPinPhase(null);
      } else if (next.entry && next.entry.phase !== prevPhase) {
        /* Phase changed — update phase state (triggers rerender) and the
           PinnedState on pinnedMessage so PinBanner can animate. */
        pinStateRef.current = next;
        const phase = next.entry.phase;
        setPinPhase(phase);
        setPinnedMessage(prev => prev ? { ...prev, phase } : null);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  if (!ready) return null;

  const hasChannel = !!(router.query.channel || router.query.kick || router.query.twitch || router.query.youtube || router.query.tiktok);
  if (!hasChannel) {
    return (
      <>
        <SunsetBanner variant="landing" />
        <LandingPage />
      </>
    );
  }

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
      <Link
        href="/"
        aria-label="Back to home"
        style={{
          position: 'fixed', top: 12, left: 12, zIndex: 9999,
          background: 'rgba(20,20,24,0.75)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(74,132,250,0.35)', borderRadius: 8,
          color: '#e2e2e8', fontSize: 13, fontWeight: 600,
          padding: '5px 14px', textDecoration: 'none',
          transition: 'all .15s', whiteSpace: 'nowrap',
        }}
        onFocus={e => { (e.target as HTMLAnchorElement).style.borderColor = '#4a84fa'; (e.target as HTMLAnchorElement).style.background = 'rgba(74,132,250,0.15)'; }}
        onBlur={e => { (e.target as HTMLAnchorElement).style.borderColor = 'rgba(74,132,250,0.35)'; (e.target as HTMLAnchorElement).style.background = 'rgba(20,20,24,0.75)'; }}
      >
        ← Home
      </Link>
      <ChatOverlay
        config={config}
        messages={messages}
        fadingIds={fadingIds}
        pinnedMessage={pinnedMessage}
        showLoader={showLoader}
      />
    </>
  );
}
