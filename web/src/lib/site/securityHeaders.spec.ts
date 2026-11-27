import { describe, expect, it } from 'vitest';
import {
	BASELINE_SECURITY_HEADERS,
	NO_FRAMING_HEADERS,
	securityHeadersFor
} from './securityHeaders.ts';

/* The values the site has always sent (they were the Next.js app's, in
   app/next.config.js, before it was retired). */
describe('security headers', () => {
	const baseline = new Map(BASELINE_SECURITY_HEADERS);

	it('sets the safe baseline values', () => {
		expect([...baseline.keys()]).toEqual([
			'X-Content-Type-Options',
			'Referrer-Policy',
			'X-DNS-Prefetch-Control',
			'X-Permitted-Cross-Domain-Policies',
			'Permissions-Policy',
			'Strict-Transport-Security'
		]);
		expect(baseline.get('X-Content-Type-Options')).toBe('nosniff');
		expect(baseline.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(baseline.get('X-DNS-Prefetch-Control')).toBe('off');
		expect(baseline.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
		expect(baseline.get('Strict-Transport-Security')).toBe('max-age=31536000');
	});

	it('turns off only browser features the site does not use', () => {
		expect(baseline.get('Permissions-Policy')?.split(', ')).toEqual([
			'accelerometer=()',
			'camera=()',
			'geolocation=()',
			'gyroscope=()',
			'magnetometer=()',
			'microphone=()',
			'payment=()',
			'usb=()'
		]);
	});

	it('leaves route-specific and streaming headers to the routes', () => {
		for (const key of [
			'Access-Control-Allow-Headers',
			'Access-Control-Allow-Methods',
			'Access-Control-Allow-Origin',
			'Cache-Control',
			'Connection',
			'Content-Length',
			'Content-Type',
			'Retry-After',
			'X-Accel-Buffering'
		]) {
			expect(baseline.has(key), key).toBe(false);
		}
	});

	it('keeps the homepage, payment page and preview frames out of other sites, not the overlays', () => {
		expect(new Map(NO_FRAMING_HEADERS)).toEqual(
			new Map([
				['X-Frame-Options', 'SAMEORIGIN'],
				['Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"]
			])
		);
		const framing = (path: string) => securityHeadersFor(path).some(([key]) => key === 'X-Frame-Options');
		expect(framing('/')).toBe(true);
		expect(framing('/support')).toBe(true);
		expect(framing('/preview-frame/chat')).toBe(true);
		expect(framing('/preview-frame/viewers')).toBe(true);
		expect(framing('/preview-frame')).toBe(true);
		expect(framing('/preview-framed')).toBe(false);
		expect(framing('/multichat')).toBe(false);
		expect(framing('/counter')).toBe(false);
		expect(securityHeadersFor('/x')).toHaveLength(BASELINE_SECURITY_HEADERS.length);
	});
});
