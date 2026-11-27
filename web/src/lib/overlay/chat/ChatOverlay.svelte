<script lang="ts">
	/*
	 * The chat overlay. Everything it draws comes from
	 * shared code: the settings' meaning and the stylesheet (chatOverlayView),
	 * the render batches (chatRenderBatches), the row shell (chatRowShell) and
	 * the rows themselves (render/chatRows, drawn by render/domParts). This file
	 * arranges them: head styles, startup card, container, batches with their
	 * Slide / Fade entrances, rows. Under Slide the batches sit in one track,
	 * which does the moving (slideTrack.ts).
	 */
	import { setContext } from 'svelte';
	import type { ParsedMessage } from '@/lib/kick';
	import type { MultichatConfig } from '@/lib/multichatConfig';
	import type { SourceTagMode } from '@/lib/renderCore';
	import type { StartupLoaderPhase } from '@/lib/startupLoader';
	import { chatContainerStyle, chatOverlayCss, chatOverlayView } from '@/lib/chatOverlayView';
	import { createRenderBatchTracker } from '@/lib/chatRenderBatches';
	import { ChatStartupLoader } from '@/lib/render/chatRows';
	import { partsToHtml, styleText } from '@/lib/render/elementTree';
	import { setSevenTVEmoteTargetHeight } from '@/lib/sevenTVEmoteSize';
	import MessageRow from './MessageRow.svelte';
	import SlideGroup from './SlideGroup.svelte';
	import { createSlideTrack, SLIDE_TRACK } from './slideTrack.ts';

	let {
		config,
		messages,
		fadingIds,
		loaderPhase,
		sourceTagExplicit = false,
		sourceTagOverride,
		sharedChatEnabled
	}: {
		config: MultichatConfig;
		messages: ParsedMessage[];
		fadingIds: Set<string>;
		loaderPhase: StartupLoaderPhase;
		sourceTagExplicit?: boolean;
		/** The generator's preview always draws its chosen mark (see ChatPreviewView). */
		sourceTagOverride?: SourceTagMode;
		sharedChatEnabled?: boolean;
	} = $props();

	const view = $derived(
		chatOverlayView(config, { sourceTagExplicit, sourceTagOverride, sharedChatEnabled })
	);
	const overlayCss = $derived(chatOverlayCss(view));
	/* Tell the emote renderer how tall emotes are drawn, so it downloads a 7TV
	   file that fits instead of always the largest one. */
	$effect.pre(() => setSevenTVEmoteTargetHeight(view.emoteDrawnPx));

	const tracker = createRenderBatchTracker();
	const batches = $derived(tracker.update(messages));
	const messagesById = $derived(new Map(messages.map((message) => [message.id, message])));
	const rowsOf = (ids: readonly string[]) =>
		ids.map((id) => messagesById.get(id)).filter((message): message is ParsedMessage => Boolean(message));

	const slideTrack = createSlideTrack();
	setContext(SLIDE_TRACK, slideTrack);
</script>

<svelte:head>
	{#if view.fontCss}<link rel="preconnect" href="https://fonts.googleapis.com" /><link
			rel="preconnect"
			href="https://fonts.gstatic.com"
			crossorigin=""
		/>{@html `<style>${view.fontCss}</style>`}{/if}{@html `<style>${overlayCss}</style>`}
</svelte:head>

{#snippet row(message: ParsedMessage, entryAnimation: MultichatConfig['entryAnimation'])}<MessageRow
		msg={message}
		fading={fadingIds.has(message.id)}
		{view}
		{entryAnimation}
		entryOwnsOpacity={config.animation !== 'fade'}
	/>{/snippet}

{#snippet batchList()}{#each batches as batch (batch.id)}{@const entry =
		batch.animate && config.animation === 'slide' && batch.messageIds.length === 1
			? config.entryAnimation
			: 'none'}{#if batch.slide && config.animation === 'slide'}<SlideGroup
			batchId={batch.id}
			preserveChildren={entry === 'slideRight' || entry === 'slideLeft'}
			>{#each rowsOf(batch.messageIds) as message (message.id)}{@render row(message, entry)}{/each}</SlideGroup
		>{:else if batch.animate && config.animation === 'fade'}<div class="gx-fade-group"
			>{#each rowsOf(batch.messageIds) as message (message.id)}{@render row(message, entry)}{/each}</div
		>{:else}<div>{#each rowsOf(batch.messageIds) as message (message.id)}{@render row(message, entry)}{/each}</div
		>{/if}{/each}{/snippet}

<!-- No whitespace between elements: the DOM stays exactly as the snapshots hold it. -->
{#if loaderPhase !== 'hidden'}{@html partsToHtml([ChatStartupLoader({ phase: loaderPhase })])}{/if}<div
	id="chat_container"
	style={styleText(chatContainerStyle(view, false))}
	>{#if config.animation === 'slide'}<div class="gx-slide-track" use:slideTrack.attach>{@render batchList()}</div
		>{:else}{@render batchList()}{/if}</div
>
