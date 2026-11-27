/*
 * The generator's full motion: menus that drop open from their field with a
 * springy squash and a blur that clears, rows that slide in one after another
 * when a section opens, a pill that slides to the chosen option (glide.ts),
 * panels that rise in, and springy feedback on press. Our own curves and
 * keyframes, in our own colors, layered on site/motion.ts.
 *
 * Generator page only; the OBS overlay never loads it. Under
 * prefers-reduced-motion everything here stops moving (the sliding pill
 * still marks the chosen option, it just doesn't slide).
 */

export { SPRING_SOFT_EASING } from '@/components/site/motion';

/** How long a section's rows take to slide in, and the gap between rows. */
export const ROW_IN_MS = 300;
export const ROW_STAGGER_MS = 22;
export const ROW_STAGGER_MAX = 12;

const MAIN = '#generator-main';
const GLIDE = `:is([data-glide=placed], [data-glide=ready])`;

export const GENERATOR_SPRING_MOTION_CSS = `
/* The sliding pill (glide.ts). */
${MAIN} [data-glide] { position: relative; isolation: isolate; }
${MAIN} ${GLIDE}::before {
  content: ''; position: absolute; z-index: 0; left: 0; top: 0; pointer-events: none;
  width: var(--glide-w); height: var(--glide-h); border-radius: var(--glide-r);
  translate: var(--glide-x) var(--glide-y); background: var(--accent);
}
${MAIN} ${GLIDE} > * { position: relative; z-index: 1; }
${MAIN} ${GLIDE} .classic-seg-label.on, ${MAIN} ${GLIDE} .classic-seg-label.on:hover,
${MAIN} ${GLIDE} .preview-mode-tab.active, ${MAIN} ${GLIDE} .cmd-group.on { background: transparent; }
${MAIN} ${GLIDE}:has(.classic-seg-label.on:hover)::before { background: var(--accent-2); }

@media (prefers-reduced-motion: no-preference) {
  ${MAIN} [data-glide=ready]::before {
    transition: translate .5s var(--ease-spring-soft), width .5s var(--ease-spring-soft),
      height .3s var(--ease-standard), border-radius .3s var(--ease-standard), background-color .15s var(--ease-standard);
  }

  /* Menus drop open from their field: squashed and blurred, then springing
     to full size; their options slide in one after another. */
  ${MAIN} .channel-suggestions, ${MAIN} .font-picker-options {
    transform-origin: top center;
    animation: gx-menu-drop .5s var(--ease-spring) backwards;
  }
  ${MAIN} :is(.channel-suggestions, .font-picker-options) > * { animation: gx-menu-item .32s var(--ease-out) backwards; }
  ${Array.from({ length: 10 }, (_, index) => `${MAIN} :is(.channel-suggestions, .font-picker-options) > :nth-child(${index + 2}) { animation-delay: ${(index + 1) * 18}ms; }`).join('\n  ')}

  /* Cards rise in once on load, out of a soft blur. */
  #generator-main > .card, .tool-grid > .card { animation: gx-card-rise .7s var(--ease-spring-soft) backwards; }

  /* Switching preview tabs: the new panel rises in. */
  ${MAIN} .preview-mode-panel { animation: gx-panel-rise .5s var(--ease-spring-soft) backwards; }

  /* "Copied" pops. */
  ${MAIN} .url-copy.ok, ${MAIN} .obs-copy.ok { animation: gx-pop .45s var(--ease-spring) backwards; }

  /* Command topics: the list re-sorts with a slide. */
  ${MAIN} .cmd-row { animation: gx-menu-item .3s var(--ease-out) backwards; }

  /* Springier presses and hovers on pills and chips. */
  ${MAIN} .classic-seg-label, ${MAIN} .preview-mode-tab, ${MAIN} .cmd-group, ${MAIN} .classic-chip-label {
    transition: color .15s var(--ease-standard), background-color .15s var(--ease-standard), scale .45s var(--ease-spring);
  }
  ${MAIN} .classic-seg-label:active, ${MAIN} .preview-mode-tab:not(:disabled):active,
  ${MAIN} .cmd-group:active, ${MAIN} .classic-chip-label:active { scale: .92; }

  /* The toggle knob stretches while held and springs across. */
  ${MAIN} .toggle-slider::before { transition: transform .5s var(--ease-spring), width .25s var(--ease-spring-soft); }

  /* The section bar's pill uses the soft spring too. */
  .page .section-nav .section-nav-indicator {
    transition: transform .55s var(--ease-spring-soft), width .55s var(--ease-spring-soft);
  }
}

@keyframes gx-menu-drop {
  0% { opacity: 0; scale: .8 .55; translate: 0 -6px; filter: blur(7px); }
  40% { opacity: 1; filter: blur(0); }
  100% { opacity: 1; scale: 1; translate: 0 0; filter: none; }
}
@keyframes gx-menu-item {
  from { opacity: 0; translate: 0 -5px; }
  to { opacity: 1; translate: 0 0; }
}
@keyframes gx-card-rise {
  0% { opacity: 0; translate: 0 14px; scale: .985; filter: blur(6px); }
  45% { opacity: 1; filter: blur(0); }
  100% { opacity: 1; translate: 0 0; scale: 1; filter: none; }
}
@keyframes gx-panel-rise {
  0% { opacity: 0; translate: 0 10px; filter: blur(5px); }
  50% { opacity: 1; filter: blur(0); }
  100% { opacity: 1; translate: 0 0; filter: none; }
}
@keyframes gx-pop {
  0% { scale: .86; }
  100% { scale: 1; }
}
`;
