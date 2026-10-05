/* MultiChat's runtime gating rule.
 *
 * One fact drives three behaviours — option availability, pin-list
 * reconciliation, and whether the connection id reaches the URL — so these tests
 * mostly check that all three agree with `twitchPinsAvailable` rather than each
 * having its own notion of "connected".
 *
 * The rule: native Twitch pins need a connection *and* a configured Twitch
 * channel naming that same account. Polling account A's pins while the overlay
 * reads channel B would show pins that never appear in the visible chat.
 */
import { describe, expect, it } from 'vitest';
import { MULTICHAT_WORKSPACE_DEFAULTS } from '@/lib/multichatConfig';
import {
  EMPTY_MULTICHAT_RUNTIME,
  multichatContext,
  multichatOptionAvailability,
  syncMultichatStyle,
  twitchPinsAvailable,
  twitchPinsReason,
  type MultichatRuntime,
} from '@/features/multichat/runtime';

const ID = '123e4567-e89b-12d3-a456-426614174000';

/** A runtime with a live connection matching the configured channel. */
const MATCHED: MultichatRuntime = {
  connectionId: ID,
  connectedLogin: 'someone',
  twitchChannel: 'someone',
};

const D = MULTICHAT_WORKSPACE_DEFAULTS;

/** Defaults with Twitch pins actually requested. */
const PINNED = { ...D, showPinEnabled: true, pinPlatforms: ['twitch', 'kick'] as const };

describe('twitchPinsAvailable', () => {
  it('is true only with a connection whose login matches the channel', () => {
    expect(twitchPinsAvailable(MATCHED)).toBe(true);
  });

  it('is false with no connection at all', () => {
    expect(twitchPinsAvailable(EMPTY_MULTICHAT_RUNTIME)).toBe(false);
  });

  it('is false when the configured channel is a different account', () => {
    expect(twitchPinsAvailable({ ...MATCHED, twitchChannel: 'someoneelse' })).toBe(false);
  });

  it('is false when no Twitch channel is configured yet', () => {
    expect(twitchPinsAvailable({ ...MATCHED, twitchChannel: '' })).toBe(false);
  });

  /* A connection id with no login would otherwise match an empty channel and
     silently enable pins for nobody. */
  it('is false when the login is missing despite an id', () => {
    expect(twitchPinsAvailable({ connectionId: ID, connectedLogin: '', twitchChannel: '' })).toBe(
      false,
    );
  });

  it('compares the channel using the same normalization as everything else', () => {
    for (const typed of ['  someone  ', '@someone', 'SomeOne', '@SOMEONE']) {
      expect(twitchPinsAvailable({ ...MATCHED, twitchChannel: typed })).toBe(true);
    }
  });
});

describe('twitchPinsReason', () => {
  it('is absent when pins are available, so nothing is explained needlessly', () => {
    expect(twitchPinsReason(MATCHED)).toBeUndefined();
  });

  it('asks for a connection when there is none', () => {
    expect(twitchPinsReason(EMPTY_MULTICHAT_RUNTIME)).toMatch(/connect a twitch account/i);
  });

  /* The mismatch case must name the connected account: "not available" alone
     leaves the user with no idea what to change. */
  it('names the connected account when the channel does not match', () => {
    const reason = twitchPinsReason({ ...MATCHED, twitchChannel: 'other' }) ?? '';
    expect(reason).toContain('someone');
  });

  it('never includes the connection id', () => {
    for (const runtime of [
      EMPTY_MULTICHAT_RUNTIME,
      { ...MATCHED, twitchChannel: 'other' },
      { ...MATCHED, twitchChannel: '' },
    ]) {
      expect(twitchPinsReason(runtime) ?? '').not.toContain(ID);
    }
  });
});

describe('multichatOptionAvailability', () => {
  it('gates nothing when pins are available', () => {
    expect(multichatOptionAvailability(MATCHED)).toEqual({});
  });

  it('marks only the twitch pin option unavailable, with a reason', () => {
    const availability = multichatOptionAvailability(EMPTY_MULTICHAT_RUNTIME);
    expect(availability.pinPlatforms?.twitch.available).toBe(false);
    expect(availability.pinPlatforms?.twitch.reason).toBeTruthy();
    /* The other platforms need no connection, so they are never listed. */
    expect(availability.pinPlatforms?.kick).toBeUndefined();
    expect(availability.pinPlatforms?.youtube).toBeUndefined();
  });

  it('agrees with twitchPinsAvailable in every state', () => {
    for (const runtime of [
      MATCHED,
      EMPTY_MULTICHAT_RUNTIME,
      { ...MATCHED, twitchChannel: 'other' },
      { ...MATCHED, connectionId: '' },
    ]) {
      const gated = multichatOptionAvailability(runtime).pinPlatforms?.twitch;
      expect(gated === undefined).toBe(twitchPinsAvailable(runtime));
    }
  });
});

describe('syncMultichatStyle', () => {
  it('drops twitch from the pin list when pins are unavailable', () => {
    const synced = syncMultichatStyle(PINNED, EMPTY_MULTICHAT_RUNTIME);
    expect(synced.pinPlatforms).toEqual(['kick']);
  });

  it('preserves the other selections exactly', () => {
    const style = { ...D, pinPlatforms: ['twitch', 'kick', 'youtube'] as const };
    expect(syncMultichatStyle(style, EMPTY_MULTICHAT_RUNTIME).pinPlatforms).toEqual([
      'kick',
      'youtube',
    ]);
  });

  it('leaves the style untouched when pins are available', () => {
    expect(syncMultichatStyle(PINNED, MATCHED)).toBe(PINNED);
  });

  /* Returning the identical object when nothing changes is what lets the shell's
     effect skip a state update, so it cannot loop. */
  it('returns the same object when twitch was never selected', () => {
    const style = { ...D, pinPlatforms: ['kick'] as const };
    expect(syncMultichatStyle(style, EMPTY_MULTICHAT_RUNTIME)).toBe(style);
  });

  it('never adds twitch, so connecting does not opt anyone in', () => {
    const style = { ...D, pinPlatforms: [] as const };
    expect(syncMultichatStyle(style, MATCHED).pinPlatforms).toEqual([]);
  });

  it('drops twitch again when a channel edit breaks the match', () => {
    const synced = syncMultichatStyle(PINNED, { ...MATCHED, twitchChannel: 'other' });
    expect(synced.pinPlatforms).not.toContain('twitch');
  });
});

describe('multichatContext', () => {
  it('emits the id and login as a fragment when pins are available and wanted', () => {
    const context = multichatContext(PINNED, MATCHED);
    const params = new URLSearchParams(context?.fragment);
    expect(params.get('twitchConnectionId')).toBe(ID);
    expect(params.get('twitch')).toBe('someone');
  });

  it('emits nothing without a usable connection', () => {
    expect(multichatContext(PINNED, EMPTY_MULTICHAT_RUNTIME)).toBeUndefined();
    expect(multichatContext(PINNED, { ...MATCHED, twitchChannel: 'other' })).toBeUndefined();
  });

  /* No id in a URL that has no use for it: pins off, or twitch not among the
     selected pin platforms. */
  it('emits nothing when pins are disabled or twitch is unselected', () => {
    expect(multichatContext({ ...PINNED, showPinEnabled: false }, MATCHED)).toBeUndefined();
    expect(
      multichatContext({ ...PINNED, pinPlatforms: ['kick'] as const }, MATCHED),
    ).toBeUndefined();
  });

  it('produces a fragment with no leading #, so the builder adds exactly one', () => {
    expect(multichatContext(PINNED, MATCHED)?.fragment?.startsWith('#')).toBe(false);
  });
});
