<script lang="ts">
	/*
	 * Draws the FlossCounter preview with the viewer counter inside the same
	 * 8 px inset as /counter (its page rules come from the page that uses
	 * this). Used by the preview frame and the Pogly counter preview page.
	 */
	import { parseViewerCounterConfig, type PlatformStatuses } from '@/lib/viewerCounterConfig';
	import { COUNTER_INSET_STYLE } from '@/lib/viewerCounterView';
	import { cssText } from '#lib/site/cssText.ts';
	import ViewerCounter from '#lib/overlay/counter/ViewerCounter.svelte';

	let { query, statuses }: { query: string; statuses: PlatformStatuses } = $props();

	const style = $derived(
		parseViewerCounterConfig(Object.fromEntries(new URLSearchParams(query).entries())).style
	);
</script>

<div style={cssText(COUNTER_INSET_STYLE)}><ViewerCounter {statuses} {style} /></div>
