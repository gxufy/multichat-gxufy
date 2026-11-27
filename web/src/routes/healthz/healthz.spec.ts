import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetDrainForTests } from '@/lib/server/drain';
import { __resetPayPalRecheckForTests, startPayPalRechecks } from '@/lib/server/paypalRecheck';
import { GET } from './+server';

describe('/healthz', () => {
	let dir: string;
	const saved = { hold: process.env.FLOSSCHAT_HOLD_FILE, drain: process.env.FLOSSCHAT_DRAIN_FILE };

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'healthz-'));
		process.env.FLOSSCHAT_HOLD_FILE = join(dir, 'a.hold');
		process.env.FLOSSCHAT_DRAIN_FILE = join(dir, 'a.draining');
		__resetDrainForTests();
	});

	afterEach(() => {
		if (saved.hold === undefined) delete process.env.FLOSSCHAT_HOLD_FILE;
		else process.env.FLOSSCHAT_HOLD_FILE = saved.hold;
		if (saved.drain === undefined) delete process.env.FLOSSCHAT_DRAIN_FILE;
		else process.env.FLOSSCHAT_DRAIN_FILE = saved.drain;
		__resetDrainForTests();
		rmSync(dir, { recursive: true, force: true });
	});

	it('answers 200, uncached, while this copy takes visitors', async () => {
		const res = GET();
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ ok: true, status: 'ok', app: 'flosschat-web', paypalRecheck: false });
	});

	it('answers 503 "held" while the deploy has not checked this copy yet', async () => {
		writeFileSync(process.env.FLOSSCHAT_HOLD_FILE!, '');
		const res = GET();
		expect(res.status).toBe(503);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ ok: false, status: 'held', app: 'flosschat-web', paypalRecheck: false });
	});

	it('answers 503 "draining" once the deploy hands visitors to the other copy', async () => {
		writeFileSync(process.env.FLOSSCHAT_DRAIN_FILE!, '');
		const res = GET();
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ ok: false, status: 'draining', app: 'flosschat-web', paypalRecheck: false });
	});

	it('ignores a drain file left over from before this copy started', async () => {
		const file = process.env.FLOSSCHAT_DRAIN_FILE!;
		writeFileSync(file, '');
		const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
		utimesSync(file, old, old);
		const res = GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, status: 'ok', app: 'flosschat-web', paypalRecheck: false });
	});

	it('says whether this copy runs the PayPal check (the deploy checks it does)', async () => {
		try {
			startPayPalRechecks({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
			expect(await GET().json()).toMatchObject({ status: 'ok', paypalRecheck: true });
		} finally {
			__resetPayPalRecheckForTests();
		}
		expect(await GET().json()).toMatchObject({ paypalRecheck: false });
	});
});
