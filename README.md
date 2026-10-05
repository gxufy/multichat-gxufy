<div align="center">

# 🕊️ MultiChat

**Custom multi-platform chat overlay for OBS**

Kick · Twitch · YouTube · TikTok

<a href="https://gxufy.com/multichat">
  <img src="https://i.nuuls.com/BN5W6.gif" alt="MultiChat overlay preview" width="760" />
</a>

[**Live Site**](https://gxufy.com/) · [**Open Generator**](https://gxufy.com/multichat)

</div>

---

MultiChat combines **Kick, Twitch, YouTube, and TikTok** chat into one customizable browser-source overlay, with a separate multi-platform viewer counter.

Chat and viewer counts require **no login**. Twitch authentication is optional and is used only for native Twitch pinned messages.

## Features

- One unified Kick, Twitch, YouTube, and TikTok chat overlay
- Separate real-time multi-platform viewer counter
- 7TV, BTTV, and FFZ emotes
- 7TV paints, cosmetics, badges, and zero-width emotes
- Native platform badges, source markers, replies, and pinned messages
- Twitch Shared Chat and Hype Train support
- Font, size, color, stroke, shadow, emote scale, bold, and uppercase controls
- Fade, entrance animation, slide-in, and smooth scrolling
- Colored @mentions, avatars, transparent/custom backgrounds, and message colors
- Moderation actions, bot filtering, and username/message-prefix blacklists
- Fullscreen image, YouTube, and TTS chat commands
- Generator UI is code-split away from the OBS browser-source startup path

## Commands

Commands must be the **first word** of a chat message and require moderator or broadcaster access. `!kickchat` is also accepted as a legacy alias for `!multichat`.

| Command | What it does |
| :--- | :--- |
| `!multichat ping` | Shows a **Pong!** confirmation for 3 seconds. |
| `!multichat reload` | Reloads the whole browser source. |
| `!multichat stop` | Clears active notifications, images, and videos. |
| `!multichat show` | Shows the chat container again after `hide`. |
| `!multichat hide` | Hides chat without stopping platform connections. |
| `!multichat kickon` | Shows Kick chat messages again. |
| `!multichat kickoff` | Hides current and future Kick chat messages while keeping the connection alive. |
| `!multichat twitchon` | Shows Twitch chat messages again. |
| `!multichat twitchoff` | Hides current and future Twitch chat messages while keeping the connection alive. |
| `!multichat youtubeon` | Shows YouTube chat messages again. |
| `!multichat youtubeoff` | Hides current and future YouTube chat messages while keeping the connection alive. |
| `!multichat tiktokon` | Shows TikTok chat messages again. |
| `!multichat tiktokoff` | Hides current and future TikTok chat messages while keeping the connection alive. |
| `!multichat sharedon` | Turns Twitch Shared Chat display on. |
| `!multichat sharedoff` | Turns Twitch Shared Chat display off without disconnecting local Twitch chat. |
| `!multichat counterbgon` | Turns the matching viewer-counter pill background on. |
| `!multichat counterbgoff` | Turns the matching viewer-counter pill background off. |
| `!multichat animation <on\|off\|auto>` | Controls entrance animations at runtime. `auto` uses configured animation normally and temporarily reduces expensive animation work under heavy load. |
| `!multichat events <on\|off\|feature> [on\|off]` | Controls event notifications at runtime. Features: `subs`, `gifts`, `raids`, `cheers`, `milestones`, `watchstreaks`, `follows`, `announcements`, `hypetrain`, `firstmessages`, `redeems`. |
| `!multichat refresh [emotes]` | Reloads 7TV, BTTV, and FFZ emotes without reloading OBS. The optional argument can only be `emotes`. |
| `!multichat img <url\|emote> [-t seconds] [-o opacity]` | Shows a fullscreen image or emote. Defaults to 5 seconds at full opacity; `img clear` dismisses it. |
| `!multichat yt <url\|preset> [-t seconds] [-m]` | Plays a fullscreen YouTube video. Presets: `bruh`, `vine-boom`, `dc-ping`, `rickroll`, `win-error`. Defaults to 5 seconds; `-m` mutes. |
| `!multichat tts <message>` | Reads the message aloud through the browser source, with browser-voice fallback if the server voice fails. |

The generator's **Commands & help** section uses the same command registry as the overlay.

## Supported Services

<!-- prettier-ignore-start -->
| Service | Support |
| :--- | :--- |
| <img src="https://assets.twitch.tv/assets/favicon-32-e29e246c157142c94346.png" width="20" /> **[TwitchTV](https://www.twitch.tv/)** | Chat, emotes, badges, moderation, Shared Chat, pins, Hype Trains |
| <img src="https://kick.com/favicon.ico" width="20" /> **[Kick](https://kick.com/)** | Chat, emotes, badges, moderation, pins |
| <img src="https://www.youtube.com/favicon.ico" width="20" /> **[YouTube](https://www.youtube.com/)** | Live chat, native emoji, badges, memberships, Super Chats, pins |
| <img src="https://www.tiktok.com/favicon.ico" width="20" /> **[TikTok](https://www.tiktok.com/)** | Live comments, badges, gifts, subscriptions, follows, shares, pins |
| <img src="https://7tv.app/favicon.svg" width="20" /> **[7TV](https://7tv.app/)** | Global/channel emotes, zero-width emotes, paints, badges, cosmetics |
| <img src="https://betterttv.com/favicon.png" width="20" /> **[BTTV](https://betterttv.com/)** | Global and channel emotes |
| <img src="https://www.frankerfacez.com/static/images/favicon-32.png" width="20" /> **[FFZ](https://www.frankerfacez.com/)** | Global/channel emotes and badges |
<!-- prettier-ignore-end -->

## OBS Setup

Chat and the viewer counter use **separate browser-source URLs**.

1. Open [**gxufy.com/multichat**](https://gxufy.com/multichat).
2. Enter your channel name(s) and customize the overlay.
3. Copy the generated **Chat URL** into an OBS Browser Source.
4. Use **830 × 230** for the chat browser source.
5. Add the generated **Viewer Counter URL** as its own Browser Source if you want the counter.

---

<div align="center">
  Built by <a href="https://guns.lol/gxufy"><strong>gxufy</strong></a>
</div>
