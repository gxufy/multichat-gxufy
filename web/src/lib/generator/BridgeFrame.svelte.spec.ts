import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { PREVIEW_FRAME_READY } from '@/lib/previewBridge';
import BridgeFrame from './BridgeFrame.svelte';

type Received = { data: unknown; origin: string };

/** Install a listener inside the frame's own realm and say "ready" from there. */
function readyFrom(frame: HTMLIFrameElement, kind: string): Received[] {
	const win = frame.contentWindow as (Window & { __received?: Received[] }) | null;
	if (!win) throw new Error('no frame window');
	win.__received = [];
	win.addEventListener('message', (event) => win.__received!.push({ data: event.data, origin: event.origin }));
	/* Code run in the frame's realm, so the message's source is the frame. */
	new (win as unknown as { Function: FunctionConstructor }).Function(
		'kind',
		'type',
		'parent.postMessage({ type, kind }, parent.location.origin)'
	)(kind, PREVIEW_FRAME_READY);
	return win.__received;
}

function frameLoaded(frame: HTMLIFrameElement): Promise<void> {
	return new Promise<void>((resolve) => {
		if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href !== 'about:blank') resolve();
		else frame.addEventListener('load', () => resolve(), { once: true });
	});
}

describe('preview bridge frame', () => {
	it('sizes the box like the OBS source and scales the frame', async () => {
		const screen = await render(BridgeFrame, {
			kind: 'chat',
			title: 'FlossChat sample preview',
			width: 680,
			height: 280,
			scale: 50,
			testId: 'bridge',
			payloads: []
		});
		const box = screen.container.querySelector<HTMLElement>('[data-testid=bridge]')!;
		const frame = box.querySelector('iframe')!;
		expect(box.style.aspectRatio).toBe('680 / 280');
		expect(frame.getAttribute('src')).toBe('/preview-frame/chat');
		expect(frame.style.width).toBe('200%');
		expect(frame.style.transform).toBe('scale(0.5)');
	});

	it('sends every payload again when the frame says ready, then each change', async () => {
		let query = $state('kick=a');
		const screen = await render(BridgeFrame, {
			kind: 'chat',
			title: 'FlossChat sample preview',
			width: 680,
			height: 280,
			payloads: [
				() => ({ type: 'flosschat-preview:chat', query }),
				() => ({ type: 'flosschat-preview:chat', messages: [{ id: 'm1' }] })
			]
		});
		const frame = screen.container.querySelector('iframe')!;
		await frameLoaded(frame);
		const received = readyFrom(frame, 'chat');
		await expect.poll(() => received.length).toBeGreaterThanOrEqual(2);
		expect(received.every((entry) => entry.origin === window.location.origin)).toBe(true);
		expect(received.map((entry) => entry.data)).toEqual(
			expect.arrayContaining([
				{ type: 'flosschat-preview:chat', query: 'kick=a' },
				{ type: 'flosschat-preview:chat', messages: [{ id: 'm1' }] }
			])
		);
		query = 'kick=b';
		await expect.poll(() => received.at(-1)?.data).toEqual({ type: 'flosschat-preview:chat', query: 'kick=b' });
	});

	it("doesn't wait for ready: a frame that was listening before the page woke still gets updates", async () => {
		let query = $state('kick=early');
		const screen = await render(BridgeFrame, {
			kind: 'chat',
			title: 'FlossChat sample preview',
			width: 680,
			height: 280,
			testId: 'bridge',
			payloads: [() => ({ type: 'flosschat-preview:chat', query })]
		});
		const frame = screen.container.querySelector('iframe')!;
		await frameLoaded(frame);
		const win = frame.contentWindow as Window & { __heard?: unknown[] };
		win.__heard = [];
		win.addEventListener('message', (event) => win.__heard!.push(event.data));
		query = 'kick=later';
		await expect.poll(() => win.__heard!.at(-1)).toEqual({ type: 'flosschat-preview:chat', query: 'kick=later' });
		expect(screen.container.querySelector('[data-testid=bridge]')!.getAttribute('data-preview-ready')).toBe('false');
	});

	it('ignores "ready" from anything but its own frame', async () => {
		const screen = await render(BridgeFrame, {
			kind: 'chat',
			title: 'FlossChat sample preview',
			width: 680,
			height: 280,
			testId: 'bridge',
			payloads: [() => ({ type: 'flosschat-preview:chat', query: 'kick=a' })]
		});
		window.postMessage({ type: PREVIEW_FRAME_READY, kind: 'chat' }, window.location.origin);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(screen.container.querySelector('[data-testid=bridge]')!.getAttribute('data-preview-ready')).toBe('false');
	});
});
