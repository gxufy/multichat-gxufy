/* The Support/Badges popup frame's timing and stylesheet (PopupShell.svelte).
   The panel rises out of a blur with a soft spring; the backdrop's blur
   fades in with it. */
import { SPRING_SOFT_EASING } from '../site/motion';

export const CLOSE_MS = 200;

export const SUPPORT_MODAL_CSS = `
.support-modal { position: fixed; inset: 0; z-index: 100; overflow-y: auto; overscroll-behavior: contain;
  background: rgba(6, 6, 9, .5); -webkit-backdrop-filter: blur(12px) saturate(.9); backdrop-filter: blur(12px) saturate(.9);
  animation: gx-support-fade .22s ease-out both; }
.support-modal[data-state=closing] { animation: gx-support-fade-out ${CLOSE_MS}ms ease-in both; }
.support-modal-frame { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 48px 18px; }
.support-modal-panel { position: relative; width: min(960px, 100%); outline: none;
  animation: gx-support-pop .56s ${SPRING_SOFT_EASING} both; }
.support-modal[data-state=closing] .support-modal-panel { animation: gx-support-pop-out ${CLOSE_MS}ms ease-in both; }
.support-modal-close { position: absolute; top: 14px; right: 14px; z-index: 2; display: inline-grid; place-items: center;
  width: 38px; height: 38px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(20,20,24,.85);
  color: #e9eaf0; cursor: pointer; transition: background .15s, transform .2s; }
.support-modal-close:hover { background: rgba(255,255,255,.1); }
.support-modal-close:active { transform: scale(.94); }
.support-modal-close:focus-visible { outline: 2px solid #4a84fa; outline-offset: 2px; }
.support-modal-loading { height: 420px; border-radius: 22px; background: rgba(20,20,24,.85); }
@keyframes gx-support-fade {
  from { opacity: 0; -webkit-backdrop-filter: blur(0) saturate(1); backdrop-filter: blur(0) saturate(1); }
  to { opacity: 1; }
}
@keyframes gx-support-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes gx-support-pop {
  0% { opacity: 0; transform: translateY(18px) scale(.9); filter: blur(10px); }
  40% { opacity: 1; filter: blur(0); }
  100% { opacity: 1; transform: none; filter: none; }
}
@keyframes gx-support-pop-out { from { opacity: 1; transform: none; filter: none; } to { opacity: 0; transform: translateY(8px) scale(.95); filter: blur(6px); } }
@media (prefers-reduced-motion: reduce) {
  .support-modal, .support-modal-panel, .support-modal[data-state=closing], .support-modal[data-state=closing] .support-modal-panel { animation-duration: .01ms; }
}
`;
