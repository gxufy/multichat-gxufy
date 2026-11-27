<script lang="ts">
	/* /preview-frame/viewers: the viewer-count renderer for the generator's
	   FlossCounter preview, with the same page rules as /counter. Framed by our
	   own pages only (src/lib/site/securityHeaders.ts). The path avoids the word
	   "counter": content blockers have blocked nested /counter frames. */
	import '#lib/styles/reset.css';
	import ViewersPreviewFrame from '#lib/generator/frames/ViewersPreviewFrame.svelte';
</script>

<svelte:head>
	<title>FlossCounter preview</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ViewersPreviewFrame />
