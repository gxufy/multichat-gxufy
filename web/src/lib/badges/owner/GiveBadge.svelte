<script lang="ts">
	import { onMount } from 'svelte';
	import {
		parseFounderSlotsLeft,
		parseGivenBadges,
		parseGivenFounders,
		type GivenBadgeRow,
		type GivenFounderRow
	} from '@/lib/badgesPage';
	import { FOUNDER_LIMIT, SUPPORTER_TIERS, supporterTier, type SupporterTierId } from '@/lib/supporterTiers';
	import { ownerPost, type Phase } from './ownerRequest.ts';

	type Choice = SupporterTierId | 'founder';

	let login = $state('');
	let choice = $state<Choice>('supporter');
	let given = $state<GivenBadgeRow[]>([]);
	let founders = $state<GivenFounderRow[]>([]);
	let founderSlotsLeft = $state<number | null>(null);
	let phase = $state<Phase>('idle');
	let message = $state('');

	/* Every given badge in one list, newest first. */
	const rows = $derived(
		[
			...founders.map((row) => ({ ...row, badge: 'founder' as const, label: 'Founder' })),
			...given.map((row) => ({ ...row, badge: 'tier' as const, label: supporterTier(row.tier ?? 'supporter').name }))
		].sort((a, b) => b.givenAt.localeCompare(a.givenAt))
	);

	function load() {
		return fetch('/api/badges/give', { cache: 'no-store' })
			.then((response) => (response.ok ? response.json() : null))
			.then((body) => {
				given = parseGivenBadges(body);
				founders = parseGivenFounders(body);
				founderSlotsLeft = parseFounderSlotsLeft(body);
			})
			.catch(() => {});
	}

	onMount(() => {
		void load();
	});

	async function send(payload: Record<string, string>) {
		phase = 'sending';
		const result = await ownerPost('/api/badges/give', payload);
		if (!result.ok) {
			phase = 'error';
			message = result.error;
			return null;
		}
		return result.body;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const name = login.trim().replace(/^@/, '');
		if (!name) {
			phase = 'error';
			message = 'Enter a Twitch username first.';
			return;
		}
		const body = await send({ login: name, tier: choice });
		if (!body) return;
		if (choice === 'founder') {
			const row = parseGivenFounders({ founders: [body.founder] })[0];
			if (!row) return;
			founders = [row, ...founders.filter((item) => item.id !== row.id)];
			founderSlotsLeft = parseFounderSlotsLeft(body);
			login = '';
			phase = 'sent';
			const left = founderSlotsLeft === null ? '' : ` ${founderSlotsLeft} of ${FOUNDER_LIMIT} Founder spots left.`;
			message = `Given. ${row.displayName} is a Founder now; overlays show it within about 15 seconds.${left}`;
			return;
		}
		const row = parseGivenBadges({ given: [body.given] })[0];
		if (!row) return;
		given = [row, ...given.filter((item) => item.id !== row.id)];
		login = '';
		phase = 'sent';
		message = `Given. ${row.displayName} has ${supporterTier(row.tier ?? 'supporter').name} now; overlays show it within about 15 seconds.`;
	}

	async function takeBack(row: { id: string; displayName: string; badge: 'founder' | 'tier'; label: string }) {
		const body = await send(row.badge === 'founder' ? { takeBack: row.id, badge: 'founder' } : { takeBack: row.id });
		if (!body) return;
		if (row.badge === 'founder') {
			founders = founders.filter((item) => item.id !== row.id);
			/* The spot may go to the next paid supporter in line, so ask again. */
			await load();
		} else {
			given = given.filter((item) => item.id !== row.id);
		}
		phase = 'sent';
		message = `Taken back from ${row.displayName} (${row.label}).`;
	}
</script>

<form class="fc-owner-tool" onsubmit={(event) => void submit(event)}>
	<h3>Give a badge</h3>
	<p class="fc-fine">Free, for tests and giveaways. It goes on that Twitch account right away. A free tier doesn’t count toward Founder; a free Founder takes one of the {FOUNDER_LIMIT} Founder spots until you take it back. A badge someone paid for can only be taken back with a refund.</p>
	<div class="fc-owner-row">
		<input
			aria-label="Give to (Twitch username)"
			placeholder="Twitch username"
			value={login}
			maxlength={40}
			autocomplete="off"
			spellcheck={false}
			oninput={(event) => {
				login = event.currentTarget.value;
				if (phase === 'error') phase = 'idle';
			}}
		/>
		<select aria-label="Badge to give" bind:value={choice}>
			{#each SUPPORTER_TIERS as option (option.id)}
				<option value={option.id}>{option.name}</option>
			{/each}
			<option value="founder" disabled={founderSlotsLeft === 0}>
				{founderSlotsLeft === null ? 'Founder' : founderSlotsLeft === 0 ? 'Founder (no spots left)' : `Founder (${founderSlotsLeft} left)`}
			</option>
		</select>
		<button type="submit" class="fc-owner-button" disabled={phase === 'sending'}>
			{phase === 'sending' ? 'Sending…' : 'Give badge'}
		</button>
	</div>
	{#if message && phase !== 'idle'}<p class="fc-fine" role="status">{message}</p>{/if}
	{#if rows.length > 0}
		<ul class="fc-owner-given" aria-label="Badges given">
			{#each rows as row (`${row.badge}:${row.id}`)}
				<li>
					<span>
						<strong>{row.displayName}</strong> <span class="fc-fine">@{row.login} · {row.label} · {new Date(row.givenAt).toLocaleDateString()}</span>
					</span>
					<button
						type="button"
						class="fc-owner-button"
						aria-label={`Take back ${row.label} from ${row.login}`}
						disabled={phase === 'sending'}
						onclick={() => void takeBack(row)}
					>
						Take back
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</form>
