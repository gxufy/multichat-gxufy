/* Command metadata must describe the real dispatcher, not a parallel wish list.
 *
 * The load-bearing test here reads lib/multichatCommandRuntimeCore.ts and extracts
 * the `case` labels from the dispatcher's own switch statement, then asserts they
 * are exactly the documented names. The public multichatCommandRuntime.ts module
 * now decorates that core dispatcher with live DOM visibility reconciliation, so
 * source-shape assertions belong to the core where the switch actually lives.
 *
 * The remaining tests pin the facts the UI copy asserts — both triggers, the single
 * shared access gate, and the argument shapes — so documentation cannot claim
 * capabilities the dispatcher lacks. Behaviour itself is tested by executing it:
 * see multichatCommandDispatch.test.ts, which drives every command through each
 * connector's real ingestion path.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MULTICHAT_ACCESS_BROADCASTER,
  MULTICHAT_ACCESS_MODERATOR,
  MULTICHAT_COMMAND_ALIASES,
  MULTICHAT_COMMANDS,
  MULTICHAT_COMMAND_ALIAS,
  MULTICHAT_COMMAND_MIN_ACCESS,
  MULTICHAT_COMMAND_TRIGGER,
  canonicalMultichatCommandName,
} from '@/lib/multichatCommands';
import {
  MULTICHAT_PERMITTED_COMMANDS,
  MULTICHAT_TRIGGERS,
  YT_PRESETS,
} from '@/lib/multichatCommandRuntime';

const SOURCE = readFileSync(
  join(process.cwd(), 'src', 'lib', 'multichatCommandRuntimeCore.ts'),
  'utf8',
);

/** The dispatcher body: the switch inside `handle`, to the end of the module. */
const handlerBody = () => {
  const start = SOURCE.indexOf('switch (command.name)');
  expect(start).toBeGreaterThan(-1);
  return SOURCE.slice(start);
};

/** The whole runtime module, for facts that live outside the switch. */
const runtimeSource = () => SOURCE;

/** Every `case 'x':` label inside the handler, in source order. */
const parsedCases = () =>
  Array.from(handlerBody().matchAll(/case '([a-z]+)':/g)).map((m) => m[1]);

describe('documented commands match the parser', () => {
  it('documents exactly the switch cases the handler implements', () => {
    expect(MULTICHAT_COMMANDS.map((c) => c.name)).toEqual(parsedCases());
  });

  it('finds a non-trivial number of cases, so the regex has not silently broken', () => {
    expect(parsedCases().length).toBeGreaterThanOrEqual(9);
  });

  it('documents no command the handler lacks', () => {
    const implemented = new Set(parsedCases());
    for (const command of MULTICHAT_COMMANDS) {
      expect(implemented.has(command.name)).toBe(true);
    }
  });

  it('omits commands the handler has never implemented', () => {
    const documented = new Set(MULTICHAT_COMMANDS.map((c) => c.name));
    for (const absent of ['say', 'mute', 'volume', 'pin', 'timeout']) {
      expect(documented.has(absent)).toBe(false);
      expect(parsedCases()).not.toContain(absent);
    }
  });

  it('derives command aliases from their canonical catalog entries', () => {
    const clear = MULTICHAT_COMMANDS.find((command) => command.name === 'clear');
    const pause = MULTICHAT_COMMANDS.find((command) => command.name === 'pause');
    const resume = MULTICHAT_COMMANDS.find((command) => command.name === 'resume');
    const togglepause = MULTICHAT_COMMANDS.find((command) => command.name === 'togglepause');
    const permit = MULTICHAT_COMMANDS.find((command) => command.name === 'permit');
    const unpermit = MULTICHAT_COMMANDS.find((command) => command.name === 'unpermit');
    const permitted = MULTICHAT_COMMANDS.find((command) => command.name === 'permitted');
    expect(clear?.aliases).toEqual(['cls']);
    expect(pause?.aliases).toEqual(['freeze']);
    expect(resume?.aliases).toEqual(['play', 'unfreeze', 'unpause']);
    expect(togglepause?.aliases).toEqual(['tp']);
    expect(permit?.aliases).toEqual(['grant', 'allow']);
    expect(unpermit?.aliases).toEqual(['revoke', 'deny']);
    expect(permitted?.aliases).toEqual(['perms', 'permissions']);
    expect(MULTICHAT_COMMAND_ALIASES).toEqual({
      grant: 'permit',
      allow: 'permit',
      revoke: 'unpermit',
      deny: 'unpermit',
      perms: 'permitted',
      permissions: 'permitted',
      cls: 'clear',
      freeze: 'pause',
      play: 'resume',
      unfreeze: 'resume',
      unpause: 'resume',
      tp: 'togglepause',
    });
    expect(canonicalMultichatCommandName('clear')).toBe('clear');
    expect(canonicalMultichatCommandName('cls')).toBe('clear');
    expect(canonicalMultichatCommandName('freeze')).toBe('pause');
    expect(canonicalMultichatCommandName('play')).toBe('resume');
    expect(canonicalMultichatCommandName('unfreeze')).toBe('resume');
    expect(canonicalMultichatCommandName('unpause')).toBe('resume');
    expect(canonicalMultichatCommandName('tp')).toBe('togglepause');
    expect(canonicalMultichatCommandName('grant')).toBe('permit');
    expect(canonicalMultichatCommandName('allow')).toBe('permit');
    expect(canonicalMultichatCommandName('revoke')).toBe('unpermit');
    expect(canonicalMultichatCommandName('deny')).toBe('unpermit');
    expect(canonicalMultichatCommandName('perms')).toBe('permitted');
    expect(canonicalMultichatCommandName('permissions')).toBe('permitted');
    expect(clear?.detail).toContain('!multichat cls');
    expect(pause?.detail).toContain('!multichat freeze');
    expect(resume?.detail).toContain('!multichat unpause');
    expect(togglepause?.detail).toContain('!multichat tp');
    expect(pause?.aliases).not.toContain('stop');
  });
});

describe('triggers and access', () => {
  it('matches the two triggers the dispatcher accepts', () => {
    expect(MULTICHAT_COMMAND_TRIGGER).toBe('!multichat');
    expect(MULTICHAT_COMMAND_ALIAS).toBe('!kickchat');
    /* The runtime's own list, so a third trigger cannot appear undocumented. */
    expect([...MULTICHAT_TRIGGERS]).toEqual([
      MULTICHAT_COMMAND_TRIGGER,
      MULTICHAT_COMMAND_ALIAS,
    ]);
  });

  it('keeps native moderator access separate from restricted temporary permits', () => {
    expect(MULTICHAT_COMMAND_MIN_ACCESS).toBe(MULTICHAT_ACCESS_MODERATOR);
    expect(MULTICHAT_ACCESS_MODERATOR).toBe(500);
    expect(MULTICHAT_ACCESS_BROADCASTER).toBe(1000);
    expect([...MULTICHAT_PERMITTED_COMMANDS]).toEqual([
      'ping', 'clear', 'pause', 'resume', 'togglepause', 'show', 'hide',
      'kickon', 'kickoff', 'twitchon', 'twitchoff', 'youtubeon', 'youtubeoff',
      'tiktokon', 'tiktokoff', 'sharedon', 'sharedoff', 'animation', 'events',
    ]);
    for (const sensitive of [
      'reload', 'stop', 'counterbgon', 'counterbgoff', 'refresh', 'img', 'yt',
      'tts', 'permit', 'unpermit', 'permitted',
    ]) {
      expect(MULTICHAT_PERMITTED_COMMANDS.has(sensitive), sensitive).toBe(false);
    }
  });

  it('keeps the access levels the badge reader assigns', () => {
    expect(runtimeSource()).toContain(
      "badge.type === 'broadcaster' || badge.type === 'owner'",
    );
    expect(runtimeSource()).toContain('return MULTICHAT_ACCESS_BROADCASTER');
    expect(runtimeSource()).toContain("badge.type === 'moderator'");
    expect(runtimeSource()).toContain('return MULTICHAT_ACCESS_MODERATOR');
  });
});

describe('documented syntax is well formed', () => {
  it('starts every syntax line with the primary trigger and its own name', () => {
    for (const command of MULTICHAT_COMMANDS) {
      expect(command.syntax.startsWith(`${MULTICHAT_COMMAND_TRIGGER} ${command.name}`)).toBe(
        true,
      );
    }
  });

  it('keeps names unique and lowercase, as the handler lowercases before matching', () => {
    const names = MULTICHAT_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toBe(name.toLowerCase());
  });

  it('keeps aliases unique, lowercase, and separate from canonical names', () => {
    const names = new Set(MULTICHAT_COMMANDS.map((command) => command.name));
    const aliases = MULTICHAT_COMMANDS.flatMap((command) => command.aliases ?? []);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) {
      expect(alias).toBe(alias.toLowerCase());
      expect(names.has(alias)).toBe(false);
    }
  });

  it('gives every command a summary', () => {
    for (const command of MULTICHAT_COMMANDS) {
      expect(command.summary.length).toBeGreaterThan(0);
      expect(command.summary.endsWith('.')).toBe(true);
    }
  });

  it('documents only the flags the dispatcher actually parses', () => {
    const source = runtimeSource();
    const img = MULTICHAT_COMMANDS.find((c) => c.name === 'img');
    const yt = MULTICHAT_COMMANDS.find((c) => c.name === 'yt');
    expect(source).toContain('-t\\s+([\\d.]+)');
    expect(source).toContain('-o\\s+([\\d.]+)');
    expect(source).toContain("command.text.includes('-m')");
    expect(img?.syntax).toContain('-t');
    expect(img?.syntax).toContain('-o');
    expect(yt?.syntax).toContain('-m');
    /* -o is an image-only flag: the yt branch never reads an opacity. */
    expect(yt?.syntax).not.toContain('-o');
  });

  it('documents exactly the yt presets the dispatcher defines', () => {
    const yt = MULTICHAT_COMMANDS.find((c) => c.name === 'yt');
    /* The runtime's own table, so a preset cannot be added or removed without the
       documented detail line failing. */
    expect(Object.keys(YT_PRESETS).sort()).toEqual(
      ['bruh', 'dc-ping', 'rickroll', 'vine-boom', 'win-error'].sort(),
    );
    for (const preset of Object.keys(YT_PRESETS)) {
      expect(yt?.detail).toContain(preset);
    }
  });

  it('documents img clear, which the dispatcher special-cases', () => {
    expect(runtimeSource()).toContain("command.args[0] === 'clear'");
    expect(MULTICHAT_COMMANDS.find((c) => c.name === 'img')?.detail).toContain('clear');
  });

  it('documents refresh as taking only the optional emotes argument', () => {
    expect(runtimeSource()).toContain("if (argument && argument !== 'emotes') return;");
    const refresh = MULTICHAT_COMMANDS.find((c) => c.name === 'refresh');
    expect(refresh?.syntax).toContain('[emotes]');
    expect(refresh?.detail).toContain('emotes');
  });
});
