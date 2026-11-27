/*
 * Svelte action drawing shared chat parts as an element's content
 * (lib/render/domParts.ts: the exact markup, image failure handlers, and
 * stateful slots that keep their state across updates).
 */
import type { ChatPart } from '@/lib/render/elementTree';
import { mountParts } from '@/lib/render/domParts';

export function chatParts(node: Element, parts: readonly ChatPart[]) {
	const mounted = mountParts(node, parts);
	let current = parts;
	return {
		update(next: readonly ChatPart[]) {
			if (next === current) return;
			current = next;
			mounted.update(next);
		},
		destroy() {
			mounted.destroy();
		}
	};
}
