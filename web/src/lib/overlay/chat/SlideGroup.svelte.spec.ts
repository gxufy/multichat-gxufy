/*
 * Slide, frame by frame in a real browser: a new batch is laid out at its full
 * height at once, only the track moves (the rows above glide up by exactly
 * the batch's height and never down), nothing is drawn below the content
 * while it moves, and afterwards the chat is as if nothing had moved.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ParsedMessage } from '@/lib/kick';
import ChatOverlay from './ChatOverlay.svelte';
import { parsedFor } from '../../../../../app/tests/fixtures/overlayCorpus.ts';

const { config, parsed } = parsedFor({ twitch: 'streamer', animation: 'slide', textShadow: 'large' });

type Frame = {
	newHeight: number | null;
	oldTop: number;
	transform: string;
	clipped: boolean;
	sliding: boolean;
	opening: boolean;
	lowestDrawn: number;
};

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

async function settle(chat: HTMLElement) {
	await expect
		.poll(() => !chat.hasAttribute('data-slide-clip') && !chat.querySelector('[data-slide-phase="measure"]'), {
			timeout: 3000
		})
		.toBe(true);
	for (let i = 0; i < 3; i += 1) await nextFrame();
}

/** Records every frame from now until `ms` have passed. */
function record(chat: HTMLElement, newText: string, oldRow: HTMLElement, ms: number) {
	const frames: Frame[] = [];
	const start = performance.now();
	return new Promise<Frame[]>((resolve) => {
		const tick = (now: number) => {
			const track = chat.querySelector<HTMLElement>('.gx-slide-track')!;
			const live = [...chat.querySelectorAll<HTMLElement>('.gx-message-row')].filter(
				(row) => !row.closest('[data-slide-ghost]')
			);
			const newRow = live.find((row) => row.textContent?.includes(newText)) ?? null;
			const box = chat.getBoundingClientRect();
			const clipBottom = chat.hasAttribute('data-slide-clip') ? box.bottom - 10 : box.bottom;
			frames.push({
				newHeight: newRow ? newRow.getBoundingClientRect().height : null,
				oldTop: oldRow.getBoundingClientRect().top,
				transform: track.style.transform,
				clipped: chat.hasAttribute('data-slide-clip'),
				sliding: track.hasAttribute('data-sliding'),
				opening: Boolean(chat.querySelector('[data-slide-phase="opening"]')),
				lowestDrawn: Math.min(
					clipBottom,
					Math.max(...live.map((row) => row.getBoundingClientRect().bottom))
				)
			});
			if (now - start < ms) requestAnimationFrame(tick);
			else resolve(frames);
		};
		requestAnimationFrame(tick);
	});
}

function textOf(message: ParsedMessage) {
	return message.message.filter((part) => typeof part === 'string').join('');
}

describe('Slide', () => {
	const plainRows = parsed.filter((message) => message.kind === 'chat' && textOf(message).length > 4).slice(0, 4);

	it('lays a new batch out at full height at once and glides the rows above up by its height', async () => {
		const screen = await render(ChatOverlay, {
			config,
			messages: plainRows.slice(0, 3),
			fadingIds: new Set<string>(),
			loaderPhase: 'hidden'
		});
		const chat = screen.container.querySelector<HTMLElement>('#chat_container')!;
		await settle(chat);
		const oldRow = [...chat.querySelectorAll<HTMLElement>('.gx-message-row')].at(-1)!;
		const before = oldRow.getBoundingClientRect().top;

		const recording = record(chat, textOf(plainRows[3]), oldRow, 600);
		await screen.rerender({ messages: plainRows.slice(0, 4) });
		const frames = await recording;
		await settle(chat);

		const shown = frames.filter((frame) => frame.newHeight !== null);
		expect(shown.length).toBeGreaterThan(5);
		const height = shown.at(-1)!.newHeight!;
		/* Full height from its first frame on: never laid out smaller. */
		for (const frame of shown) expect(frame.newHeight).toBeCloseTo(height, 1);
		/* The space never opens by layout. */
		expect(frames.some((frame) => frame.opening)).toBe(false);
		/* The first frame with the new row: the track holds everything in place. */
		expect(shown[0].transform).toMatch(/^translateY\(/);
		expect(shown[0].clipped).toBe(true);
		expect(shown[0].sliding).toBe(true);
		expect(shown[0].oldTop).toBeCloseTo(before, 0);
		/* The row above only ever moves up, and ends exactly one new row higher. */
		for (let i = 1; i < frames.length; i += 1) expect(frames[i].oldTop).toBeLessThanOrEqual(frames[i - 1].oldTop + 0.01);
		expect(oldRow.getBoundingClientRect().top).toBeCloseTo(before - height, 0);
		/* Nothing is drawn below the bottom of the content while it moves. */
		const contentBottom = chat.getBoundingClientRect().bottom - 10;
		for (const frame of frames.filter((f) => f.clipped)) expect(frame.lowestDrawn).toBeLessThanOrEqual(contentBottom + 0.5);
		/* Settled: no transform, no clip, no layer. */
		const track = chat.querySelector<HTMLElement>('.gx-slide-track')!;
		expect(track.style.cssText).toBe('');
		expect(track.hasAttribute('data-sliding')).toBe(false);
		expect(chat.hasAttribute('data-slide-clip')).toBe(false);
		expect(chat.querySelectorAll('[data-slide-phase="settled"]').length).toBeGreaterThanOrEqual(2);
	});

	it('takes a removed batch’s remaining distance with it', async () => {
		const screen = await render(ChatOverlay, {
			config,
			messages: plainRows.slice(0, 3),
			fadingIds: new Set<string>(),
			loaderPhase: 'hidden'
		});
		const chat = screen.container.querySelector<HTMLElement>('#chat_container')!;
		await settle(chat);
		const oldRow = [...chat.querySelectorAll<HTMLElement>('.gx-message-row')].at(-1)!;
		const before = oldRow.getBoundingClientRect().top;

		await screen.rerender({ messages: plainRows.slice(0, 4) });
		await expect.poll(() => chat.hasAttribute('data-slide-clip')).toBe(true);
		await nextFrame();
		await screen.rerender({ messages: plainRows.slice(0, 3) });
		await nextFrame();
		/* Back where it was at once: no leftover push downwards. */
		expect(oldRow.getBoundingClientRect().top).toBeCloseTo(before, 0);
		expect(chat.querySelector<HTMLElement>('.gx-slide-track')!.style.cssText).toBe('');
		expect(chat.hasAttribute('data-slide-clip')).toBe(false);
	});

	it('glides a row that grows while the batch moves instead of jumping', async () => {
		const screen = await render(ChatOverlay, {
			config,
			messages: plainRows.slice(0, 3),
			fadingIds: new Set<string>(),
			loaderPhase: 'hidden'
		});
		const chat = screen.container.querySelector<HTMLElement>('#chat_container')!;
		await settle(chat);
		const oldRow = [...chat.querySelectorAll<HTMLElement>('.gx-message-row')].at(-1)!;
		const before = oldRow.getBoundingClientRect().top;

		await screen.rerender({ messages: plainRows.slice(0, 4) });
		await expect.poll(() => chat.hasAttribute('data-slide-clip')).toBe(true);
		const newRow = [...chat.querySelectorAll<HTMLElement>('[data-slide-phase="settled"] .gx-message-row')].at(-1)!;
		const height = newRow.getBoundingClientRect().height;
		/* Near the end of the move (under 3 px a frame), while it still runs. */
		let last = oldRow.getBoundingClientRect().top;
		for (let i = 0; i < 30; i += 1) {
			await nextFrame();
			const now = oldRow.getBoundingClientRect().top;
			if (last - now < 3) break;
			last = now;
		}
		expect(chat.hasAttribute('data-slide-clip')).toBe(true);
		const justBefore = oldRow.getBoundingClientRect().top;
		newRow.style.paddingBottom = '40px';
		await nextFrame();
		/* Not a 40 px jump in one frame: the growth glides too. */
		expect(justBefore - oldRow.getBoundingClientRect().top).toBeLessThan(25);
		await settle(chat);
		expect(oldRow.getBoundingClientRect().top).toBeCloseTo(before - height - 40, 0);
	});
});
