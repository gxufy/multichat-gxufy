/* Authoritative !multichat command metadata.
 *
 * lib/multichatCommandRuntime.ts is the implementation; this module is the single
 * description of it. Both the workspace Commands panel and the classic generator's
 * table read from here, so neither can document a command the dispatcher does not
 * implement.
 *
 * A test in tests/unit/multichatCommands.test.ts reads the dispatcher's own switch
 * statement out of the source file and asserts its `case` labels are exactly the
 * names below. That is what keeps this from drifting into fiction: adding a case
 * without documenting it, or documenting one that was removed, fails the suite.
 * Further tests drive every command through each connector's real ingestion path.
 *
 * Everything here was traced from the dispatcher rather than assumed. In
 * particular: a trigger must be the message's first token, native moderators keep
 * their existing command access, permission management has its own stricter
 * policy, and there is no `refresh` variant other than a bare call or the literal
 * `emotes`.
 */

/** Primary trigger word. */
export const MULTICHAT_COMMAND_TRIGGER = '!multichat';

/** Legacy trigger, still accepted verbatim by the handler. */
export const MULTICHAT_COMMAND_ALIAS = '!kickchat';

/** Native access levels the handler derives from unified provider identity. */
export const MULTICHAT_ACCESS_BROADCASTER = 1000;
export const MULTICHAT_ACCESS_MODERATOR = 500;

/**
 * The native moderator level retained by ordinary commands. Temporary permits
 * use a separate explicit command allowlist and never receive this level.
 */
export const MULTICHAT_COMMAND_MIN_ACCESS = MULTICHAT_ACCESS_MODERATOR;

export type MultichatCommand = {
  /** The canonical `case` label in the handler's switch. */
  readonly name: string;
  /** Additional command words normalized to `name` before dispatch. */
  readonly aliases?: readonly string[];
  /** Exact syntax, including the trigger. */
  readonly syntax: string;
  /** What it does, in one line. */
  readonly summary: string;
  /** Extra detail only where behaviour would otherwise be guessed at. */
  readonly detail?: string;
};

/**
 * Every command the handler implements, in switch order.
 *
 * Order matches the switch so a reader comparing the two sees them line up.
 */
export const MULTICHAT_COMMANDS: readonly MultichatCommand[] = [
  {
    name: 'ping',
    syntax: '!multichat ping',
    summary: 'Shows a "Pong!" confirmation on the overlay for 3 seconds.',
    detail: 'Quickest way to confirm the browser source is live and receiving chat.',
  },
  {
    name: 'permit',
    aliases: ['grant', 'allow'],
    syntax: '!multichat permit [target]',
    summary: 'Temporarily permits a recent viewer to use safe presentation controls.',
    detail: 'Broadcaster only. Reply to a Twitch/Kick viewer, name a recent same-platform viewer, or use platform:name.',
  },
  {
    name: 'unpermit',
    aliases: ['revoke', 'deny'],
    syntax: '!multichat unpermit <target>',
    summary: 'Immediately revokes a temporary runtime permission.',
    detail: 'Broadcaster only. Uses the same reply, recent-user, and platform:name targeting as permit.',
  },
  {
    name: 'permitted',
    aliases: ['perms', 'permissions'],
    syntax: '!multichat permitted',
    summary: 'Lists temporarily permitted viewers without exposing provider IDs.',
    detail: 'Available to the broadcaster and native moderators. Permits reset on browser-source reload.',
  },
  {
    name: 'reload',
    syntax: '!multichat reload',
    summary: 'Reloads the whole browser source.',
  },
  {
    name: 'stop',
    syntax: '!multichat stop',
    summary: 'Clears every active overlay: notifications, images, and videos.',
  },
  {
    name: 'clear',
    aliases: ['cls'],
    syntax: '!multichat clear',
    summary: 'Clears current chat messages without disconnecting providers.',
    detail: 'Alias: !multichat cls (or !kickchat cls).',
  },
  {
    name: 'pause',
    aliases: ['freeze'],
    syntax: '!multichat pause',
    summary: 'Pauses new chat message presentation.',
    detail: 'Alias: !multichat freeze. Providers stay connected and new chat is buffered.',
  },
  {
    name: 'resume',
    aliases: ['play', 'unfreeze', 'unpause'],
    syntax: '!multichat resume',
    summary: 'Resumes paused chat messages.',
    detail: 'Aliases: !multichat play, !multichat unfreeze, and !multichat unpause.',
  },
  {
    name: 'togglepause',
    aliases: ['tp'],
    syntax: '!multichat togglepause',
    summary: 'Toggles paused chat presentation.',
    detail: 'Alias: !multichat tp.',
  },
  {
    name: 'show',
    syntax: '!multichat show',
    summary: 'Shows the chat container again after hide.',
  },
  {
    name: 'hide',
    syntax: '!multichat hide',
    summary: 'Hides the chat container without stopping the connections.',
  },
  {
    name: 'kickon',
    syntax: '!multichat kickon',
    summary: 'Shows Kick chat messages again.',
    detail: 'The Kick connection stays alive while hidden, so this works without reloading.',
  },
  {
    name: 'kickoff',
    syntax: '!multichat kickoff',
    summary: 'Hides current and future Kick chat messages.',
    detail: 'The connection stays alive so a later kickon command can restore it.',
  },
  {
    name: 'twitchon',
    syntax: '!multichat twitchon',
    summary: 'Shows Twitch chat messages again.',
    detail: 'The Twitch connection stays alive while hidden, so this works without reloading.',
  },
  {
    name: 'twitchoff',
    syntax: '!multichat twitchoff',
    summary: 'Hides current and future Twitch chat messages.',
    detail: 'The connection stays alive so a later twitchon command can restore it.',
  },
  {
    name: 'youtubeon',
    syntax: '!multichat youtubeon',
    summary: 'Shows YouTube chat messages again.',
    detail: 'The YouTube connection stays alive while hidden, so this works without reloading.',
  },
  {
    name: 'youtubeoff',
    syntax: '!multichat youtubeoff',
    summary: 'Hides current and future YouTube chat messages.',
    detail: 'The connection stays alive so a later youtubeon command can restore it.',
  },
  {
    name: 'tiktokon',
    syntax: '!multichat tiktokon',
    summary: 'Shows TikTok chat messages again.',
    detail: 'The TikTok connection stays alive while hidden, so this works without reloading.',
  },
  {
    name: 'tiktokoff',
    syntax: '!multichat tiktokoff',
    summary: 'Hides current and future TikTok chat messages.',
    detail: 'The connection stays alive so a later tiktokon command can restore it.',
  },
  {
    name: 'sharedon',
    syntax: '!multichat sharedon',
    summary: 'Turns Twitch Shared Chat display on.',
    detail: 'Partner-room messages are included and Twitch rows show only the source streamer profile picture.',
  },
  {
    name: 'sharedoff',
    syntax: '!multichat sharedoff',
    summary: 'Turns Twitch Shared Chat display off.',
    detail: 'Partner-room Shared Chat messages already on screen are removed; local Twitch chat stays connected.',
  },
  {
    name: 'counterbgon',
    syntax: '!multichat counterbgon',
    summary: 'Turns the viewer counter pill background on.',
    detail: 'Targets the matching gxufy.com counter source generated from the same channel set.',
  },
  {
    name: 'counterbgoff',
    syntax: '!multichat counterbgoff',
    summary: 'Turns the viewer counter pill background off.',
    detail: 'Targets the matching gxufy.com counter source generated from the same channel set.',
  },
  {
    name: 'animation',
    syntax: '!multichat animation <on|off|auto>',
    summary: 'Controls chat entrance animations at runtime without reloading the source.',
    detail:
      'auto is the default after a browser-source load: normal traffic uses the configured animation, while heavy 200 ms batches or measured browser-frame pressure temporarily bypass expensive entrance work and recover automatically. on force-enables the configured entrance animation and off disables it.',
  },
  {
    name: 'events',
    syntax: '!multichat events <on|off|feature> [on|off]',
    summary: 'Turns notification/event features on or off without reloading the source.',
    detail:
      'Use events on/off for everything, or target subs, gifts, raids, cheers, milestones, watchstreaks, follows, announcements, firstmessages, or redeems. Watch streaks share the milestone event category.',
  },
  {
    name: 'refresh',
    syntax: '!multichat refresh [emotes]',
    summary: 'Reloads 7TV, BTTV, and FFZ emotes without reloading the source.',
    detail:
      'The argument is optional and the only accepted value is "emotes"; anything else does nothing.',
  },
  {
    name: 'img',
    syntax: '!multichat img <url|emote> [-t seconds] [-o opacity]',
    summary: 'Shows a fullscreen image, or an emote by name, over the scene.',
    detail:
      'Defaults to 5 seconds at full opacity. "!multichat img clear" dismisses it early.',
  },
  {
    name: 'yt',
    syntax: '!multichat yt <url|preset> [-t seconds] [-m]',
    summary: 'Plays a fullscreen YouTube video over the scene.',
    detail:
      'Presets: bruh, vine-boom, dc-ping, rickroll, win-error. Defaults to 5 seconds; -m mutes.',
  },
  {
    name: 'tts',
    syntax: '!multichat tts <message>',
    summary: 'Reads the message aloud through the browser source.',
    detail:
      'Uses the server voice, falling back to the browser voice if that request fails.',
  },
];

/** Command-word aliases, derived from the same catalog the generator renders. */
export const MULTICHAT_COMMAND_ALIASES: Readonly<Record<string, string>> =
  Object.freeze(Object.fromEntries(
    MULTICHAT_COMMANDS.flatMap((command) =>
      (command.aliases ?? []).map((alias) => [alias, command.name] as const),
    ),
  ));

/** Resolve an already-lowercased command word to its canonical dispatcher name. */
export function canonicalMultichatCommandName(name: string): string {
  return MULTICHAT_COMMAND_ALIASES[name] ?? name;
}
