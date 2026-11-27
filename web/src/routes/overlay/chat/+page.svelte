<script lang="ts">
	/* The chat overlay. Reached as /multichat?<channels> (src/hooks.ts reroutes
	   a channel-naming /multichat here); the address stays the same, so every
	   OBS browser source URL keeps working unchanged. */
	import '#lib/styles/reset.css';
	/* The overlay's page-wide rules. */
	import '@/styles/chatOverlay.css';
	import { page } from '$app/state';
	import { parsedQuery } from '#lib/site/query.ts';
	import MultichatOverlay from '#lib/overlay/chat/MultichatOverlay.svelte';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
</script>

<SiteIcons /><MultichatOverlay query={parsedQuery(page.url.searchParams)} />
