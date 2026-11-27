/* Which commands Owner tools may send to a channel's overlays. */
import { describe, expect, it } from 'vitest';
import {
  OWNER_COMMAND_MAX_LENGTH,
  OWNER_RUNNABLE_COMMANDS,
  normalizeOwnerCommand,
  ownerCommandArguments,
  ownerCommandTakesArguments,
} from '@/lib/overlayOwnerCommands';
import { MULTICHAT_COMMANDS } from '@/lib/multichatCommands';

describe('owner commands', () => {
  it('offers every command except the streamer’s own permits and a chatter’s own paint', () => {
    const offered = OWNER_RUNNABLE_COMMANDS.map((command) => command.name);
    expect(offered).not.toContain('permit');
    expect(offered).not.toContain('unpermit');
    expect(offered).not.toContain('permitted');
    expect(offered).not.toContain('paint');
    expect(offered).toEqual(MULTICHAT_COMMANDS.map((c) => c.name).filter((n) => !['permit', 'unpermit', 'permitted', 'paint'].includes(n)));
    expect(offered).toEqual(expect.arrayContaining(['reload', 'clear', 'tts', 'img', 'yt', 'events', 'counterbgon']));
  });

  it('accepts commands and aliases, with or without the trigger, keeping their details', () => {
    expect(normalizeOwnerCommand('reload')).toBe('reload');
    expect(normalizeOwnerCommand('  tts   Hello   Chat  ')).toBe('tts Hello Chat');
    expect(normalizeOwnerCommand('!flosschat cls')).toBe('cls');
    expect(normalizeOwnerCommand('!multichat events subs off')).toBe('events subs off');
    expect(normalizeOwnerCommand('IMG https://example.com/a.png')).toBe('IMG https://example.com/a.png');
  });

  it('refuses permits, unknown words, control characters and very long text', () => {
    for (const bad of ['permit alice', 'grant alice', 'unpermit alice', 'revoke alice', 'permitted', 'perms', 'nuke', '', '   ', 42, null]) {
      expect(normalizeOwnerCommand(bad), String(bad)).toBeNull();
    }
    expect(normalizeOwnerCommand('tts hi\nthere')).toBeNull();
    expect(normalizeOwnerCommand(`tts ${'a'.repeat(OWNER_COMMAND_MAX_LENGTH)}`)).toBeNull();
  });

  it('knows which commands take details', () => {
    const byName = (name: string) => OWNER_RUNNABLE_COMMANDS.find((c) => c.name === name)!;
    expect(ownerCommandTakesArguments(byName('reload'))).toBe(false);
    expect(ownerCommandArguments(byName('tts'))).toBe('<message>');
    expect(ownerCommandArguments(byName('refresh'))).toBe('[emotes]');
  });
});
