/*
 * Twitch's own art for its common badges, used when the badge list from
 * Twitch has not loaded (or has no entry): shared by the renderer, which
 * draws it, and the preview's badge links, which need to know which badge a
 * drawn image is.
 */
export const TWITCH_FALLBACK_BADGE_IDS: Readonly<Record<string, string>> = {
  broadcaster: '5527c58c-fb7d-422d-b71b-f309dcb85cc1',
  moderator: '3267646d-33f0-4b17-b3df-f923a41db1d0',
  vip: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
  partner: 'd12a2e27-16f6-41d0-ab77-b780518f00a3',
  subscriber: '5d9f2208-5dd8-11e7-8513-2ff4adfae661',
  founder: '511b78a9-ab37-472f-9569-457753bbe7d3',
  premium: 'bbbe0db0-a598-423e-86d0-f9fb98ca1933',
  turbo: 'bd444ec6-8f34-4bf9-91f4-af1e3428d80f',
  staff: 'd97c37bd-a6f5-4c38-8f57-4e4bef88af34',
  'sub-gifter': 'f1d8486f-eb2e-4553-b44f-4d614617afc1',
};

/** The fallback art address for a Twitch badge set, or null. */
export function twitchFallbackBadgeSrc(type: string): string | null {
  const uuid = Object.prototype.hasOwnProperty.call(TWITCH_FALLBACK_BADGE_IDS, type) ? TWITCH_FALLBACK_BADGE_IDS[type] : undefined;
  return uuid ? `https://static-cdn.jtvnw.net/badges/v1/${uuid}/3` : null;
}
