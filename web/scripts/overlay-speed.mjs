/*
 * Speed checks for the chat overlay, run on the built site (npm run build,
 * then npm run speed). Starts the built server, opens /multichat in Chromium
 * with Twitch chat, the server's Kick, YouTube and TikTok streams and 7TV
 * faked (no request leaves this machine) and holds the overlay to fixed
 * limits:
 *   - how much script the overlay page loads;
 *   - how soon it joins chat, and how soon a message is on screen;
 *   - frames, main-thread load and message-to-screen time at 8, 15 and 50
 *     messages a second, and with all four platforms at once;
 *   - subs, gifts, raids, cheers and the like on every platform, each in
 *     that platform's own shape: on screen as fast as chat, and badge
 *     holders' messages shown with their badge from the first frame;
 *   - moderator deletes and bans on every platform: the message gone
 *     quickly, never shown if deleted while still held, and no other
 *     message touched;
 *   - rows never moving down, sideways or changing size once shown, and
 *     never drawn over one another;
 *   - how soon each platform is back after its connection drops, after a
 *     deploy hands over to the other server copy and after Twitch asks to
 *     reconnect, with no message lost or shown twice;
 *   - no Map or Set keeping an entry per message, and memory, page size and
 *     listeners staying flat, over a long session.
 * A failed scenario is run once more before it counts (shared CI machines
 * have the odd slow moment); a real slowdown fails both times.
 * Writes a table to stdout and to the GitHub job summary; exits 1 on a miss.
 * Usage: node scripts/overlay-speed.mjs [scenario ...]
 * (SPEED_LONG_STEPS=20 runs a longer session: 3,000 messages a step).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(WEB, 'build', 'client');

/* The limits. Measured values sit well inside them; see the job summary. */
const LIMITS = {
	scriptGzipKb: 215,
	scriptRawKb: 650,
	joinMs: 1_500,
	firstRowMs: 1_000,
	/* Per speed scenario. A message is held 0.5 s on purpose (so a quick
	   moderator delete lands before it shows), then waits for the next
	   200 ms presentation tick. */
	rowP95Ms: 1_000,
	rowMaxMs: 1_500,
	slowFramePercent: 1,
	longFrames: 1,
	mainThreadPercent: { 8: 45, 15: 35, 50: 50 },
	/* All four platforms at once. YouTube's chat arrives in batches a second
	   apart and is shown paced over 1.2 s (so a batch doesn't land at once). */
	mixedRowP95Ms: { twitch: 1_000, kick: 1_000, youtube: 2_500, tiktok: 1_000 },
	mixedRowMaxMs: { twitch: 1_500, kick: 1_500, youtube: 3_000, tiktok: 1_500 },
	mixedMainThreadPercent: { 16: 45, 60: 55 },
	/* The same with a quarter of each platform's lines being subs, gifts,
	   raids, cheers and the like (their rows are bigger, with icons). */
	eventsMainThreadPercent: 50,
	/* A deleted message, or a banned chatter's messages, gone from the
	   screen after the delete or ban arrives (it takes a frame or two). */
	goneMs: 250,
	/* Until a lost connection is open again: the overlay retries after 1 s;
	   at a deploy, within about a second (spread so overlays don't all arrive
	   at once); when Twitch asks to reconnect, at once. */
	reconnectMs: { dropped: 2_500, handover: 2_000, twitchDropped: 2_500, twitchAsked: 500 },
	/* Rows on screen: none may move down, sideways or change size once shown,
	   and none may be drawn over another. */
	rowShifts: 0,
	rowOverlapPx: 1,
	/* Long session, over the 6,000 messages after warm-up: a Map or Set keeping one entry
	   per message would add about 6,000 (one made in between counts from 0; the largest
	   such is a few hundred); memory read after garbage collection. */
	collectionGrowth: 1_000,
	heapGrowthMb: 0.6,
	nodeGrowthPercent: 10,
	listenerGrowthPercent: 10
};

const QUERY = 'twitch=streamer&animation=slide&fade=30&textShadow=large';
/* All four platforms in one overlay. */
const MIXED_QUERY = 'twitch=streamer&kick=kickstreamer&youtube=@ytstreamer&tiktok=ttstreamer&animation=slide&fade=30&textShadow=large';
const VIEWPORT = { width: 450, height: 800 };
const ROOM_ID = '4242';
const PLATFORMS = ['twitch', 'kick', 'youtube', 'tiktok'];
const PLATFORM_NAMES = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', tiktok: 'TikTok' };

/* ---------- fakes ---------- */

/** A plain PNG of one colour (emote art stand-in). */
function png(width, height, [r, g, b, a]) {
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, Buffer.from([r, g, b, a]))]);
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buffer) => {
		let c = 0xffffffff;
		for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([length, body, sum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const SQUARE = png(112, 112, [90, 170, 255, 255]);
const WIDE = png(336, 112, [255, 120, 80, 255]);

function emote(name, id, wide = false) {
	return {
		id,
		name,
		flags: 0,
		data: {
			id,
			name,
			flags: 0,
			host: {
				url: `//cdn.7tv.app/emote/${id}`,
				files: [{ name: '4x.webp', format: 'WEBP', width: wide ? 336 : 112, height: 112 }]
			}
		}
	};
}

const CHANNEL_EMOTES = {
	id: ROOM_ID,
	user: { id: 'stv' },
	emote_set_id: 's',
	emote_set: { id: 's', emotes: [emote('OMEGALUL', '01OMEGA'), emote('WIDEPEEPO', '01WIDE', true)] }
};

/* Every third chatter wears a 7TV paint with a shadow (paints are the costliest names to draw). */
const PAINT = {
	id: '01SPEEDPAINT',
	name: 'Speed check',
	function: 'LINEAR_GRADIENT',
	angle: 90,
	repeat: false,
	stops: [
		{ at: 0, color: 0xff4040ff },
		{ at: 1, color: 0x4060ffff }
	],
	shadows: [{ x_offset: 0, y_offset: 0, radius: 2, color: 0x000000ff }]
};

function cosmeticsReply(query) {
	const users = {};
	for (const [, alias, id] of query.matchAll(/(u\d+): userByConnection\(platform: [A-Z]+, platformId: "([^"]+)"\)/g)) {
		users[alias] = Number(id.replace(/\D/g, '')) % 3 === 0 ? { style: { paint: PAINT } } : { style: {} };
	}
	return { data: { users } };
}

const SHORT = ['hello there', 'nice play', 'lets go', 'gg', 'what a stream', 'lol', 'KEKW that was close'];
const LONG = 'this message is long enough to wrap onto a second line in a narrow browser source so the row is taller';

/** One chat line; every text ends in ` n<number>` so the page can match rows to lines.
    `variant` picks the chatter and kind of line (by default the line's number);
    every fourth chatter is a subscriber, on every platform. */
function chatLine(n, { chatters = 200, text, variant = n } = {}) {
	const who = variant % chatters;
	const kind = variant % 20;
	const body =
		text ??
		(kind < 11
			? SHORT[n % SHORT.length]
			: kind < 15
				? LONG
				: kind < 18
					? 'look OMEGALUL WIDEPEEPO OMEGALUL'
					: `@Chatter${(who + 7) % chatters} right?`);
	const tags = [
		`badges=${who % 4 === 0 ? 'subscriber/12' : ''}`,
		`color=#${((0x400000 + who * 2654435) & 0xffffff).toString(16).padStart(6, '0')}`,
		`display-name=Chatter${who}`,
		'emotes=',
		`id=s${n}`,
		`tmi-sent-ts=${Date.now()}`,
		`user-id=${3000 + who}`
	];
	if (kind === 19) {
		tags.push(`reply-parent-display-name=Chatter${(who + 3) % chatters}`, `reply-parent-msg-body=${SHORT[0].replace(/ /g, '\\s')}`, 'reply-parent-msg-id=x');
	}
	return `@${tags.join(';')} :chatter${who}!x@x.tmi.twitch.tv PRIVMSG #streamer :${body} n${n}`;
}

/* ---------- Kick, YouTube and TikTok ---------- */

/* What each platform's chat looks like by the time the overlay gets it: the
   same mix of short, long, emote and mention lines as Twitch, in the shape
   the server's Kick, YouTube and TikTok streams send. */
const KICK_CHANNEL = {
	id: 7001,
	user_id: 7002,
	slug: 'kickstreamer',
	chatroom: { id: 7003 },
	subscriber_badges: [{ id: 1, months: 1, badge_image: { src: 'https://files.kick.com/channel_subscriber_badges/1/original' } }],
	user: { id: 7002, username: 'kickstreamer' }
};

function lineOf(n, { chatters = 200, text, variant = n } = {}) {
	const who = variant % chatters;
	const kind = variant % 20;
	const style = text ? 'text' : kind < 11 ? 'short' : kind < 15 ? 'long' : kind < 18 ? 'emotes' : 'mention';
	return { who, style, body: text ?? (style === 'short' ? SHORT[n % SHORT.length] : style === 'long' ? LONG : style === 'mention' ? `@Chatter${(who + 7) % chatters} right?` : '') };
}

const colorOf = (who) => `#${((0x400000 + who * 2654435) & 0xffffff).toString(16).padStart(6, '0')}`;

/** One Kick chat message, as Pusher sends it (the data is a JSON string). */
function kickEvent(n, options) {
	const { who, style, body } = lineOf(n, options);
	const content = style === 'emotes' ? `look [emote:37226:KEKW] OMEGALUL [emote:39261:catJAM] n${n}` : `${body} n${n}`;
	return {
		type: 'event',
		event: 'App\\Events\\ChatMessageEvent',
		data: JSON.stringify({
			id: `k${n}`,
			chatroom_id: KICK_CHANNEL.chatroom.id,
			content,
			type: 'message',
			created_at: new Date().toISOString(),
			sender: {
				id: 8000 + who,
				username: `KickUser${who}`,
				slug: `kickuser${who}`,
				identity: { color: colorOf(who), badges: who % 4 === 0 ? [{ type: 'subscriber', text: 'Subscriber', count: 1 }] : [] }
			}
		})
	};
}

/** One YouTube chat item (an InnerTube addChatItemAction). */
function youtubeAction(n, options) {
	const { who, style, body } = lineOf(n, options);
	const runs =
		style === 'emotes'
			? [
					{ text: 'look ' },
					{ emoji: { emojiId: 'UCspeed/hello', shortcuts: [':hello:'], isCustomEmoji: true, image: { thumbnails: [{ url: 'https://yt3.ggpht.com/hello=w48-h48', width: 48, height: 48 }] } } },
					{ text: ' OMEGALUL ' },
					{ emoji: { emojiId: '😀', shortcuts: [':grinning:'], image: { thumbnails: [{ url: 'https://www.youtube.com/s/gaming/emoji/grinning.svg' }] } } },
					{ text: ` n${n}` }
				]
			: [{ text: `${body} n${n}` }];
	const renderer = {
		id: `y${n}`,
		message: { runs },
		authorName: { simpleText: `@YtUser${who}` },
		authorExternalChannelId: `UCspeed${who}`,
		timestampUsec: String(Date.now() * 1000)
	};
	if (who % 4 === 0) {
		renderer.authorBadges = [{ liveChatAuthorBadgeRenderer: { customThumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/member=s32' }] }, tooltip: 'Member (2 months)' } }];
	}
	return { addChatItemAction: { item: { liveChatTextMessageRenderer: renderer } } };
}

/** One TikTok chat message, as the server's TikTok stream sends it. */
function tiktokEvent(n, options) {
	const { who, body, style } = lineOf(n, options);
	return {
		type: 'chat',
		id: `t${n}`,
		senderId: String(9000 + who),
		senderUsername: `ttuser${who}`,
		username: `TtUser${who}`,
		text: style === 'emotes' ? `look OMEGALUL WIDEPEEPO n${n}` : `${body} n${n}`,
		timestamp: Date.now(),
		...(who % 4 === 0 ? { badgeUrls: ['https://p16-webcast.tiktokcdn.com/badge-speed.png'] } : {})
	};
}

/* ---------- events and moderation ---------- */

/* Subs, gifts, raids, cheers and the like, in each platform's shape. Whoever
   subscribed, gifted or raided is named n<number> (there may be no message
   to end in it), so the page can match the row to the line. */
const EVENT_KINDS = {
	twitch: ['sub', 'resub', 'subgift', 'mystery', 'raid', 'announcement', 'cheer'],
	kick: ['subscription', 'gifted', 'host', 'kicks', 'redeem'],
	youtube: ['superchat', 'sticker', 'membership', 'gift'],
	tiktok: ['gift', 'sub', 'follow', 'share']
};

/** A Twitch event: its IRC line or lines (a gift bomb is one line, then one per gift). */
function twitchEventLines(n, kind) {
	const tags = (params, badges = '', id = `s${n}`) =>
		`@badges=${badges};color=#A970FF;display-name=n${n};emotes=;id=${id};login=n${n};${params};tmi-sent-ts=${Date.now()};user-id=${50_000 + n}`;
	const notice = ' :tmi.twitch.tv USERNOTICE #streamer';
	const gift = (to, extra = '') => `msg-id=subgift;${extra}msg-param-recipient-display-name=${to};msg-param-recipient-id=${to.length + n};msg-param-recipient-user-name=${to.toLowerCase()};msg-param-sub-plan=1000`;
	switch (EVENT_KINDS.twitch[kind % EVENT_KINDS.twitch.length]) {
		case 'sub':
			return [tags('msg-id=sub;msg-param-cumulative-months=1;msg-param-sub-plan=1000', 'subscriber/1') + notice];
		case 'resub':
			return [`${tags('msg-id=resub;msg-param-cumulative-months=8;msg-param-should-share-streak=1;msg-param-streak-months=3;msg-param-sub-plan=Prime', 'subscriber/6')}${notice} :still here after all this time n${n}`];
		case 'subgift':
			return [tags(gift('Lucky'), 'sub-gifter/1') + notice];
		case 'mystery':
			return [
				tags(`msg-id=submysterygift;msg-param-mass-gift-count=2;msg-param-origin-id=o${n};msg-param-sender-count=20;msg-param-sub-plan=1000`, 'sub-gifter/10') + notice,
				tags(gift('One', `msg-param-origin-id=o${n};`), 'sub-gifter/10', `s${n}g1`) + notice,
				tags(gift('Two', `msg-param-origin-id=o${n};`), 'sub-gifter/10', `s${n}g2`) + notice
			];
		case 'raid':
			return [tags(`msg-id=raid;msg-param-displayName=n${n};msg-param-login=n${n};msg-param-viewerCount=420`) + notice];
		case 'announcement':
			return [`${tags('msg-id=announcement;msg-param-color=PURPLE', 'moderator/1')}${notice} :Big news tonight n${n}`];
		default:
			return [
				`@badges=;bits=100;color=#FF7F50;display-name=n${n};emotes=;id=s${n};tmi-sent-ts=${Date.now()};user-id=${50_000 + n} :n${n}!n${n}@n${n}.tmi.twitch.tv PRIVMSG #streamer :Cheer100 lets go n${n}`
			];
	}
}

/** A Kick event, as the server's Kick stream sends it. */
function kickEventOf(n, kind) {
	const chatroom_id = KICK_CHANNEL.chatroom.id;
	const [event, data] = {
		subscription: ['App\\Events\\SubscriptionEvent', { chatroom_id, username: `n${n}`, months: 3, user_id: 60_000 + n }],
		gifted: ['App\\Events\\GiftedSubscriptionsEvent', { chatroom_id, gifter_username: `n${n}`, gifter_id: 60_000 + n, gifted_usernames: ['one', 'two', 'three'] }],
		host: ['App\\Events\\StreamHostEvent', { chatroom_id, host_username: `n${n}`, number_viewers: 42, optional_message: '' }],
		kicks: ['App\\Events\\KicksGifted', { sender: { id: 60_000 + n, username: `n${n}` }, gift: { gift_id: 'rage_quit', name: 'Rage Quit', amount: 100 } }],
		redeem: ['App\\Events\\RewardRedeemedEvent', { id: `k${n}`, username: `n${n}`, user_id: 60_000 + n, reward_title: 'Hydrate', user_input: `drink water n${n}` }]
	}[EVENT_KINDS.kick[kind % EVENT_KINDS.kick.length]];
	return { type: 'event', event, data: JSON.stringify(data) };
}

/** A YouTube event (an InnerTube addChatItemAction). */
function youtubeEventAction(n, kind) {
	const author = { authorName: { simpleText: `@n${n}` }, authorExternalChannelId: `UCevent${n}`, timestampUsec: String(Date.now() * 1000) };
	const item = {
		superchat: { liveChatPaidMessageRenderer: { id: `y${n}`, ...author, purchaseAmountText: { simpleText: '$25.00' }, message: { runs: [{ text: `Great stream n${n}` }] } } },
		sticker: {
			liveChatPaidStickerRenderer: {
				id: `y${n}`,
				...author,
				purchaseAmountText: { simpleText: '$10.00' },
				stickerDisplayText: { simpleText: 'Hype sticker' },
				sticker: { thumbnails: [{ url: 'https://yt3.ggpht.com/sticker=s96', width: 96, height: 96 }] }
			}
		},
		membership: { liveChatMembershipItemRenderer: { id: `y${n}`, ...author, headerSubtext: { runs: [{ text: 'Welcome to the channel!' }] } } },
		gift: {
			liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: {
				id: `y${n}`,
				timestampUsec: author.timestampUsec,
				authorExternalChannelId: author.authorExternalChannelId,
				header: { liveChatSponsorshipsHeaderRenderer: { ...author, primaryText: { runs: [{ text: 'gifted 5 memberships' }] } } }
			}
		}
	}[EVENT_KINDS.youtube[kind % EVENT_KINDS.youtube.length]];
	return { addChatItemAction: { item } };
}

/** A TikTok event, as the server's TikTok stream sends it. */
function tiktokEventOf(n, kind) {
	const type = EVENT_KINDS.tiktok[kind % EVENT_KINDS.tiktok.length];
	const text = { gift: `n${n} sent 5x Rose! (5 💎)`, sub: `n${n} subscribed!`, follow: `n${n} followed!`, share: `n${n} shared the stream!` }[type];
	return {
		type,
		id: `t${n}`,
		senderId: String(70_000 + n),
		senderUsername: `n${n}`,
		username: `n${n}`,
		text,
		...(type === 'gift' ? { giftIcon: 'https://p16-webcast.tiktokcdn.com/rose-speed.png' } : {}),
		timestamp: Date.now()
	};
}

/* A moderator deleting one message, or banning a chatter (every message of
   theirs goes), in each platform's shape. */
function twitchDelete(n, who) {
	return `@login=chatter${who};room-id=;target-msg-id=s${n};tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARMSG #streamer :deleted n${n}`;
}
function twitchBan(who) {
	return `@room-id=${ROOM_ID};target-user-id=${3000 + who};tmi-sent-ts=${Date.now()} :tmi.twitch.tv CLEARCHAT #streamer :chatter${who}`;
}
function kickDelete(n) {
	return { type: 'event', event: 'App\\Events\\MessageDeletedEvent', data: JSON.stringify({ id: `kd${n}`, message: { id: `k${n}` } }) };
}
function kickBan(who) {
	return {
		type: 'event',
		event: 'App\\Events\\UserBannedEvent',
		data: JSON.stringify({ id: `kb${who}`, user: { id: 8000 + who, username: `KickUser${who}`, slug: `kickuser${who}` }, banned_by: { id: 1, username: 'mod', slug: 'mod' } })
	};
}
function youtubeDelete(n) {
	return { markChatItemAsDeletedAction: { targetItemId: `y${n}`, deletedStateMessage: { runs: [{ text: '[message deleted]' }] } } };
}
function youtubeBan(who) {
	return { markChatItemsByAuthorAsDeletedAction: { externalChannelId: `UCspeed${who}`, deletedStateMessage: { runs: [{ text: '[message deleted]' }] } } };
}
function tiktokDelete(n) {
	return { type: 'delete', id: `t${n}`, timestamp: Date.now() };
}
function tiktokBan(who) {
	return { type: 'delete', senderId: String(9000 + who), timestamp: Date.now() };
}
/** How the page records a ban's arrival: by the chatter's name or id on that platform. */
const banKey = (platform, who) => `ban:${platform}:${{ twitch: `chatter${who}`, kick: 8000 + who, youtube: `UCspeed${who}`, tiktok: 9000 + who }[platform]}`;
const LINE_PREFIX = { twitch: 's', kick: 'k', youtube: 'y', tiktok: 't' };

/*
 * The server's shared overlay stream (/api/overlay/stream), standing in for
 * the server's Kick, YouTube and TikTok chat streams. It sends what the
 * server sends, in the same frames (`<key> TAB <event> TAB <id> TAB <data>`),
 * and resumes the way the server does after a reconnect:
 *   - each platform keeps its last 100 events, as the server's hubs do;
 *   - Kick events carry a sequence number as their id; a reconnect with the
 *     last one gets every later event again;
 *   - YouTube and TikTok events carry their time as id; a reconnect gets
 *     every kept event from that time on (`since`), and the overlay drops
 *     the ones it already showed.
 * drop() cuts every connection (a network blip); handover() does what a
 * deploy does: YouTube and TikTok are told they're moving, then the whole
 * stream is told to reconnect in 500 ms and ends. Both reconnect to the same
 * hubs here (in production the other server copy has its own; that side is
 * the server's, not the overlay's).
 */
async function startStreamServer() {
	const hubs = { kick: { recent: [], sequence: 0 }, youtube: { recent: [] }, tiktok: { recent: [] } };
	const PATHS = { '/api/kick/realtime': 'kick', '/api/youtube/stream': 'youtube', '/api/tiktok/chat': 'tiktok', '/api/overlay/live': 'live' };
	const STATUS = {
		kick: { type: 'status', status: 'connected' },
		youtube: { type: 'status', status: 'connected', channelId: 'UCytstreamer', videoId: 'speedvideo1' },
		tiktok: { type: 'status', status: 'connected' }
	};
	/** @type {Set<{ res: import('node:http').ServerResponse, subs: Array<{ key: string, platform: string }> }>} */
	const connections = new Set();
	/** When each platform's stream (re)started, on this process's clock. */
	const opens = [];
	const frame = (key, event, id, data) => `data: ${key}\t${event}\t${id}\t${data}\n\n`;
	const idOf = (platform, data) => (platform === 'kick' ? (data.type === 'event' ? String(data.sequence) : '') : data.timestamp ? String(data.timestamp) : '');

	const server = createHttpServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://speed.invalid');
		if (url.pathname !== '/api/overlay/stream') return void res.writeHead(404).end();
		const subs = [];
		for (const entry of url.searchParams.getAll('s')) {
			const first = entry.indexOf('|');
			const second = entry.indexOf('|', first + 1);
			const target = new URL(entry.slice(second + 1), 'http://speed.invalid');
			const platform = PATHS[target.pathname];
			if (!platform) return void res.writeHead(400).end();
			subs.push({ key: entry.slice(0, first), lastEventId: entry.slice(first + 1, second), since: Number(target.searchParams.get('since')), platform });
		}
		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
		const connection = { res, subs };
		connections.add(connection);
		res.on('close', () => connections.delete(connection));
		const now = performance.now();
		for (const sub of subs) {
			res.write(frame(sub.key, '.open', '', ''));
			opens.push({ platform: sub.platform, at: now });
			if (sub.platform === 'live') continue;
			res.write(frame(sub.key, 'message', '', JSON.stringify(STATUS[sub.platform])));
			for (const { data, serialized } of hubs[sub.platform].recent) {
				if (sub.platform === 'kick') {
					if (!/^\d+$/.test(sub.lastEventId) || data.sequence <= Number(sub.lastEventId)) continue;
				} else {
					const last = Number(sub.lastEventId);
					const since = sub.lastEventId && last > (sub.since || 0) ? last : sub.since;
					if (Number.isFinite(since) && data.timestamp < since) continue;
				}
				res.write(frame(sub.key, 'message', idOf(sub.platform, data), serialized));
			}
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return {
		origin: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
		opens,
		/** Sends one event to every overlay on that platform's stream and keeps it. */
		publish(platform, input) {
			const hub = hubs[platform];
			const data = platform === 'kick' ? { ...input, sequence: (hub.sequence += 1) } : input;
			const serialized = JSON.stringify(data);
			hub.recent.push({ data, serialized });
			if (hub.recent.length > 100) hub.recent.shift();
			for (const { res, subs } of connections) {
				for (const sub of subs) if (sub.platform === platform) res.write(frame(sub.key, 'message', idOf(platform, data), serialized));
			}
		},
		drop() {
			for (const { res } of connections) res.destroy();
			connections.clear();
		},
		handover() {
			for (const { res, subs } of connections) {
				for (const sub of subs) if (sub.platform === 'youtube' || sub.platform === 'tiktok') res.write(frame(sub.key, 'message', '', '{"type":"moving"}'));
				res.end(frame('*', '.move', '', '500'));
			}
			connections.clear();
		},
		close: () =>
			new Promise((resolve) => {
				for (const { res } of connections) res.destroy();
				server.close(() => resolve(undefined));
			})
	};
}

/* ---------- in the page ---------- */

/* Records when each line arrives (from Twitch, or in the server's stream for
   Kick, YouTube and TikTok), when its row first appears and the next frame
   after that (on screen), every frame time, long animation frames, and when
   the overlay joined chat. With speed.rows set, it also counts a row shown
   while another row for the same message is still on the page. Also: when
   each delete or ban arrives (speed.mod, by the message or chatter), when
   each row is hidden as deleted and the next frame (speed.hidden,
   speed.gone), and whether each row had its badge when first drawn
   (speed.badge: 0 none, 1 still loading, 2 drawn). */
const PAGE_RECORDER = `(() => {
	const speed = (window.__speed = { recv: {}, shown: {}, painted: {}, frames: [], long: [], joinAt: null, rows: null, doubled: 0, mod: {}, hidden: {}, gone: {}, badge: {} });
	/* A row's line: chat lines end in n<number>; an event row names whoever
	   subscribed, gifted or raided n<number>. */
	const lineOf = (row) => {
		const text = row.textContent ?? '';
		return (/n(\\d+)\\s*$/.exec(text) ?? /(?<![A-Za-z0-9])n(\\d+)(?!\\d)/.exec(text))?.[1];
	};
	const BADGE = /static-cdn\\.jtvnw\\.net\\/badges\\/|channel_subscriber_badges|yt3\\.ggpht\\.com\\/member|badge-speed/;
	const badgeOf = (row) => {
		for (const img of row.querySelectorAll('img')) if (BADGE.test(img.src)) return img.complete && img.naturalWidth > 0 ? 2 : 1;
		return 0;
	};
	const Native = window.WebSocket;
	window.WebSocket = class extends Native {
		constructor(...args) {
			super(...args);
			this.addEventListener('message', (event) => {
				const now = performance.now();
				for (const line of String(event.data).split('\\r\\n')) {
					const match = /[@;]display-name=n(\\d+);/.exec(line) ?? /(?:PRIVMSG|USERNOTICE) #\\S+ :.* n(\\d+)$/.exec(line);
					if (match) speed.recv[match[1]] ??= now;
					else if (line.includes(' CLEARMSG #')) {
						const id = /target-msg-id=([^;\\s]+)/.exec(line);
						if (id) speed.mod['del:' + id[1]] ??= now;
					} else if (line.includes(' CLEARCHAT #')) {
						const login = / CLEARCHAT #\\S+ :(\\S+)$/.exec(line);
						if (login) speed.mod['ban:twitch:' + login[1]] ??= now;
					}
				}
			});
		}
		send(data) {
			if (speed.joinAt === null && String(data).startsWith('JOIN')) speed.joinAt = performance.now();
			return super.send(data);
		}
	};
	/* Deletes and bans in the server's stream (Kick, YouTube, TikTok). */
	const moderation = (data, now) => {
		let payload;
		try {
			payload = JSON.parse(data.split('\\t').slice(3).join('\\t'));
		} catch {
			return;
		}
		const mark = (key) => (speed.mod[key] ??= now);
		if (payload.type === 'event') {
			let d = {};
			try {
				d = JSON.parse(payload.data);
			} catch {}
			if (String(payload.event).endsWith('MessageDeletedEvent')) mark('del:' + (d.message?.id ?? d.id));
			else if (String(payload.event).endsWith('UserBannedEvent')) mark('ban:kick:' + d.user?.id);
		} else if (payload.type === 'actions') {
			for (const action of payload.actions ?? []) {
				if (action.markChatItemAsDeletedAction) mark('del:' + action.markChatItemAsDeletedAction.targetItemId);
				if (action.markChatItemsByAuthorAsDeletedAction) mark('ban:youtube:' + action.markChatItemsByAuthorAsDeletedAction.externalChannelId);
			}
		} else if (payload.type === 'delete') mark(payload.id ? 'del:' + payload.id : 'ban:tiktok:' + payload.senderId);
	};
	const NativeSource = window.EventSource;
	if (NativeSource) {
		window.EventSource = class extends NativeSource {
			constructor(...args) {
				super(...args);
				this.addEventListener('message', (event) => {
					const now = performance.now();
					const data = String(event.data);
					for (const match of data.matchAll(/[\\s"@]n(\\d+)(?=\\\\*")/g)) speed.recv[match[1]] ??= now;
					if (data.includes('Deleted') || data.includes('Banned') || data.includes('"delete"')) moderation(data, now);
				});
			}
		};
	}
	let waiting = [];
	let going = [];
	const paint = (t) => {
		for (const [id, row] of waiting) {
			speed.painted[id] ??= t;
			speed.badge[id] ??= badgeOf(row);
		}
		for (const id of going) speed.gone[id] ??= t;
		waiting = [];
		going = [];
	};
	const hide = (row, now) => {
		const id = lineOf(row);
		if (id === undefined || speed.hidden[id] !== undefined) return;
		speed.hidden[id] = now;
		going.push(id);
	};
	new MutationObserver((records) => {
		const now = performance.now();
		for (const record of records) {
			if (record.type === 'attributes') {
				const row = record.target.closest?.('.gx-message-row');
				if (row && record.target.getAttribute('data-deleted') === 'true') hide(row, now);
				continue;
			}
			for (const node of record.addedNodes) {
				if (!(node instanceof Element)) continue;
				const rows = node.matches('.gx-message-row') ? [node] : [...node.querySelectorAll('.gx-message-row')];
				for (const row of rows) {
					if (row.closest('[data-slide-ghost]')) continue;
					/* Added already deleted: never visible. */
					if (row.querySelector('[data-deleted="true"]')) {
						hide(row, now);
						continue;
					}
					const id = lineOf(row);
					if (id === undefined) continue;
					if (speed.rows) {
						const other = speed.rows[id];
						if (other && other !== row && other.isConnected) speed.doubled += 1;
						speed.rows[id] = row;
					}
					if (speed.shown[id] !== undefined) continue;
					speed.shown[id] = now;
					waiting.push([id, row]);
				}
			}
		}
		if (waiting.length || going.length) requestAnimationFrame(paint);
	}).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-deleted'] });
	const tick = (t) => {
		speed.frames.push(t);
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) speed.long.push({ start: entry.startTime, duration: entry.duration });
		}).observe({ type: 'long-animation-frame', buffered: true });
	} catch {}
})();`;

/* Every frame: each row's place and size (used only where rows are checked;
   reading layout every frame costs time, so not during the speed runs). */
const LAYOUT_RECORDER = `(() => {
	const layout = (window.__layout = []);
	/* What of a row is drawn, top to bottom: inside every inset() clip-path above
	   it (under Slide the chat is clipped at the bottom of its content while it
	   moves). */
	const clipOf = (row) => {
		let top = -Infinity;
		let bottom = Infinity;
		for (let el = row.parentElement; el && el !== document.body; el = el.parentElement) {
			const path = getComputedStyle(el).clipPath;
			if (!path || !path.startsWith('inset(')) continue;
			const v = path.slice(6, path.indexOf(')')).trim().split(/\\s+/).map(parseFloat);
			const box = el.getBoundingClientRect();
			top = Math.max(top, box.top + v[0]);
			bottom = Math.min(bottom, box.bottom - (v.length > 2 ? v[2] : v[0]));
		}
		return [top, bottom];
	};
	const tick = (t) => {
		const rows = [];
		for (const row of document.querySelectorAll('.gx-message-row')) {
			if (row.closest('[data-slide-ghost]')) continue;
			const text = row.textContent ?? '';
			const match = /n(\\d+)\\s*$/.exec(text) ?? /(?<![A-Za-z0-9])n(\\d+)(?!\\d)/.exec(text);
			if (!match) continue;
			const box = row.getBoundingClientRect();
			const [clipTop, clipBottom] = clipOf(row);
			rows.push([match[1], box.top, box.left, box.height, Math.max(box.top, clipTop), Math.min(box.bottom, clipBottom)]);
		}
		layout.push({ t, rows });
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
})();`;

/* ---------- server ---------- */

async function freePort() {
	return await new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address();
			probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

async function startServer() {
	if (!existsSync(join(WEB, 'build', 'index.js'))) throw new Error('No build: run npm run build first.');
	const port = await freePort();
	const server = spawn(process.execPath, ['build'], {
		cwd: WEB,
		env: { PATH: process.env.PATH, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	server.stdout.on('data', (chunk) => (output += chunk));
	server.stderr.on('data', (chunk) => (output += chunk));
	const origin = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 100; i += 1) {
		if (server.exitCode !== null) break;
		try {
			const response = await fetch(`${origin}/multichat`);
			if (response.ok) return { origin, stop: () => server.kill() };
		} catch {}
		await sleep(200);
	}
	server.kill();
	throw new Error(`The built server did not start:\n${output}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- one overlay page ---------- */

/**
 * One overlay page. With `mixed`, it shows all four platforms: Kick, YouTube
 * and TikTok come through a stand-in for the server's shared stream, and
 * lines go to the four in turn.
 */
async function openOverlay(browser, origin, { layout = false, imageDelayMs = 0, mixed = false } = {}) {
	const streams = mixed ? await startStreamServer() : null;
	const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
	const page = await context.newPage();
	const errors = [];
	const scripts = new Set();
	page.on('pageerror', (error) => errors.push(String(error)));
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.origin === origin && url.pathname.endsWith('.js')) scripts.add(url.pathname);
	});
	/** The Twitch chat sockets the overlay opened, newest last. */
	const irc = [];
	/** When the overlay (re)joined Twitch chat, on this process's clock. */
	const joins = [];
	await page.routeWebSocket(/.*/, (socket) => {
		if (!socket.url().startsWith('wss://irc-ws.chat.twitch.tv')) return; /* other sockets: open, silent */
		const entry = { socket, joined: false, closed: false };
		irc.push(entry);
		socket.onClose(() => (entry.closed = true));
		socket.onMessage((message) => {
			const text = String(message);
			if (text.startsWith('JOIN')) {
				socket.send(':justinfan1!justinfan1@justinfan1.tmi.twitch.tv JOIN #streamer');
				socket.send(`@emote-only=0;room-id=${ROOM_ID};subs-only=0 :tmi.twitch.tv ROOMSTATE #streamer`);
				entry.joined = true;
				joins.push(performance.now());
			} else if (text.startsWith('PING')) {
				socket.send(`:tmi.twitch.tv PONG tmi.twitch.tv ${text.slice(5)}`);
			}
		});
	});
	/** The socket chat lines go to: the newest, once joined and while open. */
	const twitch = () => {
		const entry = irc[irc.length - 1];
		return entry && entry.joined && !entry.closed ? entry : null;
	};
	await page.route('**/*', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin === origin) {
			if (streams && url.pathname === '/api/overlay/stream') return route.continue({ url: `${streams.origin}${url.pathname}${url.search}` });
			if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
			return route.continue();
		}
		if (url.href === `https://kick.com/api/v2/channels/${KICK_CHANNEL.slug}`) return route.fulfill({ json: KICK_CHANNEL });
		if (url.href === `https://kick.com/api/v2/channels/${KICK_CHANNEL.id}/messages`) return route.fulfill({ json: { data: { messages: [] } } });
		if (url.href.startsWith(`https://7tv.io/v3/users/twitch/${ROOM_ID}`)) return route.fulfill({ json: CHANNEL_EMOTES });
		if (url.href.startsWith('https://7tv.io/v3/users/kick/')) return route.fulfill({ json: CHANNEL_EMOTES });
		if (url.href.startsWith('https://7tv.io/v3/emote-sets/global')) return route.fulfill({ json: { id: 'g', emotes: [] } });
		if (url.href.startsWith('https://api.7tv.app/v4/gql') && request.method() === 'POST') {
			let query = '';
			try {
				query = String(request.postDataJSON()?.query ?? '');
			} catch {}
			return route.fulfill({ json: cosmeticsReply(query) });
		}
		if (request.resourceType() === 'image' || url.hostname === 'cdn.7tv.app') {
			if (imageDelayMs) await sleep(imageDelayMs);
			return route.fulfill({ status: 200, contentType: 'image/png', body: url.pathname.includes('01WIDE') ? WIDE : SQUARE });
		}
		return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	await page.addInitScript(PAGE_RECORDER);
	if (layout) await page.addInitScript(LAYOUT_RECORDER);
	const cdp = await context.newCDPSession(page);
	await cdp.send('Performance.enable');
	await page.goto(`${origin}/multichat?${mixed ? MIXED_QUERY : QUERY}`, { waitUntil: 'load' });
	for (let i = 0; i < 100 && !irc.length; i += 1) await sleep(50);
	if (!irc.length) throw new Error('The overlay never opened Twitch chat.');
	const joinAt = await page.waitForFunction(() => window.__speed.joinAt, null, { timeout: 10_000 }).then((h) => h.jsonValue());
	if (streams) {
		for (let i = 0; i < 100 && !['kick', 'youtube', 'tiktok'].every((p) => streams.opens.some((o) => o.platform === p)); i += 1) await sleep(50);
		const missing = ['kick', 'youtube', 'tiktok'].filter((p) => !streams.opens.some((o) => o.platform === p));
		if (missing.length) throw new Error(`The overlay never opened ${missing.join(', ')} chat.`);
	}
	/* ROOMSTATE brings the channel's 7TV emotes; let them load. */
	await sleep(800);
	let sent = 0;
	/** Which platform each line went to, who sent it, which lines were events, and Twitch lines with no socket to go to. */
	const platformOf = {};
	const whoOf = {};
	const eventOf = new Set();
	const unsent = new Set();
	/* YouTube's chat comes in batches (the server polls YouTube); one a second. */
	const youtubeBatch = [];
	const flushYouTube = () => {
		if (youtubeBatch.length) streams?.publish('youtube', { type: 'actions', videoId: 'speedvideo1', actions: youtubeBatch.splice(0), timestamp: Date.now() });
	};
	const youtubeTimer = streams ? setInterval(flushYouTube, 1_000) : null;
	/* With `events: k`, every k-th line of each platform is an event (a sub,
	   gift, raid, cheer and so on, in turn) instead of a chat message. */
	const deliver = (options) => {
		const n = ++sent;
		const platform = mixed ? PLATFORMS[(n - 1) % PLATFORMS.length] : 'twitch';
		if (mixed) {
			platformOf[n] = platform;
			/* Each platform gets every kind of line, in the same order. */
			options = { ...options, variant: Math.floor((n - 1) / PLATFORMS.length) };
		}
		const variant = options.variant ?? n;
		const event = options.events ? (variant % options.events === options.events - 1 ? Math.floor(variant / options.events) : null) : null;
		if (event === null) whoOf[n] = lineOf(n, options).who;
		else eventOf.add(n);
		if (platform === 'twitch') {
			const entry = twitch();
			if (!entry) unsent.add(n);
			else if (event === null) entry.socket.send(chatLine(n, options));
			else for (const line of twitchEventLines(n, event)) entry.socket.send(line);
		} else if (platform === 'kick') streams.publish('kick', event === null ? kickEvent(n, options) : kickEventOf(n, event));
		else if (platform === 'tiktok') streams.publish('tiktok', event === null ? tiktokEvent(n, options) : tiktokEventOf(n, event));
		else youtubeBatch.push(event === null ? youtubeAction(n, options) : youtubeEventAction(n, event));
	};
	/* A moderator deleting line n, or banning a chatter on a platform. YouTube's
	   go out with its next batch (the server polls YouTube). */
	const moderate = (platform, action) => {
		if (platform === 'twitch') twitch()?.socket.send(action);
		else if (platform === 'youtube') youtubeBatch.push(action);
		else streams.publish(platform, action);
	};
	return {
		page,
		cdp,
		errors,
		scripts,
		joinAt,
		joins,
		streams,
		irc,
		platformOf,
		whoOf,
		eventOf,
		unsent,
		/** Deletes line n (as a moderator would). */
		remove(n) {
			const platform = platformOf[n] ?? 'twitch';
			moderate(platform, { twitch: () => twitchDelete(n, whoOf[n]), kick: () => kickDelete(n), youtube: () => youtubeDelete(n), tiktok: () => tiktokDelete(n) }[platform]());
		},
		/** Bans chatter `who` on a platform: every message of theirs goes. */
		ban(platform, who) {
			moderate(platform, { twitch: twitchBan, kick: kickBan, youtube: youtubeBan, tiktok: tiktokBan }[platform](who));
		},
		/** Sends lines at `perSecond` for `seconds`, on a schedule (not one timer per line). */
		async stream(perSecond, seconds, options = {}) {
			const start = performance.now();
			const total = Math.round(perSecond * seconds);
			let done = 0;
			while (done < total) {
				const due = Math.min(total, Math.floor(((performance.now() - start) / 1000) * perSecond) + 1);
				for (; done < due; done += 1) deliver(options);
				await sleep(5);
			}
		},
		async send(count, options = {}) {
			for (let i = 0; i < count; i += 1) deliver(options);
		},
		get sent() {
			return sent;
		},
		async metrics() {
			const { metrics } = await cdp.send('Performance.getMetrics');
			return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
		},
		async close() {
			if (youtubeTimer) clearInterval(youtubeTimer);
			await context.close();
			await streams?.close();
		}
	};
}

/* ---------- measurements ---------- */

function percentile(values, p) {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Message-to-screen times (ms) for lines numbered from..to (those `keep` keeps). */
async function rowTimes(page, from, to, keep = () => true) {
	const speed = await page.evaluate(() => ({ recv: window.__speed.recv, painted: window.__speed.painted }));
	const times = [];
	let missing = 0;
	for (let n = from; n <= to; n += 1) {
		if (!keep(n)) continue;
		const recv = speed.recv[n];
		const painted = speed.painted[n];
		if (recv === undefined || painted === undefined) missing += 1;
		else times.push(painted - recv);
	}
	return { times, missing };
}

/* ---------- scenarios ---------- */

/** @typedef {{ name: string, value: number, limit: number, unit: string, pass: boolean }} Check */

function check(name, value, limit, unit) {
	return { name, value: Math.round(value * 10) / 10, limit, unit, pass: value <= limit };
}

async function startup(browser, origin, meta) {
	const overlay = await openOverlay(browser, origin);
	try {
		const before = overlay.sent;
		await overlay.send(1);
		await overlay.page.waitForFunction((n) => window.__speed.painted[n] !== undefined, before + 1, { timeout: 10_000 });
		const { times } = await rowTimes(overlay.page, before + 1, before + 1);
		/* Script size: every .js file the page asked for, as built (gzip as the server sends it). */
		let raw = 0;
		let gzip = 0;
		for (const path of overlay.scripts) {
			const file = join(CLIENT, path);
			if (!existsSync(file)) continue;
			raw += statSync(file).size;
			gzip += existsSync(`${file}.gz`) ? statSync(`${file}.gz`).size : gzipSync(readFileSync(file)).length;
		}
		meta.scripts = overlay.scripts.size;
		return [
			check('Script loaded, gzip', gzip / 1024, LIMITS.scriptGzipKb, 'KB'),
			check('Script loaded, unpacked', raw / 1024, LIMITS.scriptRawKb, 'KB'),
			check('Joined chat after page start', overlay.joinAt, LIMITS.joinMs, 'ms'),
			check('First message on screen after it arrived', times[0] ?? Infinity, LIMITS.firstRowMs, 'ms'),
			check('Page errors', overlay.errors.length, 0, '')
		];
	} finally {
		await overlay.close();
	}
}

/** Ten measured seconds at `perSecond` (after two to settle in): which lines,
    frame times and main-thread time in that window. */
async function measuredRun(overlay, perSecond, settleMs, options = {}) {
	await overlay.stream(perSecond, 2, options);
	const first = overlay.sent + 1;
	const frameStart = await overlay.page.evaluate(() => performance.now());
	const before = await overlay.metrics();
	await overlay.stream(perSecond, 10, options);
	const after = await overlay.metrics();
	const frameEnd = await overlay.page.evaluate(() => performance.now());
	const last = overlay.sent;
	await sleep(settleMs);
	const { frames, long } = await overlay.page.evaluate(() => ({ frames: window.__speed.frames, long: window.__speed.long }));
	const inWindow = frames.filter((t) => t >= frameStart && t <= frameEnd);
	const gaps = inWindow.slice(1).map((t, i) => t - inWindow[i]);
	return {
		first,
		last,
		slowPercent: gaps.length ? (gaps.filter((gap) => gap > 25).length / gaps.length) * 100 : 100,
		longFrames: long.filter((entry) => entry.start >= frameStart && entry.start <= frameEnd).length,
		busy: ((after.TaskDuration - before.TaskDuration) / ((frameEnd - frameStart) / 1000)) * 100
	};
}

function speedScenario(perSecond) {
	return async (browser, origin) => {
		const overlay = await openOverlay(browser, origin);
		try {
			const run = await measuredRun(overlay, perSecond, 1_600);
			const { times, missing } = await rowTimes(overlay.page, run.first, run.last);
			const label = `${perSecond} msg/s`;
			return [
				check(`${label}: message on screen, 95% within`, percentile(times, 95), LIMITS.rowP95Ms, 'ms'),
				check(`${label}: message on screen, slowest`, Math.max(0, ...times), LIMITS.rowMaxMs, 'ms'),
				check(`${label}: messages never shown`, missing, 0, ''),
				check(`${label}: frames over 25 ms`, run.slowPercent, LIMITS.slowFramePercent, '%'),
				check(`${label}: frames blocked 50 ms or more`, run.longFrames, LIMITS.longFrames, ''),
				check(`${label}: main thread busy`, run.busy, LIMITS.mainThreadPercent[perSecond], '%'),
				check(`${label}: page errors`, overlay.errors.length, 0, '')
			];
		} finally {
			await overlay.close();
		}
	};
}

/** All four platforms in one overlay, the lines shared out in turn. */
function mixedSpeedScenario(perSecond) {
	return async (browser, origin) => {
		const overlay = await openOverlay(browser, origin, { mixed: true });
		try {
			/* YouTube's last batch goes out up to a second late and is paced over 1.2 s. */
			const run = await measuredRun(overlay, perSecond, 3_200);
			const label = `All 4 platforms, ${perSecond} msg/s`;
			const checks = [];
			let missingAll = 0;
			for (const platform of PLATFORMS) {
				const { times, missing } = await rowTimes(overlay.page, run.first, run.last, (n) => overlay.platformOf[n] === platform);
				missingAll += missing;
				const name = PLATFORM_NAMES[platform];
				checks.push(
					check(`${label}: ${name} message on screen, 95% within`, percentile(times, 95), LIMITS.mixedRowP95Ms[platform], 'ms'),
					check(`${label}: ${name} message on screen, slowest`, Math.max(0, ...times), LIMITS.mixedRowMaxMs[platform], 'ms')
				);
			}
			return [
				...checks,
				check(`${label}: messages never shown`, missingAll, 0, ''),
				check(`${label}: frames over 25 ms`, run.slowPercent, LIMITS.slowFramePercent, '%'),
				check(`${label}: frames blocked 50 ms or more`, run.longFrames, LIMITS.longFrames, ''),
				check(`${label}: main thread busy`, run.busy, LIMITS.mixedMainThreadPercent[perSecond], '%'),
				check(`${label}: page errors`, overlay.errors.length, 0, '')
			];
		} finally {
			await overlay.close();
		}
	};
}

/** Badge holders' chat lines (not events) from..to on a platform whose rows were
    drawn without their badge (none, or its image still loading). */
async function badgeMisses(overlay, from, to, platform) {
	const { painted, badge } = await overlay.page.evaluate(() => ({ painted: window.__speed.painted, badge: window.__speed.badge }));
	let none = 0;
	let loading = 0;
	let holders = 0;
	for (let n = from; n <= to; n += 1) {
		if (overlay.platformOf[n] !== platform || overlay.eventOf.has(n) || overlay.whoOf[n] % 4 !== 0 || painted[n] === undefined) continue;
		holders += 1;
		if (badge[n] === 0) none += 1;
		else if (badge[n] === 1) loading += 1;
	}
	return { none, loading, holders };
}

/** All four platforms, a quarter of each one's lines being subs, gifts,
    raids, cheers and the like (in turn, each in that platform's shape). */
function eventsScenario(perSecond) {
	return async (browser, origin) => {
		const overlay = await openOverlay(browser, origin, { mixed: true });
		try {
			const run = await measuredRun(overlay, perSecond, 3_200, { events: 4 });
			const label = `Events, all 4 platforms, ${perSecond} lines/s`;
			const checks = [];
			let missingAll = 0;
			for (const platform of PLATFORMS) {
				const all = await rowTimes(overlay.page, run.first, run.last, (n) => overlay.platformOf[n] === platform);
				missingAll += all.missing;
				const { times } = await rowTimes(overlay.page, run.first, run.last, (n) => overlay.platformOf[n] === platform && overlay.eventOf.has(n));
				const badges = await badgeMisses(overlay, run.first, run.last, platform);
				const name = PLATFORM_NAMES[platform];
				checks.push(
					check(`${label}: ${name} event on screen, 95% within`, percentile(times, 95), LIMITS.mixedRowP95Ms[platform], 'ms'),
					check(`${label}: ${name} event on screen, slowest`, Math.max(0, ...times), LIMITS.mixedRowMaxMs[platform], 'ms'),
					{
						...check(`${label}: ${name} badge holders' messages drawn without the badge, of ${badges.holders}`, badges.none + badges.loading, 0, ''),
						...(badges.none + badges.loading ? { note: `${badges.none} with no badge, ${badges.loading} with it still loading` } : {})
					}
				);
			}
			return [
				...checks,
				check(`${label}: messages and events never shown`, missingAll, 0, ''),
				check(`${label}: frames over 25 ms`, run.slowPercent, LIMITS.slowFramePercent, '%'),
				check(`${label}: frames blocked 50 ms or more`, run.longFrames, LIMITS.longFrames, ''),
				check(`${label}: main thread busy`, run.busy, LIMITS.eventsMainThreadPercent, '%'),
				check(`${label}: page errors`, overlay.errors.length, 0, '')
			];
		} finally {
			await overlay.close();
		}
	};
}

/** Rows on screen, frame by frame: moves down, sideways and size changes after shown, and
    the deepest one row's visible part reaches into the next. Only what is drawn counts:
    the part inside the window and inside any clip-path above the row. */
function rowShifts(layout) {
	let down = 0;
	let sideways = 0;
	let resized = 0;
	let overlap = 0;
	for (let i = 1; i < layout.length; i += 1) {
		const before = new Map(layout[i - 1].rows.map((row) => [row[0], row]));
		const visible = [];
		for (const row of layout[i].rows) {
			const [id, top, left, height, clipTop, clipBottom] = row;
			/* Hidden (pruned off the top: no height) or outside the window: not visible. */
			const shownTop = Math.max(0, clipTop);
			const shownBottom = Math.min(VIEWPORT.height, clipBottom);
			if (height <= 0 || shownBottom <= shownTop) continue;
			visible.push([shownTop, shownBottom]);
			const old = before.get(id);
			if (!old || old[3] <= 0) continue;
			if (top - old[1] > 0.5) down += 1;
			if (Math.abs(left - old[2]) > 0.5) sideways += 1;
			if (Math.abs(height - old[3]) > 0.5) resized += 1;
		}
		visible.sort((a, b) => a[0] - b[0]);
		for (let j = 1; j < visible.length; j += 1) overlap = Math.max(overlap, visible[j - 1][1] - visible[j][0]);
	}
	return { down, sideways, resized, overlap };
}

function rowsScenario(label, plan, imageDelayMs = 0, mixed = false, events = 0) {
	return async (browser, origin) => {
		const overlay = await openOverlay(browser, origin, { layout: true, imageDelayMs, mixed });
		try {
			const start = await overlay.page.evaluate(() => performance.now());
			for (const [perSecond, seconds, text] of plan) await overlay.stream(perSecond, seconds, { ...(text ? { text } : {}), ...(events ? { events } : {}) });
			await sleep(2_500);
			const layout = await overlay.page.evaluate((t) => window.__layout.filter((frame) => frame.t >= t), start);
			const shifts = rowShifts(layout);
			return [
				check(`Rows, ${label}: moved down after shown`, shifts.down, LIMITS.rowShifts, ''),
				check(`Rows, ${label}: moved sideways after shown`, shifts.sideways, LIMITS.rowShifts, ''),
				check(`Rows, ${label}: changed size after shown`, shifts.resized, LIMITS.rowShifts, ''),
				check(`Rows, ${label}: deepest overlap of two rows`, shifts.overlap, LIMITS.rowOverlapPx, 'px'),
				check(`Rows, ${label}: page errors`, overlay.errors.length, 0, '')
			];
		} finally {
			await overlay.close();
		}
	};
}

/**
 * Connections lost and back, all four platforms chatting (2 lines a second
 * each): the server stream drops (a network blip), then a deploy hands over
 * to the other server copy, then Twitch's socket drops, then Twitch asks the
 * overlay to reconnect. For each: how soon that platform's stream or socket
 * is open again. Over the whole run: lines that never showed (Twitch has no
 * replay, so Twitch lines that had no open socket aren't sent at all) and
 * rows shown twice.
 */
async function reconnects(browser, origin) {
	const overlay = await openOverlay(browser, origin, { mixed: true });
	try {
		await overlay.page.evaluate(() => (window.__speed.rows = {}));
		const first = overlay.sent + 1;
		let running = true;
		const traffic = (async () => {
			while (running) await overlay.stream(8, 0.5);
		})();
		await sleep(3_000);
		const droppedAt = performance.now();
		overlay.streams.drop();
		await sleep(9_000);
		const movedAt = performance.now();
		overlay.streams.handover();
		await sleep(5_000);
		const twitchDroppedAt = performance.now();
		await overlay.irc[overlay.irc.length - 1].socket.close();
		await sleep(4_000);
		const askedAt = performance.now();
		const asked = overlay.irc[overlay.irc.length - 1];
		/* Lines stop going to a socket once Twitch has asked to leave it. */
		asked.closed = true;
		asked.socket.send(':tmi.twitch.tv RECONNECT');
		await sleep(4_000);
		running = false;
		await traffic;
		await sleep(3_200);
		const last = overlay.sent;
		const streamBack = (platform, at) => (overlay.streams.opens.find((o) => o.platform === platform && o.at > at)?.at ?? Infinity) - at;
		const twitchBack = (at) => (overlay.joins.find((t) => t > at) ?? Infinity) - at;
		const { painted, doubled } = await overlay.page.evaluate(() => ({ painted: window.__speed.painted, doubled: window.__speed.doubled }));
		let lost = 0;
		for (let n = first; n <= last; n += 1) if (!overlay.unsent.has(n) && painted[n] === undefined) lost += 1;
		const stream = ['kick', 'youtube', 'tiktok'];
		return [
			...stream.map((p) => check(`Server stream dropped: ${PLATFORM_NAMES[p]} back after`, streamBack(p, droppedAt), LIMITS.reconnectMs.dropped, 'ms')),
			...stream.map((p) => check(`Deploy handover: ${PLATFORM_NAMES[p]} back after`, streamBack(p, movedAt), LIMITS.reconnectMs.handover, 'ms')),
			check('Twitch connection dropped: back after', twitchBack(twitchDroppedAt), LIMITS.reconnectMs.twitchDropped, 'ms'),
			check('Twitch asked to reconnect: back after', twitchBack(askedAt), LIMITS.reconnectMs.twitchAsked, 'ms'),
			check(`Reconnects: messages never shown, of ${last - first + 1 - overlay.unsent.size}`, lost, 0, ''),
			check('Reconnects: rows shown twice', doubled, 0, ''),
			check('Reconnects: page errors', overlay.errors.length, 0, '')
		];
	} finally {
		await overlay.close();
	}
}

/**
 * Moderation, all four platforms chatting (8 lines a second in all, eight
 * chatters, so each has a few rows on screen): every third line is deleted
 * 0.1 s after it arrives (while the overlay still holds it back: it must
 * never show; YouTube's goes in the same batch), every third is deleted
 * once it has been on screen a while, and one chatter on each platform is
 * banned twice over (every row of theirs goes, and what they had waiting
 * never shows). How soon each goes after the delete or ban arrives; and
 * that no other message is hidden or lost.
 */
async function moderation(browser, origin) {
	const overlay = await openOverlay(browser, origin, { mixed: true });
	try {
		const options = { chatters: 8 };
		const first = overlay.sent + 1;
		await overlay.stream(8, 2, options);
		const quick = new Set();
		const late = new Set();
		/** Per platform and chatter: the last line sent before their ban. */
		const bans = [];
		const lines = 8 * 14;
		for (let i = 0; i < lines; i += 1) {
			const tick = performance.now();
			await overlay.send(1, options);
			const n = overlay.sent;
			if (i % 3 === 0) {
				quick.add(n);
				if (overlay.platformOf[n] === 'youtube') overlay.remove(n);
				else setTimeout(() => overlay.remove(n), 100);
			} else if (i % 3 === 1 && i >= 30) {
				/* On screen for about 3.5 s by now (YouTube's within 3 s at most). */
				const target = n - 27;
				if (!quick.has(target) && !bans.some((b) => b.platform === overlay.platformOf[target] && b.who === overlay.whoOf[target] && target <= b.last)) {
					late.add(target);
					overlay.remove(target);
				}
			}
			if (i === 48 || i === 96) {
				for (const platform of PLATFORMS) {
					const who = i === 48 ? 3 : 6;
					bans.push({ platform, who, last: n });
					overlay.ban(platform, who);
				}
			}
			await sleep(Math.max(0, 125 - (performance.now() - tick)));
		}
		const last = overlay.sent;
		await sleep(3_200);
		const speed = await overlay.page.evaluate(() => {
			const { painted, shown, gone, hidden, mod } = window.__speed;
			return { painted, shown, gone, hidden, mod };
		});
		const banOf = (n) => bans.find((b) => b.platform === overlay.platformOf[n] && b.who === overlay.whoOf[n] && n <= b.last);
		const goneTimes = Object.fromEntries(PLATFORMS.map((p) => [p, { deleted: [], banned: [] }]));
		let shownAnyway = 0;
		let wrong = 0;
		let lost = 0;
		for (let n = first; n <= last; n += 1) {
			const platform = overlay.platformOf[n];
			const ban = banOf(n);
			const key = quick.has(n) || late.has(n) ? `del:${LINE_PREFIX[platform]}${n}` : ban ? banKey(platform, ban.who) : null;
			if (!key) {
				if (speed.hidden[n] !== undefined) wrong += 1;
				if (speed.painted[n] === undefined && !overlay.unsent.has(n)) lost += 1;
				continue;
			}
			const arrived = speed.mod[key];
			/* Never shown: right for one deleted or banned while still held back. */
			if (speed.shown[n] === undefined) continue;
			if (quick.has(n) || (arrived !== undefined && speed.shown[n] >= arrived)) {
				shownAnyway += 1;
				continue;
			}
			goneTimes[platform][late.has(n) ? 'deleted' : 'banned'].push((speed.gone[n] ?? Infinity) - (arrived ?? -Infinity));
		}
		const checks = [];
		for (const platform of PLATFORMS) {
			const name = PLATFORM_NAMES[platform];
			const { deleted, banned } = goneTimes[platform];
			checks.push(
				{ ...check(`Moderation: ${name} deleted message gone after the delete, slowest`, deleted.length ? Math.max(...deleted) : Infinity, LIMITS.goneMs, 'ms'), note: `${deleted.length} deleted` },
				{ ...check(`Moderation: ${name} banned chatter's messages gone after the ban, slowest`, banned.length ? Math.max(...banned) : Infinity, LIMITS.goneMs, 'ms'), note: `${banned.length} rows` }
			);
		}
		return [
			...checks,
			check('Moderation: messages deleted or banned before they showed, shown anyway', shownAnyway, 0, ''),
			check('Moderation: other messages hidden', wrong, 0, ''),
			check('Moderation: other messages never shown', lost, 0, ''),
			check('Moderation: page errors', overlay.errors.length, 0, '')
		];
	} finally {
		await overlay.close();
	}
}

/** Every Map and Set alive in the page, each with an id that stays the same between calls. */
async function collectionSizes(cdp) {
	const sizes = new Map();
	for (const type of ['Map', 'Set']) {
		const { result: prototype } = await cdp.send('Runtime.evaluate', { expression: `${type}.prototype` });
		const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: prototype.objectId });
		const { result } = await cdp.send('Runtime.callFunctionOn', {
			objectId: objects.objectId,
			returnByValue: true,
			functionDeclaration: `function () {
				const ids = (globalThis.__speedIds ??= new WeakMap());
				const out = [];
				for (const collection of this) {
					let size;
					try {
						size = collection.size;
					} catch {
						continue; /* a subclass's prototype object, not a collection */
					}
					if (!ids.has(collection)) ids.set(collection, (globalThis.__speedNext = (globalThis.__speedNext ?? 0) + 1));
					out.push([ids.get(collection), size]);
				}
				return out;
			}`
		});
		if (!Array.isArray(result.value)) throw new Error(`Could not list ${type}s: ${JSON.stringify(result).slice(0, 300)}`);
		for (const [id, size] of result.value) sizes.set(`${type}${id}`, size);
		await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
	}
	return sizes;
}

async function longSession(browser, origin) {
	const overlay = await openOverlay(browser, origin);
	try {
		/* 150 messages a second from 500 chatters (near the most the overlay shows row by
		   row: faster, it skips rows that would scroll away unseen), in steps of 3,000 with
		   a pause after each. The first two steps warm up (compiled code and caches fill);
		   memory is read after the second step and after each later one, after garbage
		   collection. */
		const STEP = 3_000;
		const STEPS = Math.max(3, Number(process.env.SPEED_LONG_STEPS) || 4);
		const readings = [];
		for (let i = 0; i < STEPS; i += 1) {
			await overlay.stream(150, STEP / 150, { chatters: 500 });
			await sleep(2_000);
			if (i < 1) continue;
			/* The recorder's own per-message notes would count as growth: drop them first. */
			await overlay.page.evaluate(() => Object.assign(window.__speed, { recv: {}, shown: {}, painted: {}, frames: [], long: [] }));
			await overlay.cdp.send('HeapProfiler.collectGarbage');
			await sleep(200);
			const m = await overlay.metrics();
			readings.push({ heap: m.JSHeapUsedSize / 1024 / 1024, nodes: m.Nodes, listeners: m.JSEventListeners, collections: await collectionSizes(overlay.cdp) });
		}
		const first = readings[0];
		const last = readings[readings.length - 1];
		const growth = (a, b) => (a > 0 ? ((b - a) / a) * 100 : 0);
		let mostAdded = 0;
		for (const [id, size] of last.collections) mostAdded = Math.max(mostAdded, size - (first.collections.get(id) ?? 0));
		const counted = (STEPS - 2) * STEP;
		const span = `the last ${counted.toLocaleString('en')} of ${overlay.sent.toLocaleString('en')} messages`;
		return [
			check(`Long session: most entries added to any one Map or Set, ${span}`, mostAdded, LIMITS.collectionGrowth, ''),
			{
				...check(`Long session: memory growth, ${span}`, last.heap - first.heap, LIMITS.heapGrowthMb, 'MB'),
				note: readings.map((r) => r.heap.toFixed(2)).join(' → ') + ' MB'
			},
			check('Long session: page size (DOM nodes) growth', growth(first.nodes, last.nodes), LIMITS.nodeGrowthPercent, '%'),
			check('Long session: event listener growth', growth(first.listeners, last.listeners), LIMITS.listenerGrowthPercent, '%'),
			check('Long session: page errors', overlay.errors.length, 0, '')
		];
	} finally {
		await overlay.close();
	}
}

/* ---------- run ---------- */

const SCENARIOS = {
	startup,
	'speed-8': speedScenario(8),
	'speed-15': speedScenario(15),
	'speed-50': speedScenario(50),
	'mixed-16': mixedSpeedScenario(16),
	'mixed-60': mixedSpeedScenario(60),
	'events-16': eventsScenario(16),
	'rows-ramp': rowsScenario('ramp 2→6→16→5→1 msg/s', [
		[2, 3],
		[6, 3],
		[16, 3],
		[5, 3],
		[1, 3]
	]),
	'rows-flip': rowsScenario('switching 14 ↔ 6 msg/s', [
		[14, 2],
		[6, 2],
		[14, 2],
		[6, 2],
		[14, 2],
		[6, 2]
	]),
	'rows-images': rowsScenario(
		'emotes arriving late',
		[
			[4, 2, 'look OMEGALUL and more words here'],
			[16, 3, 'OMEGALUL WIDEPEEPO fast'],
			[3, 3, 'slow again OMEGALUL']
		],
		120
	),
	'rows-mixed': rowsScenario(
		'all 4 platforms, 4→16→8 msg/s',
		[
			[4, 3],
			[16, 3],
			[8, 3]
		],
		0,
		true
	),
	'rows-events': rowsScenario(
		'all 4 platforms with events, 4→16→8 lines/s',
		[
			[4, 3],
			[16, 3],
			[8, 3]
		],
		0,
		true,
		4
	),
	moderation,
	reconnects,
	'long-session': longSession
};

/** One scenario; one that throws counts as a miss, with the error as its note. */
async function attempt(name, run, browser, origin, meta) {
	try {
		return await run(browser, origin, meta);
	} catch (error) {
		return [{ ...check(`${name}: ran to the end`, 1, 0, ''), note: String(error).split('\n')[0] }];
	}
}

async function main() {
	const only = process.argv.slice(2);
	const unknown = only.filter((name) => !(name in SCENARIOS));
	if (unknown.length) throw new Error(`No such scenario: ${unknown.join(', ')} (have: ${Object.keys(SCENARIOS).join(', ')})`);
	const { origin, stop } = await startServer();
	const browser = await chromium.launch({
		/* Belt and braces: nothing leaves this machine even if a fake is missed. */
		args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
	});
	const chromiumVersion = browser.version();
	/** @type {Array<Check & { scenario: string, retried?: boolean, note?: string }>} */
	const all = [];
	const meta = {};
	try {
		for (const [name, run] of Object.entries(SCENARIOS)) {
			if (only.length && !only.includes(name)) continue;
			let checks = await attempt(name, run, browser, origin, meta);
			let retried = false;
			if (checks.some((c) => !c.pass)) {
				console.log(`${name}: missed a limit, running it once more`);
				for (const c of checks) if (!c.pass) console.log(`  first run: ${c.name} = ${c.value}${c.unit} (limit ${c.limit}${c.unit})${c.note ? ` [${c.note}]` : ''}`);
				checks = await attempt(name, run, browser, origin, meta);
				retried = true;
			}
			for (const c of checks) all.push({ ...c, scenario: name, retried });
			for (const c of checks) console.log(`${c.pass ? 'ok  ' : 'MISS'} ${c.name}: ${c.value}${c.unit} (limit ${c.limit}${c.unit})${c.note ? ` [${c.note}]` : ''}`);
		}
	} finally {
		await browser.close();
		stop();
	}
	const failed = all.filter((c) => !c.pass);
	const table = [
		'## Overlay speed checks',
		'',
		`Chromium ${chromiumVersion}, ${VIEWPORT.width}×${VIEWPORT.height}, \`/multichat?${QUERY}\`` + (meta.scripts ? `, ${meta.scripts} script files` : ''),
		'',
		'| | Check | Measured | Limit |',
		'|---|---|---:|---:|',
		...all.map((c) => `| ${c.pass ? '✅' : '❌'} | ${c.name}${c.retried ? ' (second run)' : ''}${c.note ? ` — ${c.note}` : ''} | ${c.value} ${c.unit} | ${c.limit} ${c.unit} |`),
		''
	].join('\n');
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
	console.log(failed.length ? `\n${failed.length} check(s) over the limit.` : `\nAll ${all.length} checks within limits.`);
	process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
