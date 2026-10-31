import ChannelAutocomplete, {
  type ChannelAutocompleteSuggestion,
} from './ChannelAutocomplete';

import {
  KICK_CHANNEL_SEARCH_DEBOUNCE_MS,
  normalizeKickChannelSearchQuery,
  parseKickChannelSuggestions,
} from '@/lib/kickChannelSearch';

type KickChannelAutocompleteProps = {
  id: string;
  name: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
};

function formatFollowers(value: number): string {
  return `${new Intl.NumberFormat('en-US', {
    notation: value >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)} followers`;
}

async function searchKickChannels(
  query: string,
  signal: AbortSignal,
): Promise<ChannelAutocompleteSuggestion[]> {
  const response = await fetch(
    `/api/kick/channel-search?${new URLSearchParams({
      q: query,
    })}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(
      'Kick channel search failed.',
    );
  }

  const parsed =
    parseKickChannelSuggestions(
      await response.json(),
    );

  if (!parsed) {
    throw new Error(
      'Invalid Kick channel search response.',
    );
  }

  return parsed.map((suggestion) => ({
    value: suggestion.slug,
    displayName: suggestion.display_name,
    thumbnailUrl:
      suggestion.thumbnail_url ?? undefined,
    isLive: suggestion.is_live,
    meta: `@${suggestion.slug}`,
    secondary: formatFollowers(
      suggestion.followers_count,
    ),
  }));
}

export default function KickChannelAutocomplete({
  id,
  name,
  placeholder,
  value,
  onValueChange,
}: KickChannelAutocompleteProps) {
  return (
    <ChannelAutocomplete
      id={id}
      name={name}
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
      platform="kick"
      platformLabel="Kick"
      debounceMs={
        KICK_CHANNEL_SEARCH_DEBOUNCE_MS
      }
      normalizeQuery={
        normalizeKickChannelSearchQuery
      }
      search={searchKickChannels}
    />
  );
}
