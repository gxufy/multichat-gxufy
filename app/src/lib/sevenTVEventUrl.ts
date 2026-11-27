export function buildSevenTVEventUrl(
  platform: 'kick' | 'twitch',
  channelId: string,
  stvUserId: string | null,
  setId: string | null,
): string {
  const platformName = platform.toUpperCase();

  const subscriptions = [
    `entitlement.*<ctx=channel;platform=${platformName};id=${channelId}>`,
    `cosmetic.*<ctx=channel;platform=${platformName};id=${channelId}>`,
  ];

  if (stvUserId) {
    subscriptions.push(
      `user.update<object_id=${stvUserId}>`,
    );
  }

  if (setId) {
    subscriptions.push(
      `emote_set.*<object_id=${setId}>`,
    );
  }

  return `https://events.7tv.io/v3@${subscriptions.join(',')}`;
}
