import { afterEach, describe, expect, it } from 'vitest';
import { glide } from './glide.ts';

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function row() {
	const node = document.createElement('div');
	node.style.cssText = 'display:flex;gap:4px;padding:3px;border:2px solid #000;width:max-content';
	node.innerHTML = ['One', 'Second', 'Third option']
		.map((label, index) => `<span class="item"><label class="opt${index === 0 ? ' on' : ''}" style="display:inline-block;padding:4px 10px;border-radius:12px">${label}</label></span>`)
		.join('');
	/* What the generator's CSS does for a measured row. */
	const style = document.createElement('style');
	style.textContent = '[data-glide]{position:relative}';
	node.append(style);
	document.body.append(node);
	return node;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('the sliding pill', () => {
	it('sits under the chosen option, jumps there first, then slides on each change', async () => {
		const node = row();
		const action = glide(node, '.opt.on');
		const [first, second] = [...node.querySelectorAll<HTMLElement>('.opt')];
		expect(node.getAttribute('data-glide')).toBe('placed');
		expect(node.style.getPropertyValue('--glide-x')).toBe('3px');
		expect(node.style.getPropertyValue('--glide-w')).toBe(`${first!.offsetWidth}px`);
		expect(node.style.getPropertyValue('--glide-r')).toBe('12px');
		await frame();
		expect(node.getAttribute('data-glide')).toBe('ready');

		first!.classList.remove('on');
		second!.classList.add('on');
		await frame();
		expect(node.style.getPropertyValue('--glide-x')).toBe(`${3 + first!.offsetWidth + 4}px`);
		expect(node.style.getPropertyValue('--glide-w')).toBe(`${second!.offsetWidth}px`);
		expect(node.getAttribute('data-glide')).toBe('ready');

		/* A pressed (scaled) option doesn't shrink the pill. */
		second!.style.scale = '0.9';
		node.style.width = '400px';
		await frame();
		expect(node.style.getPropertyValue('--glide-w')).toBe(`${second!.offsetWidth}px`);

		action?.destroy?.();
		expect(node.hasAttribute('data-glide')).toBe(false);
	});

	it('steps back when nothing is chosen, so the options draw their own look', async () => {
		const node = row();
		glide(node, '.opt.on');
		node.querySelector('.opt.on')!.classList.remove('on');
		await frame();
		expect(node.getAttribute('data-glide')).toBe('measuring');
	});
});
