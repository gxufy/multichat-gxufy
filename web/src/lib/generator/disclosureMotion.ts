/*
 * Smooth expand/collapse for a disclosure body. The `hidden` attribute stays
 * the source of truth: this only animates the change, never on first render,
 * and not at all under prefers-reduced-motion. Opening springs the body to
 * its height and slides its rows in one after another.
 *
 * Used as a Svelte action: `use:disclosureMotion={open}`.
 */
import { tick } from 'svelte';
import type { Action } from 'svelte/action';
import {
	COLLAPSE_MS,
	EASE_OUT,
	EASE_STANDARD,
	prefersReducedMotion
} from '@/components/site/motion';
import { ROW_IN_MS, ROW_STAGGER_MAX, ROW_STAGGER_MS, SPRING_SOFT_EASING } from './generatorMotion.ts';

/** Opening runs a little longer than site/motion's, for the spring to settle. */
export const SPRING_EXPAND_MS = 380;

export const disclosureMotion: Action<HTMLElement, boolean> = (element, initialOpen) => {
	let open = initialOpen;
	let running: Animation | null = null;
	let safety: ReturnType<typeof setTimeout> | null = null;

	const settleLater = (animation: Animation, ms: number) => {
		if (safety) clearTimeout(safety);
		safety = setTimeout(() => {
			if (animation.playState !== 'finished' && animation.playState !== 'idle') animation.finish();
		}, ms + 120);
	};

	const animate = (nowOpen: boolean) => {
		if (typeof element.animate !== 'function' || prefersReducedMotion()) return;
		running?.cancel();
		const style = getComputedStyle(element);
		const reset = () => {
			element.style.overflow = '';
			element.inert = false;
		};

		if (nowOpen) {
			const full = {
				height: `${element.scrollHeight}px`,
				paddingTop: style.paddingTop,
				paddingBottom: style.paddingBottom,
				opacity: 1
			};
			element.style.overflow = 'hidden';
			const animation = element.animate(
				[{ height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }, full],
				{ duration: SPRING_EXPAND_MS, easing: SPRING_SOFT_EASING }
			);
			animation.onfinish = reset;
			animation.oncancel = reset;
			running = animation;
			settleLater(animation, SPRING_EXPAND_MS);
			/* Nothing is left on the rows afterwards ('backwards' only), so no
			   row keeps a transform that would cover a menu opened later. */
			[...element.children].slice(0, ROW_STAGGER_MAX).forEach((row, index) => {
				row.animate(
					[
						{ opacity: 0, transform: 'translateY(8px)' },
						{ opacity: 1, transform: 'none' }
					],
					{ duration: ROW_IN_MS, delay: 40 + index * ROW_STAGGER_MS, easing: EASE_OUT, fill: 'backwards' }
				);
			});
			return;
		}

		element.hidden = false;
		element.inert = true;
		element.style.overflow = 'hidden';
		const animation = element.animate(
			[
				{
					height: `${element.scrollHeight}px`,
					paddingTop: style.paddingTop,
					paddingBottom: style.paddingBottom,
					opacity: 1
				},
				{ height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }
			],
			{ duration: COLLAPSE_MS, easing: EASE_STANDARD }
		);
		animation.onfinish = () => {
			element.hidden = true;
			reset();
		};
		animation.oncancel = reset;
		running = animation;
		settleLater(animation, COLLAPSE_MS);
	};

	return {
		update(nextOpen) {
			if (nextOpen === open) return;
			open = nextOpen;
			/* After Svelte has applied the new `hidden`. */
			void tick().then(() => {
				if (open === nextOpen) animate(nextOpen);
			});
		},
		destroy() {
			if (safety) clearTimeout(safety);
			running?.cancel();
		}
	};
};
