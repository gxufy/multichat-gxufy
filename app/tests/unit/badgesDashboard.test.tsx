import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/multichat/previewIdentityClient', () => ({
  acquirePreviewIdentity: () => ({
    promise: new Promise(() => {}),
    enrichment: new Promise(() => {}),
    release: () => {},
  }),
}));

import BadgesDashboard, { parseGivenBadges, parseMe } from '@/components/badges/BadgesDashboard';

const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
const badge = (owned: boolean, worn: boolean) => ({ id: 'supporter', title: 'FlossChat', url: '/badges/gxufy/supporter-hand.webp', owned, worn });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let wearResponse: () => Response = () => json({ worn: false });
let givenList: unknown[] = [];
const posts: unknown[] = [];

function mockMe(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/me') return json(body, status);
    if (url === '/api/badges/wear') {
      posts.push(JSON.parse(String(init?.body)));
      return wearResponse();
    }
    if (url === '/api/auth/logout') return new Response(null, { status: 204 });
    if (url === '/api/badges/give') {
      if (init?.method !== 'POST') return json({ given: givenList });
      const sent = JSON.parse(String(init.body)) as { login?: string; takeBack?: string };
      posts.push({ give: sent });
      if (sent.takeBack) return json({ takenBack: true });
      if (sent.login === 'nobodyhere') return json({ error: 'No Twitch account found.' }, 404);
      return json({ given: { id: '777', login: sent.login, displayName: 'TestViewer', givenAt: '2026-11-18T13:00:00.000Z' } });
    }
    if (url === '/api/overlay/refresh' && init?.method === 'POST') {
      if (init.body) {
        const target = JSON.parse(String(init.body));
        posts.push({ refresh: target });
        return json({ target: { ...target, at: 1 } });
      }
      posts.push('refresh');
      return json({ token: 1 });
    }
    return json({}, 404);
  }));
}

beforeEach(() => {
  posts.length = 0;
  givenList = [];
  wearResponse = () => json({ worn: false });
  window.history.replaceState(null, '', '/badges');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/badges', () => {
  it('asks a signed-out visitor to sign in with Twitch and come back here', async () => {
    mockMe({ signInReady: true, user: null, badges: [] });
    render(<BadgesDashboard />);
    const link = await screen.findByRole('link', { name: /Sign in with Twitch/ });
    expect(link.getAttribute('href')).toBe('/api/auth/twitch/login?next=%2Fbadges');
  });

  it('wears and takes off the badge with one click, saving straight away', async () => {
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)] });
    render(<BadgesDashboard />);
    const tile = await screen.findByRole('button', { name: /FlossChat/ });
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByAltText('FlossChat Supporter')).toBeTruthy();

    await act(async () => { fireEvent.click(tile); });
    expect(posts).toEqual([{ badgeId: 'supporter', worn: false }]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'));
    expect(tile.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByAltText('FlossChat Supporter')).toBeNull();
  });

  it('puts the badge back if saving fails', async () => {
    wearResponse = () => json({ error: 'nope' }, 503);
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)] });
    render(<BadgesDashboard />);
    const tile = await screen.findByRole('button', { name: /FlossChat/ });
    await act(async () => { fireEvent.click(tile); });
    await waitFor(() => expect(screen.getByText('Could not save')).toBeTruthy());
    expect(tile.getAttribute('aria-pressed')).toBe('true');
  });

  it('points a signed-in visitor without the badge to the $5 support page', async () => {
    mockMe({ signInReady: true, user: { id: '555', login: 'viewer', displayName: 'Viewer' }, badges: [badge(false, false)] });
    render(<BadgesDashboard />);
    const link = await screen.findByRole('link', { name: /Get it from \$5/ });
    expect(link.getAttribute('href')).toBe('/support');
  });

  it('in the popup, "Get it from $5" switches to the Support popup and says why', async () => {
    mockMe({ signInReady: true, user: { id: '555', login: 'viewer', displayName: 'Viewer' }, badges: [badge(false, false)] });
    const onGetBadge = vi.fn();
    render(<BadgesDashboard variant="modal" onGetBadge={onGetBadge} />);
    const tile = await screen.findByRole('button', { name: /Get it from \$5/ });
    expect(screen.getByText(/don.t have this badge yet/)).toBeTruthy();
    expect(screen.getByText(/goes to @viewer/)).toBeTruthy();
    fireEvent.click(tile);
    expect(onGetBadge).toHaveBeenCalledTimes(1);
    expect(posts).toEqual([]);
  });

  it('explains a failed sign-in and cleans the URL', async () => {
    window.history.replaceState(null, '', '/badges?signin=failed');
    mockMe({ signInReady: true, user: null, badges: [] });
    render(<BadgesDashboard />);
    expect(await screen.findByText('Sign-in did not work. Please try again.')).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('shows owner tools only to the owner, and refresh-all fires on one click', async () => {
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)], owner: true });
    render(<BadgesDashboard />);
    const button = await screen.findByRole('button', { name: 'Refresh all overlays' });
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(posts).toEqual(['refresh']));
    expect(await screen.findByText('Sent. Every open overlay is reloading now.')).toBeTruthy();
  });

  it('lets the owner refresh one channel, any platform or a chosen one', async () => {
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)], owner: true });
    render(<BadgesDashboard />);
    const name = await screen.findByLabelText('Channel name');
    const send = screen.getByRole('button', { name: 'Refresh this channel' });

    /* Nothing typed: nothing sent. */
    await act(async () => { fireEvent.click(send); });
    expect(posts).toEqual([]);
    expect(await screen.findByText('Enter a channel name first.')).toBeTruthy();

    fireEvent.change(name, { target: { value: '@PlaqueBoyMax' } });
    await act(async () => { fireEvent.click(send); });
    await waitFor(() => expect(posts).toEqual([{ refresh: { platform: 'any', channel: 'PlaqueBoyMax' } }]));
    expect(await screen.findByText('Sent. Overlays showing PlaqueBoyMax are reloading now.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'youtube' } });
    fireEvent.change(name, { target: { value: 'plaqueboymaxlive' } });
    await act(async () => { fireEvent.click(send); });
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ refresh: { platform: 'youtube', channel: 'plaqueboymaxlive' } });
    expect(await screen.findByText('Sent. Overlays showing plaqueboymaxlive on YouTube are reloading now.')).toBeTruthy();
  });

  it('lets the owner search for a command and run it on one channel', async () => {
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)], owner: true });
    render(<BadgesDashboard />);
    const search = await screen.findByLabelText('Search commands');
    const list = screen.getByRole('list', { name: 'Commands' });
    const shown = () => Array.from(list.querySelectorAll('button code')).map((code) => code.textContent);

    /* Everything but the streamer's own permits is offered. */
    expect(shown()).toContain('reload');
    expect(shown()).toContain('tts');
    expect(shown()).not.toContain('permit');

    fireEvent.change(search, { target: { value: '!flosschat tt' } });
    expect(shown()).toEqual(['tts']);
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByText('No command matches.')).toBeTruthy();

    /* A command that needs details will not send without them. */
    fireEvent.change(search, { target: { value: 'tts' } });
    fireEvent.click(screen.getByRole('button', { name: /^tts/ }));
    fireEvent.change(screen.getByLabelText('Command channel name'), { target: { value: '#PlaqueBoyMax' } });
    const run = screen.getByRole('button', { name: 'Run command' });
    await act(async () => { fireEvent.click(run); });
    expect(posts).toEqual([]);
    expect(await screen.findByText('!flosschat tts needs <message>.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Command details'), { target: { value: 'hello chat' } });
    await act(async () => { fireEvent.click(run); });
    await waitFor(() => expect(posts).toEqual([{ refresh: { platform: 'any', channel: 'PlaqueBoyMax', command: 'tts hello chat' } }]));
    expect(await screen.findByText('Sent. Overlays showing PlaqueBoyMax are running !flosschat tts hello chat now.')).toBeTruthy();

    /* One with no details, on a chosen platform. */
    fireEvent.change(search, { target: { value: 'reload' } });
    fireEvent.click(screen.getByRole('button', { name: /^reload/ }));
    expect(screen.queryByLabelText('Command details')).toBeNull();
    fireEvent.change(screen.getByLabelText('Command platform'), { target: { value: 'kick' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run command' })); });
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual({ refresh: { platform: 'kick', channel: 'PlaqueBoyMax', command: 'reload' } });
    expect(await screen.findByText('Sent. Overlays showing PlaqueBoyMax on Kick are running !flosschat reload now.')).toBeTruthy();
  });

  it('asks for a channel before running a command', async () => {
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)], owner: true });
    render(<BadgesDashboard />);
    await screen.findByLabelText('Search commands');
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'clear' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run command' })); });
    expect(posts).toEqual([]);
    expect((await screen.findAllByText('Enter a channel name first.')).length).toBeGreaterThan(0);
  });

  it('lets the owner give a badge for free and take it back', async () => {
    givenList = [{ id: '42', login: 'earlier', displayName: 'Earlier', givenAt: '2026-11-17T12:00:00.000Z' }];
    mockMe({ signInReady: true, user: OWNER, badges: [badge(true, true)], owner: true });
    render(<BadgesDashboard />);
    const name = await screen.findByLabelText('Give to (Twitch username)');
    expect(await screen.findByText('Earlier')).toBeTruthy();
    const give = screen.getByRole('button', { name: 'Give badge' });

    await act(async () => { fireEvent.click(give); });
    expect(posts).toEqual([]);
    expect(await screen.findByText('Enter a Twitch username first.')).toBeTruthy();

    fireEvent.change(name, { target: { value: 'nobodyhere' } });
    await act(async () => { fireEvent.click(give); });
    expect(await screen.findByText('No Twitch account found.')).toBeTruthy();

    fireEvent.change(name, { target: { value: '@testviewer' } });
    await act(async () => { fireEvent.click(give); });
    await waitFor(() => expect(posts.at(-1)).toEqual({ give: { login: 'testviewer' } }));
    expect(await screen.findByText('Given. TestViewer has the badge now; overlays show it within about 15 seconds.')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Badges given' });
    expect(Array.from(list.querySelectorAll('strong')).map((el) => el.textContent)).toEqual(['TestViewer', 'Earlier']);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take back from earlier' })); });
    await waitFor(() => expect(posts.at(-1)).toEqual({ give: { takeBack: '42' } }));
    expect(await screen.findByText('Taken back from Earlier.')).toBeTruthy();
    expect(Array.from(list.querySelectorAll('strong')).map((el) => el.textContent)).toEqual(['TestViewer']);
  });

  it('parses only well-formed given badges', () => {
    expect(parseGivenBadges(null)).toEqual([]);
    expect(parseGivenBadges({ given: 'x' })).toEqual([]);
    expect(parseGivenBadges({ given: [{ id: '1', login: 'a', displayName: 'A', givenAt: 'd' }, { id: 2 }, null] }))
      .toEqual([{ id: '1', login: 'a', displayName: 'A', givenAt: 'd' }]);
  });

  it('never shows owner tools to anyone else', async () => {
    mockMe({ signInReady: true, user: { id: '555', login: 'viewer', displayName: 'Viewer' }, badges: [badge(false, false)] });
    render(<BadgesDashboard />);
    await screen.findByText('@viewer');
    expect(screen.queryByRole('button', { name: 'Refresh all overlays' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh this channel' })).toBeNull();
    expect(screen.queryByLabelText('Search commands')).toBeNull();
    expect(screen.queryByLabelText('Give to (Twitch username)')).toBeNull();
  });

  it('parses only well-formed answers', () => {
    expect(parseMe(null).kind).toBe('unavailable');
    expect(parseMe({ user: null }).kind).toBe('signed-out');
    expect(parseMe({ user: { id: 1 } }).kind).toBe('unavailable');
    const ok = parseMe({ user: OWNER, badges: [badge(true, false), { id: 'x' }] });
    expect(ok.kind === 'signed-in' && ok.badges.length).toBe(1);
  });
});
