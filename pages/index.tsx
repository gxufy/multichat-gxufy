'use client';

import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { z } from 'zod';
import Pusher from 'pusher-js';
import {
  getKickChannel,
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
import LandingPage from '../components/LandingPage';
import ChatOverlay from '../components/ChatOverlay';

const QuerySchema = z.object({
  channel: z.string().min(1),
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
  smallCaps: z.string().optional().transform(v => v === 'true'),
  nlAfterName: z.string().optional().transform(v => v === 'true'),
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
  const [pinnedMessage, setPinnedMessage] = useState<ParsedMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (!parsed.success || !router.query.channel) return;

    const cfg = parsed.data;
    setConfig(cfg);
    stateRef.current.config = cfg;
    setShowLoader(true); // show immediately on load, like chatis #loader


    const s = stateRef.current;

    function parseMessageText(content: string, emotes: SevenTVEmote[]): React.ReactNode[] {
      content = content.replace(/\s\s+/g, ' ').trim();
      const nodes: React.ReactNode[] = [];
      const kickEmoteRe = /\[(emote|emoji):(\w+):[^\]]*\]/g;
      const words = content.split(' ');

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const emoteIdx = emotes.findIndex(e => e.name === word);
        if (emoteIdx === -1) {
          const kickMatches = [...word.matchAll(kickEmoteRe)];
          if (kickMatches.length) {
            for (const m of kickMatches) {
              nodes.push(
                <img
                  key={`ke-${i}-${m[2]}`}
                  className="ck-emote"
                  src={`https://files.kick.com/emotes/${m[2]}/fullsize`}
                  alt="emote"
                  height={28}
                  width={28}
                />
              );
            }
            if (i !== words.length - 1) nodes.push(' ');
          } else {
            nodes.push(i !== words.length - 1 ? word + ' ' : word);
          }
        } else {
          const emote = emotes[emoteIdx];
          const zeroWidths: React.ReactNode[] = [];
          while (i + 1 < words.length) {
            const nextIdx = emotes.findIndex(e => e.name === words[i + 1]);
            if (nextIdx === -1 || !emotes[nextIdx].zeroWidth) break;
            zeroWidths.push(
              <img
                key={`zw-${i}`}
                className={`ck-emote${emotes[nextIdx].upscale ? ' ck-upscale' : ''}`}
                src={emotes[nextIdx].image}
                alt={emotes[nextIdx].name}
                height={emotes[nextIdx].height}
                width={emotes[nextIdx].width}
                style={{ display:'block', maxWidth:'100%', maxHeight:'100%' }}
              />
            );
            i++;
          }
          // Check if next token is also an emote — if not, we need a space after this emote
          const nextIsEmote = i + 1 < words.length && emotes.findIndex(e => e.name === words[i + 1]) !== -1;
          const needsSpace = i !== words.length - 1 && !nextIsEmote;
          if (zeroWidths.length === 0) {
            nodes.push(
              <img
                key={`em-${i}`}
                className={`ck-emote${emote.upscale ? ' ck-upscale' : ''}`}
                src={emote.image}
                alt={emote.name}
                height={emote.height}
                width={emote.width}
              />
            );
          } else {
            nodes.push(
              <span key={`zws-${i}`} style={{ display:'inline-block', position:'relative', verticalAlign:'middle' }}>
                <img className={`ck-emote${emote.upscale ? ' ck-upscale' : ''}`} src={emote.image} alt={emote.name} height={emote.height} width={emote.width} style={{ display:'block' }} />
                {zeroWidths.map((zw, zi) => (
                  <span key={zi} style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>{zw}</span>
                ))}
              </span>
            );
          }
          if (needsSpace) nodes.push(' ');
        }
      }
      return nodes;
    }

    function buildBadges(senderBadges: any[], subscriberBadges: KickChannel['subscriber_badges'], senderBadgesV2?: any[]): React.ReactNode[] {
      const badgeNodes: React.ReactNode[] = [];
      // badges_v2 contains level badges with direct image_url (not in regular badges array)
      if (senderBadgesV2?.length) {
        for (const b of senderBadgesV2) {
          if (b.image_url) {
            badgeNodes.push(<img key={`v2-${b.name}-${b.metadata?.level ?? 0}`} className="ck-badge-img" src={b.image_url} alt={b.name} height={16} width={16} />);
          }
        }
      }
      for (const badge of senderBadges) {
        switch (badge.type) {
          case 'broadcaster':
            badgeNodes.push(<img key="broadcaster" className="ck-badge-img" src="/badges/broadcaster.svg" alt="broadcaster" height={16} width={16} />);
            break;
          case 'moderator':
            badgeNodes.push(<img key="mod" className="ck-badge-img" src="/badges/moderator.svg" alt="moderator" height={16} width={16} />);
            break;
          case 'vip':
            badgeNodes.push(<img key="vip" className="ck-badge-img" src="/badges/vip.svg" alt="vip" height={16} width={16} />);
            break;
          case 'founder':
            badgeNodes.push(<img key="founder" className="ck-badge-img" src="/badges/founder.svg" alt="founder" height={16} width={16} />);
            break;
          case 'og':
            badgeNodes.push(<img key="og" className="ck-badge-img" src="/badges/og.svg" alt="og" height={16} width={16} />);
            break;
          case 'verified':
            badgeNodes.push(<img key="verified" className="ck-badge-img" src="/badges/verified.svg" alt="verified" height={16} width={16} />);
            break;
          case 'staff':
            badgeNodes.push(<img key="staff" className="ck-badge-img" src="/badges/staff.svg" alt="staff" height={16} width={16} />);
            break;
          case 'subscriber': {
            const sorted = [...subscriberBadges].sort((a, b) => b.months - a.months);
            const match = sorted.find(sb => badge.count >= sb.months);
            if (match) {
              badgeNodes.push(<img key="sub" className="ck-badge-img" src={match.badge_image.src} alt="subscriber" />);
            } else {
              badgeNodes.push(<img key="sub-default" className="ck-badge-img" src="/badges/subscriber.svg" alt="subscriber" height={16} width={16} />);
            }
            break;
          }
          case 'sub_gifter': {
            const count = badge.count ?? 0;
            const gifterSrc = (() => {
              if (count >= 5000)  return '/badges/gift_5000_.svg';
              if (count >= 4000)  return '/badges/gift_4000-4999.svg';
              if (count >= 3000)  return '/badges/gift_3000-3999.svg';
              if (count >= 2000)  return '/badges/gift_2000-2999.svg';
              if (count >= 1000)  return '/badges/gift_1000-1999.svg';
              if (count >= 850)   return '/badges/gift_850-899.svg';
              if (count >= 800)   return '/badges/gift_800-849.svg';
              if (count >= 750)   return '/badges/gift_750-799.svg';
              if (count >= 700)   return '/badges/gift_700-749.svg';
              if (count >= 650)   return '/badges/gift_650-699.svg';
              if (count >= 600)   return '/badges/gift_600-649.svg';
              if (count >= 500)   return '/badges/gift_500-549.svg';
              if (count >= 450)   return '/badges/gift_450-499.svg';
              if (count >= 400)   return '/badges/gift_400-449.svg';
              if (count >= 300)   return '/badges/gift_300-349.svg';
              if (count >= 250)   return '/badges/gift_250-299.svg';
              if (count >= 200)   return '/badges/gift_200-249.svg';
              if (count >= 150)   return '/badges/gift_150-199.svg';
              if (count >= 100)   return '/badges/gift_100-149.svg';
              if (count >= 25)    return '/badges/gift_25-99.svg';
              if (count >= 10)    return '/badges/gift_10-24.svg';
              if (count >= 5)     return '/badges/gift_5-9.svg';
              return '/badges/gift_1-4.svg';
            })();
            badgeNodes.push(<img key="gifter" className="ck-badge-img" src={gifterSrc} alt="gifter" height={16} width={16} />);
            break;
          }
          case 'gift_rank': {
            const rank = badge.count ?? badge.rank ?? 1;
            const rankSrc = rank <= 1 ? '/badges/gift-rank-1.png' : rank === 2 ? '/badges/gift-rank-2.png' : '/badges/gift-rank-3.png';
            badgeNodes.push(<img key="gift-rank" className="ck-badge-img" src={rankSrc} alt={`gift-rank-${rank}`} height={16} width={16} />);
            break;
          }
          case 'kicks_rank': {
            const rank = badge.count ?? badge.rank ?? 1;
            const rankSrc = rank <= 1 ? '/badges/kicks-rank-1.png' : rank === 2 ? '/badges/kicks-rank-2.png' : '/badges/kicks-rank-3.png';
            badgeNodes.push(<img key="kicks-rank" className="ck-badge-img" src={rankSrc} alt={`kicks-rank-${rank}`} height={16} width={16} />);
            break;
          }
        }
      }
      return badgeNodes;
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
        shadows.push(`drop-shadow(${decimalToRGBA(shadow.color)} ${shadow.x_offset}px ${shadow.y_offset}px ${shadow.radius}px)`);
      }

      const background = `${prefix}${paint.func.toLowerCase().replace('_', '-')}(${parts.join(', ')})`;
      return { background, filter: shadows.join(' ') };
    }

    function buildMessage(rawMsg: any): ParsedMessage | null {
      try {
        const channel = s.channel!;
        const msgNodes = parseMessageText(rawMsg.content, s.emotes);
        const badgeNodes = buildBadges(rawMsg.sender?.identity?.badges ?? [], channel.subscriber_badges ?? [], rawMsg.sender?.identity?.badges_v2);

        // 7TV cosmetics
        let background = '';
        let filter = '';
        const entitlement = s.entitlements[rawMsg.sender.id.toString()];
        if (entitlement && s.config?.sevenTVCosmeticsEnabled) {
          if (entitlement.badge) {
            const badge = s.badges.find(b => b.id === entitlement.badge);
            if (badge) badgeNodes.push(<img key="7tv-badge" className="ck-badge-img" src={badge.image} alt="7tv badge" />);
          }
          if (entitlement.paint) {
            const paint = s.paints.find(p => p.id === entitlement.paint);
            if (paint) {
              const style = buildPaintStyle(paint);
              background = style.background;
              filter = style.filter;
            }
          }
        }

        return {
          id: rawMsg.id,
          timestamp: Date.now(),
          identity: {
            username: rawMsg.sender.username,
            color: rawMsg.sender.identity.color || '#ffffff',
            background,
            filter,
            badges: badgeNodes,
          },
          message: msgNodes,
        };
      } catch {
        return null;
      }
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
    function isBot(username: string) {
      const u = username.toLowerCase();
      return KNOWN_BOTS.has(u) || extraBots.has(u);
    }

    function addMessage(msg: ParsedMessage) {
      if (isBot(msg.identity.username)) return;
      s.messages.push(msg);
      if (s.messages.length > 100) s.messages.shift();
      setMessages([...s.messages]);
    }

    async function init() {
      const channel = await getKickChannel(cfg.channel);
      if (!channel) {
        setError(`Could not find Kick channel: "${cfg.channel}". Make sure the channel name is correct.`);
        return;
      }
      s.channel = channel;

      // Fetch Kick global badges (includes all level_up badge URLs)
      // NOTE: endpoint TBD — will populate once we confirm the correct URL from debug logs
      // fetch('https://kick.com/api/v2/channels/global-badges') — returns 404, disabled
      if (cfg.sevenTVEmotesEnabled) {
        const globalEmotes = await getSevenTVGlobalEmotes();
        s.emotes.push(...globalEmotes);
        const { emotes: channelEmotes, setId } = await getSevenTVChannelEmotes(channel.user_id.toString());
        s.emotes.push(...channelEmotes);
        // 7TV SSE for cosmetics + live emotes
        if (cfg.sevenTVCosmeticsEnabled) {
          const sseUrl = `https://events.7tv.io/v3@entitlement.*<ctx=channel;platform=KICK;id=${channel.user.id}>,cosmetic.*<ctx=channel;platform=KICK;id=${channel.user.id}>${setId ? `,emote_set.*<object_id=${setId}>` : ''}`;
          const sse = new EventSource(sseUrl);
          sse.addEventListener('dispatch', (e: MessageEvent) => {
            const data = JSON.parse(e.data);
            handle7TVDispatch(data);
          });
          // Reconnect SSE if it errors out
          sse.onerror = () => {
            setTimeout(() => {
              const sse2 = new EventSource(sseUrl);
              sse2.addEventListener('dispatch', (e: MessageEvent) => {
                const data = JSON.parse(e.data);
                handle7TVDispatch(data);
              });
            }, 3000);
          };
          const prevCleanup = cleanup;
          cleanup = () => { sse.close(); if (prevCleanup) prevCleanup(); };
        }
      }
      // Kick Pusher connection
      // disableStats: avoids Pusher's stats pings which can confuse
      // some proxies and cause silent disconnects
      // Pusher is Kick's transport — we make it behave like chatis's
      // ReconnectingWebSocket: auto-reconnect on every drop, re-subscribe
      // on every reconnect, watchdog to escape stuck states.
      const pusher = new Pusher('32cbd69e4b950bf97679', {
        cluster: 'us2',
        disableStats: true,
        activityTimeout: 20000,   // ping every 20s (chatis uses ~2s reconnect interval)
        pongTimeout: 8000,        // declare dead after 8s no pong → triggers reconnect
      });
      const chatroomName = `chatrooms.${channel.chatroom.id}.v2`;

      // Bind all message events — called once on first connect and
      // again any time Pusher drops and re-subscribes the channel
      function bindChannel() {
        const ch = pusher.subscribe(chatroomName);

        ch.bind('App\\Events\\ChatMessageEvent', (data: any) => {
          handleCommand(data);
          const msg = buildMessage(data);
          if (msg) addMessage(msg);
        });
        ch.bind('App\\Events\\MessageDeletedEvent', (data: any) => {
          s.messages = s.messages.filter(m => m.id !== data.message.id);
          setMessages([...s.messages]);
        });
        ch.bind('App\\Events\\UserBannedEvent', (data: any) => {
          s.messages = s.messages.filter(m => m.identity.username !== data.user.username);
          setMessages([...s.messages]);
        });
        ch.bind('App\\Events\\PinnedMessageCreatedEvent', (data: any) => {
          if (cfg.showPinEnabled) {
            const msg = buildMessage(data.message);
            if (msg) setPinnedMessage(msg);
          }
        });
        ch.bind('App\\Events\\PinnedMessageDeletedEvent', () => {
          setPinnedMessage(null);
        });
      }

      bindChannel();

      // ── !kickchat command handler ──
      // Access: broadcaster=1000, mod=500, viewer=0
      // Mirrors chatis's !chatis command system
      function getAccessLevel(data: any): number {
        const badges: any[] = data.sender?.identity?.badges ?? [];
        for (const b of badges) {
          if (b.type === 'broadcaster') return 1000;
        }
        for (const b of badges) {
          if (b.type === 'moderator') return 500;
        }
        // Always give broadcaster by username as fallback
        if ((data.sender?.username ?? '').toLowerCase() === cfg.channel.toLowerCase()) return 1000;
        return 0;
      }

      // Float overlay system — mirrors chatis showFloat/removeFloat
      const floats: { [id: number]: { el: HTMLElement; timer: ReturnType<typeof setTimeout> | null } } = {};
      // showFloat — exact chatis implementation:
      // position:fixed; left:50%; bottom:1%; transform:translate(-50%,0)
      // background:rgba(0,0,0,alpha); padding:2px; font-weight:800; white-space:pre-wrap
      // Uses chat_container font-size just like chatis does
      // showFloat — exact chatis implementation.
      // Chatis reads #chat_container computed font-size which is set by size_*.css
      // (20px=small, 34px=medium, 48px=large). We use the same values directly
      // from config so it's always correct and scales with overlay resolution.
      function showFloat(id: number, msg: string, timeoutMs = 5000, alpha = 0.3) {
        removeFloat(id);
        // Chatis fires showFloat on document.ready BEFORE size CSS loads,
        // so it gets browser default ~16px. We hardcode 14px to match that small look.
        const chatFontSize = '18px';
        const el = document.createElement('pre');
        el.style.cssText = [
          'position:fixed',
          'left:50%',
          'bottom:1%',
          'max-width:99%',
          'white-space:pre-wrap',
          'margin:0',
          'padding:2px',
          `background:rgba(0,0,0,${alpha})`,
          'color:#fff',
          'font-weight:800',
          `font-size:${chatFontSize}`,
          'z-index:9999',
          'transform:translate(-50%,0)',
          'pointer-events:none',
          'font-family:inherit',
        ].join(';');
        el.textContent = msg;
        document.body.appendChild(el);
        floats[id] = {
          el,
          timer: timeoutMs > 0 ? setTimeout(() => removeFloat(id), timeoutMs) : null,
        };
      }
      function removeFloat(id: number) {
        if (floats[id]) {
          if (floats[id].timer) clearTimeout(floats[id].timer!);
          floats[id].el.remove();
          delete floats[id];
        }
      }
      function removeAllFloats() {
        Object.keys(floats).forEach(id => removeFloat(Number(id)));
      }

      // Chat overlay visibility
      let chatVisible = true;
      function setChatVisible(v: boolean) {
        chatVisible = v;
        const el = document.getElementById('chat_container');
        if (el) el.style.display = v ? '' : 'none';
      }

      function handleCommand(rawData: any) {
        const text: string = rawData.content ?? '';
        if (!text.toLowerCase().startsWith('!kickchat')) return;
        const access = getAccessLevel(rawData);
        if (access < 500) return;

        const args = text.trim().split(/\s+/);
        const cmd = (args[1] ?? '').toLowerCase();

        switch (cmd) {
          case 'ping':
            showFloat(1, 'Pong!\nkickchat-gxufy', 3000);
            break;

          case 'reload':
            window.location.reload();
            break;

          case 'stop':
            removeAllFloats();
            break;

          case 'show':
            setChatVisible(true);
            break;

          case 'hide':
            setChatVisible(false);
            break;

          case 'refresh':
            if (!args[2] || args[2] === 'emotes') {
              showFloat(9, '🔄 Reloading emotes...', 10000, 0.7);
              (async () => {
                try {
                  const globals = await getSevenTVGlobalEmotes();
                  s.emotes = [...globals];
                  const ch = s.channel;
                  if (ch) {
                    const { emotes: ce } = await getSevenTVChannelEmotes(ch.user_id.toString());
                    s.emotes.push(...ce);
                  }
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
            // If no URL, try to resolve as a 7TV emote name — same as chatis img fallback
            const emoteName = args[2] ?? '';
            const emoteLink = urlMatch
              ? urlMatch[0]
              : s.emotes.find(e => e.name === emoteName)?.image ?? null;
            const link = emoteLink;
            if (!link) break;
            const timeout = (parseFloat((text.match(/-t\s+([\d.]+)/) || [])[1] ?? '') || 5) * 1000;
            const opacity = parseFloat((text.match(/-o\s+([\d.]+)/) || [])[1] ?? '') || 1;
            // Stretch to fill entire viewport — exact chatis behaviour (width=vw, height=vh, no aspect ratio)
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9998;pointer-events:none;';
            el.innerHTML = `<img src="${link}" style="width:100%;height:100%;object-fit:fill;opacity:${opacity};" />`;
            document.body.appendChild(el);
            floats[4] = { el, timer: setTimeout(() => removeFloat(4), timeout) };
            break;
          }

          case 'yt': {
            if (access < 500) break;
            const ytPresets: Record<string, string> = {
              'bruh': '2ZIpFytCSVc',
              'vine-boom': '_vBVGjFdwk4',
              'dc-ping': 'jiWj1zZlRjQ',
              'rickroll': 'dQw4w9WgXcQ',
              'win-error': 'v76-ChTSLJk',
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
            const ttsText = text.replace(/^!kickchat\s+tts\s*/i, '').trim();
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

            // Try our /api/tts proxy (StreamElements Brian → Streamlabs fallback)
            fetch(`/api/tts?voice=Brian&text=${encodeURIComponent(ttsText)}`)
              .then(r => {
                if (!r.ok) throw new Error('proxy failed');
                return r.blob();
              })
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

      // On every successful (re)connect: re-subscribe if the channel
      // was dropped. Pusher unsubscribes channels on disconnect.
      pusher.connection.bind('connected', () => {
        setShowLoader(false); // hide loader on connect, exact chatis $('#loader').hide()
        // Re-subscribe if channel was lost during disconnect
        if (!pusher.channel(chatroomName)) {
          bindChannel();
        }
        // showFloat text fires on connect — chatis fires it on document.ready but
        // we fire on connect since we don't have a static HTML page
        showFloat(1, 'Kick Chat Overlay made by @Gxufy', 5000, 0.3);

      });

      // Track state changes — mirrors chatis's ReconnectingWebSocket
      // onclose → reconnect behaviour. Force-reconnect from any
      // terminal state so the overlay never silently goes dead.
      pusher.connection.bind('state_change', ({ previous, current }: { previous: string; current: string }) => {
        // 'disconnected' = clean close (network blip, OBS tab hidden, etc.)
        // Pusher won't auto-reconnect from 'disconnected' unless we tell it to
        if (current === 'disconnected') {
          setTimeout(() => pusher.connect(), 2000); // 2s — same as chatis reconnectInterval
        }
      });

      // Watchdog: escape 'unavailable' / 'failed' (Pusher's stuck states)
      // Checks every 10s — much tighter than before
      let watchdog: ReturnType<typeof setInterval> | null = setInterval(() => {
        const state = pusher.connection.state;
        if (state === 'unavailable' || state === 'failed') {
          pusher.disconnect();
          setTimeout(() => pusher.connect(), 2000);
        }
      }, 10000);

      cleanup = () => {
        if (watchdog) { clearInterval(watchdog); watchdog = null; }
        pusher.disconnect();
      };
    }

    function handle7TVDispatch(data: any) {
      if (data.type === 'cosmetic.create') {
        if (data.body.object.kind === 'BADGE') {
          s.badges.push({ id: data.body.id, image: `https://cdn.7tv.app/badge/${data.body.id}/3x` });
        }
        if (data.body.object.kind === 'PAINT') {
          const d = data.body.object.data;
          s.paints.push({ id: data.body.id, func: d.function, angle: d.angle, color: d.color, repeat: d.repeat, shadows: d.shadows, stops: d.stops, image_url: d.image_url, shape: d.shape });
        }
      }
      if (data.type === 'entitlement.create') {
        for (const conn of (data.body.object.user.connections ?? [])) {
          if (conn.platform === 'KICK') {
            s.entitlements[conn.id] = {
              ...s.entitlements[conn.id],
              [data.body.object.kind === 'BADGE' ? 'badge' : 'paint']: data.body.object.ref_id,
            };
          }
        }
      }
      if (data.type === 'entitlement.delete') {
        for (const conn of (data.body.object.user.connections ?? [])) {
          if (conn.platform === 'KICK') {
            const key = data.body.object.kind === 'BADGE' ? 'badge' : 'paint';
            if (s.entitlements[conn.id]?.[key] === data.body.object.ref_id) {
              s.entitlements[conn.id] = { ...s.entitlements[conn.id], [key]: undefined };
            }
          }
        }
      }
    }

    let cleanup: (() => void) | null = null;

    init();

    let fadeInterval: ReturnType<typeof setInterval> | null = null;
    if (cfg.fade !== false) {
      const fadeMs = (cfg.fade as number) * 1000;
      // Tracks IDs currently in their 400ms fade-out animation
      const fadingSet = new Set<string>();
      fadeInterval = setInterval(() => {
        const cutoff = Date.now() - fadeMs;
        // Find oldest expired message not already fading
        const expired = s.messages.find(
          m => (m.timestamp ?? 0) <= cutoff && !fadingSet.has(m.id)
        );
        if (!expired) return;
        // Mark as fading — triggers CSS opacity transition (400ms = jQuery fadeOut default)
        fadingSet.add(expired.id);
        setFadingIds(new Set(fadingSet));
        setTimeout(() => {
          // After animation completes, remove from messages
          fadingSet.delete(expired.id);
          s.messages = s.messages.filter(m => m.id !== expired.id);
          setMessages([...s.messages]);
          setFadingIds(new Set(fadingSet));
        }, 400);
      }, 200); // 200ms poll — same as chatis update interval
    }

    return () => {
      if (fadeInterval) clearInterval(fadeInterval);
      if (cleanup) cleanup();
    };
  }, [router.isReady]);

  if (!ready) return null;

  // Show landing page if no channel specified
  if (!router.query.channel) {
    return <LandingPage />;
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
        <title>Kick Chat Overlay</title>
      </Head>
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
