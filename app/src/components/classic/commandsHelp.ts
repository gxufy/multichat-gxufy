/* Commands & help: topic groups, topic order and the one-line descriptions,
   for the generator's Commands & help section. */
import { MULTICHAT_COMMANDS, type MultichatCommand } from '@/lib/multichatCommands';

export const COMMAND_GROUPS = [
  { id: 'basics', label: 'Basics', names: ['ping', 'reload', 'refresh', 'clear', 'stop', 'pause', 'resume', 'togglepause', 'show', 'hide'] },
  { id: 'platforms', label: 'Platforms', names: ['kickon', 'kickoff', 'twitchon', 'twitchoff', 'youtubeon', 'youtubeoff', 'tiktokon', 'tiktokoff', 'sharedon', 'sharedoff'] },
  { id: 'look', label: 'Look & alerts', names: ['animation', 'events', 'counterbgon', 'counterbgoff'] },
  { id: 'media', label: 'Media', names: ['img', 'yt', 'tts'] },
  { id: 'viewers', label: 'For viewers', names: ['paint'] },
  { id: 'permissions', label: 'Permits', names: ['permit', 'unpermit', 'permitted'] },
] as const;

export type GroupId = (typeof COMMAND_GROUPS)[number]['id'] | 'other';

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
  paint: 'Anyone: pick 7TV or JilTV paint',
};
