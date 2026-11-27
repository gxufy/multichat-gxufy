/*
 * The generator's preview frames: the updates are posted to them from the
 * parent window (as the generator's BridgeFrame posts them), and what they
 * draw is held by snapshots. The snapshots are what the Next.js frame pages
 * drew (these were checked against them in the same browser before they were
 * retired).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { SAMPLE_COSMETICS, sampleAllMessages } from '@/features/multichat/samples';
import {
	CHAT_HISTORY_MAX,
	allSourcesEnabled,
	appendBounded,
	generateMessage
} from '@/features/multichat/previewSimulator';
import {
	COUNTER_COMBINATIONS,
	statusesForCombination
} from '@/features/counter/previewSimulator';
import { chatPreviewConfig, chatPreviewRows } from '@/lib/chatPreviewRows';
import { COUNTER_ROLL_DURATION_MS } from '@/lib/viewerCounterView';
import type { PlatformStatuses } from '@/lib/viewerCounterConfig';
import type { MessageCosmetics } from '@/lib/multichatMessageModel';
import type { UnifiedMessage } from '@/lib/types';
import { CONFIGS, COSMETICS, EXTRA } from '../../../../../app/tests/fixtures/overlayCorpus.ts';
import ChatPreviewFrame from './ChatPreviewFrame.svelte';
import ViewersPreviewFrame from './ViewersPreviewFrame.svelte';
import { settledText } from '../../testing/domSnapshot.ts';

/** Post as the parent window does: run in the parent's realm, so the message's source is the parent. */
function postFromParent(data: unknown) {
	const parentWindow = window.parent as unknown as { Function: FunctionConstructor };
	new parentWindow.Function('target', 'data', 'target.postMessage(data, location.origin)')(window, data);
}

/** A seeded generator (mulberry32), so the sample feed is the same every run. */
function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The generator's own sample feed: what it holds once full. */
function feed(seed: number): readonly UnifiedMessage[] {
	const random = seeded(seed);
	const sources = allSourcesEnabled();
	let messages: readonly UnifiedMessage[] = [];
	let previous: UnifiedMessage | null = null;
	for (let sequence = 1; sequence <= CHAT_HISTORY_MAX + 5; sequence += 1) {
		previous = generateMessage(sequence, sources, random, previous);
		messages = appendBounded(messages, previous, CHAT_HISTORY_MAX);
	}
	return messages;
}

let stopListening: (() => void) | null = null;
afterEach(() => {
	stopListening?.();
	stopListening = null;
});

/** Counts the frames' "ready" messages to the parent window, as BridgeFrame does. */
function listenForReady(kind: string): () => number {
	let count = 0;
	const listener = (event: MessageEvent) => {
		const data = event.data as { type?: unknown; kind?: unknown } | null;
		if (data?.type === 'flosschat-preview:ready' && data.kind === kind) count += 1;
	};
	window.parent.addEventListener('message', listener);
	stopListening = () => window.parent.removeEventListener('message', listener);
	return () => count;
}

function serialize(query: Record<string, string>): string {
	return new URLSearchParams(query).toString();
}

/** A case name as a file name. */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

describe('the chat preview frame', () => {
	const cases: Array<[string, string, readonly UnifiedMessage[], MessageCosmetics]> = [
		...Object.entries(CONFIGS).map(
			([name, query]): [string, string, readonly UnifiedMessage[], MessageCosmetics] => [
				`corpus: ${name}`,
				serialize({ ...query, animation: 'none' }),
				[...sampleAllMessages(), ...EXTRA],
				COSMETICS
			]
		),
		['generator feed: defaults', serialize({ animation: 'none' }), feed(1), SAMPLE_COSMETICS],
		[
			'generator feed: large, label, caps',
			serialize({ animation: 'none', textSize: 'large', sourceTag: 'label', msgCaps: 'true' }),
			feed(2),
			SAMPLE_COSMETICS
		],
		[
			'generator feed: hidden badges, Geist italic',
			serialize({ animation: 'none', hideBadges: 'true', font: 'geist', fontItalic: 'true' }),
			feed(3),
			SAMPLE_COSMETICS
		]
	];

	for (const [name, query, messages, cosmetics] of cases) {
		it(name, async () => {
			const expected = chatPreviewRows(chatPreviewConfig(query), messages, cosmetics).length;
			expect(expected).toBeGreaterThanOrEqual(20);

			const ready = listenForReady('chat');
			const svelteSide = (await render(ChatPreviewFrame)).container;
			/* It listens before anything is sent (the generator re-sends on ready). */
			await expect.poll(ready).toBe(1);

			/* As BridgeFrame sends them: one update per part. */
			postFromParent({ type: 'flosschat-preview:chat', query });
			postFromParent({ type: 'flosschat-preview:chat', messages });
			postFromParent({ type: 'flosschat-preview:chat', cosmetics });

			const rows = (side: HTMLElement) => side.querySelectorAll('#chat_container .gx-message-row').length;
			await expect.poll(() => rows(svelteSide)).toBe(expected);

			const chat = svelteSide.querySelector('#chat_container') as HTMLElement;
			await expect(await settledText(chat)).toMatchFileSnapshot(`./__snapshots__/chat/${slug(name)}.txt`);
		});
	}

	it('draws nothing until it is told what to draw, and listens only to its parent', async () => {
		const svelteSide = (await render(ChatPreviewFrame)).container;
		/* From this window itself, not the parent: ignored. */
		window.postMessage({ type: 'flosschat-preview:chat', query: serialize(CONFIGS.default) }, window.location.origin);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(svelteSide.querySelector('#chat_container')).toBeNull();

		postFromParent({ type: 'flosschat-preview:chat', query: serialize(CONFIGS.default) });
		await expect.poll(() => svelteSide.querySelector('#chat_container')).not.toBeNull();
		/* No messages posted yet: an empty overlay. */
		expect(svelteSide.querySelectorAll('.gx-message-row')).toHaveLength(0);
	});

	it('says ready to its parent once it listens', async () => {
		const ready = listenForReady('chat');
		await render(ChatPreviewFrame);
		await expect.poll(ready).toBe(1);
	});
});

describe('the counter preview frame', () => {
	const all = { twitch: 'gxufy', kick: 'gxufy', youtube: 'gxufy', tiktok: 'gxufy' };
	const random = seeded(7);
	const samples: PlatformStatuses[] = [
		...COUNTER_COMBINATIONS.slice(0, 15).map((combination) => statusesForCombination(combination, random)),
		{ twitch: { state: 'live-unknown' }, youtube: { state: 'offline' }, kick: { state: 'live', viewers: 99 }, tiktok: { state: 'unavailable' } }
	];
	const queries: Array<[string, Record<string, string>]> = [
		['combined', all],
		['separate', { ...all, combined: 'false' }],
		['bg, shadow, stroke', { ...all, bg: 'true', textShadow: 'large', stroke: 'thick' }],
		['right, large, italic', { ...all, align: 'right', counterTextSize: 'large', counterFontItalic: 'true', counterTextTransform: 'uppercase', combined: 'false' }],
		['no icons, colour, Geist', { ...all, icons: 'false', counterFontColor: '#ff66aa', counterFont: 'geist', counterFontWeight: '400' }]
	];

	/* Every combination once across the cases (three each), plus the mixed one in each. */
	queries.forEach(([name, query], queryIndex) => {
		const shown = [
			...samples.slice(0, 15).filter((_unused, index) => index % queries.length === queryIndex),
			samples[15]
		];
		it(name, async () => {
			const ready = listenForReady('viewers');
			const svelteSide = (await render(ViewersPreviewFrame)).container;
			await expect.poll(ready).toBe(1);
			const inset = (side: HTMLElement) =>
				Array.from(side.querySelectorAll<HTMLElement>('div[style]')).find((div) => div.style.padding === '8px');

			postFromParent({ type: 'flosschat-preview:viewers', query: serialize(query) });
			for (const [index, statuses] of shown.entries()) {
				postFromParent({ type: 'flosschat-preview:viewers', statuses });
				await expect.poll(() => inset(svelteSide)?.querySelector('div') != null).toBe(true);
				/* Let the numbers finish rolling. */
				await new Promise((resolve) => setTimeout(resolve, COUNTER_ROLL_DURATION_MS + 50));
				await expect(await settledText(inset(svelteSide)!)).toMatchFileSnapshot(
					`./__snapshots__/counter/${slug(name)}-${index + 1}.txt`
				);
			}
		});
	});
});
