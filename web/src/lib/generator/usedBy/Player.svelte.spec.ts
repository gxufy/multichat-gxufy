import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { USED_BY_STREAMERS } from '@/features/usedBy';
import Carousel from './Carousel.svelte';
import Player from './Player.svelte';
import { skipBy } from './icons.ts';

/*
 * A clip whose length and position the test decides. Headless Chromium can't
 * decode the real H.264 clips, so the element only pretends to have loaded.
 */
function fakeClip(clip = document.createElement('video'), duration = 26.75) {
	let now = 0;
	Object.defineProperty(clip, 'duration', { configurable: true, get: () => duration });
	Object.defineProperty(clip, 'paused', { configurable: true, get: () => true });
	Object.defineProperty(clip, 'currentTime', {
		configurable: true,
		get: () => now,
		set: (value: number) => {
			now = value;
			clip.dispatchEvent(new Event('seeked'));
		}
	});
	return {
		clip,
		/* The clip moving on by itself, as it does while playing. */
		playTo(value: number) {
			now = value;
			clip.dispatchEvent(new Event('timeupdate'));
		}
	};
}

const sound = () => ({ current: { muted: false, volume: 1 } });

describe('clip player', () => {
	it('skipBy stays inside the clip and waits for its length', () => {
		const { clip } = fakeClip();
		clip.currentTime = 3;
		skipBy(clip, 5);
		expect(clip.currentTime).toBe(8);
		skipBy(clip, -10);
		expect(clip.currentTime).toBe(0);
		clip.currentTime = 24;
		skipBy(clip, 5);
		expect(clip.currentTime).toBe(26.75);

		const loading = fakeClip(undefined, Number.NaN);
		loading.clip.currentTime = 2;
		skipBy(loading.clip, 5);
		expect(loading.clip.currentTime).toBe(2);
	});

	it('back and forward buttons jump 5 seconds and the time follows', async () => {
		const { clip } = fakeClip();
		clip.currentTime = 10;
		await render(Player, { clip, streamer: USED_BY_STREAMERS[0], sound: sound() });

		await page.getByRole('button', { name: 'Forward 5 seconds' }).click();
		expect(clip.currentTime).toBe(15);
		await expect.element(page.getByText('0:15 / 0:26')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Back 5 seconds' }).click();
		await page.getByRole('button', { name: 'Back 5 seconds' }).click();
		expect(clip.currentTime).toBe(5);
		await expect.element(page.getByText('0:05 / 0:26')).toBeInTheDocument();
	});

	it('the seek bar moves the clip, and arrow keys on it jump 5 seconds', async () => {
		const { clip } = fakeClip();
		await render(Player, { clip, streamer: USED_BY_STREAMERS[0], sound: sound() });
		const seek = page.getByRole('slider', { name: `Seek in ${USED_BY_STREAMERS[0].name}'s clip` });
		const input = seek.element() as HTMLInputElement;

		input.value = '12';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(clip.currentTime).toBe(12);

		input.focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(clip.currentTime).toBe(17);
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
		expect(clip.currentTime).toBe(7);
	});

	it('while the seek bar is dragged, playback does not pull it back', async () => {
		const { clip, playTo } = fakeClip();
		await render(Player, { clip, streamer: USED_BY_STREAMERS[0], sound: sound() });
		const input = page
			.getByRole('slider', { name: `Seek in ${USED_BY_STREAMERS[0].name}'s clip` })
			.element() as HTMLInputElement;

		input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		input.value = '20';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		playTo(4);
		await expect.poll(() => input.value).toBe('20');
		expect(clip.currentTime).toBe(4);

		input.dispatchEvent(new Event('change', { bubbles: true }));
		await expect.poll(() => input.value).toBe('4');
	});

	it('back and forward wait for the clip to load', async () => {
		const { clip } = fakeClip(undefined, Number.NaN);
		await render(Player, { clip, streamer: USED_BY_STREAMERS[0], sound: sound() });
		await expect.element(page.getByRole('button', { name: 'Back 5 seconds' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: 'Forward 5 seconds' })).toBeDisabled();
	});

	it('J and L jump back and forward in the carousel', async () => {
		await render(Carousel, {
			index: 0,
			avatars: {},
			closing: false,
			sound: sound(),
			onChoose: () => undefined,
			onClose: () => undefined
		});
		const node = document.querySelector<HTMLVideoElement>('video.used-by-slide-clip');
		expect(node).not.toBeNull();
		const { clip } = fakeClip(node!);
		clip.currentTime = 10;
		clip.dispatchEvent(new Event('durationchange'));

		await userEvent.keyboard('l');
		expect(clip.currentTime).toBe(15);
		await userEvent.keyboard('jj');
		expect(clip.currentTime).toBe(5);
		await userEvent.keyboard('{Control>}l{/Control}');
		expect(clip.currentTime).toBe(5);
	});
});
