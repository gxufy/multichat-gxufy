import { describe, expect, it } from 'vitest';
import { load } from './+page.server.ts';

type LoadEvent = Parameters<typeof load>[0];
const run = (href: string) => load({ url: new URL(href) } as LoadEvent);

describe('/multichat (generator)', () => {
	it('serves the generator when no channel is named', () => {
		expect(run('https://flosschat.app/')).toEqual({});
		expect(run('http://localhost:5173/multichat?tab=counter')).toEqual({});
	});

	it('a URL naming a channel is the overlay (rerouted before this page), so 404 here', () => {
		expect(() => run('http://localhost:5173/multichat?kick=xqc')).toThrow();
	});
});
