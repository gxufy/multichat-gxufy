/* Platform chip styling for the workspace, in one place.
 *
 * The classic generator tags each channel input with a small uppercase pill in
 * that platform's brand color — the detail that makes four adjacent text fields
 * read as four distinct services rather than a generic list. The workspace's
 * channel fields were unlabelled by platform beyond their text label.
 *
 * These are Tailwind class strings, not inline styles, so they are purged and
 * hashed with everything else. The brand colors themselves live in
 * tailwind.config.js as ws-<platform> tokens; the parity test in
 * tests/unit/platformChrome.test.ts asserts the token values match
 * lib/render's PROVIDERS, which is what the overlay renders with. That is the
 * guard against the workspace and the overlay disagreeing about what colour a
 * platform is.
 *
 * Browser-safe — no server-only imports, no secrets.
 */
import type { Platform } from '@/lib/types';

/** Tailwind classes for one platform's chip: text, border, and wash. */
export const PLATFORM_CHIP: Readonly<Record<Platform, string>> = {
  kick: 'text-ws-kick border-ws-kick/55 bg-ws-kick/[0.06]',
  twitch: 'text-ws-twitch border-ws-twitch/55 bg-ws-twitch/[0.07]',
  youtube: 'text-ws-youtube border-ws-youtube/55 bg-ws-youtube/[0.06]',
  tiktok: 'text-ws-tiktok border-ws-tiktok/50 bg-ws-tiktok/[0.05]',
};

/** Shape and type shared by every chip, independent of platform. */
export const CHIP_BASE =
  'inline-block rounded-full border px-2.5 py-0.5 text-[0.66rem] font-extrabold uppercase tracking-[0.1em]';

/** The full chip class string for a platform. */
export function chipClass(platform: Platform): string {
  return `${CHIP_BASE} ${PLATFORM_CHIP[platform]}`;
}

/**
 * Whether a tool's channel key is one of the four known platforms.
 *
 * A tool declares its own platform keys, and nothing requires them to be
 * platforms — a future tool could have a channel field that is not one. So the
 * chip is opt-in by this guard rather than by an assertion, and an unrecognized
 * key simply renders no chip instead of an undefined class string.
 */
export function isChipPlatform(key: string): key is Platform {
  return Object.prototype.hasOwnProperty.call(PLATFORM_CHIP, key);
}
