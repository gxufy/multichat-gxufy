<script lang="ts">
	import type { BadgeListSize } from '@/lib/communityBadges';
	import { badgeListLevel, badgeListName, formatListBytes } from '@/lib/badgesPage';

	let rows = $state<BadgeListSize[] | null>(null);
	let phase = $state<'idle' | 'checking' | 'done' | 'error'>('idle');

	async function check() {
		if (phase === 'checking') return;
		phase = 'checking';
		try {
			/* Loaded only when asked: the badge loader is not part of this page. */
			const { measureCommunityBadgeLists } = await import('@/lib/communityBadges');
			rows = await measureCommunityBadgeLists();
			phase = 'done';
		} catch {
			phase = 'error';
		}
	}

	const worst = $derived(
		rows?.reduce<'ok' | 'watch' | 'act'>((level, row) => {
			const next = badgeListLevel(row);
			return next === 'act' || level === 'act'
				? 'act'
				: next === 'watch' || level === 'watch'
					? 'watch'
					: 'ok';
		}, 'ok')
	);
</script>

<div class="fc-owner-tool">
	<h3>Badge list sizes</h3>
	<p class="fc-fine">Each community badge list next to the most FlossChat loads. A list over its limit stops showing its badges, so act when one turns red.</p>
	<button type="button" class="fc-owner-button" onclick={() => void check()} disabled={phase === 'checking'}>
		{phase === 'checking' ? 'Checking…' : rows ? 'Check again' : 'Check now'}
	</button>
	{#if phase === 'error'}<p class="fc-fine" role="status">That did not work.</p>{/if}
	{#if rows}
		<p class="fc-fine" role="status">
			{rows.length === 0
				? 'No lists answered.'
				: worst === 'ok'
					? `All ${rows.length} lists are well under their limits.`
					: worst === 'watch'
						? 'One or more lists are past 75% of their limit.'
						: 'One or more lists are at 90% of their limit or over it.'}
		</p>
		<ul class="fc-owner-sizes" aria-label="Badge list sizes">
			{#each rows as row (row.list)}
				{@const share = row.bytes === null ? 1 : Math.min(1, row.bytes / row.cap)}
				<li data-level={badgeListLevel(row)}>
					<span class="fc-owner-size-name" title={row.list}>{badgeListName(row.list)}</span>
					<span class="fc-owner-size-bar" aria-hidden="true"><span style:width={`${Math.max(2, share * 100)}%`}></span></span>
					<span class="fc-owner-size-text">
						{row.bytes === null
							? `over ${formatListBytes(row.cap)}`
							: `${formatListBytes(row.bytes)} of ${formatListBytes(row.cap)} · ${Math.round((row.bytes / row.cap) * 100)}%`}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
