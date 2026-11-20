// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ClassicCommandsHelp, { COMMAND_GROUPS, COMMAND_PLAIN, COMMANDS_BY_TOPIC, commandGroup } from '@/components/classic/ClassicCommandsHelp';
import { MULTICHAT_COMMANDS, MULTICHAT_COMMAND_TRIGGER } from '@/lib/multichatCommands';

const rows = () => Array.from(document.querySelectorAll('.cmd-row')).map((row) => row.getAttribute('data-command'));

describe('Commands & help', () => {
  it('lists every implemented command exactly once, grouped by topic', () => {
    render(<ClassicCommandsHelp />);
    expect([...rows()].sort()).toEqual(MULTICHAT_COMMANDS.map((command) => command.name).sort());
    expect(rows()).toEqual(COMMANDS_BY_TOPIC.map((command) => command.name));
    expect(rows()[0]).toBe('ping');
    expect(rows().slice(-3)).toEqual(['permit', 'unpermit', 'permitted']);
  });

  it('puts every implemented command in a named topic (none fall into Other today)', () => {
    expect(MULTICHAT_COMMANDS.filter((command) => commandGroup(command) === 'other')).toEqual([]);
    const grouped = COMMAND_GROUPS.flatMap((group) => group.names as readonly string[]);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('filters by topic and by search text', () => {
    render(<ClassicCommandsHelp />);
    fireEvent.click(screen.getByRole('button', { name: 'Platforms' }));
    expect(rows()).toEqual(MULTICHAT_COMMANDS.filter((c) => commandGroup(c) === 'platforms').map((c) => c.name));
    expect(screen.getByRole('button', { name: 'Platforms' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search commands' }), { target: { value: 'tts' } });
    expect(rows()).toEqual(['tts']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search commands' }), { target: { value: 'zzzz' } });
    expect(rows()).toEqual([]);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it('copies the trigger and command word when a command is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ClassicCommandsHelp />);
    const row = document.querySelector('[data-command="img"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button'));
    expect(row.getAttribute('title')).toContain('!flosschat img <url|emote>');
    expect(writeText).toHaveBeenCalledWith(`${MULTICHAT_COMMAND_TRIGGER} img`);
    expect(screen.getByRole('status').textContent).toContain('copied');
  });

  it('says who can use the commands once, in plain words', () => {
    render(<ClassicCommandsHelp />);
    expect(document.querySelector('.cmd-intro')?.textContent).toMatch(/the broadcaster and mods/);
  });

  it('gives every command a short plain-English line and keeps the exact syntax on hover', () => {
    expect(MULTICHAT_COMMANDS.filter((command) => !COMMAND_PLAIN[command.name])).toEqual([]);
    render(<ClassicCommandsHelp />);
    for (const command of MULTICHAT_COMMANDS) {
      const row = document.querySelector(`[data-command="${command.name}"]`)!;
      expect(row.querySelector('.cmd-summary')?.textContent).toBe(COMMAND_PLAIN[command.name]);
      expect(row.getAttribute('data-syntax')).toBe(command.syntax);
      expect(COMMAND_PLAIN[command.name]!.length).toBeLessThanOrEqual(32);
    }
  });
});
