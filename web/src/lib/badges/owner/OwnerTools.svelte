<script lang="ts">
	import BadgeListSizes from './BadgeListSizes.svelte';
	import GiveBadge from './GiveBadge.svelte';
	import RefreshAllOverlays from './RefreshAllOverlays.svelte';
	import RefreshOneChannel from './RefreshOneChannel.svelte';
	import RunOwnerCommand from './RunOwnerCommand.svelte';
</script>

<section class="fc-card fc-owner" aria-labelledby="fc-owner-title">
	<h2 id="fc-owner-title">Owner tools</h2>
	<RefreshAllOverlays />
	<RefreshOneChannel />
	<RunOwnerCommand />
	<GiveBadge />
	<BadgeListSizes />
</section>
