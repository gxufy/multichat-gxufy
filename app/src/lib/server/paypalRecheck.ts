/*
 * The server asks PayPal itself how its recent payments stand, so badges
 * follow PayPal even when PayPal's notices (the webhook) never arrive:
 *
 *   - A payment PayPal now reports refunded, reversed, declined or failed takes
 *     the badge back, exactly like the refund notice would (markReversed).
 *     Refunds made on PayPal's own website are caught too.
 *   - A payment that was still pending when the buyer came back grants once
 *     PayPal reports it completed, with the same checks as the return page.
 *
 * Only payments taken through this server are asked about, and only reads
 * (GET) are sent to PayPal. Every few minutes a handful of orders that are
 * due get checked, one per second: recent ones often, older ones less often,
 * and none after PayPal's 180-day refund window. A copy of the server that is
 * held or draining (during a deploy) asks nothing.
 *
 * Off when PayPal or the supporter store is not set up, under tests, or with
 * GXUFY_PAYPAL_RECHECK=off. The site's server starts it
 * (web/src/hooks.server.ts).
 */
import { isDraining, isHeld } from './drain';
import { PAYPAL_CAPTURE_ID_RE, PAYPAL_ORDER_ID_RE, PayPalError, getCaptureState, getSupportOrder, type CaptureState } from './paypal';
import { captureMatchesOrder, checkoutDeps, grantVerifiedCapture, type CheckoutDeps } from './supportCheckout';
import type { PayPalRecheckCandidate } from './supporterStore';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const PAYPAL_RECHECK_TICK_MS = 2 * MINUTE;
export const PAYPAL_RECHECK_PER_TICK = 10;
export const PAYPAL_RECHECK_GAP_MS = 1_000;
/** PayPal allows refunds for 180 days. */
export const PAYPAL_RECHECK_COMPLETED_DAYS = 180;
/** How long a payment that was still pending is followed. */
export const PAYPAL_RECHECK_PENDING_DAYS = 14;

/** Capture statuses after which the payment no longer stands. PayPal
    documents REFUNDED, PARTIALLY_REFUNDED, DECLINED and FAILED; DENIED and
    REVERSED are the names its notices use. Any refund takes the badge back,
    as the refund notice does. */
export const PAYPAL_REVOKING_STATUSES: ReadonlySet<string> = new Set([
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'FAILED',
  'DENIED',
  'REVERSED',
]);

/** How often an order is asked about again (ms), or null when no longer. */
export function recheckEvery(candidate: PayPalRecheckCandidate, now: number): number | null {
  if (candidate.status === 'completed') {
    const age = now - Date.parse(candidate.completedAt ?? '');
    if (!Number.isFinite(age)) return null;
    if (age < 2 * DAY) return 10 * MINUTE;
    if (age < 30 * DAY) return 6 * HOUR;
    if (age < PAYPAL_RECHECK_COMPLETED_DAYS * DAY) return DAY;
    return null;
  }
  const age = now - Date.parse(candidate.captureTriedAt ?? '');
  if (!Number.isFinite(age)) return null;
  if (age < 2 * DAY) return 10 * MINUTE;
  if (age < PAYPAL_RECHECK_PENDING_DAYS * DAY) return 3 * HOUR;
  return null;
}

/** When the order was last looked at: the last check, or else when the payment
    completed / was first tried (so nobody is asked about right away). */
function lastLook(candidate: PayPalRecheckCandidate): number {
  const at = candidate.checkedAt
    ?? (candidate.status === 'completed' ? candidate.completedAt : candidate.captureTriedAt);
  return Date.parse(at ?? '');
}

/**
 * Orders due now, at most `limit`, only PayPal orders. The most overdue for
 * its own schedule comes first (late by 2 of its 10-minute turns beats late by
 * a sixth of a day), so recent payments are never crowded out by old ones.
 */
export function dueForRecheck(candidates: PayPalRecheckCandidate[], now: number, limit: number): PayPalRecheckCandidate[] {
  return candidates
    .filter((candidate) => PAYPAL_ORDER_ID_RE.test(candidate.orderId)
      && (candidate.status === 'created' || PAYPAL_CAPTURE_ID_RE.test(candidate.captureId ?? '')))
    .map((candidate) => {
      const every = recheckEvery(candidate, now);
      const last = lastLook(candidate);
      return { candidate, overdue: every === null || !Number.isFinite(last) ? -1 : (now - last - every) / every };
    })
    .filter((item) => item.overdue >= 0)
    .sort((a, b) => b.overdue - a.overdue || a.candidate.orderId.localeCompare(b.candidate.orderId))
    .slice(0, Math.max(0, limit))
    .map((item) => item.candidate);
}

export type RecheckSummary = { checked: number; reversed: string[]; granted: string[]; failed: boolean };

type RecheckOptions = {
  now?: () => number;
  limit?: number;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  (timer as { unref?: () => void }).unref?.();
});

/**
 * Ask PayPal about the orders that are due. Stops at the first PayPal error
 * (that order is tried again next time), so an outage is never hammered.
 */
export async function runPayPalRecheck(deps: CheckoutDeps, options: RecheckOptions = {}): Promise<RecheckSummary> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const gapMs = options.gapMs ?? PAYPAL_RECHECK_GAP_MS;
  const log = options.log ?? ((message: string) => console.info(message));
  const start = now();
  const candidates = await deps.store.payPalRecheckCandidates(
    new Date(start - PAYPAL_RECHECK_COMPLETED_DAYS * DAY),
    new Date(start - PAYPAL_RECHECK_PENDING_DAYS * DAY),
  );
  const due = dueForRecheck(candidates, start, options.limit ?? PAYPAL_RECHECK_PER_TICK);
  const summary: RecheckSummary = { checked: 0, reversed: [], granted: [], failed: false };

  for (const [index, candidate] of due.entries()) {
    if (index > 0 && gapMs > 0) await sleep(gapMs);
    try {
      if (candidate.status === 'completed') {
        const state = await getCaptureState(deps.paypal, candidate.captureId!);
        if (state && PAYPAL_REVOKING_STATUSES.has(state.status)) {
          await deps.store.markReversed(candidate.captureId!);
          summary.reversed.push(candidate.orderId);
          log(`PayPal check: order ${candidate.orderId} is ${describe(state)} at PayPal; badge taken back.`);
        } else if (!state) {
          log(`PayPal check: PayPal has no capture ${candidate.captureId} (order ${candidate.orderId}); left as is.`);
        }
      } else {
        const stored = await deps.store.getOrder(candidate.orderId);
        if (stored?.status === 'created') {
          const result = await getSupportOrder(deps.paypal, candidate.orderId);
          if (result.captureStatus === 'COMPLETED' && captureMatchesOrder(result, stored)) {
            const completed = await grantVerifiedCapture(deps, candidate.orderId, result.captureId!);
            if (completed?.status === 'completed') {
              summary.granted.push(candidate.orderId);
              log(`PayPal check: order ${candidate.orderId} finished at PayPal; badge granted.`);
            }
          }
        }
      }
    } catch (error) {
      /* An order PayPal does not know: nothing to grant. It is asked about
         again only on its usual schedule, not on every round. */
      if (candidate.status === 'created' && error instanceof PayPalError && error.status === 404) {
        await deps.store.markPayPalChecked(candidate.orderId, new Date(now()));
        summary.checked += 1;
        continue;
      }
      summary.failed = true;
      log(`PayPal check stopped: ${error instanceof PayPalError ? `${error.message} (${error.status})` : 'PayPal could not be reached'}.`);
      break;
    }
    await deps.store.markPayPalChecked(candidate.orderId, new Date(now()));
    summary.checked += 1;
  }
  return summary;
}

function describe(state: CaptureState): string {
  return state.reason ? `${state.status} (${state.reason})` : state.status;
}

/* ------------------------------------------------------------------ */
/* The timer (one per server process, shared across its bundles)      */
/* ------------------------------------------------------------------ */

type RecheckTimer = { timer: ReturnType<typeof setInterval> | null; running: boolean };
const shared: RecheckTimer = ((globalThis as Record<string, unknown>).__flosschatPayPalRecheck ??= {
  timer: null,
  running: false,
}) as RecheckTimer;

export function payPalRecheckEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'test') return false;
  return (env.GXUFY_PAYPAL_RECHECK?.trim().toLowerCase() ?? '') !== 'off';
}

/** One round, unless this copy is held/draining, checkout is off, or a round is still running. */
export async function payPalRecheckTick(
  env: NodeJS.ProcessEnv = process.env,
  options: RecheckOptions = {},
): Promise<RecheckSummary | null> {
  if (shared.running || isHeld() || isDraining()) return null;
  const deps = checkoutDeps(env);
  if (!deps) return null;
  shared.running = true;
  try {
    return await runPayPalRecheck(deps, options);
  } catch (error) {
    console.error('PayPal check failed:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    shared.running = false;
  }
}

/** Whether this server process runs the checks (its timer is set). */
export function payPalRechecksRunning(): boolean {
  return shared.timer !== null;
}

/** Start the checks (called once when the server starts). */
export function startPayPalRechecks(env: NodeJS.ProcessEnv = process.env): boolean {
  if (shared.timer || !payPalRecheckEnabled(env)) return false;
  shared.timer = setInterval(() => { void payPalRecheckTick(env); }, PAYPAL_RECHECK_TICK_MS);
  (shared.timer as { unref?: () => void }).unref?.();
  return true;
}

export function __resetPayPalRecheckForTests(): void {
  if (shared.timer) clearInterval(shared.timer);
  shared.timer = null;
  shared.running = false;
}
