/** @jsxImportSource ./jsx */
/*
 * The Hype Train card the overlay draws (through domParts), built as
 * parts. Our own design and drawings.
 *
 * Two rows on a dark glass card:
 *  - top: the train's mark, its name and level ("Hype Train · Level 3"), what
 *    the next level still needs (bits with a cheer gem, or subs with a gift),
 *    a treasure train's gift discount, and on the right the level's countdown,
 *    whose outline drains as time runs out and warms to amber, then red;
 *  - bottom: the track, its fill flowing in Gxufy's rainbow (or the train
 *    kind's colours) with a glow and a passing light, our locomotive riding
 *    the fill's front edge with spinning wheels and smoke, and the percentage.
 * A level-up (or a train that just started) hides the top row while its words
 * cross the whole card once, fills the track to the brim with a sheen, and
 * throws confetti over the chat.
 *
 * Looping animations take their phase from the clock (`phaseAt`), so a card
 * drawn again (the DOM renderer redraws on each update) carries on where the
 * last one was instead of starting over. The countdown text is kept current by
 * the renderers (hypeClockState each second).
 */
import type { ElementStyle } from './elementTree';
import type { HypeTrainCelebration, HypeTrainEventData, HypeTrainKind } from '../types';

const NUMBER = new Intl.NumberFormat('en-US');

/** A level's window on Twitch: what the countdown ring measures against. */
export const HYPE_LEVEL_WINDOW_MS = 5 * 60_000;
/** A train this new (at level 1) gets its kickoff words when first seen. The
    overlay looks for a train once a minute while none runs, so this allows a
    full check plus the answer's way back. */
export const HYPE_KICKOFF_WITHIN_MS = 75_000;
/** A Tier 1 sub is 500 points; a bit is 1. */
const SUB_POINTS = 500;

/** How each kind of train looks: its name, its fill and its accent. */
interface KindLook {
  name: string;
  /** Gradient stops (looping: first and last the same); none keeps the Gxufy rainbow. */
  fill?: readonly string[];
  accent: string;
}

const KIND_LOOKS: Readonly<Record<HypeTrainKind, KindLook>> = {
  regular: { name: 'Hype Train', accent: '#c9b6ff' },
  'golden-kappa': { name: 'Golden Kappa Train', fill: ['#ffe58a', '#ffc400', '#ff9d00', '#ffe58a'], accent: '#ffd54a' },
  treasure: { name: 'Treasure Train', fill: ['#3ee6b0', '#ffd84a', '#2fbf8f', '#3ee6b0'], accent: '#7ff0c8' },
  mythic: { name: 'Mythic Train', fill: ['#b26bff', '#ff5fd2', '#6a7bff', '#b26bff'], accent: '#dd9cff' },
  community: { name: 'Community Train', fill: ['#35d8df', '#5b8cff', '#7ef0c4', '#35d8df'], accent: '#7fe6ff' },
  pinata: { name: 'Piñata Train', fill: ['#ff5fa2', '#ff9f43', '#ffd84a', '#ff5fa2'], accent: '#ff9cc8' },
};

/** The Gxufy rainbow, also the confetti's colours for a regular train. */
const RAINBOW = ['#ff5fa2', '#9d6cff', '#5b8cff', '#35d8df', '#ffd84a'];

/** Our level-up words, after "Level N!". */
const LEVEL_WORDS = [
  'Keep the coal coming!',
  'Chat is on fire!',
  'Nobody is stopping this one!',
  'Next stop: the top!',
  'Hype is climbing!',
  'What a ride, chat!',
  'Louder, chat!',
  'The engine is roaring!',
];

export function hypeTrainTitle(data: Pick<HypeTrainEventData, 'kind' | 'shared'>): string {
  const name = KIND_LOOKS[data.kind ?? 'regular'].name;
  return data.shared ? `Shared ${name}` : name;
}

/** Bits as people say them: 950, 1,400, 12.5K, 120K. */
export function shortBits(bits: number): string {
  if (bits < 10_000) return NUMBER.format(bits);
  const thousands = bits / 1000;
  return `${thousands < 100 ? Math.floor(thousands * 10) / 10 : Math.floor(thousands)}K`;
}

/** A cheer gem's colour for an amount of bits (Twitch's tiers: 1, 100, 1,000, 5,000, 10,000). */
function gemColor(bits: number): string {
  if (bits >= 10_000) return '#f43021';
  if (bits >= 5_000) return '#0099fe';
  if (bits >= 1_000) return '#1db2a5';
  if (bits >= 100) return '#9c3ee8';
  return '#979797';
}

export interface HypeClockState {
  text: string;
  /** '' calm, 'warm' under a minute, 'hot' under 20 seconds. */
  heat: '' | 'warm' | 'hot';
}

/** The countdown as shown at `now`. */
export function hypeClockState(endsAt: number, now: number): HypeClockState {
  const left = Math.max(0, endsAt - now);
  const seconds = Math.ceil(left / 1000);
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return { text, heat: seconds <= 20 ? 'hot' : seconds <= 60 ? 'warm' : '' };
}

export type HypeCelebration = HypeTrainCelebration;

/** How long words take to cross the card: a steady reading pace, within bounds. */
export function hypeCrossMs(words: string): number {
  return Math.min(9000, Math.max(4000, 1600 + words.length * 110));
}

/**
 * Whether this update starts a celebration. `before` is the last state seen
 * (null: the first). A level-up is the level rising, or the bar emptying while
 * the train still runs (Twitch resets the bar a moment before the level moves).
 */
export function hypeCelebrationFor(
  before: { level: number; progress: number } | null,
  data: HypeTrainEventData,
  now: number,
): HypeCelebration | null {
  if (data.phase !== 'progress') return null;
  if (!before) {
    if (data.level > 1 || data.startedAt === undefined) return null;
    const age = now - data.startedAt;
    if (age < 0 || age >= HYPE_KICKOFF_WITHIN_MS) return null;
    const words = `${hypeTrainTitle(data)} started! Hop on!`;
    return { kind: 'kickoff', level: data.level, words, ms: hypeCrossMs(words), at: now };
  }
  const stillRunning = data.endsAt === undefined || data.endsAt - now > 3000;
  const levelIncreased = data.level > before.level;
  const progressReset = stillRunning && before.progress > 0 && data.progress < before.progress * 0.5 && data.level >= before.level;
  if (!levelIncreased && !progressReset) return null;
  const level = levelIncreased ? data.level : before.level + 1;
  const words = `Level ${level}! ${LEVEL_WORDS[(level - 2 + LEVEL_WORDS.length * 4) % LEVEL_WORDS.length]}`;
  return { kind: 'level', level, words, ms: hypeCrossMs(words), at: now };
}

/** The percentage the bar shows. */
export function hypePercent(data: Pick<HypeTrainEventData, 'progress' | 'goal'>): number {
  return data.goal > 0 ? Math.min(100, Math.max(0, Math.round((data.progress / data.goal) * 100))) : 0;
}

/** The celebration still playing at `now`, if any. */
export function activeHypeCelebration(data: Pick<HypeTrainEventData, 'celebration'>, now: number): HypeCelebration | null {
  const celebration = data.celebration;
  return celebration && now >= celebration.at && now < celebration.at + celebration.ms ? celebration : null;
}

/**
 * A train update as the chat shows it (the overlay runtime, once per update;
 * the card is drawn afresh as the newest row each time): the celebration this
 * update starts, or the one still playing, and where the bar was before.
 */
export function hypeTrainUpdate(
  before: HypeTrainEventData | null,
  event: HypeTrainEventData,
  now: number,
): HypeTrainEventData {
  const plain: HypeTrainEventData = { ...event };
  delete plain.celebration;
  delete plain.fromPercent;
  const started = hypeCelebrationFor(
    before && before.phase === 'progress' ? { level: before.level, progress: before.progress } : null,
    plain,
    now,
  );
  const playing = before && plain.phase === 'progress' ? activeHypeCelebration(before, now) : null;
  const celebration = started ?? playing;
  const fromPercent = before && before.phase === 'progress'
    ? (activeHypeCelebration(before, now)?.kind === 'level' ? 100 : hypePercent(before))
    : undefined;
  return {
    ...plain,
    ...(celebration ? { celebration } : {}),
    ...(fromPercent !== undefined ? { fromPercent } : {}),
  };
}

/** A negative delay that puts a loop of `periodMs` where the clock says it is. */
const phase = (at: number, periodMs: number, offsetMs = 0) => `${-((at + offsetMs) % periodMs)}ms`;

/** A small pseudo-random number in [0, 1) from two integers (the confetti's layout). */
function scatter(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Our locomotive, side on, facing the way it travels (right). */
function Locomotive({ wheels }: { wheels: boolean }) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const wheel = (cx: number, cy: number, r: number) => {
    const spoke = round(r * 0.7);
    return (
      <g className={wheels ? 'gx-hype-wheel' : undefined}>
        <circle cx={cx} cy={cy} r={r} className="gx-hype-loco-wheel" />
        <path
          d={`M${round(cx - spoke)} ${cy}H${round(cx + spoke)}M${cx} ${round(cy - spoke)}V${round(cy + spoke)}`}
          className="gx-hype-loco-spoke"
        />
        <circle cx={cx} cy={cy} r={round(r * 0.28)} className="gx-hype-loco-hub" />
      </g>
    );
  };
  return (
    <svg className="gx-hype-loco" viewBox="0 0 40 25" focusable={false} aria-hidden={true}>
      <rect x="1.5" y="2.5" width="15" height="2.6" rx="1.2" className="gx-hype-loco-dark" />
      <rect x="3" y="4.6" width="12" height="12.6" rx="1.4" className="gx-hype-loco-cab" />
      <rect x="6" y="7.2" width="6" height="4.8" rx="1" className="gx-hype-loco-window" />
      <rect x="14" y="8" width="19.5" height="9.2" rx="4.6" className="gx-hype-loco-boiler" />
      <path d="M19 8.4v8.4M25 8.4v8.4" className="gx-hype-loco-band" />
      <circle cx="21.5" cy="8.2" r="2.4" className="gx-hype-loco-cab" />
      <rect x="27" y="3.6" width="4" height="5" className="gx-hype-loco-dark" />
      <rect x="26" y="2" width="6" height="2.2" rx="1" className="gx-hype-loco-dark" />
      <circle cx="34.2" cy="11.4" r="1.7" className="gx-hype-loco-lamp" />
      <path d="M33 16.6 38.6 21.2H33Z" className="gx-hype-loco-catcher" />
      <rect x="2" y="16.4" width="32" height="2.1" rx="1" className="gx-hype-loco-dark" />
      {wheel(9, 19.6, 4.3)}
      {wheel(20.5, 20.9, 3)}
      {wheel(28.5, 20.9, 3)}
      <path d="M9 19.6H28.5" className="gx-hype-loco-rod" />
    </svg>
  );
}

function Gem({ bits }: { bits: number }) {
  return (
    <svg className="gx-hype-gem" viewBox="0 0 16 16" focusable={false} aria-hidden={true} style={{ color: gemColor(bits) }}>
      <path d="M8 1 14.6 6.4 8 15 1.4 6.4Z" className="gx-hype-gem-body" />
      <path d="M8 1 11 6.4H5Z" className="gx-hype-gem-top" />
    </svg>
  );
}

function Gift() {
  return (
    <svg className="gx-hype-gift" viewBox="0 0 16 16" focusable={false} aria-hidden={true}>
      <rect x="1.5" y="6" width="13" height="3" rx=".8" className="gx-hype-gift-box" />
      <rect x="2.5" y="9" width="11" height="5.5" rx=".8" className="gx-hype-gift-box" />
      <path d="M8 6v8.5M8 6C6.6 3.2 3.9 3.4 4.6 5.2 5 6 8 6 8 6Zm0 0c1.4-2.8 4.1-2.6 3.4-.8C11 6 8 6 8 6Z" className="gx-hype-gift-ribbon" />
    </svg>
  );
}

function Trophy() {
  return (
    <svg className="gx-hype-trophy" viewBox="0 0 16 16" focusable={false} aria-hidden={true}>
      <path d="M4.5 2h7v3.6a3.5 3.5 0 0 1-7 0Z" className="gx-hype-trophy-cup" />
      <path d="M4.5 3.2H2.4a2.2 2.2 0 0 0 2.4 3M11.5 3.2h2.1a2.2 2.2 0 0 1-2.4 3M8 9.2V12M5.2 14h5.6" className="gx-hype-trophy-line" />
    </svg>
  );
}

export interface HypeTrainCardProps {
  data: HypeTrainEventData;
  /** A celebration in progress (level-up or kickoff), or none. */
  celebration?: HypeCelebration | null;
  /** The percentage shown before this update, for the fill to move on from. */
  fromPercent?: number;
  /** Now, for the countdown. */
  now?: number;
  /** When the card's looping animations started (the renderer's draw time). */
  phaseAt?: number;
  /** Prefers reduced motion: no confetti. */
  reducedMotion?: boolean;
}

/** The Hype Train card. */
export function HypeTrainCard({
  data,
  celebration = null,
  fromPercent,
  now = Date.now(),
  phaseAt = now,
  reducedMotion = false,
}: HypeTrainCardProps) {
  const look = KIND_LOOKS[data.kind ?? 'regular'];
  const title = hypeTrainTitle(data);
  const named = (data.kind !== undefined && data.kind !== 'regular') || data.shared === true;
  const percent = hypePercent(data);
  const shown = celebration?.kind === 'level' ? 100 : percent;
  const from = Math.min(100, Math.max(0, fromPercent ?? data.fromPercent ?? shown));
  const remaining = Math.max(0, data.goal - data.progress);
  const subs = Math.ceil(remaining / SUB_POINTS);
  const clock = data.endsAt !== undefined && data.phase === 'progress' ? hypeClockState(data.endsAt, now) : null;
  const clockLeft = data.endsAt !== undefined ? Math.max(0, data.endsAt - phaseAt) : 0;
  const confettiColors = [...new Set([...(look.fill ?? RAINBOW), look.accent, '#ffffff'])];

  const style: ElementStyle = {
    '--gx-hype-pct': `${shown}%`,
    '--gx-hype-from': `${from}%`,
    '--gx-hype-accent': look.accent,
    ...(look.fill ? { '--gx-hype-fill': `linear-gradient(90deg, ${look.fill.join(', ')})` } : {}),
    '--gx-hype-flow-at': phase(phaseAt, 6000),
    '--gx-hype-shine-at': phase(phaseAt, 4500),
    '--gx-hype-wheel-at': phase(phaseAt, 700),
    '--gx-hype-bob-at': phase(phaseAt, 640),
    '--gx-hype-puff-at': phase(phaseAt, 1500),
    '--gx-hype-glint-at': phase(phaseAt, 1600),
    /* A card drawn again during a celebration carries on with it. */
    ...(celebration ? { '--gx-hype-burst-at': `${-Math.max(0, phaseAt - celebration.at)}ms` } : {}),
  };

  const progressLabel = data.phase === 'end'
    ? `${title} complete at level ${data.level}`
    : `${title}, level ${data.level}, ${percent} percent, ${NUMBER.format(remaining)} bits or ${subs} ${subs === 1 ? 'sub' : 'subs'} to go`
      + (clock ? `, ${clock.text} left` : '');

  return (
    <div
      className="gx-hype"
      data-testid="hype-train-row"
      data-hype-phase={data.phase}
      data-hype-level={data.level}
      data-hype-kind={data.kind ?? 'regular'}
      aria-label={progressLabel}
      style={style}
    >
      <div
        className={`gx-hype-card${look.fill ? ' is-themed' : ''}${celebration?.kind === 'level' ? ' is-leveling' : ''}${
          data.phase === 'end' ? ' is-complete' : ''
        }`}
      >
        <div className={`gx-hype-top${celebration ? ' is-words' : ''}`}>
          <span className="gx-hype-info">
            <span className="gx-hype-mark"><Locomotive wheels={false} /></span>
            {data.record && <span className="gx-hype-record" title="All-time high"><Trophy /></span>}
            <span className="gx-hype-title">
              {named ? <span className="gx-hype-name">{title}</span> : <span className="gx-hype-plain-name">{title}</span>}
              <span className="gx-hype-dot">{' · '}</span>
              {'Level '}
              <span className="gx-hype-level-num">{data.level}</span>
            </span>
            {remaining > 0 ? (
              <span className="gx-hype-need">
                <span className="gx-hype-need-part"><Gem bits={remaining} />{shortBits(remaining)}</span>
                <span className="gx-hype-need-rule" />
                <span className="gx-hype-need-part gx-hype-subs"><Gift />{subs}</span>
              </span>
            ) : (
              <span className="gx-hype-togo">Level up incoming</span>
            )}
            {/* Too narrow for all of it, the row fades out from the right:
                "to go" goes first, then the discount. */}
            {data.treasure && (
              <span className="gx-hype-need gx-hype-treasure">
                {`${data.treasure.percent}% off gift subs from level ${data.treasure.level}`}
              </span>
            )}
            {remaining > 0 && <span className="gx-hype-togo">to go</span>}
          </span>
          {clock && (
            <span
              className="gx-hype-clock"
              data-gx-hype-clock=""
              data-ends-at={data.endsAt}
              data-heat={clock.heat || undefined}
              style={{
                '--gx-hype-drain-ms': `${HYPE_LEVEL_WINDOW_MS}ms`,
                '--gx-hype-drain-at': `${-(HYPE_LEVEL_WINDOW_MS - Math.min(HYPE_LEVEL_WINDOW_MS, clockLeft))}ms`,
              }}
            >
              <svg className="gx-hype-ring" viewBox="0 0 100 30" preserveAspectRatio="none" focusable={false} aria-hidden={true}>
                <rect x="1.5" y="1.5" width="97" height="27" rx="13.5" className="gx-hype-ring-track" />
                <rect x="1.5" y="1.5" width="97" height="27" rx="13.5" pathLength="100" className="gx-hype-ring-left" />
              </svg>
              <span className="gx-hype-clock-text">{clock.text}</span>
            </span>
          )}
          {celebration && (
            <span className="gx-hype-words" aria-live="polite" style={{ '--gx-hype-cross': `${celebration.ms}ms` }}>
              <span className="gx-hype-words-run">
                <span className="gx-hype-words-text">{celebration.words}</span>
              </span>
            </span>
          )}
        </div>
        <div className="gx-hype-bottom">
          <span className="gx-hype-track">
            <span className="gx-hype-glow" />
            <span className="gx-hype-meter">
              <span className="gx-hype-fill"><span className="gx-hype-shine" /></span>
              {celebration?.kind === 'level' && <span className="gx-hype-sheen" />}
            </span>
            <span className="gx-hype-rider">
              <span className="gx-hype-nose" />
              <span className="gx-hype-smoke"><i /><i /><i /></span>
              <span className="gx-hype-sparks"><i /><i /><i /></span>
              <Locomotive wheels={true} />
            </span>
          </span>
          <span className="gx-hype-percent">{`${shown}%`}</span>
        </div>
        {data.phase === 'end' && (
          <span className="gx-hype-complete">{`${title} complete! Level ${data.level}`}</span>
        )}
      </div>
      {celebration?.kind === 'level' && !reducedMotion && (
        <span className="gx-hype-confetti" aria-hidden={true}>
          {Array.from({ length: 26 }, (_, index) => {
            const r = (n: number) => scatter(celebration.level * 31 + index, n);
            return (
              <i
                style={{
                  '--x': `${Math.round(r(1) * 1000) / 10}%`,
                  '--dx': `${Math.round((r(2) - 0.5) * 60) / 10}em`,
                  '--up': `${Math.round(25 + r(3) * 35) / 10}em`,
                  '--fall': `${Math.round(-8 + r(4) * 20) / 10}em`,
                  '--spin': `${Math.round(r(5) * 720) - 360}deg`,
                  /* After the row's entrance (it arrives as the newest row). */
                  '--delay': `${400 + Math.round(r(6) * 260)}ms`,
                  '--dur': `${Math.round(1700 + r(7) * 900)}ms`,
                  '--c': confettiColors[index % confettiColors.length],
                }}
              />
            );
          })}
        </span>
      )}
    </div>
  );
}
