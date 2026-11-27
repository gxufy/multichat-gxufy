<script lang="ts">
	/*
	 * Sticky section bar for the generator. Plain in-page anchors; JavaScript adds the "you are
	 * here" highlight and the sliding pill. Badges/Support appear when the page
	 * passes their handlers.
	 */
	import { GENERATOR_SECTIONS, currentSection } from '@/components/classic/sectionNav';

	let { onSupport, onBadges }: { onSupport?: () => void; onBadges?: () => void } = $props();

	const SECTION_IDS = GENERATOR_SECTIONS.map((section) => section.id);

	let active = $state<string>(SECTION_IDS[0] ?? '');
	/* A clicked link stays highlighted until the reader scrolls on their own. */
	let pinned: string | null = null;
	let list: HTMLUListElement | undefined = $state();
	let indicator = $state<{ left: number; width: number } | null>(null);
	const hasSupport = $derived(Boolean(onSupport) || Boolean(onBadges));

	$effect(() => {
		let frame = 0;
		const update = () => {
			frame = 0;
			if (pinned) return;
			const root = document.documentElement;
			active = currentSection(
				SECTION_IDS,
				(id) => document.getElementById(id)?.getBoundingClientRect().top,
				window.innerHeight,
				window.innerHeight + window.scrollY >= root.scrollHeight - 2
			);
		};
		const onScroll = () => {
			if (!frame) frame = window.requestAnimationFrame(update);
		};
		const release = () => {
			pinned = null;
		};
		update();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		window.addEventListener('wheel', release, { passive: true });
		window.addEventListener('touchstart', release, { passive: true });
		window.addEventListener('keydown', release);
		return () => {
			if (frame) window.cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			window.removeEventListener('wheel', release);
			window.removeEventListener('touchstart', release);
			window.removeEventListener('keydown', release);
		};
	});

	function choose(id: string) {
		pinned = id;
		active = id;
	}

	function activeItem(): HTMLElement | null | undefined {
		return list?.querySelector<HTMLElement>('a.is-active')?.closest('li');
	}

	/* Slide the pill under the current link; on a phone keep it centred in the
	   sideways-scrolling strip. Offsets are relative to the <ul>. */
	$effect(() => {
		void active;
		void hasSupport;
		const item = activeItem();
		if (!list || !item) return;
		indicator = { left: item.offsetLeft, width: item.offsetWidth };
		if (list.scrollWidth > list.clientWidth) {
			list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
		}
	});

	$effect(() => {
		const remeasure = () => {
			const item = activeItem();
			if (item) indicator = { left: item.offsetLeft, width: item.offsetWidth };
		};
		window.addEventListener('resize', remeasure);
		/* Web fonts change link widths after first paint. */
		void document.fonts?.ready.then(remeasure);
		return () => window.removeEventListener('resize', remeasure);
	});
</script>

<nav class="section-nav" aria-label="Generator sections" data-indicator={indicator ? 'on' : undefined}>
	<ul bind:this={list}>
		{#if indicator}
			<li
				class="section-nav-indicator"
				aria-hidden="true"
				style:transform={`translateX(${indicator.left}px)`}
				style:width={`${indicator.width}px`}
			></li>
		{/if}
		{#each GENERATOR_SECTIONS as section (section.id)}
			<li>
				<a
					href={`#${section.id}`}
					class={section.id === active ? 'is-active' : undefined}
					aria-current={section.id === active ? 'location' : undefined}
					onclick={() => choose(section.id)}>{section.label}</a
				>
			</li>
		{/each}
		{#if onBadges}
			<li>
				<button type="button" class="section-nav-badges" aria-haspopup="dialog" onclick={onBadges}>Badges</button>
			</li>
		{/if}
		{#if onSupport}
			<li>
				<button type="button" class="section-nav-support" aria-haspopup="dialog" onclick={onSupport}>Support</button>
			</li>
		{/if}
	</ul>
</nav>
