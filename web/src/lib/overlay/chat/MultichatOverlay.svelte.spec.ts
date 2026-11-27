import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/* The engine reports a connection error straight away. */
vi.mock('@/lib/multichatRuntime', () => ({
	startMultichatRuntime: (_query: unknown, handlers: { onError: (message: string) => void }) => {
		handlers.onError('Could not find Kick channel: "nobody"');
		return () => {};
	}
}));

import MultichatOverlay from './MultichatOverlay.svelte';

describe('MultichatOverlay error screen', () => {
	it('stays see-through (the page has no styles for these classes)', async () => {
		const screen = await render(MultichatOverlay, { query: { kick: 'nobody' } });
		await expect.element(screen.getByText('Connection Error')).toBeInTheDocument();
		await expect.element(screen.getByText('Could not find Kick channel: "nobody"')).toBeInTheDocument();
		const box = screen.container.querySelector<HTMLElement>('div.bg-black.min-h-screen');
		expect(box).not.toBeNull();
		const style = getComputedStyle(box!);
		expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
		expect(style.display).toBe('block');
		expect(screen.container.querySelector('style')).toBeNull();
	});
});
