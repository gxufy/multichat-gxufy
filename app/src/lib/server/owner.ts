/* Who may use owner-only tools on FlossChat (by immutable Twitch user ID). */
export const OWNER_TWITCH_IDS: readonly string[] = ['204219574'];

export function isOwner(twitchId: string | null | undefined): boolean {
  return typeof twitchId === 'string' && OWNER_TWITCH_IDS.includes(twitchId);
}
