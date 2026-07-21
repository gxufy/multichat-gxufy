export interface KickChannel {
  id: number;
  user_id: number;
  slug: string;
  chatroom: { id: number };
  subscriber_badges: Array<{
    id: number;
    months: number;
    badge_image: { src: string };
  }>;
  user: { id: number; username: string };
}

export interface SevenTVEmote {
  name: string;
  image: string;
  height: number;
  width: number;
  zeroWidth: boolean;
  upscale: boolean;  // render at full line-height (chatis 'upscale' flag)
}

export interface SevenTVPaint {
  id: string;
  func: string;
  angle?: number;
  color?: number;
  repeat: boolean;
  shadows: Array<{ color: number; x_offset: number; y_offset: number; radius: number }>;
  stops: Array<{ color: number; at: number }>;
  image_url?: string;
  shape?: string;
}

export interface SevenTVBadge {
  id: string;
  image: string;
}

export interface Entitlements {
  [userId: string]: { badge?: string; paint?: string };
}

export interface ParsedMessage {
  id: string;
  platform?: 'kick' | 'twitch' | 'youtube' | 'tiktok';
  /** platform sender id — enables ban-by-author deletion (yt) */
  senderId?: string;
  /** event card category for kind === 'system' */
  category?: string;
  /** redeem/highlighted message — truthy = highlight; string = reward title */
  redeem?: boolean | string;
  /** avatar URL (yt/tiktok) */
  avatar?: string;
  /** original UnifiedMessage — kept so late-arriving 7TV cosmetics can rebuild the rendered line */
  raw?: unknown;
  /** system events (gifts, subs, superchats) render without name colon */
  kind?: 'chat' | 'system';
  timestamp?: number;
  identity: {
    username: string;
    color: string;
    background: string;
    filter: string;
    badges: React.ReactNode[];
    /** render name as a colored pill (yt owner gold) — 'bg|fg' */
    namePill?: string;
  };
  message: React.ReactNode[];
}

export async function getKickChannel(channel: string): Promise<KickChannel | null> {
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${channel}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getSevenTVGlobalEmotes(): Promise<SevenTVEmote[]> {
  try {
    const res = await fetch('https://7tv.io/v3/emote-sets/global');
    if (!res.ok) return [];
    const data = await res.json();
    return (data.emotes || []).map((e: any) => ({
      name: e.name,
      image: `https://cdn.7tv.app/emote/${e.id}/4x.webp`,
      height: e.data?.host?.files?.[3]?.height ?? e.data?.host?.files?.[1]?.height ?? 28,
      width: e.data?.host?.files?.[3]?.width ?? e.data?.host?.files?.[1]?.width ?? 28,
      zeroWidth: (e.data?.flags & 256) === 256,
      upscale: (e.data?.flags & 128) === 128,
    }));
  } catch {
    return [];
  }
}

export async function getSevenTVChannelEmotes(userId: string, platform: 'kick' | 'twitch' = 'kick'): Promise<{ emotes: SevenTVEmote[]; setId: string | null; stvUserId: string | null }> {
  try {
    const res = await fetch(`https://7tv.io/v3/users/${platform}/${userId}`);
    if (!res.ok) return { emotes: [], setId: null, stvUserId: null };
    const data = await res.json();
    // NOTE: root `id` is the PLATFORM connection id; the actual 7TV
    // user id (needed for the presence POST) is `user.id`
    const stvUserId = data?.user?.id ?? null;
    const emoteSet = data?.emote_set;
    if (!emoteSet) return { emotes: [], setId: null, stvUserId };
    return {
      setId: emoteSet.id,
      stvUserId,
      emotes: (emoteSet.emotes || []).map((e: any) => ({
        name: e.name,
        image: `https://cdn.7tv.app/emote/${e.id}/4x.webp`,
        height: e.data?.host?.files?.[3]?.height ?? e.data?.host?.files?.[1]?.height ?? 28,
        width: e.data?.host?.files?.[3]?.width ?? e.data?.host?.files?.[1]?.width ?? 28,
        zeroWidth: (e.data?.flags & 256) === 256,
        upscale: (e.data?.flags & 128) === 128,
      })),
    };
  } catch {
    return { emotes: [], setId: null, stvUserId: null };
  }
}

export function decimalToRGBA(decimal: number): string {
  const r = (decimal >>> 24) & 255;
  const g = (decimal >>> 16) & 255;
  const b = (decimal >>> 8) & 255;
  const a = ((decimal & 255) / 255).toFixed(3);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
