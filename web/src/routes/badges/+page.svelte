<script lang="ts">
	import '#lib/styles/reset.css';
	import BadgesDashboard from '#lib/badges/BadgesDashboard.svelte';
	import GoogleFonts from '#lib/site/GoogleFonts.svelte';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
	import { UI_FONT_SPECS } from '@/lib/overlayFonts';
</script>

<SiteIcons />

<svelte:head>
	<title>Your badges | FlossChat</title>
	<meta name="robots" content="noindex,nofollow,noarchive" />
</svelte:head>

<GoogleFonts specs={Object.values(UI_FONT_SPECS)} />

<BadgesDashboard />

<style>
	:global(html),
	:global(body) {
		margin: 0;
		background: #141418;
	}
</style>
