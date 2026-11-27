<script lang="ts">
	/* /audience: the same counter for embeds, through /api/audience so it does
	   not depend on URL names content blockers tend to block. */
	import '#lib/styles/reset.css';
	import CounterRuntime from '#lib/overlay/counter/CounterRuntime.svelte';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
	import { page } from '$app/state';
</script>

<SiteIcons />

<CounterRuntime serverEndpoint="/api/audience" searchParams={page.url.searchParams} />
