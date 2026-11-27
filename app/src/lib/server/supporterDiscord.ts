/*
 * Discord notice for each completed supporter purchase (owner's own channel).
 *
 * Purchases only: no refund or reversal notices, and never the buyer's email
 * or any PayPal payer detail. The store's claimPurchaseNotice() makes sure each
 * completed order is announced at most once.
 */
import { DISCORD_COLORS, discordPlainText, validDiscordWebhookUrl } from '@/lib/server/discordWebhook';
import type { SupportOrderRecord } from '@/lib/server/supporterStore';
import { isSupporterTierId, supporterTier } from '@/lib/supporterTiers';

export const SUPPORTER_DISCORD_WEBHOOK_ENV = 'GXUFY_SUPPORTER_DISCORD_WEBHOOK_URL';
const DELIVERY_TIMEOUT_MS = 4_000;

export type PurchaseNoticeResult = 'delivered' | 'unconfigured' | 'failed';

const plain = (value: string) => discordPlainText(value);

function kindLabel(order: SupportOrderRecord): string {
  if (order.kind === 'self') return 'For themselves';
  if (order.kind === 'gift') return 'Gift';
  return 'Support only (no badge)';
}

export function purchaseNoticeBody(order: SupportOrderRecord): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (order.recipient) {
    fields.push({
      name: 'Twitch',
      value: `${plain(order.recipient.displayName || order.recipient.login)} (${plain(order.recipient.login)})`,
      inline: true,
    });
    fields.push({ name: 'Twitch ID', value: plain(order.recipient.id), inline: true });
  }
  fields.push({ name: 'Type', value: kindLabel(order), inline: true });
  fields.push({ name: 'Amount', value: `$${(order.amountCents / 100).toFixed(2)} USD`, inline: true });
  fields.push({ name: 'Order', value: plain(order.orderId), inline: true });
  return {
    username: 'FlossChat',
    allowed_mentions: { parse: [] },
    embeds: [{
      title: order.recipient
        ? `New FlossChat ${isSupporterTierId(order.tier) ? supporterTier(order.tier).name : 'Sanctioned'} badge`
        : 'New FlossChat support',
      color: DISCORD_COLORS.supporter,
      fields,
      timestamp: order.completedAt ?? new Date().toISOString(),
    }],
  };
}

export async function sendPurchaseNotice(
  order: SupportOrderRecord,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<PurchaseNoticeResult> {
  const url = env[SUPPORTER_DISCORD_WEBHOOK_ENV]?.trim() ?? '';
  if (!url || !validDiscordWebhookUrl(url)) return 'unconfigured';
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(purchaseNoticeBody(order)),
      redirect: 'error',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return response.ok ? 'delivered' : 'failed';
  } catch {
    return 'failed';
  }
}
