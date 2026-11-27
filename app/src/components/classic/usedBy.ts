/* Featured streamers row and clip carousel: labels, clip-time and carousel
   helpers, and the stylesheet, for the generator's featured streamers. */
export const CLOSE_ANIMATION_MS = 140;

/* The heading, said the same way on the page and in the carousel. */
export const USED_BY_PRODUCTS_LABEL = 'Featured streamers using FlossChat and FlossCounter';
/* The hint shown when hovering a name in the row: the clip plays right here,
   nothing opens Twitch. */
export const USED_BY_HINT = 'Play a clip from their stream';

/* 75.4 → "1:15". */
export function formatClipTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/* Shortest way round the ring from the current clip: -4 … +5 for 10 clips. */
export function carouselOffset(position: number, current: number, count: number): number {
  let offset = (position - current) % count;
  if (offset > count / 2) offset -= count;
  if (offset <= -count / 2) offset += count;
  return offset;
}

export const USED_BY_CSS = `
.used-by { display: flex; flex-direction: column; gap: 9px; margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--line, #2c2c35); min-width: 0; }
.used-by-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin: 0; min-width: 0; }
.used-by-title { color: var(--muted, #9a9aa5); font-size: .8rem; font-weight: 700; }
.used-by-product { color: var(--accent-2, #6d9dff); font-weight: 800; }
.used-by-row { list-style: none; margin: 0; padding: 2px; display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
@media (max-width: 720px) {
  .used-by { gap: 8px; }
  .used-by-row { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; scrollbar-width: none; padding-bottom: 4px; }
  .used-by-row::-webkit-scrollbar { display: none; }
}
.used-by-person { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 32px; margin: 0; padding: 3px 12px 3px 3px;
  border-radius: 999px; border: 1px solid var(--line, #2c2c35); background: rgba(255,255,255,.03);
  color: var(--text, #e2e2e8); font: inherit; font-size: .76rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
.used-by-person:hover { color: #fff; border-color: rgba(109,157,255,.55); background: rgba(74,132,250,.1); }
.used-by-person:focus-visible { outline: 2px solid var(--accent-2, #6d9dff); outline-offset: 2px; }
/* With a mouse, a play sign covers the picture on hover; on touch screens
   (no hover) a small play sign sits after the name instead. */
.used-by-avatar-play { display: grid; place-items: center; width: 100%; height: 100%; border-radius: 999px;
  background: rgba(74,132,250,.88); color: #fff; opacity: 0; scale: .5; }
.used-by-avatar-play svg { margin-left: 1px; }
.used-by-person:hover .used-by-avatar-play, .used-by-person:focus-visible .used-by-avatar-play { opacity: 1; scale: 1; }
.used-by-person-play { display: none; place-items: center; width: 18px; height: 18px; border-radius: 999px;
  background: rgba(74,132,250,.18); color: var(--accent-2, #6d9dff); }
.used-by-person-play svg { margin-left: 1px; }
@media (hover: none) {
  .used-by-person { padding-right: 6px; }
  .used-by-person-play { display: inline-grid; }
}
.used-by-tip { position: absolute; left: 0; bottom: calc(100% + 9px); z-index: 5; padding: 6px 10px; border-radius: 9px;
  background: var(--accent, #4a84fa); color: #fff; font-size: .72rem; font-weight: 800; white-space: nowrap; pointer-events: none;
  box-shadow: 0 10px 24px rgba(0,0,0,.45); opacity: 0; translate: 0 5px; scale: .94; transform-origin: 14px 100%; }
.used-by-tip::after { content: ''; position: absolute; left: 11px; top: 100%; border: 5px solid transparent; border-top-color: var(--accent, #4a84fa); }
.used-by-person:focus-visible .used-by-tip { opacity: 1; translate: 0 0; scale: 1; }
@media (hover: hover) {
  .used-by-person:hover .used-by-tip { opacity: 1; translate: 0 0; scale: 1; }
}
@media (max-width: 720px) {
  .used-by-tip { display: none; }
}
.used-by-avatar { position: relative; flex: none; display: inline-grid; place-items: center; width: 24px; height: 24px;
  border-radius: 999px; overflow: hidden; background: #24242c; box-shadow: 0 0 0 1px rgba(255,255,255,.14); }
.used-by-avatar > * { grid-area: 1 / 1; }
.used-by-avatar-mark { width: 14px; height: 14px; object-fit: contain; }
.used-by-avatar-photo { width: 100%; height: 100%; object-fit: cover; }

@media (prefers-reduced-motion: no-preference) {
  .used-by-person { transition: color .15s var(--ease-standard, ease), border-color .15s var(--ease-standard, ease),
    background-color .15s var(--ease-standard, ease), scale .4s var(--ease-spring, ease-out); }
  .used-by-person:active { scale: .96; }
  .used-by-avatar-play { transition: opacity .15s var(--ease-out, ease-out), scale .45s var(--ease-spring, ease-out); }
  .used-by-avatar { transition: scale .45s var(--ease-spring, ease-out), box-shadow .2s var(--ease-standard, ease); }
  .used-by-person:hover .used-by-avatar, .used-by-person:focus-visible .used-by-avatar {
    scale: 1.18; box-shadow: 0 0 0 2px var(--accent, #4a84fa), 0 0 12px rgba(74,132,250,.55); }
  .used-by-tip { transition: opacity .12s var(--ease-out, ease-out), translate .4s var(--ease-spring, ease-out), scale .4s var(--ease-spring, ease-out); }
  .used-by-person:hover .used-by-tip { transition-delay: .12s; }
  .used-by-avatar-photo { animation: gx-fade-in .3s var(--ease-out, ease-out) backwards; }
  .used-by-row > li { animation: gx-used-by-pill .55s var(--ease-spring, ease-out) backwards;
    animation-delay: calc(.18s + var(--i, 0) * 45ms); }
}

.used-by-carousel:focus { outline: none; }
/* The carousel sits in the middle at a modest size on top of the page, which
   stays in view around it with only a light blur. */
.used-by-carousel { --slide-w: min(50vw, calc((100vh - 340px) * 16 / 9)); --slide-h: calc(var(--slide-w) * 9 / 16);
  --col: min(96vw, calc(var(--slide-w) * 1.45)); --slide-step: .88; --player-h: 70px;
  position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden;
  background: rgba(6,6,9,.3); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.used-by-carousel-panel { width: var(--col); max-height: 100%; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.used-by-carousel-head { align-self: stretch; display: flex; align-items: center; gap: 12px; min-height: 38px; }
.used-by-carousel-title { min-width: 0; color: #f1f2f6; font-size: 1.05rem; font-weight: 700; line-height: 1.3;
  text-shadow: 0 1px 3px rgba(0,0,0,.9), 0 0 14px rgba(0,0,0,.7); }
.used-by-carousel-close { margin-left: auto; flex: none; display: inline-grid; place-items: center; width: 38px; height: 38px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.14); background: rgba(20,20,24,.85); color: #e9eaf0; cursor: pointer; }
.used-by-carousel-close:hover { background: rgba(255,255,255,.1); }
.used-by-carousel-close:focus-visible, .used-by-slide-pick:focus-visible, .used-by-control:focus-visible, .used-by-twitch:focus-visible,
.used-by-carousel-arrow:focus-visible, .used-by-carousel-name:focus-visible { outline: 2px solid var(--accent-2, #6d9dff); outline-offset: 2px; }
.used-by-carousel-stage { position: relative; align-self: stretch; height: calc(var(--slide-h) + var(--player-h)); touch-action: pan-y; }
/* The clips at the sides fade out towards the edges of the carousel. */
.used-by-carousel-track { position: absolute; left: 0; right: 0; top: -40px; height: calc(var(--slide-h) + 80px); overflow: hidden; pointer-events: none;
  -webkit-mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent); }
.used-by-slide { position: absolute; left: 50%; top: 40px; width: var(--slide-w); aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden;
  background: #000; translate: calc(-50% + var(--offset) * var(--slide-w) * var(--slide-step)) 0; scale: .72; opacity: 0; z-index: 1;
  pointer-events: none; box-shadow: 0 18px 40px rgba(0,0,0,.5); }
/* Side clips are dimmed but solid, so the page behind does not show through them. */
.used-by-slide[data-offset="-1"], .used-by-slide[data-offset="1"] { opacity: 1; filter: brightness(.45) saturate(.85); z-index: 2; pointer-events: auto; cursor: pointer; }
.used-by-slide[data-offset="-1"]:hover, .used-by-slide[data-offset="1"]:hover { filter: brightness(.7); }
.used-by-slide[data-centre=true] { scale: 1; opacity: 1; z-index: 3; pointer-events: auto; box-shadow: 0 0 0 1px rgba(74,132,250,.4), 0 18px 40px rgba(0,0,0,.6); }
.used-by-slide-tile, .used-by-slide-clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
.used-by-slide-clip { opacity: 0; cursor: pointer; transition: opacity .25s ease; }
.used-by-slide-clip[data-ready=true] { opacity: 1; }
.used-by-slide-paused { position: absolute; left: 50%; top: 50%; z-index: 2; translate: -50% -50%; display: grid; place-items: center;
  width: 68px; height: 68px; border-radius: 999px; background: rgba(10,10,14,.62); color: #fff; pointer-events: none;
  box-shadow: 0 0 0 1px rgba(255,255,255,.18); }
.used-by-slide-paused svg { margin-left: 4px; }
.used-by-slide-pick { position: absolute; inset: 0; padding: 0; margin: 0; border: 0; background: transparent; cursor: pointer; font: inherit; color: #fff; }
.used-by-tile-name { position: absolute; left: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px; max-width: calc(100% - 20px);
  padding: 3px 10px 3px 3px; border-radius: 999px; background: rgba(10,10,14,.72); font-size: .8rem; font-weight: 800;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.used-by-slide[data-offset="-1"] .used-by-tile-name { left: auto; right: 10px; }

.used-by-player { position: absolute; z-index: 4; left: 50%; top: calc(var(--slide-h) + 12px); width: var(--slide-w);
  translate: -50% 0; display: flex; flex-direction: column; gap: 6px; }
.used-by-player-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.used-by-control { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 34px; height: 34px; padding: 0 9px; margin: 0;
  border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: rgba(20,20,24,.85); color: #fff; cursor: pointer;
  font: inherit; font-size: .72rem; font-weight: 700; white-space: nowrap; }
.used-by-control:hover { background: rgba(255,255,255,.14); }
.used-by-control[data-forced=true] { background: var(--accent, #4a84fa); border-color: var(--accent, #4a84fa); }
.used-by-control:disabled { cursor: default; opacity: .5; background: rgba(20,20,24,.85); }
.used-by-skip { padding: 0 8px; }
.used-by-volume { display: inline-flex; align-items: center; gap: 8px; }
.used-by-time { margin-left: 4px; color: #e2e3ea; font-size: .76rem; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0,0,0,.9); }
.used-by-range { --fill: 0%; -webkit-appearance: none; appearance: none; display: block; height: 16px; margin: 0; padding: 0;
  background: transparent; cursor: pointer; }
.used-by-range:disabled { cursor: default; opacity: .5; }
.used-by-range:focus { outline: none; }
.used-by-range::-webkit-slider-runnable-track { height: 4px; border-radius: 999px;
  background: linear-gradient(to right, var(--accent, #4a84fa) var(--fill), rgba(255,255,255,.24) var(--fill)); }
.used-by-range::-moz-range-track { height: 4px; border-radius: 999px;
  background: linear-gradient(to right, var(--accent, #4a84fa) var(--fill), rgba(255,255,255,.24) var(--fill)); }
.used-by-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; margin-top: -5px; border: 0;
  border-radius: 999px; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.5); }
.used-by-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 999px; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.5); }
.used-by-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--accent-2, #6d9dff); }
.used-by-range:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--accent-2, #6d9dff); }
.used-by-seek { width: 100%; }
.used-by-volume-range { width: 76px; }
.used-by-twitch { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; height: 34px; min-width: 0; padding: 0 12px 0 11px;
  border-radius: 999px; background: #9146ff; color: #fff; font-size: .8rem; font-weight: 800; text-decoration: none; white-space: nowrap;
  box-shadow: 0 6px 18px rgba(145,70,255,.35); }
.used-by-twitch:hover { background: #a970ff; color: #fff; opacity: 1; }
.used-by-twitch-mark { flex: none; width: 14px; height: 16px; object-fit: contain; }
.used-by-twitch-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.used-by-twitch-on { font-weight: 600; opacity: .85; }
.used-by-twitch svg { flex: none; opacity: .85; }

.used-by-carousel-arrow { position: absolute; top: calc(var(--slide-h) / 2); z-index: 4; translate: 0 -50%; display: inline-grid; place-items: center;
  width: 46px; height: 46px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: rgba(20,20,24,.85); color: #fff; cursor: pointer; }
.used-by-carousel-arrow:hover { background: var(--accent, #4a84fa); border-color: var(--accent, #4a84fa); }
.used-by-carousel-arrow.is-prev { left: 4px; }
.used-by-carousel-arrow.is-next { right: 4px; }
.used-by-carousel-names { width: max-content; max-width: 96vw; display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 2px; }
.used-by-carousel-name { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 3px 13px 3px 3px; margin: 0;
  border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(20,20,24,.85); color: #c9cad3;
  font: inherit; font-size: .8rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
.used-by-carousel-name:hover { color: #fff; border-color: rgba(109,157,255,.55); background: rgba(74,132,250,.12); }
.used-by-carousel-name[aria-current=true] { color: #fff; border-color: var(--accent, #4a84fa); background: var(--accent, #4a84fa);
  box-shadow: 0 6px 20px rgba(74,132,250,.35); }
.used-by-carousel-name[aria-current=true] .used-by-avatar { box-shadow: 0 0 0 2px rgba(255,255,255,.9); }
@media (max-width: 760px), (max-aspect-ratio: 1/1) {
  .used-by-carousel { --slide-w: 80vw; --col: 94vw; --slide-step: .84; --player-h: 128px; padding: 12px; }
  .used-by-carousel-track { -webkit-mask-image: linear-gradient(to right, transparent, #000 4%, #000 96%, transparent);
    mask-image: linear-gradient(to right, transparent, #000 4%, #000 96%, transparent); }
  .used-by-carousel-arrow { width: 40px; height: 40px; top: calc(var(--slide-h) + 82px); translate: none; }
  .used-by-carousel-arrow.is-prev { left: calc(50% - var(--slide-w) / 2); }
  .used-by-carousel-arrow.is-next { right: calc(50% - var(--slide-w) / 2); }
  .used-by-slide-pick .used-by-tile-name { display: none; }
  .used-by-volume-range, .used-by-twitch-on { display: none; }
  /* With back/forward buttons the Twitch link gets its own line, between the clip arrows. */
  .used-by-player-row.has-skip { display: grid; grid-template-columns: repeat(4, auto) minmax(0, 1fr); row-gap: 17px; }
  .used-by-player-row.has-skip .used-by-time { overflow: hidden; text-overflow: ellipsis; }
  .used-by-player-row.has-skip[data-forced=true] .used-by-time { display: none; }
  .used-by-player-row.has-skip .used-by-twitch { grid-column: 1 / -1; justify-self: center; max-width: calc(100% - 104px); margin: 0; }
  .used-by-time { font-size: .7rem; margin-left: 2px; }
  .used-by-twitch { padding: 0 10px 0 9px; font-size: .76rem; }
  .used-by-carousel-title { font-size: .95rem; }
  .used-by-carousel-names { width: 100%; max-width: none; flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; scrollbar-width: none; }
  .used-by-carousel-names::-webkit-scrollbar { display: none; }
  .used-by-carousel-name { flex: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .used-by-carousel { animation: gx-fade-in .22s var(--ease-out, ease-out) both; }
  .used-by-carousel[data-state=closing] { animation: gx-used-by-carousel-out ${CLOSE_ANIMATION_MS}ms var(--ease-standard, ease-in) both; }
  .used-by-slide { transition: translate .65s var(--ease-spring, ease-out), scale .65s var(--ease-spring, ease-out),
    opacity .35s var(--ease-out, ease-out), filter .35s var(--ease-out, ease-out), box-shadow .3s var(--ease-standard, ease); }
  .used-by-carousel-panel { animation: gx-used-by-pop .6s var(--ease-spring, ease-out) both; --from-y: 14px; }
  .used-by-slide-paused { animation: gx-used-by-pop .35s var(--ease-spring, ease-out) both; --from-y: 0px; }
  .used-by-carousel-arrow, .used-by-carousel-name, .used-by-control, .used-by-twitch { transition: background .2s var(--ease-standard, ease),
    border-color .2s var(--ease-standard, ease), color .15s, box-shadow .25s var(--ease-standard, ease), scale .4s var(--ease-spring, ease-out); }
  .used-by-carousel-arrow:active, .used-by-carousel-name:active, .used-by-control:active, .used-by-twitch:active { scale: .94; }
  .used-by-range::-webkit-slider-thumb { transition: scale .3s var(--ease-spring, ease-out); }
  .used-by-range:hover::-webkit-slider-thumb, .used-by-range:active::-webkit-slider-thumb { scale: 1.2; }
  .used-by-carousel-name .used-by-avatar { transition: box-shadow .2s var(--ease-standard, ease), scale .45s var(--ease-spring, ease-out); }
  .used-by-carousel-name:hover .used-by-avatar, .used-by-carousel-name[aria-current=true] .used-by-avatar { scale: 1.08; }
}
@keyframes gx-used-by-carousel-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes gx-used-by-pill {
  from { opacity: 0; transform: translateY(6px) scale(.85); filter: blur(4px); }
  to { opacity: 1; transform: none; filter: none; }
}
@keyframes gx-used-by-pop {
  from { opacity: 0; transform: translateY(var(--from-y, -8px)) scale(.82); filter: blur(8px); }
  50% { filter: blur(0); }
  to { opacity: 1; transform: none; filter: none; }
}
`;
