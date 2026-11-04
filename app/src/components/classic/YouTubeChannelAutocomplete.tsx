import ChannelAutocomplete, {
  type ChannelAutocompleteSuggestion,
} from './ChannelAutocomplete';
import {
  YOUTUBE_CHANNEL_SEARCH_DEBOUNCE_MS,
  normalizeYouTubeChannelSearchQuery,
  parseYouTubeChannelSuggestions,
} from '@/lib/youtubeChannelSearch';

type YouTubeChannelAutocompleteProps = {
  id: string;
  name: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
};

async function searchYouTubeChannels(
  query: string,
  signal: AbortSignal,
): Promise<ChannelAutocompleteSuggestion[]> {
  const response = await fetch(
    `/api/youtube/channel-search?${new URLSearchParams({ q: query })}`,
    { signal },
  );

  if (!response.ok) throw new Error('YouTube channel search failed.');

  const parsed = parseYouTubeChannelSuggestions(await response.json());
  if (!parsed) throw new Error('Invalid YouTube channel search response.');

  return parsed.map((suggestion) => ({
    value: suggestion.handle,
    displayName: suggestion.display_name,
    thumbnailUrl: suggestion.thumbnail_url ?? undefined,
    isLive: suggestion.is_live,
    meta: suggestion.handle,
    secondary: suggestion.subscribers || undefined,
  }));
}

export default function YouTubeChannelAutocomplete({
  id,
  name,
  placeholder,
  value,
  onValueChange,
}: YouTubeChannelAutocompleteProps) {
  return (
    <ChannelAutocomplete
      id={id}
      name={name}
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
      platform="youtube"
      platformLabel="YouTube"
      debounceMs={YOUTUBE_CHANNEL_SEARCH_DEBOUNCE_MS}
      normalizeQuery={normalizeYouTubeChannelSearchQuery}
      search={searchYouTubeChannels}
    />
  );
}
