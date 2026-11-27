<script lang="ts">
	/*
	 * Draws the chat Preview Data with the chat overlay exactly as the
	 * generator's preview frame does: no startup card, the source mark shown,
	 * and hovering a badge or a 7TV-painted name names it and its site
	 * (clicking opens that page in a new tab). Used by the preview frame and
	 * the Pogly chat preview page.
	 */
	import { untrack } from 'svelte';
	import { chatPreviewConfig, chatPreviewRows, withPreviewPaintPicks } from '@/lib/chatPreviewRows';
	import type { MessageCosmetics } from '@/lib/multichatMessageModel';
	import type { UnifiedMessage } from '@/lib/types';
	import { attachPreviewBadgeLinks, previewHoverFor, previewHoverIndex } from '@/lib/badgeHomepages';
	import ChatOverlay from '#lib/overlay/chat/ChatOverlay.svelte';

	let {
		query,
		messages,
		cosmetics
	}: {
		query: string;
		messages: readonly UnifiedMessage[];
		cosmetics: MessageCosmetics;
	} = $props();

	/* Nothing is ever mid-fade in a static preview. */
	const EMPTY_FADING: Set<string> = new Set();

	const config = $derived(chatPreviewConfig(query));
	const rows = $derived(config ? chatPreviewRows(config, messages, cosmetics) : []);

	const hoverIndex = $derived(previewHoverIndex(messages, withPreviewPaintPicks(messages, cosmetics)));
	$effect(() =>
		attachPreviewBadgeLinks(document, (element, title) =>
			previewHoverFor(element, title, untrack(() => hoverIndex))
		)
	);
</script>

{#if config}<ChatOverlay
		{config}
		messages={rows}
		fadingIds={EMPTY_FADING}
		loaderPhase="hidden"
		sourceTagExplicit
		sourceTagOverride="icon"
	/>{/if}
