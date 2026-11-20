/* Commands the owner can send to one channel's overlays from Owner tools.
 *
 * The same !flosschat commands a streamer's mods type in chat, minus the
 * streamer's own permission management (permit / unpermit / permitted). The
 * overlay runs a sent command exactly as if the streamer had typed it, so every
 * check the command already has (safe image/video links, cooldowns) still
 * applies. Browser-safe: Owner tools lists these, the server checks them.
 */
import { MULTICHAT_COMMANDS, type MultichatCommand } from './multichatCommands';

/** Longest command text accepted, arguments included. */
export const OWNER_COMMAND_MAX_LENGTH = 300;

const STREAMER_ONLY = new Set(['permit', 'unpermit', 'permitted']);

/** The commands Owner tools offers, in the help's order. */
export const OWNER_RUNNABLE_COMMANDS: readonly MultichatCommand[] = MULTICHAT_COMMANDS
  .filter((command) => !STREAMER_ONLY.has(command.name));

const RUNNABLE_WORDS = new Set(
  OWNER_RUNNABLE_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
);

/** The part of a command's syntax after its name (e.g. "<message>"), or ''. */
export function ownerCommandArguments(command: MultichatCommand): string {
  const words = command.syntax.split(' ');
  return words.slice(2).join(' ');
}

/** True when the command needs or accepts something after its name. */
export function ownerCommandTakesArguments(command: MultichatCommand): boolean {
  return ownerCommandArguments(command) !== '';
}

/**
 * The command text to send (name first, no trigger), or null if it isn't one
 * the owner may send. Rejects control characters and anything over
 * OWNER_COMMAND_MAX_LENGTH; collapses runs of spaces.
 */
export function normalizeOwnerCommand(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const text = raw.trim().replace(/^!(flosschat|multichat|kickchat)\s+/i, '').replace(/\s+/g, ' ');
  if (!text || text.length > OWNER_COMMAND_MAX_LENGTH) return null;
  const word = text.split(' ')[0]!.toLowerCase();
  return RUNNABLE_WORDS.has(word) ? text : null;
}
