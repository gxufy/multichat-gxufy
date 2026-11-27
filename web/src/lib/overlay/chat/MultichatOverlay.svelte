<script lang="ts">
	/*
	 * /multichat?<channels> — the chat overlay an OBS browser source loads. The
	 * shared engine
	 * (lib/multichatRuntime) does everything — connections, emotes, cosmetics,
	 * moderation, fades, commands, restore — and hands this page what to draw.
	 *
	 * The overlay's styles and startup card are in the server's HTML, so OBS shows the card before any script has run.
	 */
	import { onMount } from 'svelte';
	import type { ParsedMessage } from '@/lib/kick';
	import {
		hasConfiguredMultichatChannel,
		safeParseMultichatConfig,
		type MultichatConfig
	} from '@/lib/multichatConfig';
	import { startMultichatRuntime, type MultichatQuery } from '@/lib/multichatRuntime';
	import type { StartupLoaderPhase } from '@/lib/startupLoader';
	import ChatOverlay from './ChatOverlay.svelte';

	let { query }: { query: MultichatQuery } = $props();

	/* What the server can know: the settings, if the URL names a channel. */
	function initialConfig(): MultichatConfig | null {
		const parsed = safeParseMultichatConfig(query);
		return parsed.success && hasConfiguredMultichatChannel(parsed.data) ? parsed.data : null;
	}
	const startConfig = initialConfig();

	let config = $state.raw<MultichatConfig | null>(startConfig);
	let messages = $state.raw<ParsedMessage[]>([]);
	let sharedChatEnabled = $state(startConfig?.sharedChatEnabled ?? false);
	let fadingIds = $state.raw<Set<string>>(new Set());
	let loaderPhase = $state<StartupLoaderPhase>(startConfig ? 'visible' : 'hidden');
	let error = $state<string | null>(null);

	onMount(
		() =>
			startMultichatRuntime(query, {
				onConfig: (next) => (config = next),
				onLoaderPhase: (phase) => (loaderPhase = phase),
				onMessages: (next) => (messages = next),
				onFadingIds: (ids) => (fadingIds = ids),
				onSharedChat: (enabled) => (sharedChatEnabled = enabled),
				onError: (message) => (error = message)
			}) ?? undefined
	);
</script>

<svelte:head>
	{#if config && !error}<title>FlossChat</title>{/if}
</svelte:head>

<!-- The error screen's classes have no styles (the overlay page loads no utility CSS), so a browser
	source with a wrong channel name stays see-through instead of turning black. -->
{#if error}<div class="flex min-h-screen items-center justify-center bg-black text-white p-8"
		><div class="text-center max-w-md"
			><div class="text-4xl mb-4">⚠️</div><h1 class="text-xl font-bold mb-2">Connection Error</h1><p
				class="text-gray-300"
			>{error}</p></div
		></div
	>{:else if config}<ChatOverlay
		{config}
		{messages}
		{fadingIds}
		{loaderPhase}
		{sharedChatEnabled}
		sourceTagExplicit={query.sourceTag !== undefined}
	/>{/if}
