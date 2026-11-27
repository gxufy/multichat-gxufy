/*
 * Browser tests only: a part of the page as text for a snapshot. Tags,
 * attributes in name order, inline styles as the browser reads them back, and
 * text (neighbouring text nodes merged, comments left out), one element per
 * line, indented by depth.
 */

type Canon = string | [string, [string, string][], string | null, Canon[]];

/*
 * Chromium builds write some inline styles back differently. A `background`
 * that leaves every part at its starting value reads back as
 * "background: transparent" in one build and "background: none" in a newer
 * one; both are the same declaration. The snapshots use the first spelling.
 */
const SAME_DECLARATION: readonly [RegExp, string][] = [[/(^|; )background: none;/g, '$1background: transparent;']];

/** An inline style as read back, written the same way whichever Chromium build reads it. */
export function styleText(element: HTMLElement): string {
	return SAME_DECLARATION.reduce((text, [pattern, same]) => text.replace(pattern, same), element.style.cssText);
}

/** One element as data: its tag, sorted attributes, inline style as read back, and what is in it. */
function canonElement(element: HTMLElement): Canon {
	const attrs = Array.from(element.attributes)
		.filter((attribute) => attribute.name !== 'style')
		.map((attribute): [string, string] => [attribute.name, attribute.value])
		.sort();
	return [
		element.tagName.toLowerCase(),
		attrs,
		element.getAttribute('style') === null ? null : styleText(element),
		canon(element)
	];
}

/** A subtree as data: tags, sorted attributes, inline styles as read back, merged text; comments ignored. */
export function canon(node: Node): Canon[] {
	const out: Canon[] = [];
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = (child as Text).data;
			if (!text) continue;
			if (typeof out[out.length - 1] === 'string') out[out.length - 1] += text;
			else out.push(text);
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			out.push(canonElement(child as HTMLElement));
		}
	}
	return out;
}

const quote = (value: string) => `"${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;

function lines(nodes: Canon[], indent: string): string {
	let out = '';
	for (const node of nodes) {
		if (typeof node === 'string') {
			out += `${indent}${JSON.stringify(node)}\n`;
			continue;
		}
		const [tag, attrs, style, children] = node;
		const attributes = attrs.map(([name, value]) => ` ${name}=${quote(value)}`).join('');
		out += `${indent}<${tag}${attributes}${style === null ? '' : ` style=${quote(style)}`}>\n`;
		out += lines(children, `${indent}  `);
	}
	return out;
}

/** The element itself and everything in it, as snapshot text. */
export function domText(element: HTMLElement): string {
	return lines([canonElement(element)], '');
}

/** True once every image that is loading has loaded or failed (lazy ones that never started don't count). */
export function imagesSettled(...sides: HTMLElement[]): boolean {
	return sides.every((side) =>
		Array.from(side.querySelectorAll('img')).every((img) => img.complete || img.loading === 'lazy')
	);
}

/**
 * The element's snapshot text once it has stopped changing: images from other
 * sites fail in the test browser (see vite.config.ts), and their fallbacks
 * (other art, then hiding) run on their own schedule.
 */
export async function settledText(element: HTMLElement, timeout = 5_000): Promise<string> {
	const until = performance.now() + timeout;
	let last = '';
	for (;;) {
		const now = imagesSettled(element) ? domText(element) : '';
		if (now && now === last) return now;
		if (performance.now() > until) throw new Error('the element kept changing');
		last = now;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}
