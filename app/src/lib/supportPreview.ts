/*
 * The chat-line preview on the support and badges pages: which badges show
 * beside the name, and the 7TV paint on the name.
 *
 * Used by the support and badges pages. Browser-safe.
 */
import {
  SUPPORT_BADGE,
} from '@/lib/supportPage';

import type {
  PreviewIdentityResponse,
} from '@/features/multichat/previewIdentity';

import {
  buildPaintStyle,
} from '@/lib/messageCosmetics';

import type {
  UnifiedBadge,
} from '@/lib/types';

/** Inline style for a painted name (React style keys; also usable as CSS). */
export type SupportUsernameStyle = {
  readonly background: string;
  readonly WebkitBackgroundClip: 'text';
  readonly backgroundClip: 'text';
  readonly color: 'transparent';
  readonly textShadow: 'none';
  readonly filter?: string;
};

export type SupportBadgePreview = {
  readonly key: string;
  readonly title: string;
  readonly url: string;
};

function unifiedBadgeUrl(
  badge: UnifiedBadge,
): string | null {
  return (
    badge.url
    ?? badge.fallbackUrl
    ?? null
  );
}

export function buildSupportBadgePreview(
  response:
    PreviewIdentityResponse | null,
  deferredCommunityBadges:
    readonly UnifiedBadge[] = [],
  bttvProBadgeUrl:
    string | null = null,
  includeSupporter = false,
  /* The FlossChat badge to show (the tier picked on the support page). */
  featured: { readonly id: string; readonly title: string; readonly url: string } = {
    id: SUPPORT_BADGE.id,
    title: SUPPORT_BADGE.hoverTitle,
    url: SUPPORT_BADGE.url,
  },
): readonly SupportBadgePreview[] {
  const result:
  SupportBadgePreview[] = [];

  const seen =
    new Set<string>();

  /* The FlossChat badge itself is drawn once, at the end, from its feature
     art. FlossChat badges that already arrive with the account's community
     badges (they own one) are skipped here, so none shows twice. */
  const isFlossChatBadge = (type: string) =>
    type.startsWith('community:gxufy:');

  let ownsSupporter =
    false;

  const push = (
    key: string,
    title: string,
    url:
      string | null | undefined,
  ) => {
    if (
      !url
      || seen.has(url)
    ) {
      return;
    }

    seen.add(url);

    result.push({
      key:
        `${key}:${url}`,
      title,
      url,
    });
  };

  if (response) {
    const twitch =
      response.providers
        .Twitch?.resources;

    for (
      const badge
      of twitch?.ownedBadges
        ?? []
    ) {
      push(
        `twitch:${badge.type}:${badge.version ?? ''}`,
        badge.title
          ?? (
            badge.version
              ? `Twitch ${badge.type} ${badge.version}`
              : `Twitch ${badge.type}`
          ),
        unifiedBadgeUrl(
          badge,
        ),
      );
    }

    const ffz =
      response.providers
        .FFZ?.resources;

    for (
      const badge
      of ffz?.ownedBadges
        ?? []
    ) {
      push(
        `ffz:${badge.id}`,
        `FFZ ${badge.id}`,
        badge.image,
      );
    }

    const bttv =
      response.providers
        .BTTV?.resources;

    for (
      const badge
      of bttv?.ownedBadges
        ?? []
    ) {
      push(
        `bttv:${badge.id}`,
        `BTTV ${badge.id}`,
        badge.image,
      );
    }

    const sevenTV =
      response.providers[
        '7TV'
      ]?.resources.badge;

    if (sevenTV) {
      push(
        `7tv:${sevenTV.id}`,
        `7TV ${sevenTV.id}`,
        sevenTV.image,
      );
    }

    for (
      const badge
      of response
        .communityBadges
        ?? []
    ) {
      if (isFlossChatBadge(badge.type)) {
        ownsSupporter = true;
        continue;
      }

      push(
        `community:${badge.type}:${badge.version ?? ''}`,
        badge.title
          ?? badge.type,
        unifiedBadgeUrl(
          badge,
        ),
      );
    }
  }

  for (
    const badge
    of deferredCommunityBadges
  ) {
    if (isFlossChatBadge(badge.type)) {
      ownsSupporter = true;
      continue;
    }

    push(
      `deferred:${badge.type}:${badge.version ?? ''}`,
      badge.title
        ?? badge.type,
      unifiedBadgeUrl(
        badge,
      ),
    );
  }

  if (bttvProBadgeUrl) {
    push(
      'bttv-pro',
      'BTTV Pro',
      bttvProBadgeUrl,
    );
  }

  if (
    includeSupporter
    || ownsSupporter
  ) {
    push(
      `gxufy:${featured.id}`,
      featured.title,
      featured.url,
    );
  }

  return result;
}

export function buildSupportUsernameStyle(
  response:
    PreviewIdentityResponse | null,
): SupportUsernameStyle | undefined {
  const paint =
    response?.providers[
      '7TV'
    ]?.resources.paint;

  if (!paint) {
    return undefined;
  }

  const {
    background,
    filter,
  } = buildPaintStyle(
    paint,
    true,
  );

  if (!background) {
    return undefined;
  }

  return {
    background,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    textShadow: 'none',
    filter:
      filter || undefined,
  };
}
