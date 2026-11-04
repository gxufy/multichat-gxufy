import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TwitchChannelAutocomplete from '@/components/classic/TwitchChannelAutocomplete';
import { TWITCH_CHANNEL_SEARCH_DEBOUNCE_MS } from '@/lib/twitchChannelSearch';

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
  broadcaster_login: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    broadcaster_login,
    display_name: broadcaster_login.toUpperCase(),
    thumbnail_url: `https://static-cdn.jtvnw.net/${broadcaster_login}.png`,
    is_live: false,
    game_name: 'Just Chatting',
    ...overrides,
  };
}

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="channel-twitch">Twitch</label>
      <TwitchChannelAutocomplete
        id="channel-twitch"
        name="twitch"
        placeholder="Twitch channel"
        value={value}
        onValueChange={setValue}
      />
      <output aria-label="Selected Twitch channel">{value}</output>
    </>
  );
}

async function advanceSearch(ms = TWITCH_CHANNEL_SEARCH_DEBOUNCE_MS) {
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

describe('TwitchChannelAutocomplete', () => {
  it('waits for three characters and exactly 100ms before searching', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Twitch' });

    fireEvent.change(input, { target: { value: 'ab' } });
    await advanceSearch(1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Cat' } });
    await advanceSearch(TWITCH_CHANNEL_SEARCH_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await advanceSearch(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/twitch/channel-search?q=cat');
  });

  it('aborts a stale request immediately and ignores it after a newer result', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('q=cat')) {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(jsonResponse([suggestion('cats')]));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Twitch' });

    fireEvent.change(input, { target: { value: 'cat' } });
    await advanceSearch();
    expect(firstSignal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: 'cats' } });
    expect(firstSignal?.aborted).toBe(true);
    await advanceSearch();
    expect(screen.getByRole('option', { name: /CATS/i })).not.toBeNull();
  });

  it('renders avatar, display name, live state, game, and canonical login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      suggestion('gxufy', {
        display_name: 'GXUFY',
        is_live: true,
        game_name: 'Software and Game Development',
      }),
    ])));
    render(<Harness />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Twitch' }), {
      target: { value: 'gxu' },
    });
    await advanceSearch();

    const option = screen.getByRole('option', { name: /GXUFY/i });
    expect(within(option).getByText('LIVE')).not.toBeNull();
    expect(within(option).getByText('Software and Game Development')).not.toBeNull();
    expect(within(option).getByText('@gxufy')).not.toBeNull();
    expect(option.querySelector('img')?.getAttribute('src'))
      .toBe('https://static-cdn.jtvnw.net/gxufy.png');
  });

  it('supports Down, Up, Enter, and writes the selected canonical lowercase login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      suggestion('alpha'),
      suggestion('alphabet'),
    ])));
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Twitch' });

    fireEvent.change(input, { target: { value: 'ALP' } });
    await advanceSearch();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getByRole('option', { name: /ALPHABET/i }).getAttribute('aria-selected'))
      .toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected'))
      .toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByLabelText('Selected Twitch channel').textContent).toBe('alpha');
    expect((input as HTMLInputElement).value).toBe('alpha');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape and outside pointer interaction', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([suggestion('channel')])));
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Twitch' });

    fireEvent.change(input, { target: { value: 'channel' } });
    await advanceSearch();
    expect(screen.getByRole('listbox')).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
