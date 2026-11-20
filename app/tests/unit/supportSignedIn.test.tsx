import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupportCheckout from '@/components/support/SupportCheckout';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const checkoutBodies: unknown[] = [];

function mockServer(user: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/auth/me') return json({ signInReady: true, user, badges: [] });
    if (url === '/api/support/checkout') {
      checkoutBodies.push(JSON.parse(String(init?.body)));
      return json({ error: 'Stopped in test.' }, 503);
    }
    if (url.startsWith('/api/twitch/support-user')) return json({ id: '555', login: 'viewer', displayName: 'Viewer' });
    return json({}, 404);
  }));
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('off in test'); } });
}

beforeEach(() => {
  checkoutBodies.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('support page with Twitch sign-in', () => {
  it('signed in: "For you" sends the badge to the signed-in account', async () => {
    mockServer({ id: '555', login: 'viewer', displayName: 'Viewer' });
    render(<SupportCheckout checkoutReady />);
    expect(await screen.findByText('@viewer')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'For you' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByLabelText('Twitch username')).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with $5' })); });
    await waitFor(() => expect(checkoutBodies).toEqual([{ forSelf: true, amountCents: 500 }]));
  });

  it('never sends less than $5: a smaller amount cannot even be typed', async () => {
    mockServer({ id: '555', login: 'viewer', displayName: 'Viewer' });
    render(<SupportCheckout checkoutReady />);
    expect(await screen.findByText('@viewer')).toBeTruthy();
    const amount = screen.getByRole('textbox', { name: 'Support amount in US dollars ($5 or more)' });
    fireEvent.change(amount, { target: { value: '2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with $5' })); });
    await waitFor(() => expect(checkoutBodies).toEqual([{ forSelf: true, amountCents: 500 }]));
    expect((amount as HTMLInputElement).value).toBe('5');
  });

  it('sends the amount typed when it is $5 or more', async () => {
    mockServer({ id: '555', login: 'viewer', displayName: 'Viewer' });
    render(<SupportCheckout checkoutReady />);
    expect(await screen.findByText('@viewer')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Support amount in US dollars ($5 or more)' }), { target: { value: '12.5' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue with $12.50' })); });
    await waitFor(() => expect(checkoutBodies).toEqual([{ forSelf: true, amountCents: 1250 }]));
  });

  it('signed in: "As a gift" brings back the name field', async () => {
    mockServer({ id: '555', login: 'viewer', displayName: 'Viewer' });
    render(<SupportCheckout checkoutReady />);
    fireEvent.click(await screen.findByRole('radio', { name: 'As a gift' }));
    expect(screen.getByLabelText('Twitch username')).toBeTruthy();
    expect(screen.getByText(/Gift to/)).toBeTruthy();
  });

  it('signed out: only offers Twitch sign-in, no way to pay', async () => {
    mockServer(null);
    render(<SupportCheckout checkoutReady />);
    const link = await screen.findByRole('link', { name: 'Sign in with Twitch' });
    expect(link.getAttribute('href')).toBe('/api/auth/twitch/login?next=%2Fsupport');
    expect(screen.queryByLabelText('Twitch username')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'For you' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue with $5' })).toBeNull();
  });

  it('signed out in the generator popup: sign-in comes back with the popup open', async () => {
    mockServer(null);
    render(<SupportCheckout checkoutReady variant="modal" />);
    const link = await screen.findByRole('link', { name: 'Sign in with Twitch' });
    expect(link.getAttribute('href')).toBe(
      `/api/auth/twitch/login?next=${encodeURIComponent(`${window.location.pathname}?support=1`)}`,
    );
  });
});
