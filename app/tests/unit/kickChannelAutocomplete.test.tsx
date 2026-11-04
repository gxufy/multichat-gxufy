import {
  useState,
} from 'react';

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import KickChannelAutocomplete from '@/components/classic/KickChannelAutocomplete';

import {
  KICK_CHANNEL_SEARCH_DEBOUNCE_MS,
} from '@/lib/kickChannelSearch';

vi.mock('next/image', () => ({
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement>,
  ) => <img {...props} />,
}));

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function suggestion(
  slug: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    slug,
    display_name: slug.toUpperCase(),
    thumbnail_url:
      `https://files.kick.com/${slug}.webp`,
    is_live: false,
    followers_count: 123,
    verified: false,
    ...overrides,
  };
}

function Harness() {
  const [value, setValue] = useState('');

  return (
    <>
      <label htmlFor="channel-kick">
        Kick
      </label>

      <KickChannelAutocomplete
        id="channel-kick"
        name="kick"
        placeholder="Kick channel"
        value={value}
        onValueChange={setValue}
      />

      <output aria-label="Selected Kick channel">
        {value}
      </output>
    </>
  );
}

async function advanceSearch(
  ms = KICK_CHANNEL_SEARCH_DEBOUNCE_MS,
) {
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

describe('KickChannelAutocomplete', () => {
  it('waits for three characters and 100ms before searching', async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => jsonResponse([]));

    vi.stubGlobal('fetch', fetchMock);

    render(<Harness />);

    const input = screen.getByRole(
      'combobox',
      { name: 'Kick' },
    );

    fireEvent.change(input, {
      target: { value: 'ab' },
    });

    await advanceSearch(1_000);

    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, {
      target: { value: 'Stay' },
    });

    await advanceSearch(
      KICK_CHANNEL_SEARCH_DEBOUNCE_MS - 1,
    );

    expect(fetchMock).not.toHaveBeenCalled();

    await advanceSearch(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(fetchMock.mock.calls[0][0])
      .toBe(
        '/api/kick/channel-search?q=stay',
      );
  });

  it('renders Kick suggestion metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          suggestion('staydownkayyy', {
            display_name: 'StayDownKayyy',
            is_live: true,
            followers_count: 1583,
          }),
        ]),
      ),
    );

    render(<Harness />);

    fireEvent.change(
      screen.getByRole(
        'combobox',
        { name: 'Kick' },
      ),
      {
        target: { value: 'stay' },
      },
    );

    await advanceSearch();

    const option = screen.getByRole(
      'option',
      { name: /StayDownKayyy/i },
    );

    expect(
      within(option).getByText('LIVE'),
    ).not.toBeNull();

    expect(
      within(option).getByText(
        '@staydownkayyy',
      ),
    ).not.toBeNull();

    expect(option.textContent)
      .toContain('1.6K followers');
  });

  it('writes the canonical Kick slug when selected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          suggestion('staydownkayyy'),
        ]),
      ),
    );

    render(<Harness />);

    const input = screen.getByRole(
      'combobox',
      { name: 'Kick' },
    );

    fireEvent.change(input, {
      target: { value: 'STAY' },
    });

    await advanceSearch();

    fireEvent.keyDown(input, {
      key: 'ArrowDown',
    });

    fireEvent.keyDown(input, {
      key: 'Enter',
    });

    expect(
      screen.getByLabelText(
        'Selected Kick channel',
      ).textContent,
    ).toBe('staydownkayyy');
  });

  it('renders a fallback avatar when Kick has no profile picture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse([
          suggestion('staydownz', {
            thumbnail_url: null,
            display_name: 'StayDownZ',
          }),
        ]),
      ),
    );

    render(<Harness />);

    fireEvent.change(
      screen.getByRole(
        'combobox',
        { name: 'Kick' },
      ),
      {
        target: { value: 'stay' },
      },
    );

    await advanceSearch();

    const option = screen.getByRole(
      'option',
      { name: /StayDownZ/i },
    );

    expect(
      option.querySelector('img'),
    ).toBeNull();

    expect(option.textContent)
      .toContain('S');
  });
});
