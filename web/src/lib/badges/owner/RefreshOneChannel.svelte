<script lang="ts">
	import { OWNER_REFRESH_PLATFORMS } from '@/lib/badgesPage';
	import { ownerPost, type Phase } from './ownerRequest.ts';

	let platform = $state('any');
	let channel = $state('');
	let phase = $state<Phase>('idle');
	let message = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = channel.trim().replace(/^[@#]/, '');
		if (!name) {
			phase = 'error';
			message = 'Enter a channel name first.';
			return;
		}
		phase = 'sending';
		const result = await ownerPost('/api/overlay/refresh', { platform, channel: name });
		if (result.ok) {
			const where = OWNER_REFRESH_PLATFORMS.find((option) => option.value === platform);
			phase = 'sent';
			message = `Sent. Overlays showing ${name}${platform === 'any' ? '' : ` on ${where?.label ?? platform}`} are reloading now.`;
		} else {
			phase = 'error';
			message = result.error;
		}
	}
</script>

<form class="fc-owner-tool" onsubmit={(event) => void submit(event)}>
	<h3>One channel</h3>
	<p class="fc-fine">Reloads only the chat overlays and FlossCounters showing this channel.</p>
	<div class="fc-owner-row">
		<select aria-label="Platform" bind:value={platform}>
			{#each OWNER_REFRESH_PLATFORMS as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
		<input
			aria-label="Channel name"
			placeholder="Channel name"
			value={channel}
			maxlength={80}
			autocomplete="off"
			spellcheck={false}
			oninput={(event) => {
				channel = event.currentTarget.value;
				if (phase === 'error') phase = 'idle';
			}}
		/>
		<button type="submit" class="fc-owner-button" disabled={phase === 'sending'}>
			{phase === 'sending' ? 'Sending…' : 'Refresh this channel'}
		</button>
	</div>
	{#if message && phase !== 'idle'}<p class="fc-fine" role="status">{message}</p>{/if}
</form>
