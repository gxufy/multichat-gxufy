<script lang="ts">
	import '#lib/styles/reset.css';
	import SiteIcons from '#lib/site/SiteIcons.svelte';
	import SupportCheckout from '#lib/support/SupportCheckout.svelte';
</script>

<SiteIcons />

<svelte:head>
	<title>Support FlossChat</title>
	<meta name="robots" content="noindex,nofollow,noarchive" />
	<meta name="description" content="Private preview of the Gxufy supporter flow." />
</svelte:head>

<main>
	<SupportCheckout />
</main>

<style>
	:global(html),
	:global(body) {
		min-height: 100%;
		margin: 0;
		background: #0b0b0d;
	}
</style>
