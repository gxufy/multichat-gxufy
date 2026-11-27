<script lang="ts">
	/* /preview-frame/chat: the chat renderer for the generator's Preview Data,
	   in a real overlay document (the same page-wide styles as the overlay).
	   Framed by our own pages only (src/lib/site/securityHeaders.ts). */
	import '#lib/styles/reset.css';
	import '@/styles/chatOverlay.css';
	import ChatPreviewFrame from '#lib/generator/frames/ChatPreviewFrame.svelte';
</script>

<svelte:head>
	<title>FlossChat preview</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ChatPreviewFrame />
