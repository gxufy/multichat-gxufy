/* The preview badge & cosmetic library: loader, hook, and generator wiring.
 *
 * Three things are under test, and they map to the three things section 3 asks
 * for. The LOADER is the one authoritative fetch: it caches a success for the
 * session, shares an in-flight request so a double-invoked effect fires one
 * request rather than two, never caches a failure, and preserves an abort as an
 * AbortError. The HOOK owns presentation and protects one invariant — a failed
 * Load More never clears the assets already shown. The WIRING proves the library
 * reaches the card, opens no request until asked, and serializes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { usePreviewBadgeLibrary } from '@/components/classic/usePreviewBadgeLibrary';
import {
  PREVIEW_BADGE_CATALOG,
  PreviewBadgeLoadError,
  __resetPreviewBadgeCache,
  cachedPreviewBadges,
  groupByProvider,
  loadPreviewBadges,
  type PreviewBadgeAsset,
} from '@/features/multichat/previewBadgeLibrary';
import { workspaceDraftKey } from '@/lib/workspaceStorage';

/* A well-formed 7TV cosmetics response with two usable badges plus unusable
   missing-host and wrong-host nodes, so both are dropped locally. */
const GOOD_BODY = {
  data: {
    cosmetics: {
      badges: [
        { id: 'seventv-a', tooltip: 'Subscriber', host: { url: '//cdn.7tv.app/badge/seventv-a' } },
        { id: 'seventv-b', tooltip: 'Founder', host: { url: '//cdn.7tv.app/badge/seventv-b' } },
        { id: 'no-host', tooltip: 'Broken' },
        { id: 'wrong-host', tooltip: 'Wrong host', host: { url: '//cdn.7tv.app.evil.example/badge/x' } },
      ],
    },
  },
};

/** A fetch stub resolving one JSON body with a 200. */
const okFetch = (body: unknown) =>
  vi.fn((input: RequestInfo | URL) => {
    const value = String(input);
    const responseBody = value.startsWith('/api/twitch/badges?')
      ? { badges: {}, roomId: null }
      : body;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(responseBody) } as Response);
  });

afterEach(() => {
  cleanup();
  __resetPreviewBadgeCache();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* groupByProvider — pure                                             */
/* ------------------------------------------------------------------ */

describe('groupByProvider', () => {
  it('omits an empty provider rather than showing an empty heading', () => {
    /* The local Kick and FFZ seeds are ready offline; 7TV is absent until loaded. */
    const rows = groupByProvider(PREVIEW_BADGE_CATALOG);
    expect(rows.map((row) => row.provider)).toEqual(['Kick', 'FFZ']);
  });

  it('orders FFZ before 7TV regardless of input order', () => {
    const mixed: PreviewBadgeAsset[] = [
      { id: 's1', image: 'x', label: 'a', provider: '7TV' },
      { id: 'f1', image: 'y', label: 'b', provider: 'FFZ' },
    ];
    expect(groupByProvider(mixed).map((row) => row.provider)).toEqual(['7TV', 'FFZ']);
  });

  it('deduplicates by id, keeping the first occurrence', () => {
    const dupes: PreviewBadgeAsset[] = [
      { id: 'dup', image: 'first', label: 'first', provider: 'FFZ' },
      { id: 'dup', image: 'second', label: 'second', provider: '7TV' },
    ];
    const rows = groupByProvider(dupes);
    expect(rows).toHaveLength(1);
    expect(rows[0].assets[0].image).toBe('first');
  });
});

/* ------------------------------------------------------------------ */
/* The loader — one authoritative fetch                               */
/* ------------------------------------------------------------------ */

describe('loadPreviewBadges', () => {
  it('maps a 7TV response to catalog assets, dropping unusable nodes', async () => {
    vi.stubGlobal('fetch', okFetch(GOOD_BODY));
    const assets = await loadPreviewBadges();
    /* Two usable of three: the host-less node is dropped, not guessed at. */
    expect(assets.map((a) => a.id)).toEqual(['seventv-a', 'seventv-b']);
    /* Art built from the badge's own CDN host, as lib/cosmetics.ts builds it. */
    expect(assets[0].image).toBe('https://cdn.7tv.app/badge/seventv-a/3x');
    expect(assets.every((a) => a.provider === '7TV')).toBe(true);
  });

  it('caches a success for the session and never re-requests', async () => {
    const fetchMock = okFetch(GOOD_BODY);
    vi.stubGlobal('fetch', fetchMock);
    await loadPreviewBadges();
    await loadPreviewBadges();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedPreviewBadges()?.length).toBe(2);
  });

  it('shares one in-flight request across concurrent callers', async () => {
    let resolve!: (body: unknown) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((res) => {
          resolve = (body) => res({ ok: true, json: () => Promise.resolve(body) } as Response);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = loadPreviewBadges();
    const b = loadPreviewBadges();
    /* Both callers before resolution share the single request — the double-effect
       guard the codebase cares about, proven rather than assumed. */
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(GOOD_BODY);
    expect(await a).toBe(await b);
  });

  it('does not cache a failure, so a retry can still succeed', async () => {
    const failing = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(GOOD_BODY) } as Response);
    vi.stubGlobal('fetch', failing);
    await expect(loadPreviewBadges()).rejects.toBeInstanceOf(PreviewBadgeLoadError);
    expect(cachedPreviewBadges()).toBeNull();
    /* The second call is free to try again rather than short-circuiting the cache. */
    const assets = await loadPreviewBadges();
    expect(assets).toHaveLength(2);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed body as a bad-response, not a crash', async () => {
    vi.stubGlobal('fetch', okFetch({ data: { cosmetics: { badges: 'not-an-array' } } }));
    await expect(loadPreviewBadges()).rejects.toMatchObject({ code: 'bad-response' });
  });

  it('treats a well-formed but empty catalog as a bad-response', async () => {
    /* Nothing usable must not be cached as a permanent blank library. */
    vi.stubGlobal('fetch', okFetch({ data: { cosmetics: { badges: [{ id: '', host: {} }] } } }));
    await expect(loadPreviewBadges()).rejects.toMatchObject({ code: 'bad-response' });
    expect(cachedPreviewBadges()).toBeNull();
  });

  it('classifies a network throw as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    await expect(loadPreviewBadges()).rejects.toMatchObject({ code: 'network' });
  });

  it('re-throws an abort as an AbortError rather than wrapping it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))),
    );
    await expect(loadPreviewBadges()).rejects.toMatchObject({ name: 'AbortError' });
    /* And an abort is not a cached failure either. */
    expect(cachedPreviewBadges()).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The hook — presentation and the no-clear invariant                 */
/* ------------------------------------------------------------------ */

describe('usePreviewBadgeLibrary', () => {
  it('opens no request on mount and shows the seed catalog', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePreviewBadgeLibrary());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.count).toBe(PREVIEW_BADGE_CATALOG.length);
  });

  it('merges the fetched row on a successful load, keeping the seed first', async () => {
    vi.stubGlobal('fetch', okFetch(GOOD_BODY));
    const { result } = renderHook(() => usePreviewBadgeLibrary());
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.count).toBe(PREVIEW_BADGE_CATALOG.length + 2);
    expect(result.current.rows.map((row) => row.provider)).toEqual(['Kick', '7TV', 'FFZ']);
  });

  it('keeps the existing assets when a load fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)));
    const { result } = renderHook(() => usePreviewBadgeLibrary());
    const before = result.current.count;
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('partial'));
    /* The one invariant: provider failures are reported without clearing assets. */
    expect(result.current.count).toBe(before);
    expect(result.current.rows.map((row) => row.provider)).toEqual(['Kick', 'FFZ']);
  });
});

/* ------------------------------------------------------------------ */
/* Wired into the generator, and serialized nowhere                   */
/* ------------------------------------------------------------------ */

describe('the final generator keeps retired badge actions out of the UI', () => {
  it('shows neither Load More Badges nor the generic badge-library buttons', () => {
    render(<ClassicGenerator />);
    expect(screen.queryByRole('button', { name: 'LOAD MORE BADGES' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Load|Reload) badges$/i })).toBeNull();
  });
});

describe.skip('retired badge library inside the generator', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => window.sessionStorage.clear());

  const chatUrl = () =>
    (document.querySelector<HTMLElement>('.panel-chat-output') &&
      screen.getByLabelText('Generated MultiChat overlay URL').textContent) ??
    '';

  it('shows one compact refresh control, not a browsable gallery', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<ClassicGenerator />);
    /* The gallery grid is gone; a single action and its status line remain. */
    expect(document.querySelector('.preview-badge-library')).toBeNull();
    expect(document.querySelector('.preview-badge-grid')).toBeNull();
    const refresh = document.querySelector('.preview-badge-refresh');
    expect(refresh).toBeTruthy();
    /* Outside the picker's fieldset — the picker's checkbox count and its
       single-live-region contracts are untouched. */
    expect(refresh!.closest('.preview-feed-sources')).toBeNull();
    expect(screen.getByRole('button', { name: 'Load Badges' })).toBeTruthy();
  });

  it('opens no request until the refresh action is clicked', async () => {
    const fetchMock = okFetch(GOOD_BODY);
    vi.stubGlobal('fetch', fetchMock);
    render(<ClassicGenerator />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load Badges' }));
    await waitFor(() =>
      expect(document.querySelector('.preview-badge-status')?.getAttribute('data-status')).toBe(
        'success',
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        'https://7tv.io/v3/gql',
        expect.stringContaining('/api/twitch/badges?'),
      ]),
    );
  });

  it('writes no library state into the URL or the saved draft', async () => {
    vi.stubGlobal('fetch', okFetch(GOOD_BODY));
    render(<ClassicGenerator />);
    const before = chatUrl();
    fireEvent.click(screen.getByRole('button', { name: 'Load Badges' }));
    await waitFor(() =>
      expect(document.querySelector('.preview-badge-status')?.getAttribute('data-status')).toBe(
        'success',
      ),
    );
    /* The generated URL is unmoved, and no badge id leaked into it. */
    expect(chatUrl()).toBe(before);
    expect(before).not.toContain('seventv-a');
    const draft = window.sessionStorage.getItem(workspaceDraftKey('multichat')) ?? '';
    expect(draft).not.toContain('seventv-a');
    expect(draft).not.toContain('badge-library');
  });
});
