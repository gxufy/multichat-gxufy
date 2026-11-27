import { describe, expect, it } from 'vitest';
import { homeRoute } from './homeRoute.ts';

const at = (path: string) => new URL(path, 'https://example.test');

describe('homeRoute', () => {
	it('shows the homepage on gxufy.com and locally', () => {
		expect(homeRoute('gxufy.com', at('/'))).toEqual({ kind: 'home' });
		expect(homeRoute('localhost:5173', at('/'))).toEqual({ kind: 'home' });
		expect(homeRoute(undefined, at('/'))).toEqual({ kind: 'home' });
	});

	it('hands an OBS overlay URL to /multichat with its query untouched', () => {
		for (const search of ['?channel=gxufy', '?kick=a&twitch=b', '?twitch=gxufy&theme=x%20y', '?tiktok=t']) {
			expect(homeRoute('gxufy.com', at(`/${search}`))).toEqual({
				kind: 'overlay',
				location: `/multichat${search}`
			});
		}
		// on every domain, the generator's included
		expect(homeRoute('flosschat.app', at('/?youtube=y'))).toEqual({
			kind: 'overlay',
			location: '/multichat?youtube=y'
		});
	});

	it('leaves flosschat.app/ to the generator (not moved yet)', () => {
		expect(homeRoute('flosschat.app', at('/'))).toEqual({ kind: 'generator' });
	});
});
