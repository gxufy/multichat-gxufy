<script lang="ts">
	import { OWNER_REFRESH_PLATFORMS } from '@/lib/badgesPage';
	import {
		OWNER_COMMAND_MAX_LENGTH,
		OWNER_RUNNABLE_COMMANDS,
		ownerCommandArguments,
		ownerCommandTakesArguments
	} from '@/lib/overlayOwnerCommands';
	import type { MultichatCommand } from '@/lib/multichatCommands';
	import { ownerPost, type Phase } from './ownerRequest.ts';

	let platform = $state('any');
	let channel = $state('');
	let search = $state('');
	let picked = $state<MultichatCommand | null>(null);
	let details = $state('');
	let phase = $state<Phase>('idle');
	let message = $state('');

	const matches = $derived.by(() => {
		const wanted = search.trim().toLowerCase().replace(/^!?(flosschat\s+)?/, '');
		if (!wanted) return OWNER_RUNNABLE_COMMANDS;
		return OWNER_RUNNABLE_COMMANDS.filter(
			(command) =>
				command.name.includes(wanted) ||
				(command.aliases ?? []).some((alias) => alias.includes(wanted)) ||
				command.summary
					.toLowerCase()
					.split(/[^a-z0-9]+/)
					.some((word) => word.startsWith(wanted))
		);
	});

	function fail(text: string) {
		phase = 'error';
		message = text;
	}

	function clearError() {
		if (phase === 'error') phase = 'idle';
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = channel.trim().replace(/^[@#]/, '');
		if (!name) return fail('Enter a channel name first.');
		if (!picked) return fail('Pick a command from the list.');
		const extra = details.trim();
		if (ownerCommandArguments(picked).startsWith('<') && !extra) {
			return fail(`!flosschat ${picked.name} needs ${ownerCommandArguments(picked)}.`);
		}
		const text = `${picked.name}${extra ? ` ${extra}` : ''}`;
		phase = 'sending';
		const result = await ownerPost('/api/overlay/refresh', { platform, channel: name, command: text });
		if (result.ok) {
			const where = OWNER_REFRESH_PLATFORMS.find((option) => option.value === platform);
			phase = 'sent';
			message = `Sent. Overlays showing ${name}${platform === 'any' ? '' : ` on ${where?.label ?? platform}`} are running !flosschat ${text} now.`;
		} else {
			fail(result.error);
		}
	}
</script>

<form class="fc-owner-tool" onsubmit={(event) => void submit(event)}>
	<h3>Run a command</h3>
	<p class="fc-fine">Runs a !flosschat command on the overlays showing this channel, as if the streamer typed it. Nothing is posted in their chat.</p>
	<div class="fc-owner-row">
		<select aria-label="Command platform" bind:value={platform}>
			{#each OWNER_REFRESH_PLATFORMS as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
		<input
			aria-label="Command channel name"
			placeholder="Channel name"
			value={channel}
			maxlength={80}
			autocomplete="off"
			spellcheck={false}
			oninput={(event) => {
				channel = event.currentTarget.value;
				clearError();
			}}
		/>
	</div>
	<div class="fc-owner-row">
		<input
			aria-label="Search commands"
			placeholder="Search commands (reload, tts, img…)"
			bind:value={search}
			autocomplete="off"
			spellcheck={false}
		/>
	</div>
	<ul class="fc-owner-commands" aria-label="Commands">
		{#each matches as command (command.name)}
			<li>
				<button
					type="button"
					aria-pressed={picked?.name === command.name}
					onclick={() => {
						picked = command;
						details = '';
						clearError();
					}}
				>
					<code>{command.name}</code>
					<span>{command.summary}</span>
				</button>
			</li>
		{/each}
		{#if matches.length === 0}<li class="fc-fine">No command matches.</li>{/if}
	</ul>
	{#if picked}
		<div class="fc-owner-row">
			<code class="fc-owner-picked">!flosschat {picked.name}</code>
			{#if ownerCommandTakesArguments(picked)}
				<input
					aria-label="Command details"
					placeholder={ownerCommandArguments(picked)}
					value={details}
					maxlength={OWNER_COMMAND_MAX_LENGTH - picked.name.length - 1}
					autocomplete="off"
					spellcheck={false}
					oninput={(event) => {
						details = event.currentTarget.value;
						clearError();
					}}
				/>
			{/if}
			<button type="submit" class="fc-owner-button" disabled={phase === 'sending'}>
				{phase === 'sending' ? 'Sending…' : 'Run command'}
			</button>
		</div>
	{/if}
	{#if message && phase !== 'idle'}<p class="fc-fine" role="status">{message}</p>{/if}
</form>
