import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import ClassicGenerator from '@/components/classic/ClassicGenerator';
import { useTwitchPreviewIdentity } from '@/components/classic/useTwitchPreviewIdentity';
import { useChatPreviewSimulator } from '@/components/classic/useChatPreviewSimulator';
import { seededRandom } from '@/features/multichat/previewSimulator';
import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
import { workspaceDraftKey } from '@/lib/workspaceStorage';
import { __resetPreviewIdentityClient } from '@/features/multichat/previewIdentityClient';
import { PREVIEW_ROSTER } from '@/features/multichat/previewRoster';

vi.mock('next/head', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const emote = (id: string, name: string, provider: 'FFZ' | 'BTTV' | '7TV', zeroWidth = false) => ({
  id, name, provider, scope: 'global' as const, zeroWidth, upscale: false,
  image: `https://cdn.example/${id}.webp`, height: 28, width: 28,
});

const identityResponse = (login = 'canonical'): PreviewIdentityResponse => ({
  identity: { userId: login === 'newer' ? '99' : '42', login, displayName: login === 'newer' ? 'NewerName' : 'CanonicalName' },
  providers: {
    Twitch: {
      status: 'loaded',
      resources: {
        globalBadges: {
          'moderator/1': 'https://cdn.example/twitch-mod.png',
          'community:chatterino:verified/1': 'https://cdn.example/community-verified.png',
        },
        channelBadges: { 'subscriber/1': 'https://cdn.example/twitch-channel.png' },
      },
    },
    FFZ: {
      status: 'loaded',
      resources: {
        globalEmotes: [emote('ffz', 'FFZReal', 'FFZ')], roomEmotes: [],
        badgeOverrides: { 'moderator/1': 'https://cdn.example/ffz-mod.png' },
      },
    },
    BTTV: {
      status: 'failed',
      resources: { globalEmotes: [emote('bttv', 'BTTVReal', 'BTTV')], channelEmotes: [], sharedEmotes: [] },
    },
    '7TV': {
      status: 'loaded',
      resources: {
        globalEmotes: [emote('seven', 'SevenReal', '7TV'), emote('zero', 'SevenZero', '7TV', true)],
        channelEmotes: [], personalEmotes: [],
        paint: { id: 'paint', func: 'LINEAR_GRADIENT', angle: 90, repeat: false, shadows: [], stops: [{ color: 0xff0000ff, at: 0 }, { color: 0x0000ffff, at: 1 }] },
        badge: { id: 'seven-badge', image: 'https://cdn.7tv.app/seven-badge.png' },
      },
    },
  },
});

const jsonResponse = (body: unknown, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
} as Response);

beforeEach(() => {
  window.sessionStorage.clear();
  __resetPreviewIdentityClient();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useTwitchPreviewIdentity lifecycle', () => {
  it('submits only after explicit load and shows canonical/provider state', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) => jsonResponse(identityResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTwitchPreviewIdentity());
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => result.current.setInput('@Canonical'));
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('partial'));
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/twitch/preview-identity?login=canonical');
    expect(result.current.response?.identity.displayName).toBe('CanonicalName');
    expect(result.current.failedProviders).toEqual(['BTTV']);
  });

  it('prevents stale data replacing a newer identity and clears incompatible output', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      resolvers.push(resolve);
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const { result } = renderHook(() => useTwitchPreviewIdentity());
    act(() => { result.current.setInput('old'); });
    act(() => result.current.load());
    act(() => { result.current.setInput('newer'); });
    act(() => result.current.load());
    expect(result.current.response).toBeNull();
    await act(async () => resolvers[1]!({ ok: true, status: 200, json: () => Promise.resolve(identityResponse('newer')) } as Response));
    expect(result.current.response?.identity.login).toBe('newer');
    await act(async () => resolvers[0]!({ ok: true, status: 200, json: () => Promise.resolve(identityResponse('old')) } as Response));
    expect(result.current.response?.identity.login).toBe('newer');
  });

  it('retries only failed providers while preserving successful slices', async () => {
    let finishRetry!: (value: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => jsonResponse(identityResponse()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRetry = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useTwitchPreviewIdentity());
    act(() => result.current.setInput('canonical'));
    act(() => result.current.load());
    await waitFor(() => expect(result.current.status).toBe('partial'));
    const twitch = result.current.response?.providers.Twitch;
    act(() => result.current.retryFailed());
    expect(result.current.status).toBe('retrying');
    expect(result.current.response?.providers.Twitch).toBe(twitch);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('providers=BTTV');
    const retry: PreviewIdentityResponse = {
      identity: identityResponse().identity,
      providers: { BTTV: { status: 'loaded', resources: { globalEmotes: [], channelEmotes: [], sharedEmotes: [] } } },
    };
    await act(async () => finishRetry({ ok: true, status: 200, json: () => Promise.resolve(retry) } as Response));
    expect(result.current.response?.providers.Twitch).toBe(twitch);
    expect(result.current.status).toBe('success');
  });

  it('classifies not-found and aborts unmount without surfacing failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({}, 404)));
    const first = renderHook(() => useTwitchPreviewIdentity());
    act(() => first.result.current.setInput('missing'));
    act(() => first.result.current.load());
    await waitFor(() => expect(first.result.current.status).toBe('not-found'));
    first.unmount();

    let aborted = false;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    })));
    const second = renderHook(() => useTwitchPreviewIdentity());
    act(() => second.result.current.setInput('pending'));
    act(() => second.result.current.load());
    second.unmount();
    expect(aborted).toBe(true);
  });
});

describe('Preview Identity feed priority', () => {
  it('rotates identity templates with fresh preview-only ids instead of generic draws', () => {
    vi.useFakeTimers();
    const template = {
      templateId: 'canonical-badge', platform: 'twitch' as const, senderId: '42',
      username: 'CanonicalName', color: '#a970ff', badges: [], text: 'identity row',
      emotes: [], kind: 'chat' as const,
    };
    const { result } = renderHook(() => useChatPreviewSimulator({
      enabled: true,
      random: seededRandom(2),
      identityTemplates: [template],
    }));
    act(() => void vi.advanceTimersToNextTimer());
    const first = result.current.messages[0]!;
    act(() => void vi.advanceTimersToNextTimer());
    const second = result.current.messages[1]!;
    expect(first.username).toBe('CanonicalName');
    expect(first.id).toBe('identity-sim-1');
    expect(second.id).toBe('identity-sim-2');
    expect(first.id).not.toBe(second.id);
  });
});

describe('curated identities in the Chat Preview card', () => {
  const rosterResponse = (login: string): PreviewIdentityResponse => ({
    ...identityResponse(login),
    identity: { userId: String(PREVIEW_ROSTER.findIndex((entry) => entry.login === login) + 42), login, displayName: 'API casing' },
  });

  it('shows exact roster casing immediately and only the final preview controls', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ClassicGenerator />);
    const body = document.querySelector<HTMLIFrameElement>('iframe[title="MultiChat sample preview"]')?.contentDocument?.body;
    for (const entry of PREVIEW_ROSTER) expect(body?.textContent ?? '').toContain(entry.displayName);
    expect(screen.getByText(/not live channel chat/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'LOAD MORE BADGES' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'RESET PREVIEW' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'PAUSE' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'RESET FEED' })).toBeNull();
    expect(screen.queryByLabelText('Twitch username/channel')).toBeNull();
    expect(screen.queryByText('Preview badges & cosmetics')).toBeNull();
    expect(screen.queryByText('Add your own lines to the preview')).toBeNull();
    expect(screen.queryByText('Feed speed')).toBeNull();
    expect(screen.queryByText('Preview scale')).toBeNull();
  });

  it('requests normalized logins automatically and renders loaded resources through ChatOverlay', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const login = new URL(String(input), 'http://local').searchParams.get('login')!;
      return jsonResponse(rosterResponse(login));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClassicGenerator />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(PREVIEW_ROSTER.length));
    expect(fetchMock.mock.calls.map((call) => new URL(String(call[0]), 'http://local').searchParams.get('login'))).toEqual(
      PREVIEW_ROSTER.map((entry) => entry.login),
    );
    await waitFor(() => expect(screen.getByText(new RegExp(`${PREVIEW_ROSTER.length} of ${PREVIEW_ROSTER.length}`))).toBeTruthy());
    const body = document.querySelector<HTMLIFrameElement>('iframe[title="MultiChat sample preview"]')?.contentDocument?.body;
    for (const entry of PREVIEW_ROSTER) expect(body?.textContent ?? '').toContain(entry.displayName);
    expect(body?.querySelector('img[src="https://cdn.example/community-verified.png"]')).not.toBeNull();
    expect(body?.querySelector('img[alt="7tv badge"]')).not.toBeNull();
    expect(Array.from(body?.querySelectorAll<HTMLElement>('*') ?? []).some((node) => node.style.background.includes('linear-gradient'))).toBe(true);
  });

  it('keeps roster state out of URLs, drafts, and the restored two-card layout', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => jsonResponse(rosterResponse(new URL(String(input), 'http://local').searchParams.get('login')!))));
    render(<ClassicGenerator />);
    const chatUrl = screen.getByLabelText('Generated MultiChat overlay URL').textContent;
    const counterUrl = screen.getByLabelText('Generated viewer counter URL').textContent;
    await waitFor(() => expect(screen.getByText(new RegExp(`${PREVIEW_ROSTER.length} of ${PREVIEW_ROSTER.length}`))).toBeTruthy());
    expect(screen.getByLabelText('Generated MultiChat overlay URL').textContent).toBe(chatUrl);
    expect(screen.getByLabelText('Generated viewer counter URL').textContent).toBe(counterUrl);
    const storage = [workspaceDraftKey('multichat'), workspaceDraftKey('counter')]
      .map((key) => window.sessionStorage.getItem(key) ?? '').join('');
    expect(storage).not.toMatch(/gxufy|blu01_|preview-roster|seven-badge/i);
    expect(Array.from(document.querySelector('.tool-grid')!.children).map((node) => node.className)).toEqual([
      'card panel-chat-output', 'card panel-chat-settings', 'card panel-counter-output',
      'card panel-counter-settings', 'card panel-commands', 'card panel-obs',
    ]);
  });
});
