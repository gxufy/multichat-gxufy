/*
 * Sticky section bar for the generator page. The generator is one long
 * page, so this gives a one-tap jump to each section and shows where you are.
 *
 * Plain in-page anchors: works without JavaScript, keeps the URL hash, and the
 * browser handles focus/scroll. JavaScript adds the "you are here" highlight
 * and a pill that slides between links. (The #viewer-counter deep link still
 * works; it just isn't one of the bar's four stops.)
 * Generator only — the OBS overlay never renders this.
 */
import { useEffect, useRef, useState } from 'react';

export const GENERATOR_SECTIONS = [
  { id: 'channels', label: 'Channels' },
  { id: 'settings', label: 'Settings' },
  { id: 'commands', label: 'Commands' },
  { id: 'obs-setup', label: 'OBS setup' },
] as const;

export type GeneratorSectionId = (typeof GENERATOR_SECTIONS)[number]['id'];

/** Pixels under the sticky bar a section top must pass to count as "current". */
const ACTIVE_OFFSET_PX = 80;

/**
 * Which section the reader is in: the lowest section whose top has scrolled
 * past the bar. Sections that share a row (Chat and Viewer counter on a
 * desktop) resolve to the first. At the very bottom of the page the last
 * section on screen wins, since short final sections can never reach the top.
 */
export function currentSection(
  ids: readonly string[],
  topOf: (id: string) => number | undefined,
  viewportHeight: number,
  atBottom: boolean,
): string {
  let current = ids[0] ?? '';
  let currentTop = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const top = topOf(id);
    if (top === undefined) continue;
    const reached = top <= ACTIVE_OFFSET_PX || (atBottom && top < viewportHeight);
    if (reached && top > currentTop + 1) {
      current = id;
      currentTop = top;
    }
    if (atBottom && reached) current = id;
  }
  return current;
}

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0] ?? '');
  /* A clicked link stays highlighted until the reader scrolls on their own. */
  const pinned = useRef<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinned.current) return;
      const root = document.documentElement;
      setActive(currentSection(
        ids,
        (id) => document.getElementById(id)?.getBoundingClientRect().top,
        window.innerHeight,
        window.innerHeight + window.scrollY >= root.scrollHeight - 2,
      ));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const release = () => {
      pinned.current = null;
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('keydown', release);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchstart', release);
      window.removeEventListener('keydown', release);
    };
  }, [ids]);

  const choose = (id: string) => {
    pinned.current = id;
    setActive(id);
  };
  return { active, choose };
}

const SECTION_IDS = GENERATOR_SECTIONS.map((section) => section.id);

export default function ClassicSectionNav({
  onSupport,
  onBadges,
}: {
  /** Shows a Support item that opens the support popup. */
  onSupport?: () => void;
  /** Shows a Badges item (next to Support) that opens the badges popup. */
  onBadges?: () => void;
} = {}) {
  const { active, choose } = useActiveSection(SECTION_IDS);
  const hasSupport = Boolean(onSupport) || Boolean(onBadges);
  const listRef = useRef<HTMLUListElement>(null);

  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  /* Slide the pill under the current link, and on a phone keep it centered in
     the sideways-scrolling strip. Offsets are relative to the <ul>. */
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('a.is-active')?.closest('li');
    if (!list || !item) return;
    setIndicator({ left: item.offsetLeft, width: item.offsetWidth });
    if (list.scrollWidth > list.clientWidth) {
      list.scrollLeft = item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2;
    }
    /* Items can shift without a resize (the Support button appears after load,
       web fonts swap in): follow the list's own size changes too. */
  }, [active, hasSupport]);

  useEffect(() => {
    const remeasure = () => {
      const item = listRef.current?.querySelector<HTMLElement>('a.is-active')?.closest('li');
      if (item) setIndicator({ left: item.offsetLeft, width: item.offsetWidth });
    };
    window.addEventListener('resize', remeasure);
    /* Web fonts change link widths after first paint. */
    void document.fonts?.ready.then(remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, []);

  return (
    <nav
      className="section-nav"
      aria-label="Generator sections"
      data-indicator={indicator ? 'on' : undefined}
    >
      <ul ref={listRef}>
        {indicator ? (
          <li
            className="section-nav-indicator"
            aria-hidden="true"
            style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
          />
        ) : null}
        {GENERATOR_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={section.id === active ? 'is-active' : undefined}
              aria-current={section.id === active ? 'location' : undefined}
              onClick={() => choose(section.id)}
            >
              {section.label}
            </a>
          </li>
        ))}
        {onBadges ? (
          <li>
            <button
              type="button"
              className="section-nav-badges"
              aria-haspopup="dialog"
              onClick={onBadges}
            >
              Badges
            </button>
          </li>
        ) : null}
        {onSupport ? (
          <li>
            <button
              type="button"
              className="section-nav-support"
              aria-haspopup="dialog"
              onClick={onSupport}
            >
              Support
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
