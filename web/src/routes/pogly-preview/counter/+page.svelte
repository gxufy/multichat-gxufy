<script lang="ts">
	/* /pogly-preview/counter: the FlossCounter preview the site shows (the
	   generator's starting settings, the same rotation of sample counts and
	   the same page rules as its preview frame), for embedding as the Pogly
	   widget's preview. */
	import '#lib/styles/reset.css';
	import { counterTool } from '@/features/counter/config';
	import { SAMPLE_COUNTER_COUNTS, sampleCounterStatuses } from '@/features/counter/samples';
	import type { ToolChannels } from '@/features/registry';
	import type { ViewerPlatform } from '@/lib/viewerCounterConfig';
	import { COUNTER_PAGE_CSS } from '@/lib/viewerCounterView';
	import ViewersPreviewView from '#lib/generator/frames/ViewersPreviewView.svelte';
	import { createCounterPreviewFeed } from '#lib/generator/previewFeeds.svelte.ts';
	import SiteIcons from '#lib/site/SiteIcons.svelte';

	const query = counterTool.serialize({} as ToolChannels<ViewerPlatform>, counterTool.defaults);

	/* The fixed sample counts until the rotation's first step. */
	const rotation = createCounterPreviewFeed();
	const firstStatuses = sampleCounterStatuses({ ...SAMPLE_COUNTER_COUNTS });
	const statuses = $derived(rotation.statuses ?? firstStatuses);
</script>

<SiteIcons />

<svelte:head>
	<title>FlossCounter Preview</title>
	<meta name="robots" content="noindex,nofollow" />
	{@html `<style>${COUNTER_PAGE_CSS}</style>`}
</svelte:head>

<ViewersPreviewView {query} {statuses} />
