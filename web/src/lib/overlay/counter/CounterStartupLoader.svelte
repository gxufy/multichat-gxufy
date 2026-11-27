<script lang="ts">
	/*
	 * The card FlossCounter shows until its first count is on screen (CSS and
	 * words in lib/counterStartupLoader.ts).
	 */
	import type { StartupLoaderPhase } from '@/lib/startupLoader';
	import { COUNTER_STARTUP_LOADER_TEXT as TEXT } from '@/lib/counterStartupLoader';

	let { phase }: { phase: StartupLoaderPhase } = $props();
</script>

{#if phase !== 'hidden'}
	<div class="fc-counter-loader" data-phase={phase} data-testid="counter-startup-loader">
		<div class="fc-counter-loader-card">
			<img
				class="fc-counter-loader-logo"
				src={TEXT.logo}
				alt=""
				width={TEXT.logoWidth}
				height={TEXT.logoHeight}
				decoding="async"
			/><div class="fc-counter-loader-copy">
				<p class="fc-counter-loader-title">
					{TEXT.title}<span class="fc-counter-loader-byline">{TEXT.byline}</span>
				</p><p class="fc-counter-loader-status">
					<span class="fc-counter-loader-spinner" aria-hidden="true"></span>{TEXT.status}
				</p>
			</div>
		</div>
	</div>
{/if}
