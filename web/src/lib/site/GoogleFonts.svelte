<script lang="ts">
	/* Google Fonts as the pages load them: two preconnects, then an
	   @import of the families (app/src/lib/overlayFonts.ts builds the URL). */
	import { googleFontsImportCss } from '@/lib/overlayFonts';

	let { specs }: { specs: readonly string[] } = $props();

	const css = $derived(googleFontsImportCss([...specs]));
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	{@html `<style>${css}</style>`}
</svelte:head>
