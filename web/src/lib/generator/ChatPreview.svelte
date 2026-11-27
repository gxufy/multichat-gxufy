<script lang="ts">
	/*
	 * Preview Data for chat: sample messages
	 * drawn by the production chat renderer, through the bridge frame.
	 */
	import { safeParseMultichatConfig } from '@/lib/multichatConfig';
	import type { MessageCosmetics } from '@/lib/messageCosmetics';
	import type { UnifiedMessage } from '@/lib/types';
	import BridgeFrame from './BridgeFrame.svelte';

	let {
		query,
		messages,
		cosmetics,
		width,
		height,
		scale = 75
	}: {
		query: string;
		messages: readonly UnifiedMessage[];
		cosmetics: MessageCosmetics;
		width: number;
		height: number;
		scale?: number;
	} = $props();

	/* Only false if the serializer emitted something its own parser rejects:
	   a real defect, shown rather than hidden (the URL would not load either). */
	const parses = $derived(
		safeParseMultichatConfig(Object.fromEntries(new URLSearchParams(query).entries())).success
	);
</script>

{#if !parses}
	<p class="preview-empty" role="status">
		These settings did not parse. That is a bug — the generated URL would not load either.
	</p>
{:else}
	<div role="group" aria-label="Preview data — sample chat messages, not a live stream" data-testid="chat-fixture-preview">
		<BridgeFrame
			kind="chat"
			title="FlossChat sample preview"
			{width}
			{height}
			{scale}
			testId="chat-preview-frame"
			payloads={[
				() => ({ type: 'flosschat-preview:chat', query }),
				() => ({ type: 'flosschat-preview:chat', messages }),
				() => ({ type: 'flosschat-preview:chat', cosmetics })
			]}
		/>
	</div>
{/if}
