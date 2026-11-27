/*
 * The site's response headers: the baseline on every answer, and no framing
 * by other sites for the pages listed below (securityHeaders.spec.ts holds
 * the values).
 */
export const BASELINE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	['X-Content-Type-Options', 'nosniff'],
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	['X-DNS-Prefetch-Control', 'off'],
	['X-Permitted-Cross-Domain-Policies', 'none'],
	[
		'Permissions-Policy',
		[
			'accelerometer=()',
			'camera=()',
			'geolocation=()',
			'gyroscope=()',
			'magnetometer=()',
			'microphone=()',
			'payment=()',
			'usb=()'
		].join(', ')
	],
	['Strict-Transport-Security', 'max-age=31536000']
];

/* Pages that must never be shown inside another site's frame (the payment
   page above all). Overlay pages stay embeddable for OBS widgets. */
export const NO_FRAMING_HEADERS: ReadonlyArray<readonly [string, string]> = [
	['X-Frame-Options', 'SAMEORIGIN'],
	['Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"]
];

const NO_FRAMING_PATHS = new Set(['/', '/support']);

/* The generator's preview frames: framed by our own pages only (the bare
   path too). */
function isPreviewFrame(pathname: string): boolean {
	return pathname === '/preview-frame' || pathname.startsWith('/preview-frame/');
}

/** Every header a response for `pathname` should carry. */
export function securityHeadersFor(pathname: string): Array<readonly [string, string]> {
	return NO_FRAMING_PATHS.has(pathname) || isPreviewFrame(pathname)
		? [...BASELINE_SECURITY_HEADERS, ...NO_FRAMING_HEADERS]
		: [...BASELINE_SECURITY_HEADERS];
}
