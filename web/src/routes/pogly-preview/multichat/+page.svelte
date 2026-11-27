<script lang="ts">
	/* /pogly-preview/multichat: the chat preview the site shows (the same
	   identities, live cosmetics and sample feed as the generator's preview,
	   drawn at the same size), for embedding as the Pogly widget's preview.
	   The feed holds while the pointer is over it, as on the site. */
	import '#lib/styles/reset.css';
	import '@/styles/chatOverlay.css';
	import { multichatTool } from '@/features/multichat/config';
	import { POGLY_CHAT_PAGE_CSS } from '@/features/poglyPreview';
	import type { ToolChannels } from '@/features/registry';
	import type { MultichatPlatform } from '@/lib/multichatConfig';
	import ChatPreviewView from '#lib/generator/frames/ChatPreviewView.svelte';
	import { createSampleChatPreview } from '#lib/generator/sampleChatPreview.svelte.ts';
	import SiteIcons from '#lib/site/SiteIcons.svelte';

	/* The generator's own starting settings and no channels. */
	const query = multichatTool.serialize({} as ToolChannels<MultichatPlatform>, multichatTool.defaults);

	/* The generator's preview draws the overlay 1/0.63 larger than its box and
	   scales it back down (ChatPreview's scale 63). */
	const SCALE = 0.63;

	let hovered = $state(false);
	const sample = createSampleChatPreview({ suspended: () => hovered });
</script>

<SiteIcons />

<svelte:head>
	<title>FlossChat Preview</title>
	<meta name="robots" content="noindex,nofollow" />
	{@html `<style>${POGLY_CHAT_PAGE_CSS}</style>`}
</svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	data-testid="pogly-chat-preview"
	style:position="relative"
	style:width="100%"
	style:height="100%"
	style:overflow="hidden"
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
>
	<div
		style:position="absolute"
		style:left="0"
		style:top="0"
		style:width={`${(100 / SCALE).toFixed(4)}%`}
		style:height={`${(100 / SCALE).toFixed(4)}%`}
		style:transform={`scale(${SCALE})`}
		style:transform-origin="0 0"
	>
		<ChatPreviewView {query} messages={sample.messages} cosmetics={sample.cosmetics} />
	</div>
</div>
