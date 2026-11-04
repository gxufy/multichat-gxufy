import ChannelAutocomplete, {
  type ChannelAutocompleteSuggestion,
} from './ChannelAutocomplete';
import {
  TIKTOK_CHANNEL_SEARCH_DEBOUNCE_MS,
  normalizeTikTokChannelSearchQuery,
  parseTikTokChannelSuggestions,
} from '@/lib/tiktokChannelSearch';

type TikTokChannelAutocompleteProps = {
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

async function searchTikTokChannels(
  query: string,
  signal: AbortSignal,
): Promise<ChannelAutocompleteSuggestion[]> {
  const response = await fetch(
    `/api/tiktok/channel-search?${new URLSearchParams({ q: query })}`,
    { signal },
  );

  if (!response.ok) throw new Error('TikTok channel search failed.');

  const parsed = parseTikTokChannelSuggestions(await response.json());
  if (!parsed) throw new Error('Invalid TikTok channel search response.');

  return parsed.map((suggestion) => ({
    value: `@${suggestion.username}`,
    displayName: suggestion.display_name,
    thumbnailUrl: suggestion.thumbnail_url ?? undefined,
    isLive: false,
    meta: `@${suggestion.username}`,
    secondary: formatFollowers(suggestion.followers_count),
  }));
}

export default function TikTokChannelAutocomplete({
  id,
  name,
  placeholder,
  value,
  onValueChange,
}: TikTokChannelAutocompleteProps) {
  return (
    <ChannelAutocomplete
      id={id}
      name={name}
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
      platform="tiktok"
      platformLabel="TikTok"
      debounceMs={TIKTOK_CHANNEL_SEARCH_DEBOUNCE_MS}
      normalizeQuery={normalizeTikTokChannelSearchQuery}
      search={searchTikTokChannels}
    />
  );
}
