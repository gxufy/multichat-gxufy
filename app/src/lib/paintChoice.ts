/*
 * Which paint a chatter's name shows when they wear one on both 7TV and
 * JilTV: 7TV's, unless they asked for JilTV's in this channel with
 * `!flosschat paint jiltv`. `!flosschat paint 7tv` or `!flosschat paint auto`
 * goes back to 7TV's. A chatter wearing only one shows that one.
 *
 * Choices are remembered for the channel in this browser source.
 */

export type PaintSource = '7tv' | 'jiltv';
export type PaintChoice = PaintSource | 'auto';

/** Chatters whose choice is remembered per channel, newest kept. */
export const PAINT_CHOICES_MAX = 500;
const STORAGE_PREFIX = 'flosschat:paint-choices:';

export function shownPaintSource(
  hasSevenTV: boolean,
  hasJilTV: boolean,
  chosen: PaintSource | undefined,
): PaintSource | null {
  if (hasSevenTV && hasJilTV) return chosen === 'jiltv' ? 'jiltv' : '7tv';
  if (hasSevenTV) return '7tv';
  return hasJilTV ? 'jiltv' : null;
}

/** `7tv` / `jiltv` / `auto` (or `default`) from a command argument, else null. */
export function parsePaintChoice(value: string | undefined): PaintChoice | null {
  const word = (value ?? '').trim().toLowerCase();
  if (word === '7tv' || word === 'seventv') return '7tv';
  if (word === 'jiltv' || word === 'jil') return 'jiltv';
  if (word === 'auto' || word === 'default' || word === 'reset') return 'auto';
  return null;
}

export type PaintChoices = {
  /** What each chatter (`${platform}:${senderId}`) asked for. */
  readonly sources: ReadonlyMap<string, PaintSource>;
  /** The chatter's own choice. True when it changed what they asked for. */
  choose(key: string, choice: PaintChoice): boolean;
};

function readStored(storage: Storage | null, storageKey: string): Map<string, PaintSource> {
  const stored = new Map<string, PaintSource>();
  if (!storage) return stored;
  try {
    const raw: unknown = JSON.parse(storage.getItem(storageKey) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return stored;
    for (const [key, value] of Object.entries(raw).slice(-PAINT_CHOICES_MAX)) {
      if (/^[a-z]+:[\w-]{1,64}$/.test(key) && (value === '7tv' || value === 'jiltv')) stored.set(key, value);
    }
  } catch { /* unreadable storage: start empty */ }
  return stored;
}

/**
 * `channel` names the channel the choices belong to (empty: not remembered
 * past this session). `storage` defaults to the browser's localStorage.
 */
export function createPaintChoices(channel: string, storage?: Storage | null): PaintChoices {
  const storageKey = `${STORAGE_PREFIX}${channel}`;
  const store = channel
    ? storage === undefined
      ? (() => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } })()
      : storage
    : null;
  const chosen = readStored(store, storageKey);

  const save = () => {
    if (!store) return;
    try { store.setItem(storageKey, JSON.stringify(Object.fromEntries(chosen))); }
    catch { /* full or blocked storage: the choice still holds for this session */ }
  };

  return {
    sources: chosen,
    choose(key, choice) {
      const before = chosen.get(key);
      chosen.delete(key);
      if (choice !== 'auto') {
        chosen.set(key, choice);
        while (chosen.size > PAINT_CHOICES_MAX) {
          const oldest = chosen.keys().next();
          if (oldest.done) break;
          chosen.delete(oldest.value);
        }
      }
      save();
      return before !== chosen.get(key);
    },
  };
}
