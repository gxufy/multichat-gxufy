/*
 * Moves an element to the end of <body>, and removes it again when Svelte destroys it.
 */
import type { Action } from 'svelte/action';

export const portal: Action<HTMLElement> = (node) => {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
};
