<script lang="ts">
	/*
	 * FlossCounter preview: the statuses to show, sample or polled, drawn by the
	 * production viewer-count renderer through the bridge frame.
	 */
	import type { PlatformStatuses } from '@/lib/viewerCounterConfig';
	import BridgeFrame from './BridgeFrame.svelte';

	let {
		query,
		statuses,
		width,
		height,
		live = false,
		overlayUrl
	}: {
		query: string;
		statuses: PlatformStatuses;
		width: number;
		height: number;
		/** Live counts for the configured channels, rather than samples. */
		live?: boolean;
		/** The generated FlossCounter URL (live mode), for tests and tooling. */
		overlayUrl?: string;
	} = $props();
</script>

{#if live}
	<div
		role="group"
		aria-label="Live FlossCounter preview"
		data-testid="counter-live-preview"
		data-overlay-url={overlayUrl}
		data-preview-height={String(height)}
	>
		<BridgeFrame
			kind="viewers"
			title="Live FlossCounter preview"
			{width}
			{height}
			testId="counter-live-preview-frame"
			payloads={[
				() => ({ type: 'flosschat-preview:viewers', query }),
				() => ({ type: 'flosschat-preview:viewers', statuses })
			]}
		/>
	</div>
{:else}
	<div role="group" aria-label="Preview data — sample viewer counts, not live numbers" data-testid="counter-fixture-preview">
		<BridgeFrame
			kind="viewers"
			title="FlossCounter sample preview"
			{width}
			{height}
			testId="counter-preview-frame"
			payloads={[
				() => ({ type: 'flosschat-preview:viewers', query }),
				() => ({ type: 'flosschat-preview:viewers', statuses })
			]}
		/>
	</div>
{/if}
