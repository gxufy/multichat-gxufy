/*
 * PayPal's JavaScript SDK (v5, "Buttons"), loaded only on the support page and
 * only from www.paypal.com. The client ID is public; the server holds the
 * secret and creates and captures every order.
 */

export type PayPalFundingSource = 'paypal' | 'venmo' | 'paylater' | 'card';

export type PayPalButtonsActions = {
	enable(): unknown;
	disable(): unknown;
	reject?(): unknown;
	resolve?(): unknown;
};

export type PayPalButtonsOptions = {
	/** One button for this way to pay (a "standalone" button). */
	fundingSource?: PayPalFundingSource;
	style?: Record<string, string | number | boolean>;
	onInit?(data: unknown, actions: PayPalButtonsActions): void;
	onClick?(data: { fundingSource?: string }, actions: PayPalButtonsActions): unknown;
	createOrder(): Promise<string>;
	onApprove(data: { orderID?: string }): Promise<void> | void;
	onCancel?(data: unknown): void;
	onError?(error: unknown): void;
};

export type PayPalButtonsInstance = {
	isEligible?(): boolean;
	render(container: HTMLElement): Promise<void>;
	close?(): Promise<void> | void;
};

export type PayPalNamespace = {
	Buttons(options: PayPalButtonsOptions): PayPalButtonsInstance;
};

const SDK_ORIGIN = 'https://www.paypal.com';
const LOAD_TIMEOUT_MS = 15_000;

/** The SDK address: US dollars, pay now, and only the ways to pay the page
    shows, like Chatlee: PayPal (Buy Now), plus PayPal's card button only
    while Stripe doesn't take cards. No Venmo, Pay Later or PayPal Credit. */
export function paypalSdkUrl(clientId: string, options: { cards: boolean }): string {
	const params = new URLSearchParams({
		'client-id': clientId,
		currency: 'USD',
		intent: 'capture',
		components: 'buttons',
		'disable-funding': options.cards ? 'venmo,paylater,credit' : 'venmo,paylater,credit,card'
	});
	return `${SDK_ORIGIN}/sdk/js?${params}`;
}

/** The buttons the page shows, top to bottom after the Stripe button. */
export function paypalButtonSources(options: { cards: boolean }): PayPalFundingSource[] {
	return options.cards ? ['paypal', 'card'] : ['paypal'];
}

/** PayPal gold "PayPal Buy Now", and the card button in black (PayPal
    allows only black or white for it); pills, like the page's buttons. */
export function paypalButtonStyle(source: PayPalFundingSource): Record<string, string | number> {
	return source === 'paypal'
		? { layout: 'vertical', color: 'gold', shape: 'pill', label: 'buynow', height: 48 }
		: { layout: 'vertical', color: 'black', shape: 'pill', height: 48 };
}

let loading: { url: string; promise: Promise<PayPalNamespace> } | null = null;

/** Adds the SDK script once (per address) and resolves with window.paypal. */
export function loadPayPalSdk(clientId: string, options: { cards: boolean }): Promise<PayPalNamespace> {
	const url = paypalSdkUrl(clientId, options);
	if (loading?.url === url) return loading.promise;
	const promise = new Promise<PayPalNamespace>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = url;
		script.async = true;
		script.dataset.flosschatPaypal = '';
		const timer = window.setTimeout(() => fail(new Error('PayPal took too long to load')), LOAD_TIMEOUT_MS);
		function fail(error: Error) {
			window.clearTimeout(timer);
			script.remove();
			if (loading?.promise === promise) loading = null;
			reject(error);
		}
		script.onload = () => {
			window.clearTimeout(timer);
			const paypal = (window as unknown as { paypal?: PayPalNamespace }).paypal;
			if (paypal && typeof paypal.Buttons === 'function') resolve(paypal);
			else fail(new Error('PayPal did not start'));
		};
		script.onerror = () => fail(new Error('PayPal could not load'));
		document.head.append(script);
	});
	loading = { url, promise };
	return promise;
}
