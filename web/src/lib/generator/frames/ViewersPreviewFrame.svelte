<script lang="ts">
	/*
	 * The FlossCounter preview frame.
	 * The generator (BridgeFrame) posts the counter query and the statuses to
	 * draw, sample counts or live counts it polled itself; ViewersPreviewView
	 * draws them, under the same page rules as /counter. It polls nothing and
	 * listens only to its parent window on its own origin
	 * (app/src/lib/previewBridge.ts).
	 */
	import {
		PREVIEW_FRAME_READY,
		fromSameOriginParent,
		isViewersPreviewUpdate
	} from '@/lib/previewBridge';
	import type { PlatformStatuses } from '@/lib/viewerCounterConfig';
	import { COUNTER_INSET_STYLE, COUNTER_PAGE_CSS } from '@/lib/viewerCounterView';
	import { cssText } from '#lib/site/cssText.ts';
	import ViewersPreviewView from './ViewersPreviewView.svelte';

	let query = $state<string | null>(null);
	let statuses = $state.raw<PlatformStatuses>({});

	$effect(() => {
		const onMessage = (event: MessageEvent) => {
			if (!fromSameOriginParent(event, window) || !isViewersPreviewUpdate(event.data)) return;
			const update = event.data;
			if (update.query !== undefined) query = update.query;
			if (update.statuses !== undefined) statuses = update.statuses;
		};
		window.addEventListener('message', onMessage);
		if (window.parent !== window) {
			window.parent.postMessage({ type: PREVIEW_FRAME_READY, kind: 'viewers' }, window.location.origin);
		}
		return () => window.removeEventListener('message', onMessage);
	});
</script>

<svelte:head>{@html `<style>${COUNTER_PAGE_CSS}</style>`}</svelte:head>

{#if query !== null}<ViewersPreviewView {query} {statuses} />{:else}<div
		style={cssText(COUNTER_INSET_STYLE)}
	></div>{/if}
