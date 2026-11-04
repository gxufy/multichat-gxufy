import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ChannelAutocompleteSuggestion = {
  value: string;
  displayName: string;
  thumbnailUrl?: string;
  isLive: boolean;
  meta: string;
  secondary?: string;
};

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

type ChannelAutocompleteProps = {
  id: string;
  name: string;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  platform: 'twitch' | 'kick' | 'youtube' | 'tiktok';
  platformLabel: string;
  debounceMs: number;
  normalizeQuery: (value: string) => string | null;
  search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<ChannelAutocompleteSuggestion[]>;
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function ChannelAutocomplete({
  id,
  name,
  placeholder,
  value,
  onValueChange,
  platform,
  platformLabel,
  debounceMs,
  normalizeQuery,
  search,
}: ChannelAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<ChannelAutocompleteSuggestion[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const aliveRef = useRef(true);

  const listboxId = `${id}-suggestions`;

  const cancelPending = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;

    abortRef.current?.abort();
    abortRef.current = null;

    requestRef.current += 1;
  }, []);

  const close = useCallback(() => {
    cancelPending();
    setOpen(false);
    setActiveIndex(-1);
  }, [cancelPending]);

  useEffect(() => {
    aliveRef.current = true;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener('pointerdown', handleOutsidePointer);

    return () => {
      aliveRef.current = false;
      document.removeEventListener('pointerdown', handleOutsidePointer);
      cancelPending();
    };
  }, [cancelPending, close]);

  const scheduleSearch = useCallback((rawValue: string) => {
    cancelPending();
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);

    const query = normalizeQuery(rawValue);
    if (!query) {
      setStatus('idle');
      return;
    }

    const requestId = requestRef.current;

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;

      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('loading');

      void search(query, controller.signal)
        .then((results) => {
          if (
            !aliveRef.current ||
            controller.signal.aborted ||
            requestId !== requestRef.current
          ) {
            return;
          }

          setSuggestions(results);
          setStatus('success');
          setOpen(results.length > 0);
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (
            isAbort(error) ||
            controller.signal.aborted ||
            !aliveRef.current ||
            requestId !== requestRef.current
          ) {
            return;
          }

          setSuggestions([]);
          setStatus('error');
          setOpen(false);
          setActiveIndex(-1);
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
        });
    }, debounceMs);
  }, [cancelPending, debounceMs, normalizeQuery, search]);

  const selectSuggestion = useCallback(
    (suggestion: ChannelAutocompleteSuggestion) => {
      cancelPending();
      onValueChange(suggestion.value);
      inputRef.current?.focus();
      setSuggestions([]);
      setStatus('idle');
      setOpen(false);
      setActiveIndex(-1);
    },
    [cancelPending, onValueChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open || status === 'loading') event.preventDefault();
      close();
      return;
    }

    if (!suggestions.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current < suggestions.length - 1 ? current + 1 : 0
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current > 0 ? current - 1 : suggestions.length - 1
      );
      return;
    }

    if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    }
  };

  const statusText =
    status === 'loading'
      ? `Searching ${platformLabel} channels.`
      : status === 'error'
        ? `${platformLabel} channel search is temporarily unavailable.`
        : status === 'success'
          ? suggestions.length
            ? `${suggestions.length} ${platformLabel} channel suggestion${
                suggestions.length === 1 ? '' : 's'
              } available.`
            : `No ${platformLabel} channels found.`
          : '';

  return (
    <div
      className="channel-autocomplete"
      data-platform={platform}
      ref={rootRef}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        name={name}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-${activeIndex}`
            : undefined
        }
        onChange={(event) => {
          const nextValue = event.target.value;
          onValueChange(nextValue);
          scheduleSearch(nextValue);
        }}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />

      {open ? (
        <div
          id={listboxId}
          className="channel-suggestions"
          role="listbox"
          aria-label={`${platformLabel} channel suggestions`}
        >
          {suggestions.map((suggestion, index) => (
            <button
              id={`${listboxId}-${index}`}
              className="channel-suggestion"
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              tabIndex={-1}
              key={suggestion.value}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion.thumbnailUrl ? (
                <Image
                  className="channel-suggestion-avatar"
                  src={suggestion.thumbnailUrl}
                  alt=""
                  width={38}
                  height={38}
                  sizes="38px"
                />
              ) : (
                <span
                  className="channel-suggestion-avatar channel-suggestion-avatar-fallback"
                  aria-hidden="true"
                >
                  {suggestion.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}

              <span className="channel-suggestion-copy">
                <span className="channel-suggestion-title">
                  <span className="channel-suggestion-display-name">
                    {suggestion.displayName}
                  </span>

                  {suggestion.isLive ? (
                    <span className="channel-suggestion-live">LIVE</span>
                  ) : null}
                </span>

                <span className="channel-suggestion-meta">
                  <span>{suggestion.meta}</span>
                  {suggestion.secondary ? (
                    <span>{suggestion.secondary}</span>
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <span className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>
    </div>
  );
}
