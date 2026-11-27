<script lang="ts">
	/*
	 * The gxufy.com homepage. It needs no JavaScript in the browser.
	 */
	import '#lib/styles/reset.css';
	import '#lib/site/home.css';
	import GoogleFonts from '#lib/site/GoogleFonts.svelte';
	import MotionBase from '#lib/site/MotionBase.svelte';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
	import SiteSeo from '#lib/site/SiteSeo.svelte';
	import { UI_FONT_SPECS } from '@/lib/overlayFonts';
	import { CANONICAL_COUNTER_ROUTE, CANONICAL_MULTICHAT_ROUTE } from '@/lib/multichatRouting';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const FOLLOW_HREF = 'https://guns.lol/gxufy';
	const FOLLOW_LABEL = 'Follow @gxufy';

	const TAGS = [
		'multi-platform chat',
		'viewer counters',
		'OBS overlays',
		'7TV · BTTV · FFZ',
		'no OAuth',
		'real-time'
	];

	/* Support is reached from FlossChat (its Support popup), not from here. */
	const SITE_LINKS = [['/multichat', 'FlossChat']] as const;

	const description =
		'Gxufy builds multi-platform stream tools for OBS, including FlossChat and FlossCounter, a live viewer counter for Kick, Twitch, YouTube, and TikTok.';
</script>

<!-- gxufy.com keeps the Gxufy avatar in the browser tab. -->
<SiteIcons gxufy />
<GoogleFonts specs={[UI_FONT_SPECS.montserrat]} />
<MotionBase />

<SiteSeo home title="Gxufy 🕊️" {description} path="/" />

<header class="topbar">
	<div class="topbar-inner">
		<nav class="site-nav" aria-label="Gxufy pages">
			{#each SITE_LINKS as [href, label] (href)}
				<a {href}>{label}</a>
			{/each}
		</nav>
	</div>
</header>

<div class="wrap">
	<div class="hero">
		<img class="hero-avatar" src="/gxufy-avatar.gif" alt="Gxufy" />
		<div class="hero-text">
			<p class="hero-kicker">overlays &amp; stream tools</p>
			<h1>wtw, I&rsquo;m <span>Gxufy</span> 🕊️</h1>
			<p>
				I build tools that make streams smoother — multi-platform chat overlays and widgets that
				just work. No logins, no OAuth, no setup pain.
			</p>
		</div>
	</div>

	<div class="tags">
		{#each TAGS as tag (tag)}
			<span class="tag">{tag}</span>
		{/each}
	</div>

	<div class="cards">
		<a class="card" href={CANONICAL_MULTICHAT_ROUTE}>
			<p class="card-kicker">Free tool</p>
			<div class="card-badges">
				<span class="cb cb-kick">Kick</span>
				<span class="cb cb-tw">Twitch</span>
				<span class="cb cb-yt">YouTube</span>
				<span class="cb cb-tt">TikTok</span>
			</div>
			<h2>FlossChat — one overlay for every chat</h2>
			<p>
				Combine Kick, Twitch, YouTube &amp; TikTok chat into a single OBS browser source. 7TV / BTTV
				/ FFZ emotes, name paints, real platform badges, gifts &amp; Super Chats, plus FlossCounter
				for real-time viewer counts. Works with just a channel name.
			</p>
			<span class="card-cta">Open the generator →</span>
		</a>

		<a class="card" href={CANONICAL_COUNTER_ROUTE}>
			<p class="card-kicker">Free tool</p>
			<div class="card-badges">
				<span class="cb cb-kick">Kick</span>
				<span class="cb cb-tw">Twitch</span>
				<span class="cb cb-yt">YouTube</span>
				<span class="cb cb-tt">TikTok</span>
			</div>
			<h2>FlossCounter — real-time viewer counts</h2>
			<p>
				Create an OBS viewer-count overlay for Kick, Twitch, YouTube &amp; TikTok. Real-time counts
				with offline platforms sliding out, plus Google Fonts, shadows, outlines, icons, and
				transparent output.
			</p>
			<span class="card-cta">Open the generator →</span>
		</a>
	</div>

	<a class="follow-cta" href={FOLLOW_HREF} target="_blank" rel="noreferrer">
		{FOLLOW_LABEL}
	</a>

	<footer>
		<p>
			© {data.year} Gxufy 🕊️ — FlossChat lives at
			<a href={CANONICAL_MULTICHAT_ROUTE}>{CANONICAL_MULTICHAT_ROUTE}</a>
		</p>
		<p>
			For abuse prevention, IP addresses may be logged when repeated server rate limits indicate
			possible abuse.
		</p>
	</footer>
</div>
