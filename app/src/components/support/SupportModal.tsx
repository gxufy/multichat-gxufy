/*
 * Support popup for the MultiChat page: the same checkout as /support, over a
 * blurred page. Springs in, closes with Esc, the close
 * button or a click outside, and hands focus back to the Support button.
 * The checkout code loads only when the popup first opens.
 */
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';

const SupportCheckout = dynamic(() => import('./SupportCheckout'), {
  ssr: false,
  loading: () => <div className="support-modal-loading" aria-hidden="true" />,
});

const CLOSE_MS = 200;

export const SUPPORT_MODAL_CSS = `
.support-modal { position: fixed; inset: 0; z-index: 100; overflow-y: auto; overscroll-behavior: contain;
  background: rgba(6, 6, 9, .5); -webkit-backdrop-filter: blur(12px) saturate(.9); backdrop-filter: blur(12px) saturate(.9);
  animation: gx-support-fade .22s ease-out both; }
.support-modal[data-state=closing] { animation: gx-support-fade-out ${CLOSE_MS}ms ease-in both; }
.support-modal-frame { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 48px 18px; }
.support-modal-panel { position: relative; width: min(960px, 100%); outline: none;
  animation: gx-support-pop .5s cubic-bezier(.22, 1.28, .36, 1) both; }
.support-modal[data-state=closing] .support-modal-panel { animation: gx-support-pop-out ${CLOSE_MS}ms ease-in both; }
.support-modal-close { position: absolute; top: 14px; right: 14px; z-index: 2; display: inline-grid; place-items: center;
  width: 38px; height: 38px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(20,20,24,.85);
  color: #e9eaf0; cursor: pointer; transition: background .15s, transform .2s; }
.support-modal-close:hover { background: rgba(255,255,255,.1); }
.support-modal-close:active { transform: scale(.94); }
.support-modal-close:focus-visible { outline: 2px solid #4a84fa; outline-offset: 2px; }
.support-modal-loading { height: 420px; border-radius: 22px; background: rgba(20,20,24,.85); }
@keyframes gx-support-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes gx-support-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes gx-support-pop { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes gx-support-pop-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (prefers-reduced-motion: reduce) {
  .support-modal, .support-modal-panel, .support-modal[data-state=closing], .support-modal[data-state=closing] .support-modal-panel { animation-duration: .01ms; }
}
`;

type PopupShellProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  /** Panel width; the support checkout is wider than the badges panel. */
  width?: string;
  children: React.ReactNode;
};

/**
 * The popup frame shared by Support and Badges: blurred page behind, springs
 * in, closes with Esc / the close button / a click outside, locks page scroll
 * and hands focus back to whatever opened it.
 */
export function PopupShell({ open, onClose, label, width, children }: PopupShellProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setClosing(false);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
      returnFocus.current?.focus();
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  /* Page behind stays put while the popup is open. */
  useEffect(() => {
    if (!mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mounted]);

  const requestClose = useCallback(() => {
    if (!closing) onClose();
  }, [closing, onClose]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, requestClose]);

  if (!mounted) return null;

  return (
    <div
      className="support-modal"
      data-state={closing ? 'closing' : 'open'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('support-modal-frame')) {
          requestClose();
        }
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: SUPPORT_MODAL_CSS }} />
      <div className="support-modal-frame">
        <div
          ref={panelRef}
          className="support-modal-panel"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          style={width ? { width: `min(${width}, 100%)` } : undefined}
        >
          <button type="button" className="support-modal-close" aria-label="Close" onClick={requestClose}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}

type SupportModalProps = {
  open: boolean;
  checkoutReady: boolean;
  onClose: () => void;
};

export default function SupportModal({ open, checkoutReady, onClose }: SupportModalProps) {
  return (
    <PopupShell open={open} onClose={onClose} label="Support Gxufy">
      <SupportCheckout checkoutReady={checkoutReady} variant="modal" onClose={onClose} />
    </PopupShell>
  );
}
