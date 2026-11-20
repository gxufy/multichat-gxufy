/* Shared Discord webhook checks for the server-side alert channels. */

const DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
]);

/** Only real Discord webhook URLs: https, Discord host, /api/webhooks/{id}/{token}. */
export function validDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search) {
      return false;
    }
    if (!DISCORD_HOSTS.has(url.hostname)) return false;
    return /^\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,120}$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Text shown in a Discord embed: markdown and mentions can't break out of it. */
export function discordPlainText(value: string, max = 100): string {
  return value.replace(/[\\`*_~|>[\]()@#<]/g, (char) => `\\${char}`).slice(0, max);
}

/** Embed colours for the owner's alert channels. */
export const DISCORD_COLORS = {
  chat: 0x3b82f6,
  counter: 0x14b8a6,
  abuse: 0xef4444,
  supporter: 0xf5b301,
} as const;
