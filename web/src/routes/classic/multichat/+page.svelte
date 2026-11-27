<script lang="ts">
	/* /classic/multichat: the original generator's retired address. The forward runs in the browser, so an
	   OAuth connection in the fragment reaches the generator
	   (app/src/lib/retiredRoutes.ts). */
	import '#lib/styles/reset.css';
	import { onMount } from 'svelte';
	import { CANONICAL_MULTICHAT_ROUTE } from '@/lib/multichatRouting';
	import { classicGeneratorTarget } from '@/lib/retiredRoutes';
	import SiteIcons from '#lib/site/SiteIcons.svelte';

	onMount(() => {
		/* `replace`, so Back returns to wherever the visitor came from and the
		   fragment-bearing address is not left in history. A full load, so the
		   generator comes from whichever app serves it. */
		location.replace(classicGeneratorTarget(location.hash));
	});
</script>

<SiteIcons />

<svelte:head>
	<title>FlossChat</title>
	<!-- A redirect stub, not content. -->
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- Shown so a visitor whose JavaScript has not run yet still has a way on. -->
<p style="padding: 24px; font-family: system-ui, sans-serif">
	The generator has moved. <a href={CANONICAL_MULTICHAT_ROUTE}>Continue</a>.
</p>
