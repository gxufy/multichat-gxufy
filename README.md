# multichat-gxufy

A multi-platform chat overlay for OBS and streaming software — **Kick · Twitch · YouTube · TikTok** in one browser source, no login or OAuth required. Built by [@Gxufy_](https://x.com/Gxufy_).

---

## Features

- **4 platforms, 1 overlay** — combine any mix of Kick, Twitch, YouTube Live, and TikTok Live chats (`?kick=x&twitch=y&youtube=z&tiktok=w`)
- **No OAuth** — works with just channel names; anyone can use it
- **Third-party emotes** — 7TV + BTTV + FFZ (global & channel) on Kick and Twitch, with live 7TV emote-set updates via EventAPI
- **7TV cosmetics** — name-paints and badges on Kick and Twitch chatters (GQL-backed, applies retroactively to buffered messages)
- Zero-width emote stacking
- **Real platform badges** — full Kick set, all Twitch badge sets (sub tiers, bits, events) + FFZ room overrides, YouTube member/mod/verified with owner gold-pill, TikTok top-gifter/fan-club/sub art
- **Platform source tags** — official brand icon (default), dot, label, or none per message
- **Event cards** — subs, gift subs, raids/hosts, cheers/Kicks, Super Chats/Stickers, memberships, TikTok gifts (with art + diamonds), follows & shares
- **Pinned messages** — Kick, YouTube, and TikTok pins in a StreamNook-style card that collapses to a thin bar
- Batched slide / fade animations (chatis-exact 200ms loop — no stutter on fast chat)
- Stroke, shadow, font options (12 fonts including Alsina)
- Bot filtering — ignore known bots + custom list
- Chat commands (`!multichat`) from **any** connected platform's chat

## Chat Commands

Work from any connected platform's chat. Broadcaster has full access; mods have access to most. `!kickchat` still works as an alias.

| Command | Description | Access |
|---|---|---|
| `!multichat ping` | Shows a Pong overlay on screen | Mod+ |
| `!multichat reload` | Reloads the browser source | Mod+ |
| `!multichat stop` | Stops all active overlays | Mod+ |
| `!multichat show` / `hide` | Shows or hides the chat overlay | Mod+ |
| `!multichat refresh emotes` | Reloads 7TV/BTTV/FFZ emotes live | Mod+ |
| `!multichat img [url or emote name] -t [sec] -o [opacity]` | Displays an image or emote (e.g. `GIGACHAD`) fullscreen for N seconds | Mod+ |
| `!multichat yt [url or preset] -t [sec] -m` | Plays YouTube video/sound. Presets: `bruh` `vine-boom` `dc-ping` `rickroll` `win-error` | Mod+ |
| `!multichat tts [message]` | Text-to-speech via StreamElements | Mod+ |

## OBS Setup

1. Open the landing page, fill in your channel name(s) — any one platform or all four — and configure options
2. Click **Generate & Copy**
3. In OBS: **Add Source → Browser Source**, paste the URL
4. Recommended size: **830 × 230**

## Hosting

Run with a persistent Node server (`npm run build && npm start`) — a VPS, Railway, Fly.io, or a PC that stays on.

- **Kick** and **Twitch** connect directly from the browser (websockets)
- **YouTube** polls through two small API routes
- **TikTok** holds a server-side connection ([tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector)) streamed to the overlay via SSE — this is the part that won't survive serverless (Vercel) deploys; everything else does
- Optional: set `TIKTOK_SIGN_API_KEY` ([Euler Stream](https://www.eulerstream.com/)) to raise TikTok signing rate limits

## Stack

Next.js 14 · TypeScript · Pusher (Kick) · anonymous IRC (Twitch) · InnerTube (YouTube) · tiktok-live-connector (TikTok) · 7TV GQL + EventAPI · BTTV · FFZ

---

*Inspired by [ChatIS](https://chatis.is2511.com/) by IS2511 & giambaJ, [unified-chat-lite](https://github.com/Kimsec/unified-chat-lite) by Kimsec, and [StreamNook](https://github.com/winters27/StreamNook). Not affiliated with Kick, Twitch, YouTube, or TikTok.*
