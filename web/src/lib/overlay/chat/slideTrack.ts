/*
 * Slide's movement, done by moving a layer instead of laying the chat out
 * again on every frame. Under Slide, all of the chat's batches sit in one
 * track (ChatOverlay). A new batch is drawn at its full height straight away;
 * the track is moved down by that height, so nothing shifts on screen, and
 * springs back up (SLIDE_HEIGHT_SPRING, the Motion engine, frame by frame).
 * The rows above glide up exactly as far and as fast as when the batch's space
 * opened from zero height, but only a transform changes on the way. Moves of
 * batches still in flight add up.
 *
 * While anything moves, the track is its own layer (data-sliding) and the chat
 * container is clipped at the bottom of its content (data-slide-clip), the line
 * new rows rise from; both rules are in the overlay stylesheet.
 */
import { animate } from 'motion';
import { SLIDE_HEIGHT_SPRING } from '@/lib/chatRenderBatches';

/** Context key: ChatOverlay provides the track, SlideGroup moves it. */
export const SLIDE_TRACK = Symbol('slide track');

export type SlideMove = {
	/** Take this move's remaining distance off the track at once (its batch is gone). */
	cancel(): void;
	/** Settles when the move has finished or was cancelled. */
	readonly done: Promise<void>;
};

export type SlideTrack = {
	/** Svelte action for the track element. */
	attach(node: HTMLElement): { destroy(): void };
	/** `distance` px of new content was just drawn at the bottom: glide the rows above up by it. */
	push(distance: number): SlideMove;
};

const NO_MOVE: SlideMove = { cancel() {}, done: Promise.resolve() };

export function createSlideTrack(): SlideTrack {
	let track: HTMLElement | null = null;
	const moves = new Set<{ left: number; cancel(): void }>();

	function draw() {
		if (!track) return;
		let offset = 0;
		for (const move of moves) offset += move.left;
		track.style.transform = Math.abs(offset) >= 0.01 ? `translateY(${offset}px)` : '';
	}

	function setMoving(moving: boolean) {
		if (!track) return;
		track.toggleAttribute('data-sliding', moving);
		track.parentElement?.toggleAttribute('data-slide-clip', moving);
	}

	return {
		attach(node) {
			track = node;
			return {
				destroy() {
					for (const move of [...moves]) move.cancel();
					track = null;
				}
			};
		},

		push(distance) {
			if (!track || !Number.isFinite(distance) || Math.abs(distance) < 0.5) return NO_MOVE;
			let settle = () => {};
			const done = new Promise<void>((resolve) => (settle = resolve));
			const move = { left: distance, cancel: () => finish() };
			const finish = () => {
				animation.stop();
				if (!moves.delete(move)) return;
				if (!moves.size) setMoving(false);
				draw();
				settle();
			};
			moves.add(move);
			if (moves.size === 1) setMoving(true);
			draw();
			const animation = animate(0, distance, {
				...SLIDE_HEIGHT_SPRING,
				onUpdate(latest: number) {
					if (!moves.has(move)) return;
					move.left = distance - latest;
					draw();
				},
				onComplete: () => finish()
			});
			return { cancel: move.cancel, done };
		}
	};
}
