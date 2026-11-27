<script lang="ts">
	/* /counter: FlossCounter for an OBS browser source (Twitch, YouTube and
	   TikTok counts through /api/viewers, Kick from the browser). */
	import '#lib/styles/reset.css';
	import CounterRuntime from '#lib/overlay/counter/CounterRuntime.svelte';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
	import { page } from '$app/state';
</script>

<SiteIcons />

<CounterRuntime serverEndpoint="/api/viewers" searchParams={page.url.searchParams} />
