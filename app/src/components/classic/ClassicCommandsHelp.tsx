/*
 * Commands & help. The rows still come straight from
 * MULTICHAT_COMMANDS — the parser's own metadata — so this panel cannot
 * document a command the overlay does not implement. Topic order, search and
 * copy are presentation only; a command missing from COMMAND_GROUPS falls
 * into "Other" rather than disappearing.
 */
import { useMemo, useRef, useState } from 'react';
import {
  MULTICHAT_COMMANDS,
  MULTICHAT_COMMAND_TRIGGER,
  type MultichatCommand,
} from '@/lib/multichatCommands';

export const COMMAND_GROUPS = [
  { id: 'basics', label: 'Basics', names: ['ping', 'reload', 'refresh', 'clear', 'stop', 'pause', 'resume', 'togglepause', 'show', 'hide'] },
  { id: 'platforms', label: 'Platforms', names: ['kickon', 'kickoff', 'twitchon', 'twitchoff', 'youtubeon', 'youtubeoff', 'tiktokon', 'tiktokoff', 'sharedon', 'sharedoff'] },
  { id: 'look', label: 'Look & alerts', names: ['animation', 'events', 'counterbgon', 'counterbgoff'] },
  { id: 'media', label: 'Media', names: ['img', 'yt', 'tts'] },
  { id: 'permissions', label: 'Permits', names: ['permit', 'unpermit', 'permitted'] },
] as const;

type GroupId = (typeof COMMAND_GROUPS)[number]['id'] | 'other';

const GROUP_OF = new Map<string, GroupId>(
  COMMAND_GROUPS.flatMap((group) => group.names.map((name) => [name, group.id] as const)),
);

export function commandGroup(command: MultichatCommand): GroupId {
  return GROUP_OF.get(command.name) ?? 'other';
}

const GROUP_ORDER: GroupId[] = [...COMMAND_GROUPS.map((group) => group.id), 'other'];

/** Commands ordered by topic (Basics first), keeping handler order within a topic. */
export const COMMANDS_BY_TOPIC: readonly MultichatCommand[] = [...MULTICHAT_COMMANDS]
  .map((command, index) => ({ command, index }))
  .sort((left, right) => (
    GROUP_ORDER.indexOf(commandGroup(left.command)) - GROUP_ORDER.indexOf(commandGroup(right.command))
    || left.index - right.index
  ))
  .map(({ command }) => command);

/*
 * One plain-English line per command, for anyone to get at a glance. The full
 * summary/detail from MULTICHAT_COMMANDS stays available on hover. A command
 * without an entry here falls back to its summary.
 */
export const COMMAND_PLAIN: Readonly<Record<string, string>> = {
  ping: 'Check it works (says Pong!)',
  reload: 'Restart the overlay',
  refresh: 'Reload the emotes',
  clear: 'Wipe the chat',
  stop: 'Stop pics, videos & alerts',
  pause: 'Freeze new messages',
  resume: 'Unfreeze messages',
  togglepause: 'Freeze / unfreeze',
  show: 'Show the chat',
  hide: 'Hide the chat',
  kickon: 'Show Kick chat',
  kickoff: 'Hide Kick chat',
  twitchon: 'Show Twitch chat',
  twitchoff: 'Hide Twitch chat',
  youtubeon: 'Show YouTube chat',
  youtubeoff: 'Hide YouTube chat',
  tiktokon: 'Show TikTok chat',
  tiktokoff: 'Hide TikTok chat',
  sharedon: 'Show shared chat',
  sharedoff: 'Hide shared chat',
  animation: 'Message animations on / off',
  events: 'Alerts on / off',
  counterbgon: 'Counter background on',
  counterbgoff: 'Counter background off',
  img: 'Put a pic or emote on screen',
  yt: 'Play a YouTube video on screen',
  tts: 'Read a message out loud',
  permit: 'Let a viewer use commands',
  unpermit: 'Take that away',
  permitted: 'See who is allowed',
};

const COPIED_MS = 1_500;

export default function ClassicCommandsHelp() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupId | 'all'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groups = useMemo(() => {
    const present = new Set(MULTICHAT_COMMANDS.map(commandGroup));
    const list: { id: GroupId; label: string }[] = COMMAND_GROUPS
      .filter((entry) => present.has(entry.id))
      .map(({ id, label }) => ({ id, label }));
    if (present.has('other')) list.push({ id: 'other', label: 'Other' });
    return list;
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = COMMANDS_BY_TOPIC.filter((command) => (
    (group === 'all' || commandGroup(command) === group)
    && (!needle || `${command.syntax} ${command.summary} ${command.detail ?? ''}`.toLowerCase().includes(needle))
  ));

  const copy = (command: MultichatCommand) => {
    /* Copy just the trigger + command word; arguments are placeholders. */
    const text = `${MULTICHAT_COMMAND_TRIGGER} ${command.name}`;
    void navigator.clipboard?.writeText(text);
    setCopied(command.name);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };

  return (
    <div className="cmd-help">
      <div className="cmd-top">
        <p className="cmd-intro">
          Type <code className="cmd-trigger">{MULTICHAT_COMMAND_TRIGGER}</code> + a word in chat (e.g.{' '}
          <code>{MULTICHAT_COMMAND_TRIGGER} clear</code>). Only <strong>the broadcaster and mods</strong>{' '}
          can use them. Click one to copy it.
        </p>
        <input
          type="search"
          className="cmd-search"
          placeholder="Search"
          aria-label="Search commands"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="cmd-groups" role="group" aria-label="Command topics">
        {[{ id: 'all' as const, label: 'All' }, ...groups].map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`cmd-group${group === entry.id ? ' on' : ''}`}
            aria-pressed={group === entry.id}
            onClick={() => setGroup(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {visible.length ? (
        <ul className="cmd-list" aria-label="Chat commands the FlossChat overlay implements">
          {visible.map((command) => {
            const plain = COMMAND_PLAIN[command.name] ?? command.summary;
            const full = [command.syntax, command.summary, command.detail].filter(Boolean).join(' — ');
            return (
              <li
                key={command.name}
                className="cmd-row"
                data-command={command.name}
                data-syntax={command.syntax}
                title={full}
              >
                <button
                  type="button"
                  className={`cmd-syntax${copied === command.name ? ' ok' : ''}`}
                  onClick={() => copy(command)}
                  aria-label={`Copy ${MULTICHAT_COMMAND_TRIGGER} ${command.name}: ${plain}`}
                >
                  <code>{command.name}</code>
                  <span className="cmd-copy-hint" aria-hidden="true">
                    {copied === command.name ? '✓' : '⧉'}
                  </span>
                </button>
                <span className="cmd-summary">{plain}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cmd-empty">Nothing matches “{query.trim()}”.</p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {copied ? `${MULTICHAT_COMMAND_TRIGGER} ${copied} copied to the clipboard.` : ''}
      </p>
    </div>
  );

}
