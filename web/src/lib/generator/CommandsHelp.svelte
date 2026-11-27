<script lang="ts">
	/*
	 * Commands & help. Rows come from MULTICHAT_COMMANDS, the overlay parser's own
	 * metadata; topics, search and copy are presentation only.
	 */
	import {
		MULTICHAT_COMMANDS,
		MULTICHAT_COMMAND_TRIGGER,
		type MultichatCommand
	} from '@/lib/multichatCommands';
	import {
		COMMAND_GROUPS,
		COMMANDS_BY_TOPIC,
		COMMAND_PLAIN,
		commandGroup,
		type GroupId
	} from '@/components/classic/commandsHelp';
	import { glide } from './glide.ts';

	const COPIED_MS = 1_500;

	let query = $state('');
	let group = $state<GroupId | 'all'>('all');
	let copied = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	const groups = (() => {
		const present = new Set(MULTICHAT_COMMANDS.map(commandGroup));
		const list: { id: GroupId; label: string }[] = COMMAND_GROUPS.filter((entry) =>
			present.has(entry.id)
		).map(({ id, label }) => ({ id, label }));
		if (present.has('other')) list.push({ id: 'other', label: 'Other' });
		return list;
	})();
	const topics: { id: GroupId | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, ...groups];

	const needle = $derived(query.trim().toLowerCase());
	const visible = $derived(
		COMMANDS_BY_TOPIC.filter(
			(command) =>
				(group === 'all' || commandGroup(command) === group) &&
				(!needle ||
					`${command.syntax} ${command.summary} ${command.detail ?? ''}`.toLowerCase().includes(needle))
		)
	);

	function copy(command: MultichatCommand) {
		/* Copy just the trigger + command word; arguments are placeholders. */
		void navigator.clipboard?.writeText(`${MULTICHAT_COMMAND_TRIGGER} ${command.name}`);
		copied = command.name;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (copied = null), COPIED_MS);
	}

	$effect(() => () => {
		if (timer) clearTimeout(timer);
	});
</script>

<div class="cmd-help">
	<div class="cmd-top">
		<!-- One line of text, so the spaces between the parts stay exactly one. -->
		<p class="cmd-intro">
			Type <code class="cmd-trigger">{MULTICHAT_COMMAND_TRIGGER}</code> + a word in chat (e.g. <code>{MULTICHAT_COMMAND_TRIGGER} clear</code>). Only <strong>the broadcaster and mods</strong> can use them, except <code>paint</code>, which anyone can use on their own name. Click one to copy it.
		</p>
		<input
			type="search"
			class="cmd-search"
			placeholder="Search"
			aria-label="Search commands"
			bind:value={query}
		/>
	</div>

	<div class="cmd-groups" role="group" aria-label="Command topics" use:glide={'.cmd-group.on'}>
		{#each topics as entry (entry.id)}
			<button
				type="button"
				class="cmd-group{group === entry.id ? ' on' : ''}"
				aria-pressed={group === entry.id}
				onclick={() => (group = entry.id)}>{entry.label}</button
			>
		{/each}
	</div>

	{#if visible.length}
		<ul class="cmd-list" aria-label="Chat commands the FlossChat overlay implements">
			{#each visible as command (command.name)}
				{@const plain = COMMAND_PLAIN[command.name] ?? command.summary}
				{@const full = [command.syntax, command.summary, command.detail].filter(Boolean).join(' — ')}
				<li class="cmd-row" data-command={command.name} data-syntax={command.syntax} title={full}>
					<button
						type="button"
						class="cmd-syntax{copied === command.name ? ' ok' : ''}"
						onclick={() => copy(command)}
						aria-label={`Copy ${MULTICHAT_COMMAND_TRIGGER} ${command.name}: ${plain}`}
					>
						<code>{command.name}</code>
						<span class="cmd-copy-hint" aria-hidden="true">{copied === command.name ? '✓' : '⧉'}</span>
					</button>
					<span class="cmd-summary">{plain}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="cmd-empty">Nothing matches “{query.trim()}”.</p>
	{/if}

	<p class="sr-only" role="status" aria-live="polite">
		{copied ? `${MULTICHAT_COMMAND_TRIGGER} ${copied} copied to the clipboard.` : ''}
	</p>
</div>
