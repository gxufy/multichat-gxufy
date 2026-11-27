/**
 * Keeps the support page's chat-line preview ("badges Name: hey chat") on one
 * line. When it doesn't fit, the row gets a `--sp-chat-scale` below 1, which
 * the page's CSS multiplies into the text, badge and gap sizes. If even
 * MIN_CHAT_LINE_SCALE wouldn't fit it (lots of badges), it stays full size and
 * wraps as before, since smaller badges on two rows would only be harder to
 * see. Measured
 * again when the row's width changes, when its contents change (the action's
 * parameter), and once the page's fonts have loaded.
 */

export const MIN_CHAT_LINE_SCALE = 0.75;

/** How much smaller the row must be drawn so `needed` px fit in `available`
 *  (1 when it fits already, or when no allowed size would fit it). */
export function chatLineScale(available: number, needed: number): number {
	if (!(available > 0) || !(needed > available)) return 1;
	/* A hair under the exact ratio, so rounding never tips it onto two lines. */
	const scale = Math.floor((available / needed) * 0.99 * 1000) / 1000;
	return scale >= MIN_CHAT_LINE_SCALE ? scale : 1;
}

/** The row's width with nothing wrapped, at full size. */
function unwrappedWidth(node: HTMLElement): number {
	const { width, flexWrap } = node.style;
	node.style.width = 'max-content';
	node.style.flexWrap = 'nowrap';
	const needed = node.getBoundingClientRect().width;
	node.style.width = width;
	node.style.flexWrap = flexWrap;
	return needed;
}

export function fitChatLine(node: HTMLElement, _contents?: unknown) {
	let frame = 0;
	let width = -1;
	let live = true;
	const fit = () => {
		if (!live) return;
		node.style.removeProperty('--sp-chat-scale');
		const scale = chatLineScale(node.clientWidth, unwrappedWidth(node));
		if (scale < 1) node.style.setProperty('--sp-chat-scale', String(scale));
	};
	const schedule = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(fit);
	};
	const observer =
		typeof ResizeObserver === 'function'
			? new ResizeObserver((entries) => {
					const next = Math.round(entries[0]?.contentRect.width ?? 0);
					if (next === width) return;
					width = next;
					schedule();
				})
			: null;
	observer?.observe(node);
	void document.fonts?.ready.then(schedule, () => undefined);
	schedule();
	return {
		update: schedule,
		destroy() {
			live = false;
			cancelAnimationFrame(frame);
			observer?.disconnect();
		}
	};
}
