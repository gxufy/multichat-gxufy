/* The continuous Chat preview feed.
 *
 * The generator (`features/multichat/previewSimulator`) is a pure function of
 * a sequence number, a source selection and a `RandomSource`. Its claims — the
 * interval band, the id namespace, the history bound, which platforms are
 * reachable — are facts about values, so they are asserted directly against a
 * seeded source rather than scraped out of markup.
 *
 * Every test here supplies its own seeded random source. That is the whole reason
 * the module takes one: a suite that let `Math.random` decide would assert "all
 * four platforms appear within N draws" as a probability rather than a fact, and
 * would eventually fail on someone else's machine for no reason they could act on.
 */
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CHAT_HISTORY_MAX,
  CHAT_INTERVAL_MAX_MS,
  CHAT_INTERVAL_MIN_MS,
  PREVIEW_SOURCES,
  PREVIEW_SOURCE_HINT,
  PREVIEW_SOURCE_LABEL,
  PREVIEW_SPEEDS,
  allSourcesEnabled,
  appendBounded,
  availablePool,
  chatDelayBounds,
  generateMessage,
  nextChatDelay,
  noSourcesEnabled,
  randomSources,
  seededRandom,
  SHOWCASE_LENGTH,
  type PreviewSourceState,
} from '@/features/multichat/previewSimulator';
import { PREVIEW_EMOTE_TOKENS } from '@/features/multichat/previewAssets';

beforeEach(() => {
  vi.useFakeTimers();
});

/* ------------------------------------------------------------------ */
/* The generator                                                      */
/* ------------------------------------------------------------------ */

describe('the seeded random source', () => {
  it('gives the same stream twice for one seed, and a different one per seed', () => {
    const draw = (seed: number) => {
      const random = seededRandom(seed);
      return Array.from({ length: 8 }, () => random());
    };
    expect(draw(1)).toEqual(draw(1));
    expect(draw(1)).not.toEqual(draw(2));
  });

  it('stays inside [0, 1)', () => {
    const random = seededRandom(99);
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('the message interval', () => {
  it('draws a fresh delay per message rather than one fixed period', () => {
    const random = seededRandom(4);
    const delays = Array.from({ length: 40 }, () => nextChatDelay(random, 'normal'));
    /* The claim is that the delay varies, not that any particular value appears:
       a single repeated number would mean one interval was chosen once and reused,
       which is the thing the spec rules out. */
    expect(new Set(delays).size).toBeGreaterThan(5);
  });

  it('stays inside the documented 1.2s–3.5s band at Normal speed', () => {
    const random = seededRandom(7);
    for (let i = 0; i < 400; i += 1) {
      const delay = nextChatDelay(random, 'normal');
      expect(delay).toBeGreaterThanOrEqual(CHAT_INTERVAL_MIN_MS);
      expect(delay).toBeLessThanOrEqual(CHAT_INTERVAL_MAX_MS);
    }
    expect(CHAT_INTERVAL_MIN_MS).toBe(1200);
    expect(CHAT_INTERVAL_MAX_MS).toBe(3500);
  });

  it('keeps every speed inside its own band, widest to narrowest', () => {
    for (const speed of PREVIEW_SPEEDS) {
      const bounds = chatDelayBounds(speed);
      const random = seededRandom(11);
      for (let i = 0; i < 200; i += 1) {
        const delay = nextChatDelay(random, speed);
        expect(delay).toBeGreaterThanOrEqual(bounds.min);
        expect(delay).toBeLessThanOrEqual(bounds.max);
      }
    }
    expect(chatDelayBounds('slow').min).toBeGreaterThan(chatDelayBounds('normal').min);
    expect(chatDelayBounds('fast').max).toBeLessThan(chatDelayBounds('normal').max);
  });

  it('never schedules soon enough to land inside a synchronous test', () => {
    /* Load-bearing beyond pacing. Three existing suites mount the whole generator
       on real timers and assert synchronously; a first delay of a few milliseconds
       would update those trees mid-assertion or after unmount. */
    const fastest = Math.min(...PREVIEW_SPEEDS.map((speed) => chatDelayBounds(speed).min));
    expect(fastest).toBeGreaterThanOrEqual(500);
  });
});

describe('PROVIDER SHOWCASE: the feed opens with a fixed cosmetic/emote cycle', () => {
  /* The static fixtures already paint native badges, a paint and an emote on the
     first frame; the moving feed's opening job is to demonstrate the
     provider-gated cosmetics in a legible order rather than leaving a 7TV badge
     to chance. This asserts the order is fixed and covers every provider — and
     that a source switched off drops only its own step. */
  const sources = allSourcesEnabled();

  /** The first `SHOWCASE_LENGTH` lines, generated as the feed would in order. */
  const openingCycle = (state: PreviewSourceState, seed = 4) => {
    const random = seededRandom(seed);
    const out = [] as ReturnType<typeof generateMessage>[];
    let previous: ReturnType<typeof generateMessage> | null = null;
    for (let sequence = 1; sequence <= SHOWCASE_LENGTH; sequence += 1) {
      const message = generateMessage(sequence, state, random, previous);
      out.push(message);
      previous = message;
    }
    return out;
  };

  it('covers the 7TV badge, the paint, and one emote per provider, in order', () => {
    const opening = openingCycle(sources);
    const usernames = opening.map((m) => m.username);
    /* The exact opening order the showcase promises. */
    expect(usernames).toEqual([
      'catalogcarl', // 7TV cosmetic badge
      'paintedpip', // 7TV paint
      'emotedelia', // 7TV emote
      'bttvbrady', // BTTV emote
      'ffzfelix', // FFZ emote
    ]);
    /* The paint step claims the entitled paint identity, so the paint attaches. */
    expect(opening[1].senderId).toBe('sample-paint-sender');
    /* The three emote steps carry each provider's token in their text, so the
       production word-swap has something to resolve. */
    expect(opening[2].text).toContain(PREVIEW_EMOTE_TOKENS.sevenTV);
    expect(opening[3].text).toContain(PREVIEW_EMOTE_TOKENS.bttv);
    expect(opening[4].text).toContain(PREVIEW_EMOTE_TOKENS.ffz);
  });

  it('is identical run to run — the opening cycle is deterministic', () => {
    /* Different seeds, because the showcase must not depend on the random source
       at all for the steps it governs. */
    expect(openingCycle(sources, 1).map((m) => m.username)).toEqual(
      openingCycle(sources, 999).map((m) => m.username),
    );
  });

  it('restarts from the first step when the sequence restarts', () => {
    /* Reset zeroes the sequence counter, so sequence 1 must be the first step
       again — this is what makes Reset replay the showcase. */
    const first = generateMessage(1, sources, seededRandom(2), null);
    expect(first.username).toBe('catalogcarl');
  });

  it('drops only the step whose source is off, keeping the rest in order', () => {
    /* 7TV cosmetics off removes the badge step (catalogcarl needs it) and the
       paint step (paintedpip needs sevenTVPaints, gated the same way in the
       picker but a distinct source here); the emote steps stay. The dropped
       positions take an ordinary random draw rather than forcing the entry. */
    const noCosmetics: PreviewSourceState = {
      ...sources,
      sevenTVCosmetics: false,
      sevenTVPaints: false,
    };
    const opening = openingCycle(noCosmetics);
    const usernames = opening.map((m) => m.username);
    expect(usernames).not.toContain('catalogcarl');
    expect(usernames).not.toContain('paintedpip');
    /* The emote steps are still played, still in their order. */
    expect(usernames).toContain('emotedelia');
    expect(usernames).toContain('bttvbrady');
    expect(usernames).toContain('ffzfelix');
  });

  it('plays plain lines when every source is off, never an unavailable step', () => {
    const opening = openingCycle(noSourcesEnabled());
    for (const message of opening) {
      expect(message.badges).toEqual([]);
      expect(message.text.length).toBeGreaterThan(0);
    }
  });
});

describe('NO CONSECUTIVE REPEAT: the feed never emits one identity twice in a row', () => {
  it('draws a different identity than the previous line across a long run', () => {
    /* Past the showcase window the draw is random, so this is where a repeat
       could occur; the previous-line exclusion is what prevents it. */
    const sources = allSourcesEnabled();
    const random = seededRandom(31);
    let previous = generateMessage(1, sources, random, null);
    for (let sequence = 2; sequence <= 600; sequence += 1) {
      const message = generateMessage(sequence, sources, random, previous);
      expect(message.username, `seq ${sequence}`).not.toBe(previous.username);
      previous = message;
    }
  });

  it('still draws when only one plain line is reachable, preferring it to silence', () => {
    /* With every source off the pool narrows to plain lines; the dedup must not
       empty it. A message is still produced even when asked to avoid the only
       reachable identity. */
    const none = noSourcesEnabled();
    const random = seededRandom(8);
    const first = generateMessage(1, none, random, null);
    const second = generateMessage(2, none, random, first);
    expect(second.text.length).toBeGreaterThan(0);
  });
});

describe('the fixture source selection', () => {
  it('offers a label and a hint for every source, with no duplicates', () => {
    const labels = PREVIEW_SOURCES.map((source) => PREVIEW_SOURCE_LABEL[source]);
    expect(new Set(labels).size).toBe(PREVIEW_SOURCES.length);
    for (const source of PREVIEW_SOURCES) {
      expect(PREVIEW_SOURCE_LABEL[source].length).toBeGreaterThan(0);
      expect(PREVIEW_SOURCE_HINT[source].length).toBeGreaterThan(0);
    }
  });

  it('says which chat setting gates each source that one gates', () => {
    /* The picker chooses identities; the settings decide whether they render. A
       chip promising paints while paints are switched off looks broken unless it
       says so, so the hint has to name the gate. */
    expect(PREVIEW_SOURCE_HINT.sevenTVPaints).toMatch(/7TV cosmetics/i);
    expect(PREVIEW_SOURCE_HINT.sevenTVCosmetics).toMatch(/7TV cosmetics/i);
    expect(PREVIEW_SOURCE_HINT.bttvEmotes).toMatch(/7TV emotes/i);
  });

  it('turns everything on and everything off', () => {
    const all = allSourcesEnabled();
    const none = noSourcesEnabled();
    for (const source of PREVIEW_SOURCES) {
      expect(all[source]).toBe(true);
      expect(none[source]).toBe(false);
    }
  });

  it('randomizes to a varied subset that always keeps at least one source on', () => {
    const shapes = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const state = randomSources(seededRandom(seed));
      expect(PREVIEW_SOURCES.some((source) => state[source])).toBe(true);
      shapes.add(PREVIEW_SOURCES.map((source) => (state[source] ? '1' : '0')).join(''));
    }
    expect(shapes.size).toBeGreaterThan(20);
  });

  it('narrows the pool as sources switch off, and never empties it', () => {
    const all = availablePool(allSourcesEnabled());
    const none = availablePool(noSourcesEnabled());
    expect(none.length).toBeGreaterThan(0);
    expect(none.length).toBeLessThan(all.length);
    for (const entry of none) expect(entry.needs ?? []).toHaveLength(0);
  });

  it('still generates messages with every source off', () => {
    const random = seededRandom(31);
    const off = noSourcesEnabled();
    for (let i = 1; i <= 40; i += 1) {
      const message = generateMessage(i, off, random);
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.badges).toHaveLength(0);
    }
  });

  it('drops the entries a disabled source owns', () => {
    const withoutPaints: PreviewSourceState = { ...allSourcesEnabled(), sevenTVPaints: false };
    const painted = availablePool(withoutPaints).filter((entry) =>
      (entry.needs ?? []).includes('sevenTVPaints'),
    );
    expect(painted).toHaveLength(0);
    expect(
      availablePool(allSourcesEnabled()).some((entry) =>
        (entry.needs ?? []).includes('sevenTVPaints'),
      ),
    ).toBe(true);
  });
});

describe('the history bound', () => {
  it('keeps the newest CHAT_HISTORY_MAX messages and drops from the front', () => {
    expect(CHAT_HISTORY_MAX).toBeGreaterThanOrEqual(20);
    expect(CHAT_HISTORY_MAX).toBeLessThanOrEqual(30);
    const random = seededRandom(37);
    let history: readonly ReturnType<typeof generateMessage>[] = [];
    for (let i = 1; i <= CHAT_HISTORY_MAX + 25; i += 1) {
      history = appendBounded(history, generateMessage(i, allSourcesEnabled(), random));
    }
    expect(history).toHaveLength(CHAT_HISTORY_MAX);
    expect(history[history.length - 1]!.id).toBe(`sim-${CHAT_HISTORY_MAX + 25}`);
    expect(history[0]!.id).toBe(`sim-26`);
  });

  it('never mutates the array it was given', () => {
    const random = seededRandom(41);
    const original = [generateMessage(1, allSourcesEnabled(), random)];
    const frozen = [...original];
    appendBounded(original, generateMessage(2, allSourcesEnabled(), random), 1);
    expect(original).toEqual(frozen);
  });
});
