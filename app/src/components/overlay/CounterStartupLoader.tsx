/* The startup card FlossCounter shows until its first count is on screen.
 *
 * The same card as the chat overlay's (logo, dark glass, blue spinner), laid
 * out in two lines so it fits the counter's 400×80 browser source. Sizes are
 * capped by the source's height, so a shorter source gets a smaller card
 * instead of a clipped one. */
import { STARTUP_LOADER_FADE_MS, type StartupLoaderPhase } from '@/lib/startupLoader';

export const COUNTER_STARTUP_LOADER_CSS = `
  .fc-counter-loader {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: min(6px, 7vh);
    box-sizing: border-box;
    pointer-events: none;
    opacity: 1;
    transition: opacity ${STARTUP_LOADER_FADE_MS}ms ease;
  }
  .fc-counter-loader[data-phase='fading'] { opacity: 0; }
  .fc-counter-loader-card {
    display: flex;
    align-items: center;
    gap: min(12px, 15vh);
    max-width: 100%;
    max-height: 100%;
    box-sizing: border-box;
    padding: min(9px, 11vh) min(16px, 20vh);
    border: 1px solid rgba(255,255,255,.14);
    border-radius: min(14px, 18vh);
    background: rgba(20,20,24,.78);
    background-image: radial-gradient(ellipse 220px 90px at 30% -20px, rgba(74,132,250,.22), transparent);
    color: #fff;
    box-shadow: 0 8px 24px rgba(0,0,0,.34);
    backdrop-filter: blur(8px);
  }
  .fc-counter-loader-logo { height: min(44px, 55vh); width: auto; flex: 0 0 auto; filter: drop-shadow(0 3px 8px rgba(0,0,0,.45)); }
  .fc-counter-loader-copy { min-width: 0; font-family: 'Open Sans', Arial, system-ui, sans-serif; white-space: nowrap; }
  .fc-counter-loader-title {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: min(20px, 25vh);
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: -.025em;
  }
  .fc-counter-loader-byline { margin-left: .35em; color: #6d9dff; font-size: .6em; font-weight: 700; letter-spacing: 0; }
  .fc-counter-loader-status {
    display: flex;
    align-items: center;
    gap: min(8px, 10vh);
    margin: min(5px, 6vh) 0 0;
    color: rgba(255,255,255,.82);
    font-size: min(13px, 16vh);
    font-weight: 700;
  }
  .fc-counter-loader-spinner {
    width: min(13px, 16vh);
    height: min(13px, 16vh);
    flex: 0 0 auto;
    box-sizing: border-box;
    border: 2px solid rgba(255,255,255,.25);
    border-top-color: #6d9dff;
    border-radius: 50%;
    animation: fcCounterLoaderSpin .8s linear infinite;
  }
  @keyframes fcCounterLoaderSpin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .fc-counter-loader { transition: none; }
    .fc-counter-loader-spinner { animation: none; }
  }
`;

export default function CounterStartupLoader({ phase }: { phase: StartupLoaderPhase }) {
  if (phase === 'hidden') return null;
  return (
    <div className="fc-counter-loader" data-phase={phase} data-testid="counter-startup-loader">
      <div className="fc-counter-loader-card">
        <img className="fc-counter-loader-logo" src="/flosschat-logo.png" alt="" width={127} height={192} decoding="async" />
        <div className="fc-counter-loader-copy">
          <p className="fc-counter-loader-title">
            FlossCounter<span className="fc-counter-loader-byline">by @Gxufy</span>
          </p>
          <p className="fc-counter-loader-status">
            <span className="fc-counter-loader-spinner" aria-hidden="true" />
            Loading viewers…
          </p>
        </div>
      </div>
    </div>
  );
}
