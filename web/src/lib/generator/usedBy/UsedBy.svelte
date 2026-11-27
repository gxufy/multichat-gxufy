<script lang="ts">
	/*
	 * "Featured streamers" row under the channel boxes. Each pill has the streamer's current Twitch picture
	 * and name; clicking one opens the clip carousel over the page (rendered
	 * straight away inside the click, so its clip may start with sound).
	 */
	import { flushSync } from 'svelte';
	import { fetchTwitchProfile } from '@/lib/twitchProfileClient';
	import { USED_BY_STREAMERS } from '@/features/usedBy';
	import {
		CLOSE_ANIMATION_MS,
		USED_BY_CSS,
		USED_BY_HINT,
		USED_BY_PRODUCTS_LABEL
	} from '@/components/classic/usedBy';
	import Avatar from './Avatar.svelte';
	import Carousel from './Carousel.svelte';
	import { playIcon, type SoundPrefs } from './icons.ts';

	type CarouselState = { index: number; closing: boolean; returnTo: HTMLElement | null };

	let avatars = $state<Record<string, string>>({});
	let carousel = $state.raw<CarouselState | null>(null);
	const sound: { current: SoundPrefs } = { current: { muted: false, volume: 1 } };

	/* Current profile pictures, looked up once the page has settled (the site
	   caches them for an hour). */
	$effect(() => {
		let cancelled = false;
		const timer = window.setTimeout(() => {
			for (const streamer of USED_BY_STREAMERS) {
				void fetchTwitchProfile(streamer.id).then((profile) => {
					const url = profile?.profileImageUrl;
					if (!cancelled && url && avatars[streamer.login] !== url) avatars[streamer.login] = url;
				});
			}
		}, 250);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	});

	function openCarousel(index: number, returnTo: HTMLElement) {
		flushSync(() => {
			carousel = { index, closing: false, returnTo };
		});
	}

	function chooseInCarousel(index: number) {
		if (carousel) carousel = { ...carousel, index };
	}

	function closeCarousel() {
		const state = carousel;
		if (!state || state.closing) return;
		carousel = { ...state, closing: true };
		window.setTimeout(() => {
			carousel = null;
			state.returnTo?.focus({ preventScroll: true });
		}, CLOSE_ANIMATION_MS);
	}
</script>

<div class="used-by" id="used-by">
	{@html `<style>${USED_BY_CSS}</style>`}
	<p class="used-by-head">
		<span class="used-by-title"
			>Featured streamers using <strong class="used-by-product">FlossChat</strong> and <strong
				class="used-by-product">FlossCounter</strong
			></span
		>
	</p>
	<ul class="used-by-row" aria-label={USED_BY_PRODUCTS_LABEL}>
		{#each USED_BY_STREAMERS as streamer, index (streamer.login)}
			<li style:--i={index}>
				<button
					type="button"
					class="used-by-person"
					aria-label={`Watch ${streamer.name}'s clip`}
					aria-haspopup="dialog"
					onclick={(event) => openCarousel(index, event.currentTarget)}
					><Avatar src={avatars[streamer.login]} playable /><span class="used-by-person-name">{streamer.name}</span
					><span class="used-by-person-play" aria-hidden="true">{@html playIcon(10)}</span><span
						class="used-by-tip"
						aria-hidden="true">{USED_BY_HINT}</span
					></button
				>
			</li>
		{/each}
	</ul>
	{#if carousel}
		<Carousel
			index={carousel.index}
			{avatars}
			closing={carousel.closing}
			{sound}
			onChoose={chooseInCarousel}
			onClose={closeCarousel}
		/>
	{/if}
</div>
