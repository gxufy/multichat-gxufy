/*
 * The generator's preview feeds, as Svelte runes. All the logic stays in the shared modules
 * (features/multichat/previewSimulator, features/counter/previewSimulator,
 * features/multichat/previewLiveCosmetics, which keeps the JilChat traffic
 * guard); these only hold state and timers.
 *
 * Production has no feed controls, so only the behaviour the page shows is
 * here: the chat feed runs
 * at the requested speed and holds while the pointer is over the preview or
 * the tab is hidden; the counter rotates at normal speed while the tab is
 * visible. Call each factory during component setup.
 */
import {
	CHAT_HISTORY_MAX,
	allSourcesEnabled,
	appendBounded,
	generateMessage,
	nextChatDelay,
	type PreviewSpeed,
	type RandomSource
} from '@/features/multichat/previewSimulator';
import {
	nextCounterDelay,
	shuffledCombinations,
	statusesForCombination,
	type CounterCombination
} from '@/features/counter/previewSimulator';
import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import {
	PREVIEW_LIVE_COSMETICS_DELAY_MS,
	applyPreviewLiveCosmetics,
	fetchPreviewJilChatShown,
	fetchPreviewJilTVPaints,
	loadPreviewLiveCosmetics,
	mergeShownProviderBadges,
	type PreviewLiveCosmetics,
	type ShownProvider
} from '@/features/multichat/previewLiveCosmetics';
import type { UnifiedBadge, UnifiedMessage } from '@/lib/types';
import type { PlatformStatuses } from '@/lib/viewerCounterConfig';

/** A loaded identity demonstration (PreviewIdentityTemplate in previewRoster.ts). */
export type PreviewIdentityTemplate = Omit<UnifiedMessage, 'id' | 'timestamp'> & {
	readonly templateId: string;
};

function documentHidden(): boolean {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** True while the tab is hidden; follows visibilitychange. */
function trackHidden(): () => boolean {
	let hidden = $state(false);
	$effect(() => {
		const sync = () => (hidden = documentHidden());
		sync();
		document.addEventListener('visibilitychange', sync);
		return () => document.removeEventListener('visibilitychange', sync);
	});
	return () => hidden;
}

export function createChatPreviewFeed(options: {
	speed: PreviewSpeed;
	suspended: () => boolean;
	identityTemplates: () => readonly PreviewIdentityTemplate[];
	random?: RandomSource;
}) {
	const random = options.random ?? (() => Math.random());
	const sources = allSourcesEnabled();
	const hidden = trackHidden();
	let messages = $state.raw<readonly UnifiedMessage[]>([]);
	let restarts = $state(0);
	let sequence = 0;
	let previous: UnifiedMessage | null = null;
	let previousKey: string | null = null;

	const running = $derived(!hidden() && !options.suspended());

	/* New identities (live cosmetics arrived): start the feed over. */
	$effect(() => {
		const key = options
			.identityTemplates()
			.map((template) => `${template.senderId ?? ''}:${template.username}:${template.templateId}`)
			.join('|');
		if (previousKey === null || previousKey === key) {
			previousKey = key;
			return;
		}
		previousKey = key;
		messages = [];
		sequence = 0;
		previous = null;
		restarts += 1;
	});

	$effect(() => {
		void restarts;
		if (!running) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			if (cancelled) return;
			sequence += 1;
			const templates = options.identityTemplates();
			const template = templates.length ? templates[(sequence - 1) % templates.length] : null;
			const next: UnifiedMessage = template
				? { ...template, id: `identity-sim-${sequence}`, timestamp: sequence * 1000 }
				: generateMessage(sequence, sources, random, previous);
			previous = next;
			messages = appendBounded(messages, next, CHAT_HISTORY_MAX);
			schedule();
		};
		const schedule = () => {
			timer = setTimeout(tick, nextChatDelay(random, options.speed));
		};
		schedule();
		return () => {
			cancelled = true;
			if (timer !== undefined) clearTimeout(timer);
		};
	});

	return {
		get messages() {
			return messages;
		},
		get running() {
			return running;
		},
		/* No pause control in production. */
		paused: false
	};
}

export function createCounterPreviewFeed(options: { random?: RandomSource } = {}) {
	const random = options.random ?? (() => Math.random());
	const hidden = trackHidden();
	let statuses = $state.raw<PlatformStatuses | null>(null);
	let bag: CounterCombination[] | null = null;
	let last: CounterCombination | null = null;

	const step = () => {
		if (bag === null || bag.length === 0) bag = shuffledCombinations(random, last ?? undefined);
		const next = bag.shift()!;
		last = next;
		statuses = statusesForCombination(next, random);
	};

	$effect(() => {
		if (hidden()) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = () => {
			if (cancelled) return;
			step();
			schedule();
		};
		const schedule = () => {
			timer = setTimeout(tick, nextCounterDelay(random, 'normal'));
		};
		schedule();
		return () => {
			cancelled = true;
			if (timer !== undefined) clearTimeout(timer);
		};
	});

	return {
		/** Null before the first tick: the page shows its fixed sample counts. */
		get statuses() {
			return statuses;
		}
	};
}

export type PreviewLiveCosmeticsStatus = 'idle' | 'loading' | 'live' | 'partial' | 'failed';

const NO_LIVE_COSMETICS: PreviewLiveCosmetics = { sevenTV: new Map(), communityBadges: new Map() };

/* The slower per-user stages (JilChat's shown badges, JilTV paints) can finish
   before or after the main load; whichever comes later keeps the others. */
function withLateStages(
	next: PreviewLiveCosmetics,
	current: PreviewLiveCosmetics | null
): PreviewLiveCosmetics {
	return {
		...next,
		...(current?.shownProviderBadges ? { shownProviderBadges: current.shownProviderBadges } : {}),
		...(current?.jiltvPaints ? { jiltvPaints: current.jiltvPaints } : {})
	};
}

/**
 * Refreshes the bundled Preview Data catalog with each identity's currently
 * equipped cosmetics, once, after first paint. The catalog shows first and
 * stays the fallback for anything a live source can't confirm.
 */
export function createPreviewLiveCosmetics(
	catalog: ReadonlyMap<string, PreviewIdentityResponse>,
	{ delayMs = PREVIEW_LIVE_COSMETICS_DELAY_MS }: { delayMs?: number } = {}
) {
	let live = $state.raw<PreviewLiveCosmetics | null>(null);
	let status = $state<PreviewLiveCosmeticsStatus>('idle');

	$effect(() => {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			status = 'loading';
			const userIds = [...catalog.values()].map((response) => response.identity.userId);
			const applyShown =
				(provider: ShownProvider) => (badges: ReadonlyMap<string, readonly UnifiedBadge[]>) => {
					if (controller.signal.aborted || !badges.size) return;
					const current = live ?? NO_LIVE_COSMETICS;
					live = {
						...current,
						shownProviderBadges: mergeShownProviderBadges(current.shownProviderBadges, provider, badges)
					};
				};
			void fetchPreviewJilChatShown(userIds, { signal: controller.signal })
				.then(applyShown('jilchat'))
				.catch(() => undefined);
			void fetchPreviewJilTVPaints([...catalog.values()].map((response) => response.identity), {
				signal: controller.signal,
				onPaint: (jiltvPaints) => {
					if (controller.signal.aborted) return;
					live = { ...(live ?? NO_LIVE_COSMETICS), jiltvPaints };
				}
			}).catch(() => undefined);
			void loadPreviewLiveCosmetics(catalog, { signal: controller.signal })
				.then(({ live: next, failedSources, totalSources }) => {
					if (controller.signal.aborted) return;
					live = withLateStages(next, live);
					status = failedSources === 0 ? 'live' : failedSources < totalSources ? 'partial' : 'failed';
				})
				.catch(() => {
					if (!controller.signal.aborted) status = 'failed';
				});
		}, delayMs);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	const responses = $derived(live ? applyPreviewLiveCosmetics(catalog, live) : catalog);

	return {
		get responses() {
			return responses;
		},
		get status() {
			return status;
		}
	};
}
