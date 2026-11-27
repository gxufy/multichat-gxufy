<script lang="ts">
	import { ownerPost, type Phase } from './ownerRequest.ts';

	let phase = $state<Phase>('idle');
	let message = $state('');

	async function click() {
		if (phase === 'sending') return;
		phase = 'sending';
		const result = await ownerPost('/api/overlay/refresh');
		if (result.ok) {
			phase = 'sent';
			message = 'Sent. Every open overlay is reloading now.';
		} else {
			phase = 'error';
			message = result.error;
		}
	}
</script>

<div class="fc-owner-tool">
	<h3>All overlays</h3>
	<p class="fc-fine">Reloads every FlossChat chat overlay and FlossCounter that is open anywhere, right away, so they pick up the latest release.</p>
	<button type="button" class="fc-owner-button" onclick={() => void click()} disabled={phase === 'sending'}>
		{phase === 'sending' ? 'Sending…' : 'Refresh all overlays'}
	</button>
	{#if message}<p class="fc-fine" role="status">{message}</p>{/if}
</div>
