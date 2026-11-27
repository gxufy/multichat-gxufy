import { describe, expect, it } from 'vitest';
import { reroute } from './hooks.ts';

const at = (href: string) => reroute({ url: new URL(href), fetch });

describe('reroute', () => {
	it('flosschat.app/ is the generator (the /multichat route), address unchanged', () => {
		expect(at('https://flosschat.app/')).toBe('/multichat');
		expect(at('https://flosschat.app/?utm_source=x')).toBe('/multichat');
		expect(at('https://flosschat.app/?tab=counter')).toBe('/multichat');
	});

	it('leaves overlays, other paths and other hosts alone', () => {
		expect(at('https://flosschat.app/?kick=xqc')).toBeUndefined();
		expect(at('https://flosschat.app/?channel=xqc')).toBeUndefined();
		expect(at('https://flosschat.app/support')).toBeUndefined();
		expect(at('https://gxufy.com/')).toBeUndefined();
		expect(at('http://localhost:5173/')).toBeUndefined();
	});

	it('/multichat naming a channel is the chat overlay; without one, the generator', () => {
		expect(at('https://flosschat.app/multichat?twitch=xqc')).toBe('/overlay/chat');
		expect(at('https://gxufy.com/multichat?kick=xqc&animation=none')).toBe('/overlay/chat');
		expect(at('http://localhost:5173/multichat?channel=xqc')).toBe('/overlay/chat');
		expect(at('https://flosschat.app/multichat')).toBeUndefined();
		expect(at('https://flosschat.app/multichat?tab=counter')).toBeUndefined();
	});
});
