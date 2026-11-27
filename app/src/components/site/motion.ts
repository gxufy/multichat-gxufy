/*
 * Site-wide motion: quick 150 ms base transitions, springy press/toggle feedback, dropdowns that pop in,
 * panels that expand smoothly — written for Gxufy's own classes and colors.
 *
 * Website only: the OBS overlay never imports this. Everything is switched off
 * by `prefers-reduced-motion: reduce` (the pages' existing reduced-motion block
 * also forces durations to ~0).
 */

/** Our own damped-spring curve (≈9% overshoot), sampled for CSS linear(). */
export const SPRING_EASING =
  'linear(0, 0.110 5%, 0.347 10%, 0.604 15%, 0.819 20%, 0.970 25%, 1.057 30%, 1.091 35%, 1.092 40%, 1.073 45%, 1.049 50%, 1.026 55%, 1.009 60%, 0.998 65%, 0.992 70%, 0.991 75%, 0.992 80%, 0.994 85%, 0.997 90%, 0.998 95%, 1)';
/** A softer one (about 4.5% overshoot) for popups, panels and sliding pills. */
export const SPRING_SOFT_EASING =
  'linear(0, 0.135 5%, 0.397 10%, 0.653 15%, 0.846 20%, 0.965 25%, 1.025 30%, 1.045 35%, 1.043 40%, 1.032 45%, 1.020 50%, 1.010 55%, 1.003 60%, 1.000 65%, 0.998 70%, 0.998 75%, 0.998 80%, 0.999 85%, 0.999 90%, 1.000 95%, 1)';
export const EASE_STANDARD = 'cubic-bezier(.4, 0, .2, 1)';
export const EASE_OUT = 'cubic-bezier(0, 0, .2, 1)';
export const EXPAND_MS = 280;
export const COLLAPSE_MS = 200;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Tokens and keyframes shared by every page. */
export const MOTION_BASE_CSS = `
:root {
  --ease-standard: ${EASE_STANDARD};
  --ease-out: ${EASE_OUT};
  --ease-spring: ${SPRING_EASING};
  --ease-spring-soft: ${SPRING_SOFT_EASING};
  --dur-fast: .15s;
  --dur-med: .28s;
}
@keyframes gx-pop-in {
  from { opacity: 0; transform: translateY(-4px) scale(.96); filter: blur(4px); }
  60% { filter: blur(0); }
  to { opacity: 1; transform: none; filter: none; }
}
@keyframes gx-rise-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@keyframes gx-fade-in { from { opacity: 0; } to { opacity: 1; } }
`;

/** Generator page: controls, dropdowns, preview panels, cards. */
export const GENERATOR_MOTION_CSS = `${MOTION_BASE_CSS}
@media (prefers-reduced-motion: no-preference) {
  /* Cards rise in once on load, slightly staggered. 'backwards' (not 'both')
     so no transform lingers afterwards: a lingering transform would make each
     card its own stacking context and cover the dropdowns of the card above. */
  #generator-main > .card, .tool-grid > .card { animation: gx-rise-in .45s var(--ease-out) backwards; }
  .tool-grid > .card:nth-child(2) { animation-delay: .04s; }
  .tool-grid > .card:nth-child(3) { animation-delay: .08s; }
  .tool-grid > .card:nth-child(4) { animation-delay: .12s; }
  .tool-grid > .card:nth-child(5) { animation-delay: .16s; }
  .tool-grid > .card:nth-child(6) { animation-delay: .2s; }

  /* Dropdowns pop in from just under their field. */
  .channel-suggestions, .font-picker-options { transform-origin: top center; animation: gx-pop-in .22s var(--ease-out) backwards; }
  .channel-suggestion, .font-picker-option { transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }

  /* Switching preview tabs cross-fades the panel. */
  .preview-mode-panel { animation: gx-fade-in .25s var(--ease-out) backwards; }

  /* Springy press feedback on every control. */
  .url-copy, .url-open, .preview-mode-tab, .classic-seg-label, .classic-chip-label, .classic-conn-btn,
  .classic-clear, .settings-reset-btn, .settings-group-toggle, .pogly-widget-button, .obs-copy,
  .preview-label button, .preview-primary-actions > button, .home-link, .cmd-group, .cmd-syntax {
    transition: color var(--dur-fast) var(--ease-standard), background-color var(--dur-fast) var(--ease-standard),
      border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard),
      opacity var(--dur-fast) var(--ease-standard), scale .4s var(--ease-spring);
  }
  .url-copy:not(:disabled):active, .url-open:active, .preview-mode-tab:not(:disabled):active,
  .classic-seg-label:active, .classic-chip-label:active, .classic-conn-btn:not(:disabled):active,
  .classic-clear:active, .settings-reset-btn:active, .pogly-widget-button:active, .obs-copy:active,
  .preview-label button:active, .preview-primary-actions > button:not(:disabled):active, .home-link:active,
  .cmd-group:active, .cmd-syntax:active { scale: .96; }
  /* Filtering the command list fades the rows in. */
  .cmd-row { animation: gx-fade-in .2s var(--ease-out) backwards; }
  .settings-group-toggle:active { scale: .99; }

  /* Toggle knob springs across; the chevron springs open. */
  .toggle-slider { transition: background-color .2s var(--ease-standard); }
  .toggle-slider::before { transition: transform .45s var(--ease-spring), width .2s var(--ease-standard); }
  .toggle input:active + .toggle-slider::before { width: 20px; }
  .toggle input:checked:active + .toggle-slider::before { transform: translateX(14px); }
  .settings-group-chevron { transition: transform .4s var(--ease-spring); }

  /* Fields ease their focus ring in. */
  input[type=text], input[type=number], select, textarea {
    transition: border-color var(--dur-fast) var(--ease-standard), box-shadow .2s var(--ease-standard), background-color var(--dur-fast) var(--ease-standard);
  }
}
`;
