/*
 * PayPal Orders v2, server side only. Credentials come from the environment
 * (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) and never reach the browser.
 *
 * Live payments are refused unless GXUFY_PAYPAL_LIVE_APPROVED=1 is also set,
 * so a stray PAYPAL_ENV=live cannot start taking real money.
 */

export type PayPalEnv = 'sandbox' | 'live';

export type PayPalConfig = {
  env: PayPalEnv;
  apiBase: string;
  clientId: string;
  clientSecret: string;
  webhookId: string | null;
};

const API_BASE: Record<PayPalEnv, string> = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function paypalConfig(env: NodeJS.ProcessEnv = process.env): PayPalConfig | null {
  const clientId = env.PAYPAL_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
  if (!clientId || !clientSecret) return null;
  const mode = (env.PAYPAL_ENV?.trim().toLowerCase() || 'sandbox');
  if (mode !== 'sandbox' && mode !== 'live') return null;
  if (mode === 'live' && env.GXUFY_PAYPAL_LIVE_APPROVED !== '1') return null;
  return {
    env: mode,
    apiBase: API_BASE[mode],
    clientId,
    clientSecret,
    webhookId: env.PAYPAL_WEBHOOK_ID?.trim() || null,
  };
}

export class PayPalError extends Error {
  constructor(message: string, readonly status = 0, readonly issue = '') {
    super(message);
    this.name = 'PayPalError';
  }
}

/** PayPal's own error name / first issue code, for diagnostics (no secrets). */
function issueOf(body: unknown): string {
  if (!isRecord(body)) return '';
  const details = Array.isArray(body.details) && isRecord(body.details[0]) ? body.details[0] : null;
  const parts = [body.name, body.error, details?.issue, details?.field].filter((v) => typeof v === 'string');
  return parts.join(' ').slice(0, 200);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new PayPalError('PayPal response too large', response.status);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new PayPalError('PayPal returned invalid JSON', response.status);
  }
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Safe hints for fixing a key mix-up (dev error detail only): the env, the
 * Client ID's first characters (public anyway) and lengths. Never the secret.
 */
function credentialFingerprint(config: PayPalConfig): string {
  const odd = (v: string) => /["'\s]/.test(v);
  return `[${config.env}; client id ${config.clientId.slice(0, 6)}... (${config.clientId.length} chars${odd(config.clientId) ? ', has quotes/spaces' : ''}); secret ${config.clientSecret.length} chars${odd(config.clientSecret) ? ', has quotes/spaces' : ''}]`;
}

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export function __resetPayPalForTests(): void {
  tokenCache = null;
}

export async function paypalAccessToken(config: PayPalConfig): Promise<string> {
  const key = `${config.env}:${config.clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const response = await timedFetch(`${config.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await readJson(response) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!response.ok || typeof body?.access_token !== 'string') {
    throw new PayPalError('PayPal sign-in failed', response.status, `${issueOf(body)} ${credentialFingerprint(config)}`.trim());
  }
  const ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 300;
  tokenCache = { key, token: body.access_token, expiresAt: Date.now() + ttl * 1000 };
  return body.access_token;
}

async function api(
  config: PayPalConfig,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; requestId?: string },
): Promise<{ status: number; body: unknown }> {
  const token = await paypalAccessToken(config);
  const response = await timedFetch(`${config.apiBase}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      /* Same id = same result if we ever retry, so a payment is never doubled. */
      ...(init.requestId ? { 'PayPal-Request-Id': init.requestId } : {}),
      Prefer: 'return=representation',
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, body: await readJson(response) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const PAYPAL_ORDER_ID_RE = /^[A-Z0-9]{10,40}$/;

export type CreatedOrder = { id: string; approveUrl: string };

/**
 * Which PayPal button the buyer pressed on the support page (the JavaScript
 * SDK's fundingSource). Left out: the older redirect flow (send the buyer to
 * PayPal's page and back).
 */
export const SUPPORT_FUNDING_SOURCES = ['paypal', 'venmo', 'paylater', 'card'] as const;
export type SupportFundingSource = (typeof SUPPORT_FUNDING_SOURCES)[number];

export function isSupportFundingSource(value: unknown): value is SupportFundingSource {
  return typeof value === 'string' && (SUPPORT_FUNDING_SOURCES as readonly string[]).includes(value);
}

/**
 * The order's payment_source for the button pressed: PayPal and Pay Later go
 * through the PayPal wallet, Venmo through Venmo, and the card button needs
 * none (PayPal collects the card itself). Never a shipping address: the badge
 * is digital.
 */
function paymentSourceFor(
  fundingSource: SupportFundingSource | undefined,
  urls: { returnUrl: string; cancelUrl: string },
): Record<string, unknown> | undefined {
  if (fundingSource === 'card') return undefined;
  if (fundingSource === 'venmo') {
    return { venmo: { experience_context: { brand_name: 'FlossChat', shipping_preference: 'NO_SHIPPING' } } };
  }
  return {
    paypal: {
      experience_context: {
        brand_name: 'FlossChat',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: urls.returnUrl,
        cancel_url: urls.cancelUrl,
      },
    },
  };
}

/** The amount comes from the server's checked order ($5 or more), never straight from the browser. */
export async function createSupportOrder(
  config: PayPalConfig,
  input: {
    reference: string;
    amountCents: number;
    customId: string;
    description: string;
    returnUrl: string;
    cancelUrl: string;
    /** The button pressed on the page; left out for the redirect flow. */
    fundingSource?: SupportFundingSource;
  },
): Promise<CreatedOrder> {
  const value = (input.amountCents / 100).toFixed(2);
  const paymentSource = paymentSourceFor(input.fundingSource, input);
  const { status, body } = await api(config, '/v2/checkout/orders', {
    method: 'POST',
    requestId: `create-${input.reference}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: input.reference,
        custom_id: input.customId,
        description: input.description,
        amount: { currency_code: 'USD', value },
      }],
      ...(paymentSource ? { payment_source: paymentSource } : {}),
    },
  });
  if (status < 200 || status >= 300 || !isRecord(body) || typeof body.id !== 'string' || !PAYPAL_ORDER_ID_RE.test(body.id)) {
    throw new PayPalError('PayPal order could not be created', status, issueOf(body));
  }
  const links = Array.isArray(body.links) ? body.links : [];
  const approve = links.find((link) => isRecord(link) && (link.rel === 'payer-action' || link.rel === 'approve'));
  const href = isRecord(approve) && typeof approve.href === 'string' ? approve.href : '';
  /* The buttons approve inside PayPal's own window; only the redirect flow
     needs a page to send the buyer to. */
  if (!isPayPalCheckoutUrl(href)) {
    if (input.fundingSource) return { id: body.id, approveUrl: '' };
    throw new PayPalError('PayPal order had no approval link', status);
  }
  return { id: body.id, approveUrl: href };
}

/** Only send buyers to PayPal's own checkout pages. */
export function isPayPalCheckoutUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:'
      && (url.hostname === 'www.paypal.com' || url.hostname === 'www.sandbox.paypal.com');
  } catch {
    return false;
  }
}

export type CaptureResult = {
  orderStatus: string;
  captureId: string | null;
  captureStatus: string | null;
  amountValue: string | null;
  currency: string | null;
  customId: string | null;
  referenceId: string | null;
  payeeMerchantId: string | null;
};

function readCapture(body: unknown): CaptureResult {
  const order = isRecord(body) ? body : {};
  const unit = Array.isArray(order.purchase_units) && isRecord(order.purchase_units[0]) ? order.purchase_units[0] : {};
  const captures = isRecord(unit.payments) && Array.isArray(unit.payments.captures) ? unit.payments.captures : [];
  const capture = isRecord(captures[0]) ? captures[0] : {};
  const amount = isRecord(capture.amount) ? capture.amount : {};
  const payee = isRecord(unit.payee) ? unit.payee : {};
  const str = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    orderStatus: str(order.status) ?? '',
    captureId: str(capture.id),
    captureStatus: str(capture.status),
    amountValue: str(amount.value),
    currency: str(amount.currency_code),
    customId: str(capture.custom_id) ?? str(unit.custom_id),
    referenceId: str(unit.reference_id),
    payeeMerchantId: str(payee.merchant_id),
  };
}

export async function captureSupportOrder(config: PayPalConfig, orderId: string): Promise<CaptureResult> {
  const { status, body } = await api(config, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    requestId: `capture-${orderId}`,
    body: {},
  });
  /* Already captured (e.g. a refresh on the return page): read the order instead. */
  if (status === 422 && isRecord(body) && Array.isArray(body.details)
    && body.details.some((d) => isRecord(d) && d.issue === 'ORDER_ALREADY_CAPTURED')) {
    return getSupportOrder(config, orderId);
  }
  if (status < 200 || status >= 300) throw new PayPalError('PayPal capture failed', status, issueOf(body));
  return readCapture(body);
}

export async function getSupportOrder(config: PayPalConfig, orderId: string): Promise<CaptureResult> {
  const { status, body } = await api(config, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
  if (status < 200 || status >= 300) throw new PayPalError('PayPal order lookup failed', status);
  return readCapture(body);
}

export const PAYPAL_CAPTURE_ID_RE = /^[A-Z0-9]{10,40}$/;

/** What PayPal says about one captured payment now (COMPLETED, REFUNDED, ...). */
export type CaptureState = { captureId: string; status: string; reason: string | null };

/**
 * A capture's current status, straight from PayPal. Null when PayPal has no
 * such capture for this account (404).
 */
export async function getCaptureState(config: PayPalConfig, captureId: string): Promise<CaptureState | null> {
  if (!PAYPAL_CAPTURE_ID_RE.test(captureId)) throw new PayPalError('Not a PayPal capture id');
  const { status, body } = await api(config, `/v2/payments/captures/${encodeURIComponent(captureId)}`, { method: 'GET' });
  if (status === 404) return null;
  if (status < 200 || status >= 300 || !isRecord(body) || typeof body.status !== 'string') {
    throw new PayPalError('PayPal capture lookup failed', status, issueOf(body));
  }
  if (body.id !== captureId) throw new PayPalError('PayPal returned a different capture', status);
  const details = isRecord(body.status_details) ? body.status_details : {};
  return {
    captureId,
    status: body.status,
    reason: typeof details.reason === 'string' ? details.reason : null,
  };
}

/** Asks PayPal whether a webhook really came from PayPal. */
export async function verifyPayPalWebhook(
  config: PayPalConfig,
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
): Promise<boolean> {
  if (!config.webhookId) return false;
  const header = (name: string) => {
    const value = headers[name];
    return typeof value === 'string' ? value : '';
  };
  const payload = {
    auth_algo: header('paypal-auth-algo'),
    cert_url: header('paypal-cert-url'),
    transmission_id: header('paypal-transmission-id'),
    transmission_sig: header('paypal-transmission-sig'),
    transmission_time: header('paypal-transmission-time'),
    webhook_id: config.webhookId,
    webhook_event: event,
  };
  if (!payload.auth_algo || !payload.cert_url || !payload.transmission_id || !payload.transmission_sig || !payload.transmission_time) {
    return false;
  }
  const { status, body } = await api(config, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: payload,
  });
  return status === 200 && isRecord(body) && body.verification_status === 'SUCCESS';
}
