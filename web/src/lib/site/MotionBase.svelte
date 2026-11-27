<script lang="ts">
	/* The site's shared easing variables and keyframes (components/site/motion.ts). */
	import { MOTION_BASE_CSS } from '@/components/site/motion';
</script>

<svelte:head>
	{@html `<style>${MOTION_BASE_CSS}</style>`}
</svelte:head>
