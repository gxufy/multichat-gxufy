import ChannelAutocomplete, {
  type ChannelAutocompleteSuggestion,
} from './ChannelAutocomplete';
import {
  TWITCH_CHANNEL_SEARCH_DEBOUNCE_MS,
  normalizeTwitchChannelSearchQuery,
  parseTwitchChannelSuggestions,
} from '@/lib/twitchChannelSearch';

type TwitchChannelAutocompleteProps = {
  id: string;
  name: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
};

async function searchTwitchChannels(
  query: string,
  signal: AbortSignal,
): Promise<ChannelAutocompleteSuggestion[]> {
  const response = await fetch(
    `/api/twitch/channel-search?${new URLSearchParams({ q: query })}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error('Twitch channel search failed.');
  }

  const parsed = parseTwitchChannelSuggestions(await response.json());
  if (!parsed) {
    throw new Error('Invalid Twitch channel search response.');
  }

  return parsed.map((suggestion) => ({
    value: suggestion.broadcaster_login,
    displayName: suggestion.display_name,
    thumbnailUrl: suggestion.thumbnail_url,
    isLive: suggestion.is_live,
    meta: `@${suggestion.broadcaster_login}`,
    secondary: suggestion.game_name || undefined,
  }));
}

export default function TwitchChannelAutocomplete({
  id,
  name,
  placeholder,
  value,
  onValueChange,
}: TwitchChannelAutocompleteProps) {
  return (
    <ChannelAutocomplete
      id={id}
      name={name}
      placeholder={placeholder}
      value={value}
      onValueChange={onValueChange}
      platform="twitch"
      platformLabel="Twitch"
      debounceMs={TWITCH_CHANNEL_SEARCH_DEBOUNCE_MS}
      normalizeQuery={normalizeTwitchChannelSearchQuery}
      search={searchTwitchChannels}
    />
  );
}
