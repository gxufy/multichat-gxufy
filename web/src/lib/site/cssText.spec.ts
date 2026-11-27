import { describe, expect, it } from 'vitest';
import { cssText } from './cssText.ts';

describe('cssText', () => {
	it('turns a React style object into CSS text', () => {
		expect(
			cssText({
				background: 'linear-gradient(90deg, red 0%, blue 100%)',
				WebkitBackgroundClip: 'text',
				backgroundClip: 'text',
				color: 'transparent',
				textShadow: 'none',
				filter: undefined,
				msFlex: 1
			})
		).toBe(
			'background: linear-gradient(90deg, red 0%, blue 100%); -webkit-background-clip: text; background-clip: text; color: transparent; text-shadow: none; -ms-flex: 1'
		);
	});

	it('gives nothing for no style', () => {
		expect(cssText(undefined)).toBeUndefined();
		expect(cssText({ filter: '' })).toBeUndefined();
	});
});
