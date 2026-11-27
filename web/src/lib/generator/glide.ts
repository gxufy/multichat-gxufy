/*
 * A pill that slides to the chosen option of a row of options (segmented
 * settings, preview tabs, command topics). The options keep their own
 * "chosen" class as the source of truth; this only measures the chosen one
 * and puts --glide-* variables on the row, which generatorMotion.ts draws.
 * Without it (or before the first measure) the chosen option draws its own
 * background as before.
 *
 * Used as a Svelte action: `use:glide={'.classic-seg-label.on'}`.
 */
import type { Action } from 'svelte/action';

/** Offset of `element` inside `root`, ignoring transforms (a pressed option
 *  is scaled down for a moment and must not shrink the pill). */
function offsetWithin(element: HTMLElement, root: HTMLElement): { x: number; y: number } | null {
	let x = 0;
	let y = 0;
	let current: HTMLElement | null = element;
	/* offsetLeft/Top count from the parent's padding edge, which is also where
	   the pill's `left: 0` sits; a positioned element in between adds its border. */
	while (current && current !== root) {
		x += current.offsetLeft;
		y += current.offsetTop;
		const parent: Element | null = current.offsetParent;
		if (parent instanceof HTMLElement && parent !== root) {
			x += parent.clientLeft;
			y += parent.clientTop;
		}
		current = parent instanceof HTMLElement ? parent : null;
	}
	return current === root ? { x, y } : null;
}

export const glide: Action<HTMLElement, string> = (node, initialSelector) => {
	let selector = initialSelector;
	let frame = 0;
	let settled = false;
	/* position: relative comes with the attribute (see the CSS); set it before
	   the first measure so offsets are taken from this row. */
	node.setAttribute('data-glide', 'measuring');

	const place = () => {
		frame = 0;
		const chosen = node.querySelector<HTMLElement>(selector);
		const at = chosen && chosen.offsetWidth > 0 ? offsetWithin(chosen, node) : null;
		if (!chosen || !at) {
			node.setAttribute('data-glide', 'measuring');
			settled = false;
			return;
		}
		node.style.setProperty('--glide-x', `${at.x}px`);
		node.style.setProperty('--glide-y', `${at.y}px`);
		node.style.setProperty('--glide-w', `${chosen.offsetWidth}px`);
		node.style.setProperty('--glide-h', `${chosen.offsetHeight}px`);
		node.style.setProperty('--glide-r', getComputedStyle(chosen).borderRadius || '999px');
		if (settled) {
			node.setAttribute('data-glide', 'ready');
			return;
		}
		/* First placement jumps; slides start from the next change on. */
		node.setAttribute('data-glide', 'placed');
		settled = true;
		window.requestAnimationFrame(() => {
			if (node.getAttribute('data-glide') === 'placed') node.setAttribute('data-glide', 'ready');
		});
	};
	const schedule = () => {
		if (!frame) frame = window.requestAnimationFrame(place);
	};

	const classes = new MutationObserver(schedule);
	classes.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled'] });
	const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
	sizes?.observe(node);
	for (const child of node.children) sizes?.observe(child);
	window.addEventListener('resize', schedule);
	void document.fonts?.ready.then(schedule);
	place();

	return {
		update(next) {
			selector = next;
			schedule();
		},
		destroy() {
			if (frame) window.cancelAnimationFrame(frame);
			classes.disconnect();
			sizes?.disconnect();
			window.removeEventListener('resize', schedule);
			node.removeAttribute('data-glide');
		}
	};
};
