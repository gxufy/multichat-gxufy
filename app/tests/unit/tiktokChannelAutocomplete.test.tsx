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
import TikTokChannelAutocomplete from '@/components/classic/TikTokChannelAutocomplete';
import { TIKTOK_CHANNEL_SEARCH_DEBOUNCE_MS } from '@/lib/tiktokChannelSearch';

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

function suggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    username: 'tiktok',
    display_name: 'TikTok',
    thumbnail_url:
      'https://p16-common-sign.tiktokcdn-us.com/tos-useast5-avt-0068-tx/avatar.jpeg',
    followers_count: 95_900_000,
    verified: true,
    is_live: false,
    ...overrides,
  };
}

function Harness() {
  const [value, setValue] = useState('');

  return (
    <>
      <label htmlFor="channel-tiktok">TikTok</label>
      <TikTokChannelAutocomplete
        id="channel-tiktok"
        name="tiktok"
        placeholder="@username"
        value={value}
        onValueChange={setValue}
      />
      <output aria-label="Selected TikTok channel">{value}</output>
    </>
  );
}

async function advanceSearch(ms = TIKTOK_CHANNEL_SEARCH_DEBOUNCE_MS) {
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

describe('TikTokChannelAutocomplete', () => {
  it('waits for three characters and the conservative debounce before searching', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'TikTok' });
    fireEvent.change(input, { target: { value: 'ti' } });
    await advanceSearch(1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'TikTok' } });
    await advanceSearch(TIKTOK_CHANNEL_SEARCH_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await advanceSearch(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/tiktok/channel-search?q=tiktok',
    );
  });

  it.each([
    ['@username', '@TikTok'],
    ['www profile URL', 'https://www.tiktok.com/@TikTok'],
    ['apex profile URL', 'https://tiktok.com/@TikTok'],
  ])('normalizes a %s before searching', async (_label, value) => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    fireEvent.change(screen.getByRole('combobox', { name: 'TikTok' }), {
      target: { value },
    });
    await advanceSearch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/tiktok/channel-search?q=tiktok',
    );
  });

  it('renders the avatar, display name, username, followers, and no LIVE badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([suggestion()])));
    render(<Harness />);

    fireEvent.change(screen.getByRole('combobox', { name: 'TikTok' }), {
      target: { value: 'tiktok' },
    });
    await advanceSearch();

    const option = screen.getByRole('option', { name: /TikTok/i });
    expect(within(option).getByText('@tiktok')).not.toBeNull();
    expect(within(option).getByText('95.9M followers')).not.toBeNull();
    expect(option.querySelector('img')?.getAttribute('src')).toContain(
      'p16-common-sign.tiktokcdn-us.com',
    );
    expect(within(option).queryByText('LIVE')).toBeNull();
  });

  it('selects the canonical @username by click', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([suggestion()])));
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'TikTok' });
    fireEvent.change(input, { target: { value: 'tiktok' } });
    await advanceSearch();
    fireEvent.click(screen.getByRole('option', { name: /TikTok/i }));

    expect((input as HTMLInputElement).value).toBe('@tiktok');
    expect(screen.getByLabelText('Selected TikTok channel').textContent).toBe(
      '@tiktok',
    );
  });

  it('supports ArrowDown, Enter, and Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([suggestion()])));
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'TikTok' });
    fireEvent.change(input, { target: { value: 'tiktok' } });
    await advanceSearch();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(input, { target: { value: 'tiktok' } });
    await advanceSearch();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect((input as HTMLInputElement).value).toBe('@tiktok');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps a manually typed value editable when resolution fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 502)));
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'TikTok' });
    fireEvent.change(input, { target: { value: 'manual.name' } });
    await advanceSearch();

    expect((input as HTMLInputElement).value).toBe('manual.name');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      screen.getByText('TikTok channel search is temporarily unavailable.'),
    ).not.toBeNull();

    fireEvent.change(input, { target: { value: 'manual.name2' } });
    expect((input as HTMLInputElement).value).toBe('manual.name2');
  });

  it('aborts stale requests and never surfaces their results', async () => {
    let staleSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('q=tiktok')) {
        staleSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }

      return Promise.resolve(jsonResponse([
        suggestion({
          username: 'tiktoklive',
          display_name: 'TikTok Live',
        }),
      ]));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);

    const input = screen.getByRole('combobox', { name: 'TikTok' });
    fireEvent.change(input, { target: { value: 'tiktok' } });
    await advanceSearch();
    expect(staleSignal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: 'tiktoklive' } });
    expect(staleSignal?.aborted).toBe(true);
    await advanceSearch();

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /TikTok Live/i }))
      .not.toBeNull();
    expect(within(listbox).queryByText('TikTok', {
      selector: '.channel-suggestion-display-name',
    })).toBeNull();
  });
});
