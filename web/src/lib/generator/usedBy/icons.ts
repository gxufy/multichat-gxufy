/* The featured-streamers icons, as SVG markup. */
const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

/* How far the back/forward buttons, J/L and the seek bar's arrow keys jump. */
export const SKIP_STEP_S = 5;

export function playIcon(size = 16): string {
	return `<svg aria-hidden="true" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z"></path></svg>`;
}

export const PAUSE_ICON =
	'<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="5.5" y="4" width="4.5" height="16" rx="1.2"></rect><rect x="14" y="4" width="4.5" height="16" rx="1.2"></rect></svg>';

export function soundIcon(muted: boolean): string {
	const waves = muted
		? '<path d="m22 9-6 6M16 9l6 6"></path>'
		: '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"></path>';
	return `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" stroke-width="2.2" ${STROKE}><path d="M11 5 6 9H3v6h3l5 4V5Z"></path>${waves}</svg>`;
}

/* Back or forward a few seconds: a nearly full turn with the step in the middle. */
export function skipIcon(direction: -1 | 1): string {
	const turn =
		direction < 0
			? '<path d="M12 4a8 8 0 1 1-6.93 4"></path><path d="M14.5 1.5 12 4l2.5 2.5"></path>'
			: '<path d="M12 4a8 8 0 1 0 6.93 4"></path><path d="M9.5 1.5 12 4 9.5 6.5"></path>';
	return `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><g stroke-width="2" ${STROKE}>${turn}</g><text x="12" y="15.2" text-anchor="middle" font-size="8.5" font-weight="800" fill="currentColor">${SKIP_STEP_S}</text></svg>`;
}

export const EXTERNAL_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" stroke-width="2.4" ${STROKE}><path d="M7 17 17 7M9 7h8v8"></path></svg>`;
export const PREV_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" stroke-width="2.4" ${STROKE}><path d="M15 5l-7 7 7 7"></path></svg>`;
export const NEXT_ICON = `<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" stroke-width="2.4" ${STROKE}><path d="M9 5l7 7-7 7"></path></svg>`;
export const CLOSE_ICON =
	'<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

/* Sound as the visitor last set it; kept while the page is open. */
export type SoundPrefs = { muted: boolean; volume: number };
export type SoundRef = { current: SoundPrefs };

export function skipBy(clip: HTMLVideoElement, seconds: number) {
	const duration = Number.isFinite(clip.duration) ? clip.duration : 0;
	if (!duration) return;
	clip.currentTime = Math.min(duration, Math.max(0, clip.currentTime + seconds));
}

export function togglePlayback(clip: HTMLVideoElement) {
	if (clip.paused) clip.play()?.catch(() => undefined);
	else clip.pause();
}

export function toggleSound(clip: HTMLVideoElement, sound: SoundRef) {
	const muted = !clip.muted;
	clip.muted = muted;
	if (!muted && clip.volume === 0) clip.volume = 1;
	sound.current = { muted, volume: clip.volume };
}
