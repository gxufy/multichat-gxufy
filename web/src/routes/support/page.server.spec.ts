import { afterEach, describe, expect, it } from 'vitest';
import { load as supportLoad } from './+page.server.ts';
import { load as badgesLoad } from '../badges/+page.server.ts';
import { load as termsLoad } from './terms/+page.server.ts';

const original = process.env.GXUFY_SUPPORT_PAGE_ENABLED;

afterEach(() => {
	if (original === undefined) delete process.env.GXUFY_SUPPORT_PAGE_ENABLED;
	else process.env.GXUFY_SUPPORT_PAGE_ENABLED = original;
});

describe('/support and /badges stay private until switched on', () => {
	for (const [name, load] of [
		['/support', supportLoad],
		['/badges', badgesLoad],
		['/support/terms', termsLoad]
	] as const) {
		it(`${name}: 404 without GXUFY_SUPPORT_PAGE_ENABLED=1`, () => {
			delete process.env.GXUFY_SUPPORT_PAGE_ENABLED;
			expect(() => (load as (e: unknown) => unknown)({ setHeaders: () => {} })).toThrow(
				expect.objectContaining({ status: 404 })
			);
			process.env.GXUFY_SUPPORT_PAGE_ENABLED = '0';
			expect(() => (load as (e: unknown) => unknown)({ setHeaders: () => {} })).toThrow(
				expect.objectContaining({ status: 404 })
			);
		});

		it(`${name}: shown with the flag on`, () => {
			process.env.GXUFY_SUPPORT_PAGE_ENABLED = '1';
			const headers: Record<string, string> = {};
			(load as (e: unknown) => unknown)({ setHeaders: (h: Record<string, string>) => Object.assign(headers, h) });
			expect(headers['cache-control']).toMatch(name === '/support/terms' ? /must-revalidate/ : /no-store/);
		});
	}
});
