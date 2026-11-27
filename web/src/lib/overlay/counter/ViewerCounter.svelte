<script lang="ts">
	/*
	 * The viewer counter. What to draw comes from the shared viewerCounterView.
	 * Presentation only: no fetching or polling.
	 */
	import type { PlatformStatuses, ViewerCounterStyle } from '@/lib/viewerCounterConfig';
	import {
		COUNTER_ICON_IMAGES,
		COUNTER_ICON_IMAGE_STYLE,
		COUNTER_KICK_ICON,
		COUNTER_UNAVAILABLE_MARK,
		viewerCounterView
	} from '@/lib/viewerCounterView';
	import { cssText } from '#lib/site/cssText.ts';
	import RollingCount from './RollingCount.svelte';

	let { statuses, style }: { statuses: PlatformStatuses; style: ViewerCounterStyle } = $props();

	const view = $derived(viewerCounterView(statuses, style));
	const pill = $derived(cssText(view.pill));
	const iconBox = $derived(cssText(view.iconBox));
	const number = $derived(cssText(view.number));
	const kickStyle = cssText(COUNTER_KICK_ICON.style);
	const imageStyle = cssText(COUNTER_ICON_IMAGE_STYLE);
</script>

<!-- The validated CSS, then the row. No whitespace between elements. -->
{@html `<style>${view.css}</style>`}<div style={cssText(view.row)}
	>{#each view.pills as entry (entry.key)}<div style={pill}
			>{#each entry.icons as platform (platform)}<span style={iconBox}
					>{#if platform === 'kick'}<svg
							viewBox={COUNTER_KICK_ICON.viewBox}
							fill={COUNTER_KICK_ICON.fill}
							style={kickStyle}><path d={COUNTER_KICK_ICON.path} /></svg
						>{:else}<img
							src={COUNTER_ICON_IMAGES[platform]}
							alt=""
							draggable="false"
							style={imageStyle}
						/>{/if}</span
				>{/each}{#if entry.count !== null}<RollingCount value={entry.count} style={number} />{:else}<span
					style={number}>{COUNTER_UNAVAILABLE_MARK}</span
				>{/if}</div
		>{/each}</div
>
