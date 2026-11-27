<script lang="ts">
	/*
	 * A single new row entering from the left or right: the Motion engine
	 * (motion = framer-motion/dom) and its spring, on two wrappers, starting
	 * from the inline styles Framer Motion renders first.
	 */
	import { onMount, untrack } from 'svelte';
	import { animate } from 'motion';
	import type { ChatPart } from '@/lib/render/elementTree';
	import {
		MESSAGE_ENTRY_SPRING,
		messageEntryInitialState,
		type DirectionalMessageEntry
	} from '@/lib/messageEntryAnimation';
	import { chatParts } from './parts.ts';

	let {
		direction,
		ownsOpacity,
		parts
	}: { direction: DirectionalMessageEntry; ownsOpacity: boolean; parts: readonly ChatPart[] } = $props();

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
	/* An entrance happens once, as the row appears: read the props once. */
	const { initial, owns } = untrack(() => ({
		initial: messageEntryInitialState(direction, ownsOpacity),
		owns: ownsOpacity
	}));

	/* What Framer Motion writes first: the initial values when the entrance
	   animates, the targets straight away when it does not. */
	const outerStyle = `width: 100%; min-width: 0px;${owns ? ` opacity: ${reduceMotion ? 1 : 0};` : ''}`;
	const innerStyle = `width: 100%; min-width: 0px; transform: ${reduceMotion ? 'none' : `translateX(${initial.x})`};`;

	let outer: HTMLDivElement;
	let inner: HTMLDivElement;

	onMount(() => {
		if (reduceMotion) return;
		const spring = { ...MESSAGE_ENTRY_SPRING };
		const running = [animate(inner, { x: [initial.x, 0] }, spring)];
		if (owns) running.push(animate(outer, { opacity: [0, 1] }, spring));
		return () => running.forEach((animation) => animation.stop());
	});
</script>

<div
	bind:this={outer}
	class="gx-message-entry"
	data-entry-animation={direction}
	style={outerStyle}
	><div bind:this={inner} data-entry-motion-x="true" style={innerStyle} use:chatParts={parts}></div></div
>
