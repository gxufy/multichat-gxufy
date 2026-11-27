<script lang="ts">
	/*
	 * Slide: a new batch is first drawn hidden to measure its height (waiting up
	 * to SLIDE_IMAGE_WAIT_MS for images not loaded yet), then drawn in place at
	 * its full height while the chat's track (slideTrack.ts) glides the rows
	 * above up into the space. From then on its element stays (display:
	 * contents), so the rows never re-parent. If its rows change size before
	 * the move ends (a 7TV emote that loads a few pixels taller), the change
	 * glides too instead of jumping. A batch that is removed while it moves
	 * takes its remaining distance with it.
	 */
	import type { Snippet } from 'svelte';
	import { getContext, untrack } from 'svelte';
	import { SLIDE_IMAGE_WAIT_MS } from '@/lib/chatRenderBatches';
	import { SLIDE_TRACK, type SlideMove, type SlideTrack } from './slideTrack.ts';

	let {
		batchId,
		preserveChildren = false,
		children
	}: { batchId: number; preserveChildren?: boolean; children: Snippet } = $props();

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
	const track = getContext<SlideTrack | undefined>(SLIDE_TRACK);

	let measuredHeight = $state<number | null>(null);
	/* Shown without a slide: reduced motion, or nothing to measure. */
	let plain = $state(false);
	let measure = $state<HTMLDivElement>();
	let live = $state<HTMLDivElement>();

	/* Measure the hidden copy once its images have loaded (or the wait ran out). */
	$effect(() => {
		const element = measure;
		if (!element || untrack(() => plain || measuredHeight !== null)) return;
		if (reduceMotion) {
			plain = true;
			return;
		}
		const takeMeasurement = () => {
			const measured = element.getBoundingClientRect().height || element.scrollHeight;
			if (measured <= 0) plain = true;
			else measuredHeight = measured;
		};
		const pending = Array.from(element.querySelectorAll('img')).filter(
			(img) => img.getAttribute('src') && !img.complete
		);
		if (!pending.length) {
			takeMeasurement();
			return;
		}
		let finished = false;
		let remaining = pending.length;
		const finish = () => {
			if (finished) return;
			finished = true;
			window.clearTimeout(timer);
			takeMeasurement();
		};
		const timer = window.setTimeout(finish, SLIDE_IMAGE_WAIT_MS);
		const settleOne = () => {
			remaining -= 1;
			if (remaining <= 0) finish();
		};
		for (const img of pending) {
			img.addEventListener('load', settleOne, { once: true });
			img.addEventListener('error', settleOne, { once: true });
		}
		return () => {
			finished = true;
			window.clearTimeout(timer);
			for (const img of pending) {
				img.removeEventListener('load', settleOne);
				img.removeEventListener('error', settleOne);
			}
		};
	});

	/* Drawn at full height: glide the rows above up by it, and keep following
	   while its rows change size before the move ends. */
	$effect(() => {
		const element = live;
		if (!element || !track) return;
		const rows = Array.from(element.children);
		if (!rows.length) return;
		const heightOf = () =>
			rows[rows.length - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top;
		/* The hidden copy's height: reading the new rows now would lay the page
		   out an extra time. If the drawn rows differ, the first resize report
		   (before this frame is painted) adds the difference. */
		let drawn = untrack(() => measuredHeight) ?? heightOf();
		const moves: SlideMove[] = [untrack(() => track.push(drawn))];
		let moving = true;
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(() => {
						if (!moving) return;
						const now = heightOf();
						if (Math.abs(now - drawn) <= 0.5) return;
						moves.push(track.push(now - drawn));
						drawn = now;
					});
		for (const row of rows) observer?.observe(row, { box: 'border-box' });
		void moves[0].done.then(() => {
			moving = false;
			observer?.disconnect();
		});
		return () => {
			moving = false;
			observer?.disconnect();
			for (const move of moves) move.cancel();
		};
	});

	/* Settled: the wrapper's height is auto, its box gone (display: contents),
	   written in the order Framer Motion leaves them. */
	const SETTLED_STYLE = 'height: auto; display: contents;';
</script>

{#if measuredHeight === null && plain}{@render children()}{:else if measuredHeight === null}<div
		class="gx-slide-group"
		data-render-batch-id={batchId}
		data-slide-phase="measure"
		style="height: 0px; overflow: hidden;"
		><div bind:this={measure} class="gx-slide-measure" data-slide-ghost="true" aria-hidden="true">{@render children()}</div
		></div
	>{:else}<div
		bind:this={live}
		class={preserveChildren ? 'gx-slide-directional-settled' : 'gx-slide-settled'}
		data-render-batch-id={batchId}
		data-slide-phase="settled"
		data-slide-live="true"
		style={SETTLED_STYLE}
		>{@render children()}</div
	>{/if}
