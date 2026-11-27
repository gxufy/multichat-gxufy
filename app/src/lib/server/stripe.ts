/*
 * Stripe Checkout for the supporter badge (cards, Apple Pay, Google Pay), next
 * to PayPal. Plain HTTPS calls to Stripe's API, no SDK.
 *
 * Settings (server env only, never sent to the browser):
 *   STRIPE_SECRET_KEY        sk_test_/rk_test_ (sandbox) or sk_live_/rk_live_.
 *                            A restricted key (rk_) with Checkout Sessions
 *                            write and read is enough.
 *   STRIPE_ENV               sandbox | live: only that kind of key works
 *                            (production sets live).
 *   STRIPE_WEBHOOK_SECRET    whsec_..., from the webhook endpoint in Stripe
 *                            (https://flosschat.app/api/support/stripe-webhook).
 *   STRIPE_PRODUCT_ID        Optional prod_... made in the Stripe Dashboard
 *                            (name, tax code). Without it the product is
 *                            described inline, with STRIPE_BADGE_TAX_CODE.
 *   STRIPE_MANAGED_PAYMENTS  On unless 0: Stripe, through Link, is the
 *                            merchant of record. Buyers see "Sold through
 *                            Link", Link sends the receipts, and the price
 *                            includes any sales tax. Managed Payments must be
 *                            on in the Dashboard. 0 = plain Stripe: the
 *                            account itself is the seller, and Stripe's
 *                            receipts show its legal name and support address.
 *                            Sandbox only: a live key always needs Managed
 *                            Payments, or card checkout stays off.
 *   GXUFY_STRIPE_LIVE_APPROVED  1 = allow a live key. Without it only sandbox
 *                            keys work, like PayPal.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const API_BASE = 'https://api.stripe.com/v1';
const REQUEST_TIMEOUT_MS = 8_000;
/* Stripe's default: a signed event older than this is refused (replay). */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Tax category of an inline badge product (General - Electronically Supplied
 * Services), one Managed Payments accepts. A Dashboard product
 * (STRIPE_PRODUCT_ID) brings its own tax code instead.
 */
export const STRIPE_BADGE_TAX_CODE = 'txcd_10000000';

export const STRIPE_SESSION_ID_RE = /^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/;
const PAYMENT_INTENT_ID_RE = /^pi_[A-Za-z0-9]{10,100}$/;

export type StripeConfig = {
  env: 'sandbox' | 'live';
  secretKey: string;
  webhookSecret: string | null;
  productId: string | null;
  managedPayments: boolean;
};

export function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? '';
  const mode = /^(?:sk|rk)_test_[A-Za-z0-9]{10,}$/.test(secretKey)
    ? 'sandbox'
    : /^(?:sk|rk)_live_[A-Za-z0-9]{10,}$/.test(secretKey)
      ? 'live'
      : null;
  if (!mode) return null;
  /* STRIPE_ENV pins the mode (production sets live): a key of the other kind
     is refused, so sandbox payments can never grant badges on the live site. */
  const pinned = env.STRIPE_ENV?.trim().toLowerCase();
  if (pinned && pinned !== mode) return null;
  if (mode === 'live' && env.GXUFY_STRIPE_LIVE_APPROVED !== '1') return null;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  const productId = env.STRIPE_PRODUCT_ID?.trim() ?? '';
  const managedPayments = !['0', 'false', 'off'].includes(env.STRIPE_MANAGED_PAYMENTS?.trim().toLowerCase() ?? '');
  /* Live payments only through Managed Payments, so real receipts never carry
     the account's legal name or support address. */
  if (mode === 'live' && !managedPayments) return null;
  return {
    env: mode,
    secretKey,
    webhookSecret: /^whsec_[A-Za-z0-9]{10,}$/.test(webhookSecret) ? webhookSecret : null,
    productId: /^prod_[A-Za-z0-9]{6,}$/.test(productId) ? productId : null,
    managedPayments,
  };
}

export class StripeError extends Error {
  constructor(message: string, readonly status = 0, readonly code = '', readonly stripeMessage = '') {
    super(message);
    this.name = 'StripeError';
  }
}

/**
 * Why a Stripe call failed, for the server log (and the page, under `npm run
 * dev` only): our step, Stripe's HTTP status and code, and Stripe's own error
 * text. Anything shaped like a key is masked, even Stripe's own "sk_test_***1234".
 */
export function describeStripeError(error: unknown): string {
  if (error instanceof StripeError) {
    const status = error.status ? ` (HTTP ${error.status}${error.code ? ` ${error.code}` : ''})` : '';
    return `${error.message}${status}${error.stripeMessage ? `: ${error.stripeMessage}` : ''}`;
  }
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'Stripe did not answer in time';
  }
  return 'could not reach Stripe';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stripe's form encoding: nested keys as a[b][c]=value. */
export function stripeForm(params: Record<string, unknown>, prefix = ''): URLSearchParams {
  const form = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item));
    } else if (isRecord(value)) {
      for (const [inner, innerValue] of Object.entries(value)) add(`${key}[${inner}]`, innerValue);
    } else {
      form.append(key, String(value));
    }
  };
  for (const [key, value] of Object.entries(params)) add(prefix ? `${prefix}[${key}]` : key, value);
  return form;
}

async function api(
  config: StripeConfig,
  path: string,
  init: { method: 'GET' | 'POST'; form?: URLSearchParams; idempotencyKey?: string },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.secretKey}` };
  if (init.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers,
    ...(init.form ? { body: init.form.toString() } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function errorCode(body: unknown): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  return typeof error.code === 'string' ? error.code : typeof error.type === 'string' ? error.type : '';
}

/** Stripe's own error text, one line, keys masked. */
function errorMessage(body: unknown): string {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  if (typeof error.message !== 'string') return '';
  return error.message
    .replace(/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, '[key]')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Only ever send buyers to Stripe's own hosted checkout. */
export function isStripeCheckoutUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
  } catch {
    return false;
  }
}

export type CreatedStripeCheckout = { id: string; url: string };

/** A one-time Checkout Session for exactly the amount this server set. */
export async function createStripeCheckout(
  config: StripeConfig,
  input: {
    reference: string;
    amountCents: number;
    recipientId: string | null;
    kind: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<CreatedStripeCheckout> {
  const metadata = {
    reference: input.reference,
    recipient_id: input.recipientId ?? '',
    kind: input.kind,
  };
  const form = stripeForm({
    mode: 'payment',
    client_reference_id: input.reference,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: input.amountCents,
        /* The buyer pays exactly the amount on our page. With Managed Payments
           any sales tax comes out of that amount instead of on top of it. */
        ...(config.managedPayments ? { tax_behavior: 'inclusive' } : {}),
        ...(config.productId
          ? { product: config.productId }
          : {
              product_data: {
                name: input.description,
                ...(config.managedPayments ? { tax_code: STRIPE_BADGE_TAX_CODE } : {}),
              },
            }),
      },
    }],
    metadata,
    payment_intent_data: { description: input.description, metadata },
    /* Plain Stripe turns both off: accounts that ticked "Simplify digital
       sales" get Managed Payments by default, and Stripe then refuses
       automatic_tax=false unless it is off here too. Managed Payments handles
       tax itself and refuses automatic_tax. */
    ...(config.managedPayments
      ? { managed_payments: { enabled: true } }
      : { managed_payments: { enabled: false }, automatic_tax: { enabled: false } }),
  });
  const { status, body } = await api(config, '/checkout/sessions', {
    method: 'POST',
    form,
    idempotencyKey: `create-${input.reference}`,
  });
  if (status < 200 || status >= 300 || !isRecord(body) || typeof body.id !== 'string' || !STRIPE_SESSION_ID_RE.test(body.id)) {
    throw new StripeError('Stripe checkout could not be created', status, errorCode(body), errorMessage(body));
  }
  if (!isStripeCheckoutUrl(body.url)) throw new StripeError('Stripe checkout had no payment page', status);
  return { id: body.id, url: body.url };
}

export type StripeCheckoutResult = {
  id: string;
  /** 'complete' once the buyer finished; 'open'; 'expired'. */
  status: string;
  /** 'paid' only when the money is in (async methods start as 'unpaid'). */
  paymentStatus: string;
  /** Before discounts and added tax; an included tax is part of it. */
  amountSubtotal: number | null;
  /** What the buyer paid, in `currency`. */
  amountTotal: number | null;
  currency: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  paymentIntentId: string | null;
  livemode: boolean;
};

export function readStripeCheckout(body: unknown): StripeCheckoutResult | null {
  if (!isRecord(body) || typeof body.id !== 'string' || !STRIPE_SESSION_ID_RE.test(body.id)) return null;
  const str = (value: unknown) => (typeof value === 'string' ? value : null);
  const metadata: Record<string, string> = {};
  if (isRecord(body.metadata)) {
    for (const [key, value] of Object.entries(body.metadata)) if (typeof value === 'string') metadata[key] = value;
  }
  const intent = typeof body.payment_intent === 'string'
    ? body.payment_intent
    : isRecord(body.payment_intent) && typeof body.payment_intent.id === 'string' ? body.payment_intent.id : null;
  return {
    id: body.id,
    status: str(body.status) ?? '',
    paymentStatus: str(body.payment_status) ?? '',
    amountSubtotal: typeof body.amount_subtotal === 'number' ? body.amount_subtotal : null,
    amountTotal: typeof body.amount_total === 'number' ? body.amount_total : null,
    currency: str(body.currency),
    clientReferenceId: str(body.client_reference_id),
    metadata,
    paymentIntentId: intent && PAYMENT_INTENT_ID_RE.test(intent) ? intent : null,
    livemode: body.livemode === true,
  };
}

/** Reads a Checkout Session from Stripe (never trusted from the browser). */
export async function getStripeCheckout(config: StripeConfig, sessionId: string): Promise<StripeCheckoutResult> {
  const { status, body } = await api(config, `/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
  const session = status >= 200 && status < 300 ? readStripeCheckout(body) : null;
  if (!session) throw new StripeError('Stripe checkout lookup failed', status, errorCode(body), errorMessage(body));
  return session;
}

/**
 * Checks a Stripe-Signature header (t=...,v1=...) against the raw body:
 * HMAC-SHA256 of "t.body" with the endpoint's signing secret, within five
 * minutes of now.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2).map((item) => item.trim());
    if (key === 't' && value) timestamp = value;
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex'), 'utf8');
  return signatures.some((signature) => {
    const given = Buffer.from(signature, 'utf8');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
