import type {
  TwitchCheerEventData,
  TwitchCheermoteVisual,
  UnifiedEmote,
} from './types';

/*
 * Twitch global Cheermotes exposed by Twitch's open CDN.
 *
 * This intentionally follows the anonymous/no-auth architecture:
 * IRC supplies the authoritative Bits total and the authored Cheer token;
 * the artwork itself comes directly from Twitch's public CDN.
 */
export const TWITCH_GLOBAL_CHEERMOTE_PREFIXES =
  [
    'cheer',
    'cheerwhal',
    'corgo',
    'uni',
    'showlove',
    'party',
    'seemsgood',
    'pride',
    'kappa',
    'frankerz',
    'heyguys',
    'dansgame',
    'trihard',
    'kreygasm',
    '4head',
    'swiftrage',
    'notlikethis',
    'failfish',
    'vohiyo',
    'pjsalt',
    'mrdestructoid',
    'bday',
    'ripcheer',
    'shamrock',
  ] as const;

const CHEER_TIERS = [
  {
    minBits: 10_000,
    color: '#f43021',
  },
  {
    minBits: 5_000,
    color: '#0099fe',
  },
  {
    minBits: 1_000,
    color: '#1db2a5',
  },
  {
    minBits: 100,
    color: '#9c3ee8',
  },
  {
    minBits: 1,
    color: '#979797',
  },
] as const;

type ResolvedCheer = {
  cheer: TwitchCheerEventData;
  emotes: UnifiedEmote[];
};

function regexEscape(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}

function tierForBits(
  bits: number,
) {
  return (
    CHEER_TIERS.find(
      (tier) =>
        bits >= tier.minBits,
    ) ??
    CHEER_TIERS[
      CHEER_TIERS.length - 1
    ]!
  );
}

function animatedCheermoteUrl(
  prefix: string,
  tier: number,
): string {
  return (
    'https://d3aqoihi2n8ty8.cloudfront.net/actions/' +
    encodeURIComponent(
      prefix.toLowerCase(),
    ) +
    '/dark/animated/' +
    tier +
    '/1.gif'
  );
}

export function resolveTwitchCheerMessage(
  text: string,
  totalBits: number,
): ResolvedCheer {
  const safeTotal =
    Number.isFinite(totalBits)
      ? Math.max(
          0,
          Math.floor(totalBits),
        )
      : 0;

  const visuals:
    TwitchCheermoteVisual[] = [];

  const emotes:
    UnifiedEmote[] = [];

  if (!text) {
    return {
      cheer: {
        bits: safeTotal,
        cheermotes: [],
      },
      emotes,
    };
  }

  const prefixes =
    [...TWITCH_GLOBAL_CHEERMOTE_PREFIXES]
      .sort(
        (a, b) =>
          b.length - a.length,
      );

  const expression =
    new RegExp(
      `\\b(${prefixes
        .map(regexEscape)
        .join('|')})(\\d+)\\b`,
      'gi',
    );

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        expression.exec(text)
    ) !== null
  ) {
    const rawPrefix =
      match[1]!;

    const prefix =
      rawPrefix.toLowerCase();

    const amount =
      Number.parseInt(
        match[2]!,
        10,
      );

    if (
      !Number.isFinite(amount) ||
      amount < 1
    ) {
      continue;
    }

    const tier =
      tierForBits(amount);

    const animatedUrl =
      animatedCheermoteUrl(
        prefix,
        tier.minBits,
      );

    const visual:
      TwitchCheermoteVisual = {
      prefix:
        rawPrefix,
      bits:
        amount,
      tierMinBits:
        tier.minBits,
      color:
        tier.color,
      animatedUrl,
    };

    visuals.push(visual);

    /*
     * RegExp indices are UTF-16 offsets. Convert the preceding portion
     * to code points because UnifiedEmote offsets use code points.
     */
    const begin =
      Array.from(
        text.slice(
          0,
          match.index,
        ),
      ).length;

    const token =
      match[0];

    const end =
      begin +
      Array.from(token).length;

    emotes.push({
      begin,
      end,
      text:
        token,
      url:
        animatedUrl,
      kind:
        'cheermote',
    });
  }

  return {
    cheer: {
      bits:
        safeTotal,
      cheermotes:
        visuals,
    },
    emotes,
  };
}