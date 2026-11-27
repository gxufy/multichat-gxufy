/*
 * The Pogly preview pages show what the site's previews show: the chat page
 * draws the generator's Preview Data (the catalog's identities, then the
 * sample feed, holding while the pointer is over it) with the generator's
 * starting settings at the preview's 63% size, and the counter page draws the
 * generator's starting counter with the same rotation of sample counts. Both
 * draw through the same views as the generator's preview frames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/* Live cosmetics come from many providers; these tests are about the pages.
   Every live lookup answers "nothing new", so the catalog stays as bundled. */
vi.mock('@/features/multichat/previewLiveCosmetics', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/features/multichat/previewLiveCosmetics')>();
	return {
		...actual,
		loadPreviewLiveCosmetics: () => new Promise(() => {}),
		fetchPreviewJilChatShown: async () => new Map(),
		fetchPreviewJilTVPaints: async () => new Map()
	};
});

import { PREVIEW_CATALOG_TEMPLATES } from '@/features/multichat/previewCatalog';
import { chatDelayBounds } from '@/features/multichat/previewSimulator';
import { counterDelayBounds } from '@/features/counter/previewSimulator';
import { SAMPLE_COUNTER_COUNTS } from '@/features/counter/samples';
import { multichatTool } from '@/features/multichat/config';
import { counterTool } from '@/features/counter/config';
import { chatPreviewConfig } from '@/lib/chatPreviewRows';
import PoglyChatPage from '../../../routes/pogly-preview/multichat/+page.svelte';
import PoglyCounterPage from '../../../routes/pogly-preview/counter/+page.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const rows = () => document.querySelectorAll('.gx-message-row');

async function advance(ms: number) {
	await vi.advanceTimersByTimeAsync(ms);
	await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
}

describe('/pogly-preview/multichat', () => {
	it('draws one row per catalog identity, in order, with the generator\'s starting settings', async () => {
		render(PoglyChatPage);
		expect(PREVIEW_CATALOG_TEMPLATES.length).toBeGreaterThan(10);
		expect(rows()).toHaveLength(PREVIEW_CATALOG_TEMPLATES.length);
		const texts = [...rows()].map((row) => row.textContent ?? '');
		PREVIEW_CATALOG_TEMPLATES.forEach((template, index) => {
			expect(texts[index]).toContain(template.username);
		});
		/* The generator's default font and size reach the overlay. */
		const config = chatPreviewConfig(multichatTool.serialize({}, multichatTool.defaults))!;
		expect(config.font).toBe(multichatTool.defaults.font);
	});

	it('draws the overlay 1/0.63 larger and scales it back down, as the generator\'s preview does', async () => {
		render(PoglyChatPage);
		const box = document.querySelector<HTMLElement>('[data-testid="pogly-chat-preview"]')!;
		const scaled = box.firstElementChild as HTMLElement;
		expect(scaled.style.transform).toBe('scale(0.63)');
		expect(scaled.style.transformOrigin).toBe('0px 0px');
		expect(parseFloat(scaled.style.width)).toBeCloseTo(100 / 0.63, 3);
		expect(scaled.querySelectorAll('.gx-message-row')).toHaveLength(PREVIEW_CATALOG_TEMPLATES.length);
	});

	it('adds feed messages over time and holds while the pointer is over it', async () => {
		render(PoglyChatPage);
		const start = rows().length;
		const { max } = chatDelayBounds('fast');
		await advance(max * 3 + 50);
		const grown = rows().length;
		expect(grown).toBeGreaterThan(start);

		const box = document.querySelector<HTMLElement>('[data-testid="pogly-chat-preview"]')!;
		box.dispatchEvent(new MouseEvent('mouseenter'));
		await advance(max * 4);
		expect(rows().length).toBe(grown);

		box.dispatchEvent(new MouseEvent('mouseleave'));
		await advance(max + 50);
		expect(rows().length).toBeGreaterThan(grown);
	});
});

describe('/pogly-preview/counter', () => {
	const shown = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

	it('starts on the sample counts with the generator\'s starting counter, then rotates', async () => {
		render(PoglyCounterPage);
		/* The starting counter combines every platform into one total. */
		expect(counterTool.defaults.combined).toBe(true);
		const total = Object.values(SAMPLE_COUNTER_COUNTS).reduce((sum, count) => sum + count, 0);
		expect(shown()).toContain(total.toLocaleString('en-US'));

		const { max } = counterDelayBounds('normal');
		await advance(max + 50);
		await advance(2_000);
		expect(shown()).not.toContain(total.toLocaleString('en-US'));
	});
});
