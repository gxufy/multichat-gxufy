<script lang="ts">
	/*
	 * Live counts for the configured channels:
	 * polled here every 10 s with the shared pollViewerStatuses, restarted when
	 * the channels change, and drawn by the production renderer.
	 */
	import { untrack } from 'svelte';
	import { counterTool } from '@/features/counter/config';
	import {
		channelPollKey,
		parseViewerCounterConfig,
		type PlatformStatuses
	} from '@/lib/viewerCounterConfig';
	import { LIVE_PREVIEW_POLL_INTERVAL_MS, pollViewerStatuses } from '@/lib/viewerStatusPoll';
	import ViewersPreview from './ViewersPreview.svelte';

	let { url, height }: { url: string; height: number } = $props();

	const parsedUrl = $derived(new URL(url));
	const config = $derived(parseViewerCounterConfig(Object.fromEntries(parsedUrl.searchParams.entries())));
	const pollKey = $derived(channelPollKey(config.channels));
	let statuses = $state.raw<PlatformStatuses>({});

	$effect(() => {
		void pollKey;
		/* Restart on a channel change only, not on a style change. */
		const channels = untrack(() => config.channels);
		let cancelled = false;
		let controller: AbortController | null = null;
		statuses = {};
		const poll = async () => {
			controller?.abort();
			controller = new AbortController();
			const fresh = await pollViewerStatuses(channels, controller);
			if (!cancelled) statuses = fresh;
		};
		void poll();
		const interval = window.setInterval(() => void poll(), LIVE_PREVIEW_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
			controller?.abort();
		};
	});
</script>

<ViewersPreview
	live
	query={parsedUrl.search.slice(1)}
	{statuses}
	width={counterTool.obs.width}
	{height}
	overlayUrl={url}
/>
