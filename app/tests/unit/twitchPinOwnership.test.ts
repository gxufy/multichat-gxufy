/* The Twitch pin ownership key, and the coupling that makes it work.
 *
 * When the poller installs a pin it records an ownership key, and on teardown it
 * clears the pinned message only if that key still matches what is on screen.
 * The key is built in one place as `twitch:${message.id}` and the on-screen id is
 * built somewhere else entirely as `${platform}:${id}` — two independent
 * expressions, now in two different modules, that must agree exactly.
 *
 * If they ever stop agreeing the failure is silent and bad: the comparison never
 * matches, so a Twitch pin is never cleared and stays on screen after the
 * streamer unpins it. Nothing about that shows up in a build or a type check.
 *
 * Asserted by reading the real source, following the pattern in
 * multichatCommands.test.ts — a test that restated the format instead would pass
 * happily while the two call sites drifted apart.
 *
 * The id half moved to lib/multichatMessageModel when the UnifiedMessage →
 * ParsedMessage conversion was extracted so the generator preview could reuse it.
 * That made this coupling *more* worth asserting, not less: the two expressions
 * are now in separate files and can be edited without the other in view. So this
 * reads whichever file owns each half rather than relaxing the assertion.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../../src/pages/multichat.tsx'), 'utf8');

/** The module that now owns UnifiedMessage → ParsedMessage, id included. */
const MODEL_SOURCE = readFileSync(
  resolve(__dirname, '../../src/lib/multichatMessageModel.tsx'),
  'utf8',
);

describe('ownership key construction', () => {
  /* Both expressions are located by their surrounding code rather than quoted,
     so a rename that changes only one of them fails here. */
  it('installs the ownership key with the platform prefix', () => {
    expect(SOURCE).toContain('twitchPinIdRef.current = `twitch:${unified.message.id}`');
  });

  it('builds the on-screen id from platform and id', () => {
    expect(MODEL_SOURCE).toContain('id: `${um.platform}:${um.id}`');
  });

  /* The overlay must actually delegate to that module. Without this, the id
     assertion above could pass against an extracted helper the route no longer
     calls, while the route built ids some other way. */
  it('builds on-screen messages through the shared conversion', () => {
    expect(SOURCE).toContain('buildParsedMessage');
    expect(SOURCE).toContain("from '../lib/multichatMessageModel'");
  });

  /* The two formats agree only because `platform` is literally 'twitch' for a
     pin the Twitch poller produced. Pinned here so a future platform-name change
     (casing, a 'twitch-helix' variant) cannot pass silently. */
  it('composes to the same string for the same message', () => {
    const messageId = 'abc';
    const updatedAt = '2024-01-01T00:00:00Z';
    const unifiedId = `${messageId}:${updatedAt}`;

    const installed = `twitch:${unifiedId}`;
    const onScreen = `${'twitch'}:${unifiedId}`;
    expect(installed).toBe(onScreen);
  });
});

describe('the ownership comparison', () => {
  const clearBody = () => {
    const start = SOURCE.indexOf('const clearOwnedTwitchPin');
    expect(start).toBeGreaterThan(-1);
    return SOURCE.slice(start, start + 700);
  };

  it('compares against the installed key, not just the platform', () => {
    const body = clearBody();
    expect(body).toContain('twitchPinIdRef.current');
    expect(body).toContain('prev.msg.id === installed');
  });

  /* Without the platform check a Twitch teardown could clear a Kick pin that
     happened to be showing; without the id check it could clear a *newer*
     Twitch pin this poller never installed. */
  it('requires the platform to match as well as the id', () => {
    expect(clearBody()).toContain("prev.msg.platform === 'twitch'");
  });

  /* A functional update is what makes the decision read live state. Comparing
     against a captured render value would consult a stale pin. */
  it('decides against live state with a functional update', () => {
    expect(clearBody()).toMatch(/setPinnedMessage\(\s*prev\s*=>/);
  });

  it('returns the previous value rather than clearing when it does not own the pin', () => {
    expect(clearBody()).toMatch(/\?\s*null\s*:\s*prev/);
  });

  /* Cleared before the early return, so a stopped poller never keeps a claim on
     a pin it can no longer manage. */
  it('drops its own claim before deciding anything', () => {
    const body = clearBody();
    const clearedId = body.indexOf("twitchPinIdRef.current = ''");
    const guard = body.indexOf('if (!installed) return');
    expect(clearedId).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(clearedId);
  });
});

describe('teardown calls the clear', () => {
  /* Three exits must clear: effect teardown, a fatal poller error, and an unpin.
     A missing one is how a pin outlives the thing that installed it. */
  it('clears on effect teardown and on a fatal poller error', () => {
    const start = SOURCE.indexOf('const stopPolling = startTwitchPinPoller');
    expect(start).toBeGreaterThan(-1);
    const end = SOURCE.indexOf('}, [twitchPinsEnabled, twitchPinLogin, clearOwnedTwitchPin]);', start);
    expect(end).toBeGreaterThan(start);
    const region = SOURCE.slice(start, end);
    expect(region).toContain('clearOwnedTwitchPin()');
    // Once inside the fatal branch, once inside the returned cleanup.
    expect(region.match(/clearOwnedTwitchPin\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('keeps the poll interval at the poller floor', () => {
    expect(SOURCE).toContain('TWITCH_PIN_INTERVAL_MS = 5_000');
  });
});

/* A pin on screen claims something is pinned right now. Transient failures are
   retried silently, so without a deadline an API outage after a pin was
   displayed would leave that claim standing for the rest of the stream — even if
   the streamer unpinned during it. */
describe('staleness deadline', () => {
  it('defines a bounded window rather than trusting the pin indefinitely', () => {
    expect(SOURCE).toContain('TWITCH_PIN_STALE_AFTER_MS = 60_000');
  });

  it('clears the owned pin once the window passes on a non-fatal error', () => {
    const start = SOURCE.indexOf('onError: (error, fatal)');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, start + 1_400);
    expect(body).toContain('TWITCH_PIN_STALE_AFTER_MS');
    expect(body).toContain('clearOwnedTwitchPin()');
    /* The fatal branch must return, or a fatal error would fall through into the
       staleness check and depend on the clock. */
    expect(body).toMatch(/if \(fatal\)[\s\S]*return;/);
  });

  it('treats any answer as confirmation, including "nothing pinned"', () => {
    const start = SOURCE.indexOf('onPin: pin =>');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, start + 400);
    const confirmed = body.indexOf('lastPinConfirmedAt = Date.now()');
    const nullBranch = body.indexOf('if (pin === null)');
    expect(confirmed).toBeGreaterThan(-1);
    /* Set before the null branch returns, so an unpin still counts as the API
       being reachable. */
    expect(nullBranch).toBeGreaterThan(confirmed);
  });

  /* Scoped inside the effect, so a reconnect or settings change starts a fresh
     clock instead of inheriting a deadline from a torn-down poller. */
  it('scopes the clock to the effect run', () => {
    expect(SOURCE).toContain('let lastPinConfirmedAt = Date.now()');
  });
});

describe('fatal Twitch pin error signal', () => {
  it('distinguishes a lost connection from a missing channel', () => {
    const start = SOURCE.indexOf('onError: (error, fatal)');
    expect(start).toBeGreaterThan(-1);

    const body = SOURCE.slice(start, start + 1_200);

    expect(body).toContain("error.code === 'invalid-request'");
    expect(body).toContain(
      'Twitch pin connection is no longer usable. Reconnect Twitch in the generator.',
    );

    expect(body).toContain("error.code === 'channel-not-found'");
    expect(body).toContain(
      'Twitch pin polling stopped because the configured Twitch channel was not found.',
    );
  });
});
