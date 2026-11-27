<script lang="ts">
	/*
	 * One chat row: the shared row shell
	 * (fade, moderator-delete collapse, inset) around the shared row content.
	 */
	import type { ParsedMessage } from '@/lib/kick';
	import type { MultichatConfig } from '@/lib/multichatConfig';
	import type { ChatOverlayView } from '@/lib/chatOverlayView';
	import { messageRowInnerStyle, messageRowStyle } from '@/lib/chatRowShell';
	import { MsgLine } from '@/lib/render/chatRows';
	import { styleText } from '@/lib/render/elementTree';
	import { chatParts } from './parts.ts';
	import DirectionalEntry from './DirectionalEntry.svelte';

	let {
		msg,
		fading,
		view,
		entryAnimation,
		entryOwnsOpacity
	}: {
		msg: ParsedMessage;
		fading: boolean;
		view: ChatOverlayView;
		entryAnimation: MultichatConfig['entryAnimation'];
		entryOwnsOpacity: boolean;
	} = $props();

	const deleted = $derived(Boolean(msg.deleted));
	const line = $derived([
		MsgLine({
			msg,
			sz: view.sz,
			emoteMaxH: view.emoteMaxH,
			emoteMaxW: view.emoteMaxW,
			paintEdgeShadow: view.paintEdgeShadow,
			hideNames: view.config.hideNames ?? false,
			tagMode: view.tagMode,
			showAvatar: view.config.showAvatars ?? false,
			showSharedSource: view.showSharedSource,
			replyStyle: view.config.replyStyle
		})
	]);
</script>

<!-- No whitespace between elements: the DOM stays exactly as the snapshots hold it. -->
<div class="gx-message-row" style={styleText(messageRowStyle(msg, fading, view.messageShadowFilter))}
	>{#if entryAnimation === 'none'}<div
			class="gx-message-row-inner"
			aria-hidden={deleted ? 'true' : undefined}
			data-deleted={deleted ? 'true' : undefined}
			style={styleText(messageRowInnerStyle(deleted, msg.category === 'hypetrain'))}
			use:chatParts={line}
		></div>{:else}<div
			class="gx-message-row-inner"
			aria-hidden={deleted ? 'true' : undefined}
			data-deleted={deleted ? 'true' : undefined}
			style={styleText(messageRowInnerStyle(deleted, msg.category === 'hypetrain'))}
			><DirectionalEntry direction={entryAnimation} ownsOpacity={entryOwnsOpacity} parts={line} /></div
		>{/if}</div
>
