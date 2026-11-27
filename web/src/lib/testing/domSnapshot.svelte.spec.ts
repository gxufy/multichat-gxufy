import { describe, expect, it } from 'vitest';
import { domText } from './domSnapshot.ts';

const box = (style: string) => {
	const element = document.createElement('div');
	element.setAttribute('style', style);
	return element;
};

describe('snapshot text', () => {
	it('writes a background left at its starting values the same way in every Chromium build', () => {
		const expected = '<div style="width: 100%; background: transparent; color: white;">\n';
		expect(domText(box('width: 100%; background: transparent; color: white'))).toBe(expected);
		expect(domText(box('width: 100%; background: none; color: white'))).toBe(expected);
	});

	it('leaves every other background as the browser reads it', () => {
		expect(domText(box('background: red'))).toBe('<div style="background: red;">\n');
		expect(domText(box('background-image: none'))).toBe('<div style="background-image: none;">\n');
	});
});
