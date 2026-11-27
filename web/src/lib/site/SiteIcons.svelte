<script lang="ts">
	/*
	 * The tags every page gets: the site name and
	 * the browser-tab icon. gxufy.com's homepage keeps the Gxufy avatar; every
	 * FlossChat page shows the FlossChat logo.
	 */
	let { gxufy = false }: { gxufy?: boolean } = $props();

	const icon = $derived(
		gxufy
			? { href: '/gxufy-avatar.gif', type: 'image/gif' }
			: { href: '/flosschat-icon.png', type: 'image/png' }
	);
</script>

<svelte:head>
	<meta name="application-name" content="Gxufy 🕊️" />
	<meta property="og:site_name" content="Gxufy 🕊️" />
	<link rel="icon" type={icon.type} href={icon.href} />
	<link rel="shortcut icon" type={icon.type} href={icon.href} />
	<link rel="apple-touch-icon" href={icon.href} />
</svelte:head>
