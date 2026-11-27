/* The live Hype Train in the chat: each change of the train is drawn as the
   newest row, carrying its celebration (render/hypeTrainCard: hypeTrainUpdate),
   and the overlay runtime swaps the old row for the new one. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeHypeCelebration, hypeTrainUpdate } from '@/lib/render/hypeTrainCard';
import { startMultichatRuntime } from '@/lib/multichatRuntime';
import { HYPE_TRAIN_ACTIVE_POLL_MS } from '@/lib/twitchHypeTrainPoller';
import type { ParsedMessage } from '@/lib/kick';

const NOW = Date.parse('2026-11-22T23:00:00.000Z');
const train = (level: number, progress: number, extra = {}) => ({ phase: 'progress' as const, level, progress, goal: 1000, ...extra });

describe('a Hype Train update as the chat shows it', () => {
  it('starts a level-up celebration as the level rises, with the bar coming from where it was', () => {
    const before = hypeTrainUpdate(null, train(1, 600), NOW);
    expect(before.celebration).toBeUndefined();
    const next = hypeTrainUpdate(before, train(2, 50), NOW);
    expect(next.celebration).toMatchObject({ kind: 'level', level: 2, at: NOW });
    expect(next.fromPercent).toBe(60);
    /* An update while it plays carries it on; after it, none. */
    const during = hypeTrainUpdate(next, train(2, 80), NOW + 1000);
    expect(during.celebration).toEqual(next.celebration);
    expect(during.fromPercent).toBe(100);
    const after = hypeTrainUpdate(during, train(2, 120), NOW + 20_000);
    expect(after.celebration).toBeUndefined();
    expect(activeHypeCelebration(next, NOW + next.celebration!.ms)).toBeNull();
  });

  it('greets a train first seen just after it starts, once', () => {
    const first = hypeTrainUpdate(null, train(1, 0, { startedAt: NOW - 30_000 }), NOW);
    expect(first.celebration?.kind).toBe('kickoff');
    expect(hypeTrainUpdate(null, train(1, 0, { startedAt: NOW - 120_000 }), NOW).celebration).toBeUndefined();
    const second = hypeTrainUpdate(first, train(1, 300, { startedAt: NOW - 30_000 }), NOW + 15_000);
    expect(second.celebration).toBeUndefined();
  });

  it('the end of a train shows no celebration and drops what an update carried', () => {
    const playing = hypeTrainUpdate(hypeTrainUpdate(null, train(1, 900), NOW), train(2, 10), NOW);
    const ended = hypeTrainUpdate(playing, { ...train(2, 10), phase: 'end', hideAfterMs: 5000 }, NOW + 500);
    expect(ended.celebration).toBeUndefined();
  });
});

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

class FakeWebSocket {
  static OPEN = 1;
  static all: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose = null;
  onerror = null;
  constructor(readonly url: string) {
    FakeWebSocket.all.push(this);
  }
  send() {}
  close() {}
}

describe('the overlay runtime draws each change of the train as the newest row', () => {
  let answers: unknown[] = [];
  beforeEach(() => {
    FakeWebSocket.all = [];
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/twitch/hypetrain')) {
        return new Response(JSON.stringify(answers.shift() ?? { active: false }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('swaps the old card for a fresh one each time, celebrating the level-up, then clears it after the end', async () => {
    answers = [
      { active: true, level: 1, progress: 100, goal: 1000, startedAgoMs: 5_000, endsInMs: 300_000 },
      { active: true, level: 1, progress: 800, goal: 1000, startedAgoMs: 20_000, endsInMs: 300_000 },
      { active: true, level: 2, progress: 50, goal: 1500, startedAgoMs: 35_000, endsInMs: 300_000 },
      { active: false },
    ];
    let shown: ParsedMessage[] = [];
    /* How many cards each published screen held. */
    const counts: number[] = [];
    const stop = startMultichatRuntime({ twitch: 'gxufy', animation: 'none' }, {
      onConfig: () => undefined,
      onLoaderPhase: () => undefined,
      onMessages: (messages) => {
        shown = messages;
        counts.push(messages.filter((message) => message.category === 'hypetrain').length);
      },
      onFadingIds: () => undefined,
      onSharedChat: () => undefined,
      onError: () => undefined,
    });
    const hypeRows = () => shown.filter((message) => message.category === 'hypetrain');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hypeRows().map((row) => row.id)).toEqual(['twitch:hype-train-1']);
    expect(hypeRows()[0]!.hypeTrain?.celebration?.kind).toBe('kickoff');

    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_ACTIVE_POLL_MS);
    expect(hypeRows().map((row) => row.id)).toEqual(['twitch:hype-train-2']);
    expect(hypeRows()[0]!.hypeTrain).toMatchObject({ level: 1, progress: 800, fromPercent: 10 });

    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_ACTIVE_POLL_MS);
    const levelUp = hypeRows();
    expect(levelUp.map((row) => row.id)).toEqual(['twitch:hype-train-3']);
    expect(levelUp[0]!.hypeTrain?.celebration).toMatchObject({ kind: 'level', level: 2 });
    expect(levelUp[0]!.hypeTrain?.fromPercent).toBe(80);
    /* It arrives like a new event: no entrance suppressed. */
    expect(levelUp[0]!.suppressEntryAnimation).toBeFalsy();

    await vi.advanceTimersByTimeAsync(HYPE_TRAIN_ACTIVE_POLL_MS);
    expect(hypeRows().map((row) => [row.id, row.hypeTrain?.phase])).toEqual([['twitch:hype-train-4', 'end']]);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(hypeRows()).toEqual([]);
    /* From the first card to the end, every screen held exactly one: the new
       copy replaced the old one in the same tick, never a gap or two cards. */
    const shownFrom = counts.indexOf(1);
    const shownTo = counts.lastIndexOf(1);
    expect(counts.slice(shownFrom, shownTo + 1).every((count) => count === 1)).toBe(true);
    expect(Math.max(...counts)).toBe(1);
    stop!();
  });

  it('a gifted sub in chat makes the overlay look for the train within seconds, not at the next minute', async () => {
    answers = [
      { active: false },
      { active: true, level: 1, progress: 500, goal: 1600, startedAgoMs: 2_000, endsInMs: 300_000 },
    ];
    let shown: ParsedMessage[] = [];
    const stop = startMultichatRuntime({ twitch: 'gxufy', animation: 'none' }, {
      onConfig: () => undefined,
      onLoaderPhase: () => undefined,
      onMessages: (messages) => { shown = messages; },
      onFadingIds: () => undefined,
      onSharedChat: () => undefined,
      onError: () => undefined,
    });
    const lookups = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => String(url).startsWith('/api/twitch/hypetrain')).length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lookups()).toBe(1);
    const irc = FakeWebSocket.all.find((socket) => socket.url.includes('irc-ws.chat.twitch.tv'))!;
    irc.onopen?.();
    irc.onmessage?.({
      data: '@badges=sub-gifter/1;color=#FF7F50;display-name=GiftKing;id=gift-1;login=giftking;msg-id=subgift;msg-param-recipient-display-name=LuckyViewer;msg-param-recipient-id=55;msg-param-recipient-user-name=luckyviewer;msg-param-sub-plan=1000;tmi-sent-ts=1;user-id=9 :tmi.twitch.tv USERNOTICE #gxufy\r\n',
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lookups()).toBe(2);
    expect(shown.filter((message) => message.category === 'hypetrain').map((row) => row.hypeTrain?.celebration?.kind)).toEqual(['kickoff']);
    stop!();
  });
});
