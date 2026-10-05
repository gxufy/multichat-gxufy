import { isSafeRemoteMediaUrl } from '../remoteMediaUrl';

export type CommunityBadgeAssetProvider =
  | 'chatty'
  | 'chatsen'
  | 'dankchat'
  | 'ffzap'
  | 'purpletv'
  | 'jilchat'
  | 'limerino';

export const COMMUNITY_BADGE_ASSET_MAX_URL_LENGTH = 2_048;

const COMMUNITY_BADGE_ASSET_HOSTS: Readonly<
  Record<CommunityBadgeAssetProvider, ReadonlySet<string>>
> = {
  chatty: new Set([
    'api.ffzap.com',
    'cdn.frankerfacez.com',
    'tduva.com',
  ]),
  chatsen: new Set(['raw.githubusercontent.com']),
  dankchat: new Set(['flxrs.com']),
  ffzap: new Set(['api.ffzap.com']),
  /* The live feed's DNS was unavailable during inspection, so only Vanity's
     documented fixed fallback asset is trusted. Entry badgeUrl values from any
     other host fail closed and use this default instead. */
  purpletv: new Set(['nopbreak.ru']),
  jilchat: new Set(['api.jil.chat']),
  limerino: new Set(['api.limerino.com']),
};

/**
 * Validate a community badge URL before returning it to browser/OBS clients.
 *
 * This is browser-side request hardening, not an SSRF defense: badge images
 * remain client-fetched and are never downloaded or DNS-resolved here.
 */
export function validateCommunityBadgeAssetUrl(
  value: unknown,
  provider: CommunityBadgeAssetProvider,
): string | null {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > COMMUNITY_BADGE_ASSET_MAX_URL_LENGTH
    || !isSafeRemoteMediaUrl(value)
  ) return null;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    // Avoid alternate-but-equivalent host spellings at the allowlist boundary.
    if (hostname.endsWith('.') || !COMMUNITY_BADGE_ASSET_HOSTS[provider].has(hostname)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
