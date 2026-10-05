/* Storage and connection-identity rules.
 *
 * Two properties are load-bearing and get most of the attention here: a stored
 * value is never trusted on the way out (sessionStorage is writable by anything
 * on the origin), and a half-valid OAuth fragment yields nothing rather than a
 * partially populated connection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isValidConnectionId,
  isValidTwitchLogin,
  normalizeTwitchLogin,
  readConnectionFromFragment,
} from '@/lib/twitchConnection';
import {
  clearStoredConnection,
  consumeWorkspaceDraft,
  readStoredConnection,
  workspaceDraftKey,
  writeStoredConnection,
  writeWorkspaceDraft,
  TWITCH_CONNECTION_KEY,
} from '@/lib/workspaceStorage';

const ID = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('connection id validation', () => {
  it('accepts a canonical uuid in either case', () => {
    expect(isValidConnectionId(ID)).toBe(true);
    expect(isValidConnectionId(ID.toUpperCase())).toBe(true);
  });

  it('rejects near-misses and non-strings', () => {
    for (const bad of [
      '',
      ID.slice(0, -1),
      `${ID}0`,
      ID.replace(/-/g, ''),
      `  ${ID}  `,
      'not-a-uuid',
      null,
      undefined,
      42,
      {},
      [ID],
    ]) {
      expect(isValidConnectionId(bad)).toBe(false);
    }
  });
});

describe('login validation and normalization', () => {
  it('lowercases, trims, and drops one leading @', () => {
    expect(normalizeTwitchLogin('  @SomeOne  ')).toBe('someone');
  });

  it('accepts logins that normalize to the allowed character set', () => {
    for (const good of ['someone', 'Some_One', '@user_123', '  MixedCase  ']) {
      expect(isValidTwitchLogin(good)).toBe(true);
    }
  });

  it('rejects empty, over-long, and out-of-charset logins', () => {
    for (const bad of ['', '   ', '@', 'a'.repeat(101), 'has space', 'dash-ed', 'dot.ted', null, 7]) {
      expect(isValidTwitchLogin(bad)).toBe(false);
    }
  });

  it('accepts a login exactly at the 100-character bound', () => {
    expect(isValidTwitchLogin('a'.repeat(100))).toBe(true);
  });
});

describe('reading a connection from a URL fragment', () => {
  it('reads a valid pair, with or without a leading #', () => {
    const expected = { connectionId: ID, login: 'someone' };
    expect(readConnectionFromFragment(`twitchConnectionId=${ID}&twitch=someone`)).toEqual(expected);
    expect(readConnectionFromFragment(`#twitchConnectionId=${ID}&twitch=SomeOne`)).toEqual(expected);
  });

  it('returns null when either half is missing or invalid', () => {
    for (const hash of [
      '',
      `twitchConnectionId=${ID}`,
      'twitch=someone',
      `twitchConnectionId=nope&twitch=someone`,
      `twitchConnectionId=${ID}&twitch=`,
      `twitchConnectionId=${ID}&twitch=has%20space`,
    ]) {
      expect(readConnectionFromFragment(hash)).toBeNull();
    }
  });

  /* A repeated key is the interesting case: `get` would silently take the first,
     so two consumers reading the same fragment could disagree about which
     account was authorized. The whole fragment is refused instead. */
  it('refuses a fragment with either key repeated', () => {
    expect(
      readConnectionFromFragment(`twitchConnectionId=${ID}&twitch=victim&twitch=attacker`),
    ).toBeNull();
    expect(
      readConnectionFromFragment(`twitchConnectionId=${ID}&twitchConnectionId=${ID}&twitch=a`),
    ).toBeNull();
  });
});

describe('stored connection', () => {
  it('round-trips a valid connection, normalizing the login', () => {
    writeStoredConnection({ connectionId: ID, login: '@SomeOne' });
    expect(readStoredConnection()).toEqual({ connectionId: ID, login: 'someone' });
  });

  it('writes nothing when either field is invalid', () => {
    writeStoredConnection({ connectionId: 'nope', login: 'someone' });
    writeStoredConnection({ connectionId: ID, login: 'has space' });
    expect(readStoredConnection()).toBeNull();
  });

  it('returns null and clears the key when the stored payload is unusable', () => {
    for (const raw of [
      'not json',
      '[]',
      '"a string"',
      'null',
      JSON.stringify({ connectionId: ID, login: 'someone' }), // no version
      JSON.stringify({ version: 0, connectionId: ID, login: 'someone' }),
      JSON.stringify({ version: 1, connectionId: 'nope', login: 'someone' }),
      JSON.stringify({ version: 1, connectionId: ID }),
      JSON.stringify({ version: 1, connectionId: ID, login: '' }),
    ]) {
      window.sessionStorage.setItem(TWITCH_CONNECTION_KEY, raw);
      expect(readStoredConnection()).toBeNull();
      /* Cleared, so a bad value cannot fail the same way on every later read. */
      expect(window.sessionStorage.getItem(TWITCH_CONNECTION_KEY)).toBeNull();
    }
  });

  /* Revalidation on read is the point: a value that was valid when written is
     not necessarily what comes back, since any script on the origin can rewrite
     sessionStorage between the write and the read. */
  it('refuses a connection tampered with after a valid write', () => {
    writeStoredConnection({ connectionId: ID, login: 'someone' });
    window.sessionStorage.setItem(
      TWITCH_CONNECTION_KEY,
      JSON.stringify({ version: 1, connectionId: ID, login: 'not a login' }),
    );
    expect(readStoredConnection()).toBeNull();
  });

  it('rejects a payload carrying a prototype-polluting own key', () => {
    window.sessionStorage.setItem(
      TWITCH_CONNECTION_KEY,
      `{"version":1,"connectionId":"${ID}","login":"someone","__proto__":{"polluted":true}}`,
    );
    expect(readStoredConnection()).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('clears on request', () => {
    writeStoredConnection({ connectionId: ID, login: 'someone' });
    clearStoredConnection();
    expect(readStoredConnection()).toBeNull();
  });
});

describe('workspace draft', () => {
  const draft = {
    channels: { twitch: 'someone', kick: 'kickuser' },
    style: { textSize: 'large' },
    background: 'dark',
  };

  it('round-trips channels, style, and background', () => {
    writeWorkspaceDraft('multichat', draft);
    expect(consumeWorkspaceDraft('multichat')).toEqual(draft);
  });

  /* One-shot by construction. A surviving draft would let a later effect run
     overwrite edits the user made after the restore. */
  it('is consumed on read, so a second read finds nothing', () => {
    writeWorkspaceDraft('multichat', draft);
    expect(consumeWorkspaceDraft('multichat')).not.toBeNull();
    expect(consumeWorkspaceDraft('multichat')).toBeNull();
  });

  it('keys drafts per tool, so one tool cannot read or clobber another', () => {
    writeWorkspaceDraft('multichat', draft);
    writeWorkspaceDraft('counter', { ...draft, background: 'light' });
    expect(consumeWorkspaceDraft('counter')?.background).toBe('light');
    expect(consumeWorkspaceDraft('multichat')?.background).toBe('dark');
    expect(workspaceDraftKey('multichat')).not.toBe(workspaceDraftKey('counter'));
  });

  it('drops undefined channel values rather than storing them', () => {
    writeWorkspaceDraft('multichat', {
      ...draft,
      channels: { twitch: 'someone', kick: undefined },
    });
    expect(consumeWorkspaceDraft('multichat')?.channels).toEqual({ twitch: 'someone' });
  });

  it('returns null for a malformed or wrong-version payload', () => {
    for (const raw of ['not json', '[]', 'null', JSON.stringify({ channels: {} })]) {
      window.sessionStorage.setItem(workspaceDraftKey('multichat'), raw);
      expect(consumeWorkspaceDraft('multichat')).toBeNull();
    }
  });

  /* Field independence: a corrupted half should not discard the good half. */
  it('restores the good fields when others are corrupt', () => {
    window.sessionStorage.setItem(
      workspaceDraftKey('multichat'),
      JSON.stringify({ version: 1, channels: 'nonsense', style: { font: 'x' }, background: 9 }),
    );
    expect(consumeWorkspaceDraft('multichat')).toEqual({
      channels: {},
      style: { font: 'x' },
      background: '',
    });
  });

  it('keeps only string channel values from a stored payload', () => {
    window.sessionStorage.setItem(
      workspaceDraftKey('multichat'),
      JSON.stringify({
        version: 1,
        channels: { twitch: 'ok', kick: 5, youtube: null, tiktok: { a: 1 } },
        style: {},
        background: 'dark',
      }),
    );
    expect(consumeWorkspaceDraft('multichat')?.channels).toEqual({ twitch: 'ok' });
  });

  it('rejects a draft carrying a prototype-polluting own key', () => {
    window.sessionStorage.setItem(
      workspaceDraftKey('multichat'),
      '{"version":1,"channels":{},"style":{},"background":"dark","constructor":{"x":1}}',
    );
    expect(consumeWorkspaceDraft('multichat')).toBeNull();
  });

  it('never stores a token-shaped field, only what was typed and chosen', () => {
    writeWorkspaceDraft('multichat', draft);
    const raw = window.sessionStorage.getItem(workspaceDraftKey('multichat')) ?? '';
    expect(raw).not.toMatch(/token|secret|connectionId|code=/i);
  });
});

/* Storage being unavailable must degrade the feature, never break the page:
   sessionStorage throws outright in Safari private mode and under some cookie
   policies, and setItem throws on quota exhaustion. */
describe('storage unavailability', () => {
  it('degrades quietly when every access throws', () => {
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('unavailable');
    });
    try {
      expect(() => writeStoredConnection({ connectionId: ID, login: 'someone' })).not.toThrow();
      expect(readStoredConnection()).toBeNull();
      expect(() => clearStoredConnection()).not.toThrow();
      expect(consumeWorkspaceDraft('multichat')).toBeNull();
      expect(() =>
        writeWorkspaceDraft('multichat', { channels: {}, style: {}, background: 'dark' }),
      ).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
