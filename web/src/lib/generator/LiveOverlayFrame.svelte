<script lang="ts">
	/*
	 * Live Overlay preview: the generated URL
	 * settles for 350 ms first, so typing a channel name doesn't open a
	 * connection per keystroke. Chat embeds the real overlay at that exact URL;
	 * the counter polls live counts here and draws them (content blockers have
	 * blocked nested /counter frames).
	 */
	import { PREVIEW_DEBOUNCE_MS_VALUE } from './liveOverlay.ts';
	import LiveViewers from './LiveViewers.svelte';

	let {
		url,
		configured,
		title,
		height
	}: { url: string; configured: boolean; title: string; height: number } = $props();

	let settledUrl = $state<string | null>(null);

	$effect(() => {
		const next = configured ? url : null;
		const timeout = setTimeout(() => (settledUrl = next), PREVIEW_DEBOUNCE_MS_VALUE);
		return () => clearTimeout(timeout);
	});

	const isCounter = $derived.by(() => {
		if (!settledUrl) return false;
		try {
			return new URL(settledUrl).pathname === '/counter';
		} catch {
			return false;
		}
	});
</script>

{#if configured && settledUrl !== null}
	{#if isCounter}
		<LiveViewers url={settledUrl} {height} />
	{:else}
		<iframe
			src={settledUrl}
			{title}
			scrolling="no"
			style:display="block"
			style:width="100%"
			style:height={`${height}px`}
			style:border="none"
			style:background="transparent"
			style:overflow="hidden"
		></iframe>
	{/if}
{/if}
