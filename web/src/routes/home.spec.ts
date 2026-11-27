import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Home from './+page.svelte';

describe('gxufy.com homepage', () => {
	const { head, body } = render(Home, {
		props: { data: { year: 2026 }, params: {} } as never
	});

	it('has the same content and links', () => {
		expect(body).toContain('wtw, I’m <span>Gxufy</span> 🕊️');
		expect(body).toContain('FlossChat — one overlay for every chat');
		expect(body).toContain('FlossCounter — real-time viewer counts');
		expect(body).toContain('href="/multichat"');
		expect(body).toContain('href="/multichat#');
		expect(body).toContain('href="https://guns.lol/gxufy"');
		expect(body).toContain('© 2026 Gxufy 🕊️');
	});

	it('has the same search and share tags', () => {
		expect(head).toContain('<title>Gxufy 🕊️</title>');
		expect(head).toContain('<link rel="canonical" href="https://gxufy.com/"');
		expect(head).toContain('"@type":"Person"');
		expect(head).toContain('<link rel="icon" type="image/gif" href="/gxufy-avatar.gif"');
		expect(head).toContain("@import url('https://fonts.googleapis.com/css2?family=Montserrat");
	});
});
