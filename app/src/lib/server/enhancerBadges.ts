import {
  validateCommunityBadgeAssetUrl,
} from './communityBadgeAsset';

export type EnhancerBadgeRecord = {
  id: string;
  title: string;
  url: string;
  users: string[];
  priority: number;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (
    typeof value === 'number'
    && Number.isFinite(value)
  ) {
    return String(value);
  }

  return '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map(stringValue)
        .filter(Boolean),
    ),
  ];
}

function finitePriority(value: unknown): number | null {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
  )
    ? value
    : null;
}

function bestBadgeSource(value: unknown): string | null {
  if (!isRecord(value)) return null;

  let best:
    | {
        rank: number;
        url: string;
      }
    | null = null;

  for (const [key, rawUrl] of Object.entries(value)) {
    const url =
      validateCommunityBadgeAssetUrl(
        rawUrl,
        'enhancer',
      );

    if (!url) continue;

    const parsedRank = Number.parseInt(key, 10);
    const rank =
      Number.isFinite(parsedRank)
        ? parsedRank
        : 0;

    if (!best || rank > best.rank) {
      best = {
        rank,
        url,
      };
    }
  }

  return best?.url ?? null;
}

/**
 * Convert Enhancer's Twitch GLOBAL aggregate into a compact assignment
 * registry suitable for browser/OBS consumers.
 */
export function parseEnhancerAggregate(
  value: unknown,
): EnhancerBadgeRecord[] | null {
  if (
    !isRecord(value)
    || stringValue(value.platform).toUpperCase() !== 'TWITCH'
    || !Array.isArray(value.accounts)
    || !Array.isArray(value.badges)
  ) {
    return null;
  }

  const usersByBadge =
    new Map<string, Set<string>>();

  for (const rawAccount of value.accounts) {
    if (!isRecord(rawAccount)) continue;

    const externalId =
      stringValue(rawAccount.externalId);

    if (!/^\d{1,25}$/.test(externalId)) {
      continue;
    }

    for (
      const badgeId
      of stringList(rawAccount.badgesIds)
    ) {
      let users = usersByBadge.get(badgeId);

      if (!users) {
        users = new Set<string>();
        usersByBadge.set(badgeId, users);
      }

      users.add(externalId);
    }
  }

  const records: EnhancerBadgeRecord[] = [];
  const seen = new Set<string>();

  for (const rawBadge of value.badges) {
    if (!isRecord(rawBadge)) continue;

    const id = stringValue(rawBadge.badgeId);

    if (
      !id
      || id.length > 128
      || seen.has(id)
    ) {
      continue;
    }

    const priority =
      finitePriority(rawBadge.priority);

    const url =
      bestBadgeSource(rawBadge.sources);

    const users =
      [...(usersByBadge.get(id) ?? [])];

    if (
      priority === null
      || !url
      || !users.length
    ) {
      continue;
    }

    seen.add(id);

    records.push({
      id,
      title:
        stringValue(rawBadge.name)
        || 'Enhancer',
      url,
      users,
      priority,
    });
  }

  records.sort(
    (left, right) =>
      left.priority - right.priority
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id),
  );

  return records;
}