<script lang="ts">
	/*
	 * One clip in the carousel. The ones beside
	 * the centre play their small silent copy; the centre one also plays the
	 * clip with sound on top, which fades in once it is running.
	 */
	import { usedByAssetPath, type UsedByStreamer } from '@/features/usedBy';
	import Avatar from './Avatar.svelte';
	import { playIcon, togglePlayback, type SoundRef } from './icons.ts';

	let {
		streamer,
		avatar,
		offset,
		sound,
		onPick,
		onClip
	}: {
		streamer: UsedByStreamer;
		avatar?: string;
		offset: number;
		sound: SoundRef;
		onPick: () => void;
		onClip: (clip: HTMLVideoElement | null) => void;
	} = $props();

	const near = $derived(Math.abs(offset) <= 1);
	const centre = $derived(offset === 0);
	let tile: HTMLVideoElement | undefined = $state();
	let clip: HTMLVideoElement | undefined = $state();
	let clipReady = $state(false);
	let paused = $state(false);

	$effect(() => {
		void near;
		const node = tile;
		if (!node) return;
		node.muted = true;
		node.defaultMuted = true;
		node.play()?.catch(() => undefined);
		return () => node.pause();
	});

	$effect.pre(() => {
		if (!centre) {
			clipReady = false;
			paused = false;
		}
	});

	$effect(() => {
		if (!centre) return;
		const node = clip;
		if (!node) return;
		node.volume = sound.current.volume;
		node.muted = sound.current.muted;
		onClip(node);
		node.play()?.catch(() => {
			if (clip !== node || node.muted) return;
			node.muted = true;
			node.dispatchEvent(new Event('volumechange'));
			node.play()?.catch(() => undefined);
		});
		return () => {
			node.pause();
			onClip(null);
		};
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="used-by-slide"
	data-offset={offset}
	data-centre={centre ? 'true' : undefined}
	style:--offset={offset}
	aria-hidden={near ? undefined : true}
	onclick={centre ? undefined : onPick}
>
	<!-- svelte-ignore a11y_media_has_caption -->
	{#if near}<video
			bind:this={tile}
			class="used-by-slide-tile"
			src={usedByAssetPath(streamer.login, 'tile')}
			poster={usedByAssetPath(streamer.login, 'poster')}
			muted
			loop
			playsinline
			preload="auto"
			aria-hidden="true"
			tabindex={-1}
			disablepictureinpicture
		></video>{:else}<img
			class="used-by-slide-tile"
			src={usedByAssetPath(streamer.login, 'poster')}
			alt=""
			loading="lazy"
		/>{/if}{#if centre}<!-- svelte-ignore a11y_media_has_caption --><video
			bind:this={clip}
			class="used-by-slide-clip"
			data-ready={clipReady ? 'true' : undefined}
			src={usedByAssetPath(streamer.login, 'clip')}
			poster={usedByAssetPath(streamer.login, 'poster')}
			playsinline
			loop
			preload="auto"
			disablepictureinpicture
			aria-label={`${streamer.name}'s stream with FlossChat`}
			onplaying={() => (clipReady = true)}
			onplay={() => (paused = false)}
			onpause={() => (paused = true)}
			onclick={(event) => togglePlayback(event.currentTarget)}
		></video>{/if}{#if centre && paused}<span class="used-by-slide-paused" aria-hidden="true"
			>{@html playIcon(28)}</span
		>{/if}{#if !centre && near}<button
			type="button"
			class="used-by-slide-pick"
			onclick={onPick}
			aria-label={`Play ${streamer.name}'s clip`}
			><span class="used-by-tile-name"><Avatar src={avatar} />{streamer.name}</span></button
		>{/if}
</div>
