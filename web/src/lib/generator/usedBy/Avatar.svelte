<script lang="ts">
	/* A dark circle with the Twitch mark until the current profile picture
	   arrives; the picture then fades in over it. */
	import { playIcon } from './icons.ts';

	let { src, playable = false }: { src?: string; playable?: boolean } = $props();
	let broken = $state(false);
</script>

<span class="used-by-avatar" aria-hidden="true"
	><img class="used-by-avatar-mark" src="/platform-twitch.png" alt="" width="14" height="14" />{#if src && !broken}<img
			class="used-by-avatar-photo"
			{src}
			alt=""
			width="24"
			height="24"
			referrerpolicy="no-referrer"
			onerror={() => (broken = true)}
		/>{/if}{#if playable}<span class="used-by-avatar-play">{@html playIcon(10)}</span>{/if}</span
>
