import SitePage from '@/components/site/SitePage';
import {
  MULTICHAT_COMMAND_ALIAS,
  MULTICHAT_COMMAND_MIN_ACCESS,
  MULTICHAT_COMMANDS,
  MULTICHAT_COMMAND_TRIGGER,
} from '@/lib/multichatCommands';

export default function CommandsPage() {
  return (
    <SitePage
      title="MultiChat Commands | Gxufy 🕊️"
      heading="MultiChat Commands"
      path="/commands"
      description="The official Gxufy MultiChat command reference for controlling chat, platforms, overlays, media, events, and refresh actions directly from stream chat."
    >
      <section>
        <h2>How commands work</h2>
        <p>
          Type <code>{MULTICHAT_COMMAND_TRIGGER}</code> as the first word of a chat
          message. The legacy <code>{MULTICHAT_COMMAND_ALIAS}</code> trigger is also
          accepted. Every command uses the same moderator-or-broadcaster access gate
          (minimum internal access level {MULTICHAT_COMMAND_MIN_ACCESS}).
        </p>
        <a className="cta" href="/multichat">Open the MultiChat generator →</a>
      </section>

      <section>
        <h2>Command reference</h2>
        <table>
          <thead>
            <tr>
              <th>Command</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {MULTICHAT_COMMANDS.map((command) => (
              <tr key={command.name}>
                <td><code>{command.syntax}</code></td>
                <td>
                  {command.summary}
                  {command.detail ? ` ${command.detail}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </SitePage>
  );
}
