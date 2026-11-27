<script lang="ts">
	/*
	 * The chat Preview Data frame. The
	 * generator (BridgeFrame) posts the overlay query, the sample messages and
	 * the preview cosmetics; ChatPreviewView draws them. It connects to
	 * nothing and listens only to its parent window on its own origin
	 * (app/src/lib/previewBridge.ts).
	 */
	import { SAMPLE_COSMETICS } from '@/features/multichat/samples';
	import type { MessageCosmetics } from '@/lib/multichatMessageModel';
	import {
		PREVIEW_FRAME_READY,
		fromSameOriginParent,
		isChatPreviewUpdate
	} from '@/lib/previewBridge';
	import type { UnifiedMessage } from '@/lib/types';
	import ChatPreviewView from './ChatPreviewView.svelte';

	/* Null until the generator has said what to draw. Snapshots arrive as
	   plain copies; nothing here changes them, so no deep state. */
	let query = $state<string | null>(null);
	let messages = $state.raw<readonly UnifiedMessage[]>([]);
	let cosmetics = $state.raw<MessageCosmetics>(SAMPLE_COSMETICS);

	$effect(() => {
		const onMessage = (event: MessageEvent) => {
			if (!fromSameOriginParent(event, window) || !isChatPreviewUpdate(event.data)) return;
			const update = event.data;
			if (update.query !== undefined) query = update.query;
			if (update.messages !== undefined) messages = update.messages;
			if (update.cosmetics !== undefined) cosmetics = update.cosmetics;
		};
		window.addEventListener('message', onMessage);
		if (window.parent !== window) {
			window.parent.postMessage({ type: PREVIEW_FRAME_READY, kind: 'chat' }, window.location.origin);
		}
		return () => window.removeEventListener('message', onMessage);
	});
</script>

{#if query !== null}<ChatPreviewView {query} {messages} {cosmetics} />{/if}
