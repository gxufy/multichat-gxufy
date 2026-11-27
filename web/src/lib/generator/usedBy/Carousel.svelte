<script lang="ts">
	/*
	 * The clip carousel: the picked clip in
	 * the middle with sound, its neighbours peeking in silently, arrows, swipe,
	 * keyboard (←/→ clips, J/L back/forward 5 s, Esc, K/Space, M), focus kept
	 * inside, page scroll locked.
	 */
	import { USED_BY_STREAMERS } from '@/features/usedBy';
	import { USED_BY_PRODUCTS_LABEL, carouselOffset } from '@/components/classic/usedBy';
	import Avatar from './Avatar.svelte';
	import Player from './Player.svelte';
	import Slide from './Slide.svelte';
	import { portal } from '../portal.ts';
	import {
		CLOSE_ICON,
		NEXT_ICON,
		PREV_ICON,
		SKIP_STEP_S,
		skipBy,
		togglePlayback,
		toggleSound,
		type SoundRef
	} from './icons.ts';

	const SWIPE_PX = 40;

	let {
		index,
		avatars,
		closing,
		sound,
		onChoose,
		onClose
	}: {
		index: number;
		avatars: Record<string, string>;
		closing: boolean;
		sound: SoundRef;
		onChoose: (index: number) => void;
		onClose: () => void;
	} = $props();

	let root: HTMLDivElement | undefined = $state();
	let closeButton: HTMLButtonElement | undefined = $state();
	let names: HTMLDivElement | undefined = $state();
	let swipe: { x: number; y: number } | null = null;
	let clip = $state.raw<HTMLVideoElement | null>(null);
	const count = USED_BY_STREAMERS.length;
	const step = (delta: number) => onChoose((index + delta + count) % count);
	const streamer = $derived(USED_BY_STREAMERS[index]);

	/* On a phone the names scroll sideways: keep the one playing in view. */
	$effect(() => {
		void index;
		const list = names;
		const current = list?.querySelector<HTMLElement>('[aria-current=true]');
		if (!list || !current || list.scrollWidth <= list.clientWidth || typeof list.scrollTo !== 'function') return;
		const still =
			typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		list.scrollTo({
			left: current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2,
			behavior: still ? 'auto' : 'smooth'
		});
	});

	/* A picked clip's button goes away when it moves to the centre: keep focus inside. */
	$effect(() => {
		void index;
		if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
	});

	$effect(() => {
		closeButton?.focus();
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	$effect(() => {
		const current = clip;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const onSlider = target instanceof HTMLInputElement && target.type === 'range';
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key === 'ArrowRight' && !onSlider) {
				step(1);
				return;
			}
			if (event.key === 'ArrowLeft' && !onSlider) {
				step(-1);
				return;
			}
			if (event.key === 'k' || event.key === 'K' || (event.key === ' ' && !target?.closest?.('button, a, input'))) {
				if (!current) return;
				event.preventDefault();
				togglePlayback(current);
				return;
			}
			if (event.key === 'j' || event.key === 'J' || event.key === 'l' || event.key === 'L') {
				if (!current || event.ctrlKey || event.metaKey || event.altKey) return;
				event.preventDefault();
				skipBy(current, event.key.toLowerCase() === 'l' ? SKIP_STEP_S : -SKIP_STEP_S);
				return;
			}
			if (event.key === 'm' || event.key === 'M') {
				if (!current) return;
				toggleSound(current, sound);
				current.dispatchEvent(new Event('volumechange'));
				return;
			}
			if (event.key !== 'Tab') return;
			const focusable = [
				...(root?.querySelectorAll<HTMLElement>('button, a[href], input:not([disabled])') ?? [])
			];
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={root}
	use:portal
	class="used-by-carousel"
	role="dialog"
	aria-modal="true"
	aria-label={USED_BY_PRODUCTS_LABEL}
	tabindex={-1}
	data-state={closing ? 'closing' : 'open'}
	onclick={(event) => {
		/* A click on the blurred site around the carousel closes it. */
		if (event.target === event.currentTarget) onClose();
	}}
>
	<div class="used-by-carousel-panel">
		<div class="used-by-carousel-head">
			<span class="used-by-carousel-title"
				>Featured streamers using <strong class="used-by-product">FlossChat</strong> and <strong
					class="used-by-product">FlossCounter</strong
				></span
			>
			<button bind:this={closeButton} type="button" class="used-by-carousel-close" aria-label="Close" onclick={onClose}
				>{@html CLOSE_ICON}</button
			>
		</div>
		<div
			class="used-by-carousel-stage"
			role="presentation"
			onpointerdown={(event) => {
				/* Dragging the seek or volume bar is not a swipe. */
				const fromPlayer = (event.target as Element | null)?.closest?.('.used-by-player');
				swipe = fromPlayer ? null : { x: event.clientX, y: event.clientY };
			}}
			onpointerup={(event) => {
				const start = swipe;
				swipe = null;
				if (!start) return;
				const dx = event.clientX - start.x;
				const dy = event.clientY - start.y;
				if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
			}}
			onpointercancel={() => (swipe = null)}
		>
			<div class="used-by-carousel-track">
				{#each USED_BY_STREAMERS as item, position (item.login)}
					<Slide
						streamer={item}
						avatar={avatars[item.login]}
						offset={carouselOffset(position, index, count)}
						{sound}
						onPick={() => onChoose(position)}
						onClip={(node) => (clip = node)}
					/>
				{/each}
			</div>
			<Player {clip} {streamer} {sound} />
			<button type="button" class="used-by-carousel-arrow is-prev" aria-label="Previous clip" onclick={() => step(-1)}
				>{@html PREV_ICON}</button
			>
			<button type="button" class="used-by-carousel-arrow is-next" aria-label="Next clip" onclick={() => step(1)}
				>{@html NEXT_ICON}</button
			>
		</div>
		<div bind:this={names} class="used-by-carousel-names" role="group" aria-label="Pick a streamer">
			{#each USED_BY_STREAMERS as item, position (item.login)}
				<button
					type="button"
					class="used-by-carousel-name"
					aria-label={`Show ${item.name}`}
					aria-current={position === index ? 'true' : undefined}
					onclick={() => onChoose(position)}
					><Avatar src={avatars[item.login]} /><span class="used-by-carousel-name-text">{item.name}</span></button
				>
			{/each}
		</div>
	</div>
</div>
