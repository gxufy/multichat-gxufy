<script lang="ts">
	/*
	 * Under the big clip: seek bar, play/pause, back and forward 5 seconds,
	 * sound, time and the streamer's Twitch channel. Everything follows the clip's own events; while the seek
	 * bar is being dragged it follows the drag instead.
	 */
	import { usedByChannelUrl, type UsedByStreamer } from '@/features/usedBy';
	import { formatClipTime } from '@/components/classic/usedBy';
	import {
		EXTERNAL_ICON,
		PAUSE_ICON,
		SKIP_STEP_S,
		playIcon,
		skipBy,
		skipIcon,
		soundIcon,
		togglePlayback,
		toggleSound,
		type SoundRef
	} from './icons.ts';

	let {
		clip,
		streamer,
		sound
	}: { clip: HTMLVideoElement | null; streamer: UsedByStreamer; sound: SoundRef } = $props();

	let time = $state(0);
	let duration = $state(0);
	let paused = $state(false);
	let muted = $state(false);
	let volume = $state(1);
	/* Where the seek bar is being dragged to; null when it is not. */
	let scrub = $state<number | null>(null);

	$effect(() => {
		const node = clip;
		if (!node) return;
		const sync = () => {
			time = node.currentTime || 0;
			duration = Number.isFinite(node.duration) && node.duration > 0 ? node.duration : 0;
			paused = node.paused;
			muted = node.muted;
			volume = node.volume;
		};
		sync();
		let frame = 0;
		const raf = typeof window.requestAnimationFrame === 'function';
		const tick = () => {
			time = node.currentTime || 0;
			frame = window.requestAnimationFrame(tick);
		};
		const start = () => {
			if (!raf) return;
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(tick);
		};
		const stop = () => {
			if (raf) window.cancelAnimationFrame(frame);
		};
		const events = ['loadedmetadata', 'durationchange', 'play', 'pause', 'volumechange', 'seeked', 'timeupdate'];
		for (const name of events) node.addEventListener(name, sync);
		node.addEventListener('playing', start);
		node.addEventListener('pause', stop);
		if (!node.paused) start();
		return () => {
			stop();
			for (const name of events) node.removeEventListener(name, sync);
			node.removeEventListener('playing', start);
			node.removeEventListener('pause', stop);
		};
	});

	function seek(value: number) {
		if (!clip || !Number.isFinite(value)) return;
		clip.currentTime = value;
		time = value;
	}

	function endScrub() {
		if (scrub === null) return;
		scrub = null;
		if (clip) time = clip.currentTime || 0;
	}

	function skip(seconds: number) {
		if (!clip) return;
		skipBy(clip, seconds);
		time = clip.currentTime || 0;
	}

	function changeVolume(value: number) {
		if (!clip || !Number.isFinite(value)) return;
		const level = Math.min(1, Math.max(0, value));
		if (level > 0) clip.volume = level;
		clip.muted = level === 0;
		sound.current = { muted: clip.muted, volume: clip.volume };
		volume = clip.volume;
		muted = clip.muted;
	}

	function onToggleSound() {
		if (!clip) return;
		toggleSound(clip, sound);
		muted = clip.muted;
		volume = clip.volume;
	}

	const shown = $derived(Math.min(scrub ?? time, duration));
	const fill = $derived(duration > 0 ? (shown / duration) * 100 : 0);
	const level = $derived(muted ? 0 : volume);
	/* The browser, not the visitor, turned the sound off. */
	const forced = $derived(muted && !sound.current.muted);
</script>

<div class="used-by-player">
	<input
		type="range"
		class="used-by-range used-by-seek"
		min={0}
		max={duration || 1}
		step="any"
		value={shown}
		disabled={!duration}
		aria-label={`Seek in ${streamer.name}'s clip`}
		aria-valuetext={`${formatClipTime(shown)} of ${formatClipTime(duration)}`}
		style:--fill={`${fill}%`}
		onpointerdown={(event) => (scrub = Number(event.currentTarget.value))}
		oninput={(event) => {
			const value = Number(event.currentTarget.value);
			if (scrub !== null) scrub = value;
			seek(value);
		}}
		onchange={endScrub}
		onpointerup={endScrub}
		onpointercancel={endScrub}
		onblur={endScrub}
		onkeydown={(event) => {
			/* Arrow keys jump 5 seconds, like most players. */
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			event.preventDefault();
			skip(event.key === 'ArrowRight' ? SKIP_STEP_S : -SKIP_STEP_S);
		}}
	/>
	<div class="used-by-player-row has-skip" data-forced={forced ? 'true' : undefined}>
		<button
			type="button"
			class="used-by-control"
			aria-label={paused ? 'Play' : 'Pause'}
			onclick={() => clip && togglePlayback(clip)}>{@html paused ? playIcon() : PAUSE_ICON}</button
		>
		<button
			type="button"
			class="used-by-control used-by-skip"
			aria-label={`Back ${SKIP_STEP_S} seconds`}
			aria-keyshortcuts="J"
			disabled={!duration}
			onclick={() => skip(-SKIP_STEP_S)}>{@html skipIcon(-1)}</button
		>
		<button
			type="button"
			class="used-by-control used-by-skip"
			aria-label={`Forward ${SKIP_STEP_S} seconds`}
			aria-keyshortcuts="L"
			disabled={!duration}
			onclick={() => skip(SKIP_STEP_S)}>{@html skipIcon(1)}</button
		>
		<div class="used-by-volume">
			<button
				type="button"
				class="used-by-control"
				data-forced={forced ? 'true' : undefined}
				aria-label={muted ? 'Turn sound on' : 'Mute'}
				onclick={onToggleSound}>{@html soundIcon(muted)}{forced ? 'Tap for sound' : ''}</button
			>
			<input
				type="range"
				class="used-by-range used-by-volume-range"
				min={0}
				max={1}
				step={0.05}
				value={level}
				aria-label="Volume"
				aria-valuetext={`${Math.round(level * 100)}%`}
				style:--fill={`${level * 100}%`}
				oninput={(event) => changeVolume(Number(event.currentTarget.value))}
			/>
		</div>
		<span class="used-by-time" aria-hidden="true">{formatClipTime(shown)} / {formatClipTime(duration)}</span>
		<a
			class="used-by-twitch"
			href={usedByChannelUrl(streamer.login)}
			target="_blank"
			rel="noreferrer"
			aria-label={`${streamer.name} on Twitch`}
			><img class="used-by-twitch-mark" src="/platform-twitch.png" alt="" width="14" height="14" /><span
				class="used-by-twitch-name">{streamer.name}</span
			><span class="used-by-twitch-on">on Twitch</span>{@html EXTERNAL_ICON}</a
		>
	</div>
</div>
