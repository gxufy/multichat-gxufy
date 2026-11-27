import { afterEach, describe, expect, it, vi } from 'vitest';
import { amountPlaces, isPayPalApprovalUrl, readCheckoutStatus, readMe, recipientHasBadge } from './checkout.ts';
import { paypalButtonSources, paypalButtonStyle, paypalSdkUrl } from './paypalSdk.ts';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('support checkout helpers', () => {
	it('only follows PayPal approval pages', () => {
		expect(isPayPalApprovalUrl('https://www.paypal.com/checkoutnow?token=X')).toBe(true);
		expect(isPayPalApprovalUrl('https://www.sandbox.paypal.com/checkoutnow?token=X')).toBe(true);
		expect(isPayPalApprovalUrl('http://www.paypal.com/x')).toBe(false);
		expect(isPayPalApprovalUrl('https://paypal.com.evil.example/x')).toBe(false);
		expect(isPayPalApprovalUrl(42)).toBe(false);
	});

	it('keys amount digits by place, so only a changed digit is new', () => {
		expect(amountPlaces('12')).toEqual([
			{ key: '2:1', char: '1' },
			{ key: '1:2', char: '2' }
		]);
		expect(amountPlaces('13').map((d) => d.key)).toEqual(['2:1', '1:3']);
		expect(amountPlaces('')).toEqual([{ key: '1:0', char: '0' }]);
	});

	it('reads the buyer and whether they already own the badge', async () => {
		vi.stubGlobal('fetch', async () =>
			json({ user: { id: '1', login: 'a', displayName: 'A', avatarUrl: 'https://x/y.png' }, badges: [{ id: 'supporter', owned: true }] })
		);
		expect(await readMe()).toEqual({
			ready: true,
			user: { id: '1', login: 'a', displayName: 'A', profileImageUrl: 'https://x/y.png', ownsBadge: true }
		});
		vi.stubGlobal('fetch', async () => json({ user: null }));
		expect(await readMe()).toEqual({ ready: true, user: null });
		vi.stubGlobal('fetch', async () => json({}, 503));
		expect(await readMe()).toEqual({ ready: false });
	});

	it('checks the public badge list for a gift recipient', async () => {
		vi.stubGlobal('fetch', async () => json([{ id: 'supporter', userIds: ['7'] }]));
		expect(await recipientHasBadge('7')).toBe(true);
		expect(await recipientHasBadge('8')).toBe(false);
		vi.stubGlobal('fetch', async () => json({ nope: true }));
		expect(await recipientHasBadge('7')).toBeNull();
		vi.stubGlobal('fetch', async () => {
			throw new Error('offline');
		});
		expect(await recipientHasBadge('7')).toBeNull();
	});

	it('reads whether checkout is ready and PayPal’s public client ID', async () => {
		vi.stubGlobal('fetch', async () =>
			json({ checkoutReady: true, paypal: { clientId: 'AbC-123_xyz-456', env: 'sandbox' } })
		);
		expect(await readCheckoutStatus()).toEqual({
			ready: true,
			paypalReady: true,
			stripe: false,
			founderSlotsLeft: null,
			paypal: { clientId: 'AbC-123_xyz-456', env: 'sandbox' }
		});
		vi.stubGlobal('fetch', async () => json({ checkoutReady: true, founderSlotsLeft: 37 }));
		expect((await readCheckoutStatus()).founderSlotsLeft).toBe(37);
		vi.stubGlobal('fetch', async () => json({ checkoutReady: true, founderSlotsLeft: -1 }));
		expect((await readCheckoutStatus()).founderSlotsLeft).toBeNull();
		vi.stubGlobal('fetch', async () => json({ checkoutReady: true, paypal: { clientId: 'x"><script>', env: 'sandbox' } }));
		expect((await readCheckoutStatus()).paypal).toBeNull();
		vi.stubGlobal('fetch', async () => json({ checkoutReady: false, stripe: true }));
		expect(await readCheckoutStatus()).toEqual({ ready: true, paypalReady: false, stripe: true, founderSlotsLeft: null, paypal: null });
		vi.stubGlobal('fetch', async () => json({ checkoutReady: false }));
		expect((await readCheckoutStatus()).ready).toBe(false);
		vi.stubGlobal('fetch', async () => json({ error: 'off' }, 404));
		expect((await readCheckoutStatus()).ready).toBe(false);
	});

	it('loads PayPal only from www.paypal.com, in US dollars, without Venmo, Pay Later or Credit', () => {
		const url = new URL(paypalSdkUrl('AbC-123', { cards: true }));
		expect(url.origin).toBe('https://www.paypal.com');
		expect(url.pathname).toBe('/sdk/js');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			'client-id': 'AbC-123',
			currency: 'USD',
			intent: 'capture',
			components: 'buttons',
			'disable-funding': 'venmo,paylater,credit'
		});
		expect(new URL(paypalSdkUrl('AbC-123', { cards: false })).searchParams.get('disable-funding')).toBe(
			'venmo,paylater,credit,card'
		);
	});

	it('shows PayPal Buy Now in gold, and PayPal’s card button only while Stripe is off', () => {
		expect(paypalButtonSources({ cards: false })).toEqual(['paypal']);
		expect(paypalButtonSources({ cards: true })).toEqual(['paypal', 'card']);
		expect(paypalButtonStyle('paypal')).toMatchObject({ color: 'gold', label: 'buynow', shape: 'pill', height: 48 });
		expect(paypalButtonStyle('card')).toMatchObject({ color: 'black', shape: 'pill', height: 48 });
	});
});
