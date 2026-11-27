<script lang="ts">
	/*
	 * FlossCounter, the viewer-count overlay for an OBS browser source.
	 * Everything that decides anything is in shared code: the query rules (viewerCounterConfig), the
	 * polling engine (counterPolling), what to draw (viewerCounterView), the
	 * owner's refresh and background commands, and usage reporting. This file
	 * only wires them to the page.
	 *
	 * The startup card is in the server's HTML, so it shows before any script
	 * has run.
	 */
	import { untrack } from 'svelte';
	import { parsedQuery } from '#lib/site/query.ts';
	import { cssText } from '#lib/site/cssText.ts';
	import { startCounterPolling, type CounterServerEndpoint } from '@/lib/counterPolling';
	import { COUNTER_STARTUP_LOADER_CSS } from '@/lib/counterStartupLoader';
	import {
		readCounterBackgroundControl,
		subscribeCounterBackgroundControl
	} from '@/lib/multichatControlBus';
	import { startOverlayRefreshWatcher, type OverlayChannel } from '@/lib/overlayRefreshWatcher';
	import { reportCounterOverlayUsage } from '@/lib/overlayUsage';
	import {
		STARTUP_LOADER_FADE_MS,
		STARTUP_LOADER_MAX_MS,
		STARTUP_LOADER_MIN_MS,
		type StartupLoaderPhase
	} from '@/lib/startupLoader';
	import {
		channelPollKey,
		parseChannelPollKey,
		parseViewerCounterConfig,
		type PlatformStatuses
	} from '@/lib/viewerCounterConfig';
	import { COUNTER_INSET_STYLE, COUNTER_PAGE_CSS } from '@/lib/viewerCounterView';
	import CounterStartupLoader from './CounterStartupLoader.svelte';
	import ViewerCounter from './ViewerCounter.svelte';

	let {
		serverEndpoint,
		searchParams
	}: {
		serverEndpoint: CounterServerEndpoint;
		/** The page's query: channels and style. */
		searchParams: Pick<URLSearchParams, 'keys' | 'getAll'>;
	} = $props();

	const config = $derived(parseViewerCounterConfig(parsedQuery(searchParams)));
	/* A primitive that changes only when a channel actually changes, so
	   restyling never restarts polling. */
	const pollKey = $derived(channelPollKey(config.channels));
	const combined = $derived(config.style.combined ?? true);
	const shownChannels = $derived(
		(Object.entries(config.channels) as [OverlayChannel['platform'], string | undefined][])
			.filter((entry): entry is [OverlayChannel['platform'], string] => Boolean(entry[1]))
			.map(([platform, channel]) => ({ platform, channel }))
	);
	const hasChannel = $derived(shownChannels.length > 0);

	let statuses = $state.raw<PlatformStatuses>({});
	let started = $state(false);
	let counterBgOverride = $state<boolean | null>(null);
	/* Up from the first render (server HTML included) when there is a channel. */
	let loaderPhase = $state<StartupLoaderPhase>(untrack(() => (hasChannel ? 'visible' : 'hidden')));
	/** When the startup card appeared (in this browser), and whether it has started to go. */
	let loader: { shownAt: number; leaving: boolean } | null = null;

	const counterStyle = $derived(
		counterBgOverride === null ? config.style : { ...config.style, bg: counterBgOverride }
	);

	/* The owner's "refresh all overlays" / "refresh one channel" reload the
	   counter too; the watcher reads the channels through a getter, so it
	   starts only once. */
	$effect(() =>
		untrack(() =>
			startOverlayRefreshWatcher({
				channels: () => shownChannels,
				onRefresh: () => window.location.reload(),
				/* Owner tools commands that mean something to the counter on its own. */
				onCommand: (text) => {
					const word = text.trim().split(/\s+/)[0]?.toLowerCase();
					if (word === 'reload') window.location.reload();
					else if (word === 'counterbgon') counterBgOverride = true;
					else if (word === 'counterbgoff') counterBgOverride = false;
				}
			})
		)
	);

	/* Usage telemetry, separate from polling so viewer polls never report. */
	$effect(() => {
		const key = pollKey;
		const all = combined;
		if (!key) return;
		untrack(() => reportCounterOverlayUsage(parseChannelPollKey(key), all));
	});

	$effect(() => {
		const channels = parseChannelPollKey(pollKey);
		untrack(() => (counterBgOverride = readCounterBackgroundControl(channels)));
		return subscribeCounterBackgroundControl(channels, (value) => (counterBgOverride = value));
	});

	$effect(() => {
		const channels = parseChannelPollKey(pollKey);
		const endpoint = serverEndpoint;
		return untrack(() => {
			/* A channel change starts over, visibly: the previous channel's
			   numbers would otherwise show under the new channel's name for a
			   whole round trip. */
			if (Object.keys(statuses).length > 0) statuses = {};
			started = false;
			if (Object.keys(channels).length === 0) return;
			return startCounterPolling({
				channels,
				serverEndpoint: endpoint,
				onStatus(platform, status, usable) {
					statuses = { ...statuses, [platform]: status };
					/* Not the unavailable marker merely because the first
					   provider to answer failed while another is still working. */
					if (usable) started = true;
				},
				onCycleSettled: () => (started = true)
			});
		});
	});

	/* The startup card: up while the counter has a channel and no count yet,
	   gone once the first count is on screen, after at least
	   STARTUP_LOADER_MIN_MS so it never just flickers, and by
	   STARTUP_LOADER_MAX_MS whatever happens. Once per page load. */
	$effect(() => {
		if (!hasChannel || loader) return;
		loader = { shownAt: Date.now(), leaving: false };
		untrack(() => (loaderPhase = 'visible'));
	});

	$effect(() => {
		const phase = loaderPhase;
		const isStarted = started;
		const current = loader;
		if (phase !== 'visible' || !current || current.leaving) return;
		const elapsed = Date.now() - current.shownAt;
		const wait = isStarted ? STARTUP_LOADER_MIN_MS - elapsed : STARTUP_LOADER_MAX_MS - elapsed;
		const timer = setTimeout(() => {
			current.leaving = true;
			loaderPhase = 'fading';
		}, Math.max(0, wait));
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (loaderPhase !== 'fading') return;
		const timer = setTimeout(() => (loaderPhase = 'hidden'), STARTUP_LOADER_FADE_MS);
		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<title>FlossCounter</title>
	{@html `<style>${COUNTER_PAGE_CSS}\n${COUNTER_STARTUP_LOADER_CSS}</style>`}
</svelte:head>

<!-- Nothing is drawn until the first poll settles, so no made-up zero ever
     flashes on screen. No whitespace between elements. -->
<CounterStartupLoader phase={loaderPhase} /><div style={cssText(COUNTER_INSET_STYLE)}
	>{#if started}<ViewerCounter
			{statuses}
			style={counterStyle}
		/>{/if}</div
>
