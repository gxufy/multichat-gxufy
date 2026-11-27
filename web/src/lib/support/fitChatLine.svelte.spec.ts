import { afterEach, describe, expect, it } from 'vitest';
import { MIN_CHAT_LINE_SCALE, chatLineScale, fitChatLine } from './fitChatLine.ts';

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/* A row shaped like the support page's preview line, with its sizing rules. */
function chatRow(width: number, badges: number, name: string) {
	const host = document.createElement('div');
	host.style.width = `${width}px`;
	host.innerHTML = `
		<style>
			.row { --font: 18px; --badge: 24px; display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
				column-gap: calc(4px * var(--sp-chat-scale, 1)); row-gap: 6px; font: 800 calc(var(--font) * var(--sp-chat-scale, 1)) sans-serif; }
			.badge { width: calc(var(--badge) * var(--sp-chat-scale, 1)); height: calc(var(--badge) * var(--sp-chat-scale, 1)); }
			.line { min-width: 0; margin-left: calc(4px * var(--sp-chat-scale, 1)); overflow-wrap: anywhere; }
		</style>
		<div class="row">${'<span class="badge"></span>'.repeat(badges)}<span class="line"><strong>${name}</strong><span>: hey chat</span></span></div>`;
	document.body.append(host);
	const row = host.querySelector<HTMLElement>('.row')!;
	const onOneLine = () => {
		const tops = [...row.children].map((child) => Math.round(child.getBoundingClientRect().top + child.getBoundingClientRect().height / 2));
		const line = row.querySelector('.line')!;
		const range = document.createRange();
		range.selectNodeContents(line);
		const textRows = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
		return Math.max(...tops) - Math.min(...tops) <= 2 && textRows === 1;
	};
	return { host, row, onOneLine };
}

const hosts: HTMLElement[] = [];
afterEach(() => {
	for (const host of hosts.splice(0)) host.remove();
});

describe('chatLineScale', () => {
	it('is 1 when the line fits, smaller when it does not, and never below the minimum', () => {
		expect(chatLineScale(300, 200)).toBe(1);
		expect(chatLineScale(300, 300)).toBe(1);
		expect(chatLineScale(300, 330)).toBeCloseTo(0.9, 2);
		expect(chatLineScale(300, 330)).toBeLessThan(300 / 330);
		expect(chatLineScale(300, 400)).toBeGreaterThanOrEqual(MIN_CHAT_LINE_SCALE);
		/* Too far over to fit at any allowed size: left at full size to wrap. */
		expect(chatLineScale(100, 1_000)).toBe(1);
		expect(chatLineScale(0, 100)).toBe(1);
	});
});

describe('fitChatLine', () => {
	it('leaves a line that fits at full size', async () => {
		const { host, row, onOneLine } = chatRow(324, 1, 'YourNameHere');
		hosts.push(host);
		const action = fitChatLine(row, 'a');
		await frame();
		expect(row.style.getPropertyValue('--sp-chat-scale')).toBe('');
		expect(onOneLine()).toBe(true);
		action.destroy();
	});

	it('draws more badges and a longer name smaller, so they stay on one line', async () => {
		const { host, row, onOneLine } = chatRow(324, 5, 'YourNameHere');
		hosts.push(host);
		expect(onOneLine()).toBe(false);
		const action = fitChatLine(row, 'b');
		await frame();
		const scale = Number(row.style.getPropertyValue('--sp-chat-scale'));
		expect(scale).toBeGreaterThanOrEqual(MIN_CHAT_LINE_SCALE);
		expect(scale).toBeLessThan(1);
		expect(onOneLine()).toBe(true);
		action.destroy();
	});

	it('fits again when the row gets narrower or wider', async () => {
		const { host, row, onOneLine } = chatRow(324, 3, 'Gxufy');
		hosts.push(host);
		const action = fitChatLine(row, 'c');
		await frame();
		expect(row.style.getPropertyValue('--sp-chat-scale')).toBe('');
		host.style.width = '200px';
		await frame();
		await frame();
		expect(Number(row.style.getPropertyValue('--sp-chat-scale'))).toBeLessThan(1);
		expect(onOneLine()).toBe(true);
		host.style.width = '600px';
		await frame();
		await frame();
		expect(row.style.getPropertyValue('--sp-chat-scale')).toBe('');
		action.destroy();
	});

	it('wraps at full size, as before, when even the smallest size is too wide', async () => {
		const { host, row, onOneLine } = chatRow(324, 17, 'YourNameHere');
		hosts.push(host);
		const action = fitChatLine(row, 'd');
		await frame();
		expect(row.style.getPropertyValue('--sp-chat-scale')).toBe('');
		expect(onOneLine()).toBe(false);
		expect(row.getBoundingClientRect().width).toBeLessThanOrEqual(324);
		action.destroy();
	});

	it('fits again when what it shows changes', async () => {
		const { host, row, onOneLine } = chatRow(324, 1, 'Gxufy');
		hosts.push(host);
		const action = fitChatLine(row, 'e');
		await frame();
		expect(row.style.getPropertyValue('--sp-chat-scale')).toBe('');
		row.querySelector('strong')!.textContent = 'averyveryverylongname_25c';
		action.update();
		await frame();
		expect(Number(row.style.getPropertyValue('--sp-chat-scale'))).toBeLessThan(1);
		expect(onOneLine()).toBe(true);
		action.destroy();
	});
});
