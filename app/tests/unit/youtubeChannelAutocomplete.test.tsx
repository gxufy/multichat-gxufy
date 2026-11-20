import { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YouTubeChannelAutocomplete from '@/components/classic/YouTubeChannelAutocomplete';
import { YOUTUBE_CHANNEL_SEARCH_DEBOUNCE_MS } from '@/lib/youtubeChannelSearch';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function suggestion(
  handle: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    channel_id: 'UCh2aTKSbIyxpnOsbHsmV-ig',
    handle,
    display_name: handle.slice(1),
    thumbnail_url: `https://yt3.ggpht.com/${handle.slice(1)}.jpg`,
    subscribers: '1.38M subscribers',
    is_live: false,
    ...overrides,
  };
}

function Harness() {
  const [value, setValue] = useState('');

  return (
    <>
      <label htmlFor="channel-youtube">YouTube</label>
      <YouTubeChannelAutocomplete
        id="channel-youtube"
        name="youtube"
        placeholder="YouTube channel"
        value={value}
        onValueChange={setValue}
      />
      <output aria-label="Selected YouTube channel">{value}</output>
    </>
  );
}

async function advanceSearch(ms = YOUTUBE_CHANNEL_SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('YouTubeChannelAutocomplete', () => {
  it('waits for three characters and 100ms before searching', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'YouTube' });
    fireEvent.change(input, { target: { value: 'ab' } });
    await advanceSearch(1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '@Agent' } });
    await advanceSearch(YOUTUBE_CHANNEL_SEARCH_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await advanceSearch(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/youtube/channel-search?q=agent',
    );
  });

  it('renders the real avatar, display name, handle, and subscribers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          suggestion('@Agent00', {
            display_name: 'Agent 00',
          }),
        ]),
      ),
    );
    render(<Harness />);

    fireEvent.change(screen.getByRole('combobox', { name: 'YouTube' }), {
      target: { value: 'agent' },
    });
    await advanceSearch();

    const option = screen.getByRole('option', { name: /Agent 00/i });
    expect(within(option).getByText('@Agent00')).not.toBeNull();
    expect(within(option).getByText('1.38M subscribers')).not.toBeNull();
    expect(option.querySelector('img')?.getAttribute('src')).toBe(
      'https://yt3.ggpht.com/Agent00.jpg',
    );
    expect(within(option).queryByText('LIVE')).toBeNull();
  });

  it('uses keyboard navigation and writes the canonical handle', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          suggestion('@Agent00', { display_name: 'Agent 00' }),
        ]),
      ),
    );
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'YouTube' });
    fireEvent.change(input, { target: { value: 'agent' } });
    await advanceSearch();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByLabelText('Selected YouTube channel').textContent).toBe(
      '@Agent00',
    );
    expect((input as HTMLInputElement).value).toBe('@Agent00');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('aborts stale searches and never surfaces their results', async () => {
    let staleSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('q=agent')) {
        staleSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }

      return Promise.resolve(
        jsonResponse([
          suggestion('@Agent007', { display_name: 'Agent 007' }),
        ]),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'YouTube' });
    fireEvent.change(input, { target: { value: 'agent' } });
    await advanceSearch();
    expect(staleSignal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: 'agent007' } });
    expect(staleSignal?.aborted).toBe(true);
    await advanceSearch();

    expect(screen.getByRole('option', { name: /Agent 007/i })).not.toBeNull();
  });

  it('fails closed when the endpoint returns an invalid suggestion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          suggestion('@Agent00', {
            thumbnail_url: 'https://example.com/avatar.jpg',
          }),
        ]),
      ),
    );
    render(<Harness />);

    fireEvent.change(screen.getByRole('combobox', { name: 'YouTube' }), {
      target: { value: 'agent' },
    });
    await advanceSearch();

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      screen.getByText('YouTube channel search is temporarily unavailable.'),
    ).not.toBeNull();
  });
});
