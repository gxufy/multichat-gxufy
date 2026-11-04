/* Preview cosmetics: the loaded badge catalog, wired into the entitlement path.
 *
 * WHAT THIS BRIDGES. The simulator (lib/tools/multichat/previewSimulator) stamps a
 * handful of generated lines with reserved sender identities — PREVIEW_BADGE_SENDERS
 * — but it cannot know which badges have actually loaded, because only the generator
 * holds that. This module is the other half: given the badges currently in the
 * library, it builds the `MessageCosmetics` those lines are read against, entitling
 * each reserved sender to a concrete badge id.
 *
 * WHY AN ENTITLEMENT AND NOT A COMPONENT. `buildParsedMessage` attaches a 7TV badge
 * only when `cosmetics.entitlements['${platform}:${senderId}']` names a badge present
 * in `cosmetics.badges`, and renders it as the same `<img className="ck-badge-img">`
 * the live overlay emits. Routing loaded badges through that map is what makes them
 * appear "through the production renderer, not a decorative component beside the
 * name" — the spec's requirement. A fake badge node would render but would prove
 * nothing about the overlay.
 *
 * WHAT LOADS INTO A SLOT. The reserved slots take the 7TV badges the network fetch
 * returned, in order, cycling if there are fewer slots than the pool. Before that
 * fetch there are no 7TV-provider assets — only the local FFZ seed — so a slot falls
 * back to the sample 7TV badge and still renders a real 7TV badge either way. The FFZ
 * seed art is not used for these slots: it stands for room-badge overrides, which the
 * simulator already demonstrates through its own `ffz` entries.
 *
 * PURE, AND GENERATOR-ONLY. No clock, no random source, no network, no server-only
 * import. The result is a plain value; the generator memoizes it on the library's
 * asset list so a settings keystroke does not rebuild it. Nothing here is serialized
 * into an overlay URL — it extends the sample cosmetics the preview already uses.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import type { Entitlements, SevenTVBadge } from '@/lib/kick';
import type { MessageCosmetics } from '@/lib/multichatMessageModel';
import type { PreviewBadgeAsset } from './previewBadgeLibrary';
import {
  PREVIEW_BADGE_SENDERS,
  PREVIEW_BADGE_SENDER_PLATFORM,
} from './previewSimulator';
import {
  SAMPLE_COSMETICS,
  SAMPLE_ENTITLEMENTS,
  SAMPLE_SEVENTV_BADGE,
} from './samples';

/**
 * Build the cosmetics the preview feed is rendered against, from the badges the
 * library currently holds.
 *
 * Extends {@link SAMPLE_COSMETICS} — every existing sample entitlement (the paint
 * sender) is kept — and adds one entitlement per reserved badge sender, each pointing
 * at a concrete badge id present in the returned `badges`. So the sample paint, the
 * sample 7TV badge, and the loaded catalog badges all attach through the one path.
 *
 * @param loaded The library's current flat asset list (seed plus anything fetched).
 */
export function buildPreviewCosmetics(
  loaded: readonly PreviewBadgeAsset[],
  resources?: {
    readonly kickChannel: MessageCosmetics['channel'];
  },
): MessageCosmetics {
  /* Every badge a slot might name must be findable by id in `cosmetics.badges`, so
     the sample badge and every loaded asset go in. Loaded assets carry extra catalog
     columns (`label`, `provider`); a SevenTVBadge only reads `id` and `image`, so
     they are structurally the same to the renderer. */
  const badges: SevenTVBadge[] = [
    SAMPLE_SEVENTV_BADGE,
    ...loaded.map((asset) => ({ id: asset.id, image: asset.image })),
  ];

  /* Prefer the fetched 7TV badges for the slots — they are what "the loaded catalog"
     means. Before a fetch there are none, so the sample 7TV badge stands in and the
     slot still renders a real 7TV badge. */
  const fetched = loaded.filter((asset) => asset.provider === '7TV');
  const slotBadgeIds =
    fetched.length > 0 ? fetched.map((asset) => asset.id) : [SAMPLE_SEVENTV_BADGE.id];

  const entitlements: Entitlements = { ...SAMPLE_ENTITLEMENTS };
  PREVIEW_BADGE_SENDERS.forEach((sender, index) => {
    entitlements[`${PREVIEW_BADGE_SENDER_PLATFORM}:${sender}`] = {
      badge: slotBadgeIds[index % slotBadgeIds.length],
    };
  });

  return {
    ...SAMPLE_COSMETICS,
    badges,
    entitlements,
    channel: resources?.kickChannel ?? SAMPLE_COSMETICS.channel,
  };
}
