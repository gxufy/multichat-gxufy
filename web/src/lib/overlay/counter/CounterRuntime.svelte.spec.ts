import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { COUNTER_POLL_INTERVAL_MS } from '@/lib/counterPolling';
import { STARTUP_LOADER_FADE_MS, STARTUP_LOADER_MIN_MS } from '@/lib/startupLoader';
import { COUNTER_ROLL_DURATION_MS } from '@/lib/viewerCounterView';
import CounterRuntime from './CounterRuntime.svelte';

/* Per-platform viewer counts the mocked providers answer with, read at
   request time so a test can change them between polls. */
let counts: Record<string, number | 'offline' | 'fail'>;
let requests: string[];

function respond(url: string): Response {
	const kick = url.startsWith('https://kick.com/');
	const platform = kick ? 'kick' : new URL(url, location.origin).searchParams.keys().next().value!;
	const count = counts[platform];
	if (count === undefined || count === 'fail') return new Response('{}', { status: 500 });
	if (kick) return Response.json({ livestream: count === 'offline' ? null : { viewer_count: count } });
	return Response.json({ [platform]: count === 'offline' ? { live: false } : { live: true, viewers: count } });
}

beforeEach(() => {
	counts = {};
	requests = [];
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame']
	});
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			/* The owner's refresh commands and usage reports are not counts. */
			if (!/^(\/api\/(viewers|audience)\?|https:\/\/kick\.com\/)/.test(url)) return new Response(null, { status: 204 });
			requests.push(url);
			return respond(url);
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const mount = (query: string, serverEndpoint: '/api/viewers' | '/api/audience' = '/api/viewers') =>
	render(CounterRuntime, { serverEndpoint, searchParams: new URLSearchParams(query) });

/** The counter's own text, without the startup card or the font rules. */
function shown(container: HTMLElement): string {
	const inset = [...container.querySelectorAll<HTMLElement>('div[style]')].find((d) => d.style.padding === '8px');
	const copy = inset?.cloneNode(true) as HTMLElement | undefined;
	copy?.querySelectorAll('style').forEach((node) => node.remove());
	return copy?.textContent?.trim() ?? '';
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('FlossCounter (Svelte)', () => {
	it('shows the startup card, then the combined count once measured, then lets the card go', async () => {
		counts = { twitch: 1234, kick: 66 };
		const screen = await mount('twitch=gxufy&kick=gxufy');
		const card = () => screen.container.querySelector('[data-testid="counter-startup-loader"]');
		expect(card()).not.toBeNull();
		await settle();
		/* Twitch drew first; the total rolls on to include Kick. */
		await vi.advanceTimersByTimeAsync(COUNTER_ROLL_DURATION_MS);
		expect(shown(screen.container)).toBe('1,300');
		expect(requests).toEqual(['/api/viewers?twitch=gxufy', 'https://kick.com/api/v2/channels/gxufy']);
		await vi.advanceTimersByTimeAsync(STARTUP_LOADER_MIN_MS - COUNTER_ROLL_DURATION_MS);
		expect(card()?.getAttribute('data-phase')).toBe('fading');
		await vi.advanceTimersByTimeAsync(STARTUP_LOADER_FADE_MS);
		expect(card()).toBeNull();
	});

	it('draws nothing before the first poll settles', async () => {
		counts = { twitch: 5 };
		const screen = await mount('twitch=gxufy');
		expect(shown(screen.container)).toBe('');
		await settle();
		expect(shown(screen.container)).toBe('5');
	});

	it('rolls to a new count on the next poll', async () => {
		counts = { twitch: 100 };
		const screen = await mount('twitch=gxufy');
		await settle();
		expect(shown(screen.container)).toBe('100');
		counts.twitch = 200;
		await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS);
		await vi.advanceTimersByTimeAsync(COUNTER_ROLL_DURATION_MS / 3);
		const midway = Number(shown(screen.container));
		expect(midway).toBeGreaterThan(100);
		expect(midway).toBeLessThan(200);
		await vi.advanceTimersByTimeAsync(COUNTER_ROLL_DURATION_MS);
		expect(shown(screen.container)).toBe('200');
	});

	it('lists platforms separately with the unavailable mark, leaving offline ones out', async () => {
		counts = { twitch: 42, youtube: 'offline', kick: 'fail' };
		const screen = await mount('twitch=a&youtube=b&kick=c&combined=false');
		await settle();
		expect(shown(screen.container)).toBe('42');
		counts = { twitch: 42, youtube: 'offline', kick: 7 };
		await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS);
		expect(shown(screen.container)).toBe('427');
	});

	it('uses the endpoint it is given (the /audience embed)', async () => {
		counts = { youtube: 9 };
		const screen = await mount('youtube=a', '/api/audience');
		await settle();
		expect(requests).toEqual(['/api/audience?youtube=a']);
		expect(shown(screen.container)).toBe('9');
	});

	it('stops polling when it goes away', async () => {
		counts = { twitch: 1 };
		const screen = await mount('twitch=a');
		await settle();
		screen.unmount();
		await vi.advanceTimersByTimeAsync(COUNTER_POLL_INTERVAL_MS * 3);
		expect(requests).toHaveLength(1);
	});

	it('shows no card and asks nothing without a channel', async () => {
		const screen = await mount('');
		await settle();
		expect(screen.container.querySelector('[data-testid="counter-startup-loader"]')).toBeNull();
		expect(requests).toEqual([]);
	});
});
