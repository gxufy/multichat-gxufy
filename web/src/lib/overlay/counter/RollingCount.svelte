<script lang="ts">
	/*
	 * A count that eases from the previous value to the next over
	 * COUNTER_ROLL_DURATION_MS.
	 * Only `value` restarts it, so restyling never does. A change while rolling
	 * starts again from the value the last finished roll reached.
	 */
	import { untrack } from 'svelte';
	import { COUNTER_ROLL_DURATION_MS, rollingCountAt } from '@/lib/viewerCounterView';

	let { value, style }: { value: number; style: string | undefined } = $props();

	let shown = $state(untrack(() => value));
	let from = untrack(() => value);

	$effect(() => {
		const to = value;
		const start = from;
		if (start === to) return;
		const began = performance.now();
		let frame = 0;
		const tick = (now: number) => {
			const t = Math.min((now - began) / COUNTER_ROLL_DURATION_MS, 1);
			shown = rollingCountAt(start, to, t);
			if (t < 1) frame = requestAnimationFrame(tick);
			else from = to;
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});
</script>

<span {style}>{shown.toLocaleString()}</span>
