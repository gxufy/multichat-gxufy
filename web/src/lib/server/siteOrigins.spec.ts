import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSameOriginRequest } from '@/lib/server/session';
import { SITE_ORIGINS } from './siteOrigins.ts';

const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const from = (origin: string) => ({ headers: { origin, host: 'flosschat.app' } }) as never;

describe('SITE_ORIGINS', () => {
	it('is exactly what the sign-in routes accept a POST from', () => {
		expect(new Set(SITE_ORIGINS).size).toBe(6);
		for (const origin of SITE_ORIGINS) expect(isSameOriginRequest(from(origin), production)).toBe(true);
		for (const origin of ['https://evil.example', 'http://flosschat.app', 'https://flosschat.app.evil.example', 'null']) {
			expect(SITE_ORIGINS).not.toContain(origin);
			expect(isSameOriginRequest(from(origin), production)).toBe(false);
		}
	});

	it('is what the app trusts for POSTs without a JSON body, and nothing wider', () => {
		const source = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8');
		expect(source).toContain("import { SITE_ORIGINS } from './src/lib/server/siteOrigins.ts';");
		expect(source).toContain('csrf: { trustedOrigins: [...SITE_ORIGINS] }');
		expect(source.match(/trustedOrigins/g)).toHaveLength(1);
	});
});
