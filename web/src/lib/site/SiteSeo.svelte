<script lang="ts">
	/*
	 * Search and share tags.
	 */
	const SITE_ORIGIN = 'https://gxufy.com';
	const SITE_NAME = 'Gxufy 🕊️';
	const DEFAULT_IMAGE = `${SITE_ORIGIN}/gxufy-avatar.jpg`;

	/* Only identities that use the exact Gxufy name. */
	const GXUFY_PROFILES = [
		'https://twitch.tv/gxufy',
		'https://youtube.com/@gxufy',
		'https://kick.com/gxufy',
		'https://solo.to/gxufy',
		'https://github.com/gxufy'
	];

	let {
		title,
		description,
		path,
		home = false
	}: { title: string; description: string; path: string; home?: boolean } = $props();

	const canonical = $derived(`${SITE_ORIGIN}${path}`);
	const structuredData = $derived(
		home
			? [
					{
						'@context': 'https://schema.org',
						'@type': 'WebSite',
						'@id': `${SITE_ORIGIN}/#website`,
						url: `${SITE_ORIGIN}/`,
						name: SITE_NAME,
						alternateName: ['Gxufy', 'gxufy.com'],
						description
					},
					{
						'@context': 'https://schema.org',
						'@type': 'Person',
						'@id': `${SITE_ORIGIN}/#gxufy`,
						name: 'Gxufy',
						url: `${SITE_ORIGIN}/`,
						image: DEFAULT_IMAGE,
						sameAs: GXUFY_PROFILES,
						knowsAbout: [
							'OBS overlays',
							'multi-platform livestream chat',
							'Twitch',
							'Kick',
							'YouTube',
							'TikTok',
							'7TV',
							'BetterTTV',
							'FrankerFaceZ'
						]
					}
				]
			: {
					'@context': 'https://schema.org',
					'@type': 'WebPage',
					url: canonical,
					name: title,
					description,
					isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
					about: { '@id': `${SITE_ORIGIN}/#gxufy` }
				}
	);
	/* `<` escaped so the JSON can never close its <script> early. */
	const jsonLd = $derived(JSON.stringify(structuredData).replace(/</g, '\\u003c'));
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta name="author" content="Gxufy" />
	<meta
		name="robots"
		content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
	/>
	<link rel="canonical" href={canonical} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content={DEFAULT_IMAGE} />
	<meta property="og:image:alt" content="Gxufy" />

	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={DEFAULT_IMAGE} />

	{@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>
