/* MultiChat's reference material, as generic descriptor help data.
 *
 * The command section is derived from MULTICHAT_COMMANDS rather than retyped, so
 * the workspace cannot document a command the overlay's parser does not
 * implement — a test reads the parser's own switch and compares it to that same
 * list. The classic generator's hardcoded table now reads from it too.
 *
 * The syntax strings are the metadata's own. They are not rewritten here, since
 * a second phrasing is a second thing to keep true.
 */
import {
  MULTICHAT_COMMANDS,
  MULTICHAT_COMMAND_ALIAS,
  MULTICHAT_COMMAND_TRIGGER,
} from '@/lib/multichatCommands';
import { MULTICHAT_OBS_RECOMMENDED } from './obs';
import type { ToolHelpSection } from '@/features/registry';

const size = (s: { width: number; height: number }) => `${s.width} × ${s.height}`;

export const MULTICHAT_HELP: readonly ToolHelpSection[] = [
  {
    id: 'obs',
    title: 'Adding this to OBS',
    intro:
      'Copy the URL below the preview, then add it to your scene as a Browser Source.',
    entries: [
      {
        syntax: `${size(MULTICHAT_OBS_RECOMMENDED)}`,
        summary: 'Recommended browser-source size.',
        detail: 'The single recommended size for the MultiChat browser source.',
      },
      {
        syntax: 'Shutdown source when not visible',
        summary: 'Leave this off.',
        detail: 'The overlay reconnects on load, so toggling it off drops recent messages.',
      },
    ],
    footnote:
      'The background is already transparent, so no custom CSS is needed. The preview background selector above only changes this page — it is never part of the URL and never reaches OBS.',
  },
  {
    id: 'commands',
    title: 'Chat commands',
    intro:
      'Type these in any connected platform’s chat. They act on the overlay itself, so they work from Kick, Twitch, YouTube, or TikTok regardless of which channel the overlay is showing.',
    entries: MULTICHAT_COMMANDS.map((command) => ({
      syntax: command.syntax,
      summary: command.summary,
      detail: command.detail,
    })),
    footnote: `Moderators and the broadcaster only — the overlay ignores these from everyone else. ${MULTICHAT_COMMAND_ALIAS} works as an alias for ${MULTICHAT_COMMAND_TRIGGER} everywhere above.`,
  },
  {
    id: 'behaviour',
    title: 'How the preview and URL behave',
    entries: [
      {
        syntax: 'The preview is the real overlay',
        summary: 'The same renderer in both of its states.',
        detail:
          'Before you enter a channel it draws sample messages marked “Preview data”, so every setting has something to act on straight away. Enter a channel and it becomes the live overlay at the exact URL below, connected to the real platforms — which means it stays empty while those channels are offline or nobody is chatting. An empty preview at that point is not an error. The samples are never part of the URL and never reach OBS.',
      },
      {
        syntax: 'Copy gives you the OBS URL',
        summary: 'Exactly the URL the preview above is running.',
        detail: 'Nothing is added or removed on copy — what you see is what OBS gets.',
      },
      {
        syntax: 'Preview background is preview-only',
        summary: 'For checking transparency against a light or dark scene.',
        detail: 'It never appears in the URL and never reaches OBS.',
      },
      {
        syntax: 'Source marker: Platform icon',
        summary: 'Keeps the original URL format, which behaves by platform count.',
        detail:
          'With one channel configured no marker is drawn; with several, icons identify each message’s source. Colored dot, Platform name, and Off apply exactly as chosen at any count.',
      },
      {
        syntax: 'Native Twitch pins',
        summary: 'Require a connected Twitch account matching your Twitch channel.',
        detail:
          'Connect Twitch beside the preview. Without a matching connection the Twitch pin option stays unavailable and no connection is added to your URL.',
      },
    ],
  },
];
