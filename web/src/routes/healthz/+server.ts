import { json } from '@sveltejs/kit';
import { isDraining, isHeld } from '@/lib/server/drain';
import { payPalRechecksRunning } from '@/lib/server/paypalRecheck';

/*
 * Health check for Caddy and the release script: 200 while this copy can
 * take visitors. During a deploy's
 * handover it answers 503 instead, so Caddy sends visitors to the other copy
 * (this slot's signal files, app/src/lib/server/drain):
 * "held" while a new copy is running but not yet checked, "draining" while an
 * old copy is about to stop. Never cached. `paypalRecheck` says whether this
 * copy runs the PayPal check (the deploy checks that it does).
 */
export function GET() {
	const status = isDraining() ? 'draining' : isHeld() ? 'held' : 'ok';
	return json(
		{ ok: status === 'ok', status, app: 'flosschat-web', paypalRecheck: payPalRechecksRunning() },
		{ status: status === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
}
