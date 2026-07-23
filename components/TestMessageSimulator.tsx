/* TestMessageSimulator — UChat-style tabbed test-message system.
 *
 * Injects UnifiedMessage objects into the preview via onMessage/onPin
 * callbacks, rendering each message through PreviewMsgLine so it flows
 * through the exact same path as real messages from connectors.
 *
 * Tabs:
 *   Chat    — normal chat message with platform, color, badges, emotes
 *   Event   — system events (follow, sub, gift, raid, cheer, announcement)
 *   Pin     — pinned-message simulation
 *   Moderation — delete / clear / timeout
 *   Burst   — 10 rapid messages to test slide/fade animations
 */
'use client';

import React, { useState, useRef } from 'react';
import type { Platform } from '../lib/types';
import type { UnifiedMessage, UnifiedBadge, UnifiedEmote, UnifiedPin } from '../lib/types';
import type { ParsedMessage } from '../lib/kick';

/* ── Props ──────────────────────────────────────────────────────────────── */

export interface TestSimulatorProps {
  /** Called to inject a normal chat message into the preview. */
  onMessage: (msg: UnifiedMessage) => void;
  /** Called to inject a pin event into the preview. */
  onPin: (pin: UnifiedPin | null) => void;
  /** Called for moderation actions. */
  onDelete: (opts: { id?: string; username?: string; senderId?: string }) => void;
  /** Called when a message is filtered — shows a toast/indicator. */
  onFilter?: (reason: string) => void;
  /** Whether mod actions (delete/clear) should be allowed. */
  modActionAllowed?: boolean;
  /** Whether the preview renders with dark or light background. */
  isWhite: boolean;
}

/* ── Constants ──────────────────────────────────────────────────────────── */

const PLATFORMS: Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];

const PLATFORM_COLORS: Record<Platform, string[]> = {
  kick:    ['#FF4B6E', '#53fc18', '#00BFFF', '#D399FF', '#FF8C00'],
  twitch:  ['#D399FF', '#00FF7F', '#FF69B4', '#53fc18', '#FF4500'],
  youtube: ['#FF5B5B', '#FFD700', '#00CED1', '#98FB98', '#DDA0DD'],
  tiktok:  ['#25F4EE', '#FE2C55', '#FFD700', '#9370DB', '#20B2AA'],
};

const BADGE_SETS: Record<Platform, Array<{ type: string; src: string; alt: string }>> = {
  kick: [
    { type: 'mod', src: '/badges/mod.svg', alt: 'mod' },
    { type: 'vip', src: '/badges/vip.svg', alt: 'vip' },
    { type: 'owner', src: '/badges/owner.svg', alt: 'owner' },
  ],
  twitch: [
    { type: 'broadcaster', src: '/badges/broadcaster.svg', alt: 'broadcaster' },
    { type: 'mod', src: '/badges/mod.svg', alt: 'mod' },
    { type: 'subscriber', src: '/badges/sub9.svg', alt: '9-month' },
  ],
  youtube: [
    { type: 'member', src: '/badges/member.svg', alt: 'member' },
    { type: 'maker', src: '/badges/maker.svg', alt: 'maker' },
  ],
  tiktok: [
    { type: 'fan', src: '/badges/fan.svg', alt: 'fan' },
    { type: 'mod', src: '/badges/mod.svg', alt: 'mod' },
  ],
};

const EMOTE_SETS: Record<Platform, UnifiedEmote[]> = {
  kick:    [{ begin: 0, end: 3, text: 'LOL', url: 'https://cdn.7tv.app/emote/01GNQNADZG0008EC7XVFGMTRNY/2x.webp' }],
  twitch:  [{ begin: 0, end: 5, text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/253727/default/dark/1.0' }],
  youtube: [],
  tiktok:  [],
};

const USERNAMES = [
  'xQc', 'Trainwreck', 'AdinRoss', 'KaiCenat', 'IShowSpeed',
  'Pokimane', 'Summit1g', 'Drake', 'Ninja', 'Shroud',
  'Lirik', 'HasanAbi', 'Valkyrae', 'CorpseHusband', 'Sykkuno',
];

const MESSAGES = [
  'LUL this is amazing',
  'OMEGALUL',
  'PogChamp',
  'let him cook',
  'W',
  'big W energy',
  'based',
  'no cap fr fr',
  'that clip is going viral',
  'chat is moving too fast',
  'GG wp',
  'clutch play',
  'wait what just happened',
  'chat the stream is bugged',
  'hype hype hype',
  '💀💀💀',
  'this is fire 🔥',
  'can we get more emotes',
  'mod check this spam',
  'first time here love the stream',
];

const EVENT_MESSAGES: Array<{ category: 'follow' | 'subscription' | 'gift' | 'raid' | 'cheer' | 'announcement' }> = [
  { category: 'follow' },
  { category: 'subscription' },
  { category: 'gift' },
  { category: 'raid' },
  { category: 'cheer' },
  { category: 'announcement' },
];

/* ── Helpers ────────────────────────────────────────────────────────────── */

let msgCounter = 0;

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeChatMessage(platform: Platform, text: string, color?: string, badges?: UnifiedBadge[], emotes?: UnifiedEmote): UnifiedMessage {
  const id = ++msgCounter;
  return {
    platform,
    id: `sim-${id}`,
    senderId: `sim-${id}`,
    username: randomFrom(USERNAMES),
    color: color ?? randomFrom(PLATFORM_COLORS[platform]),
    badges: badges ?? [],
    text,
    emotes: emotes ? [emotes] : [],
    timestamp: Date.now(),
    kind: 'chat',
  };
}

function makeSystemEvent(platform: Platform, category: 'follow' | 'subscription' | 'gift' | 'raid' | 'cheer' | 'announcement', username?: string): UnifiedMessage {
  const id = ++msgCounter;
  const user = username ?? randomFrom(USERNAMES);
  return {
    platform,
    id: `sim-event-${id}`,
    senderId: `sim-${id}`,
    username: user,
    color: randomFrom(PLATFORM_COLORS[platform]),
    badges: [],
    text: '',
    emotes: [],
    timestamp: Date.now(),
    kind: 'system',
    category,
  };
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const TABS = ['chat', 'event', 'pin', 'mod', 'burst'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  chat: '💬 Chat',
  event: '🎯 Events',
  pin: '📌 Pin',
  mod: '🛡️ Mod',
  burst: '💥 Burst',
};

/* ── Component ──────────────────────────────────────────────────────────── */

export default function TestMessageSimulator({ onMessage, onPin, onDelete, onFilter, modActionAllowed = true, isWhite }: TestSimulatorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [simPlatform, setSimPlatform] = useState<Platform>('kick');
  const [simColor, setSimColor] = useState('#FF4B6E');
  const [simText, setSimText] = useState('');
  const [simPinnedText, setSimPinnedText] = useState('');
  const [simTargetUser, setSimTargetUser] = useState('');
  const [simCategory, setSimCategory] = useState<'follow' | 'subscription' | 'gift' | 'raid' | 'cheer' | 'announcement'>('follow');
  const [badgeSet, setBadgeSet] = useState(0);
  const [includeEmote, setIncludeEmote] = useState(false);
  const [showBadges, setShowBadges] = useState(false);
  const [burstRunning, setBurstRunning] = useState(false);

  const burstRef = useRef(false);

  /* ── Handlers ───────────────────────────────────────────────────────── */

  function handleSendChat() {
    const text = simText.trim();
    if (!text) return;

    const emote = includeEmote && EMOTE_SETS[simPlatform].length > 0 ? EMOTE_SETS[simPlatform][0] : undefined;
    const badges = showBadges && BADGE_SETS[simPlatform].length > 0
      ? [BADGE_SETS[simPlatform][badgeSet % BADGE_SETS[simPlatform].length]]
      : [];
    const msg = makeChatMessage(simPlatform, text, simColor, badges, emote);
    onMessage(msg);
    setSimText('');
  }

  function handleSendPin() {
    const text = simPinnedText.trim();
    if (!text) return;

    const msg = makeChatMessage(simPlatform, text, simColor);
    onPin({ message: msg, pinnedBy: msg.username });
    setSimPinnedText('');
  }

  function handleClearPin() {
    onPin(null);
  }

  function handleEvent() {
    const evt = randomFrom(EVENT_MESSAGES);
    const msg = makeSystemEvent(simPlatform, evt.category);
    onMessage(msg);
  }

  function handleDelete() {
    if (!modActionAllowed) {
      onFilter?.('Mod actions blocked (modAction = false)');
      return;
    }
    const target = simTargetUser.trim();
    if (target) {
      onDelete({ username: target });
    } else {
      onDelete({});
    }
  }

  function handleClear() {
    if (!modActionAllowed) {
      onFilter?.('Mod actions blocked (modAction = false)');
      return;
    }
    onDelete({});
  }

  async function handleBurst() {
    if (burstRunning) return;
    burstRef.current = true;
    setBurstRunning(true);
    for (let i = 0; i < 10 && burstRef.current; i++) {
      const msg = makeChatMessage(simPlatform, randomFrom(MESSAGES));
      onMessage(msg);
      await new Promise(r => setTimeout(r, 80));
    }
    burstRef.current = false;
    setBurstRunning(false);
  }

  function handleCancelBurst() {
    burstRef.current = false;
    setBurstRunning(false);
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  const bg = isWhite ? '#f8f8fa' : 'rgba(20,20,28,0.6)';
  const border = isWhite ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
  const btnBg = isWhite ? '#4a84fa' : '#3a5a9a';

  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 10,
      padding: 12,
      fontFamily: 'inherit',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? btnBg : (isWhite ? '#eee' : '#2a2a34'),
              color: activeTab === tab ? '#fff' : (isWhite ? '#333' : '#999'),
              border: 'none',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Chat tab */}
      {activeTab === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={simPlatform} onChange={e => { setSimPlatform(e.target.value as Platform); setSimColor(randomFrom(PLATFORM_COLORS[e.target.value as Platform])); }}
              style={{ flex: '0 0 80px', fontSize: '0.75rem', borderRadius: 5, padding: '3px 6px', background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd', border: `1px solid ${border}` }}>
              {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <input type="color" value={simColor} onChange={e => setSimColor(e.target.value)}
              style={{ width: 30, height: 26, border: 'none', cursor: 'pointer', borderRadius: 3 }} title="Name color" />
            <label style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: isWhite ? '#555' : '#aaa' }}>
              <input type="checkbox" checked={showBadges} onChange={e => setShowBadges(e.target.checked)} /> Badges
              {showBadges && (
                <select value={badgeSet} onChange={e => setBadgeSet(Number(e.target.value))}
                  style={{ fontSize: '0.65rem', padding: '1px 4px', background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd', border: `1px solid ${border}`, borderRadius: 3 }}>
                  {BADGE_SETS[simPlatform].map((_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              )}
            </label>
            <label style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: isWhite ? '#555' : '#aaa' }}>
              <input type="checkbox" checked={includeEmote} onChange={e => setIncludeEmote(e.target.checked)} /> Emote
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" placeholder="Test message…" value={simText}
              onChange={e => setSimText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSendChat(); } }}
              style={{ flex: 1, fontSize: '0.78rem', padding: '5px 10px', borderRadius: 5, border: `1px solid ${border}`, background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd' }} />
            <button onClick={handleSendChat} style={{
              background: btnBg, color: '#fff', border: 'none', borderRadius: 5,
              fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
            }}>Send</button>
          </div>
        </div>
      )}

      {/* Event tab */}
      {activeTab === 'event' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={simPlatform} onChange={e => setSimPlatform(e.target.value as Platform)}
              style={{ flex: '0 0 80px', fontSize: '0.75rem', borderRadius: 5, padding: '3px 6px', background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd', border: `1px solid ${border}` }}>
              {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <select value={simCategory} onChange={e => setSimCategory(e.target.value as typeof simCategory)}
              style={{ flex: 1, fontSize: '0.75rem', borderRadius: 5, padding: '3px 6px', background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd', border: `1px solid ${border}` }}>
              <option value="follow">⭐ Follow</option>
              <option value="subscription">★ Subscription</option>
              <option value="gift">🎁 Gift Sub</option>
              <option value="raid">👥 Raid</option>
              <option value="cheer">💰 Cheer</option>
              <option value="announcement">📣 Announcement</option>
            </select>
          </div>
          <button onClick={handleEvent} style={{
            background: btnBg, color: '#fff', border: 'none', borderRadius: 5,
            fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
          }}>Send Event Card</button>
        </div>
      )}

      {/* Pin tab */}
      {activeTab === 'pin' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={simPlatform} onChange={e => setSimPlatform(e.target.value as Platform)}
              style={{ flex: '0 0 80px', fontSize: '0.75rem', borderRadius: 5, padding: '3px 6px', background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd', border: `1px solid ${border}` }}>
              {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <input type="text" placeholder="Pinned message text…" value={simPinnedText}
              onChange={e => setSimPinnedText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSendPin(); } }}
              style={{ flex: 1, fontSize: '0.78rem', padding: '5px 10px', borderRadius: 5, border: `1px solid ${border}`, background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd' }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleSendPin} style={{
              background: btnBg, color: '#fff', border: 'none', borderRadius: 5,
              fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
            }}>Pin Message</button>
            <button onClick={handleClearPin} style={{
              background: isWhite ? '#dc3545' : '#a03040', color: '#fff', border: 'none', borderRadius: 5,
              fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
            }}>Unpin</button>
          </div>
        </div>
      )}

      {/* Moderation tab */}
      {activeTab === 'mod' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="text" placeholder="Target username (optional)" value={simTargetUser}
              onChange={e => setSimTargetUser(e.target.value)}
              style={{ flex: 1, fontSize: '0.78rem', padding: '5px 10px', borderRadius: 5, border: `1px solid ${border}`, background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd' }} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={handleDelete} style={{
              background: isWhite ? '#dc3545' : '#a03040', color: '#fff', border: 'none', borderRadius: 5,
              fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
            }}>
              {simTargetUser ? `Delete ${simTargetUser}'s messages` : 'Clear All Messages'}
            </button>
          </div>
        </div>
      )}

      {/* Burst tab */}
      {activeTab === 'burst' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={simPlatform} onChange={e => setSimPlatform(e.target.value as Platform)}
              style={{ flex: '0 0 80px', fontSize: '0.75rem', borderRadius: 5, padding: '3px 6px', background: isWhite ? '#fff' : '#2a2a34', color: isWhite ? '#333' : '#ddd', border: `1px solid ${border}` }}>
              {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <span style={{ fontSize: '0.7rem', color: isWhite ? '#555' : '#aaa' }}>
              Sends 10 rapid messages to test slide/fade animations
            </span>
          </div>
          {burstRunning ? (
            <button onClick={handleCancelBurst} style={{
              background: '#dc3545', color: '#fff', border: 'none', borderRadius: 5,
              fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
            }}>Cancel Burst</button>
          ) : (
            <button onClick={handleBurst} style={{
              background: btnBg, color: '#fff', border: 'none', borderRadius: 5,
              fontWeight: 800, fontSize: '0.75rem', padding: '5px 16px', cursor: 'pointer',
            }}>💥 Burst 10 Messages</button>
          )}
        </div>
      )}
    </div>
  );
}
