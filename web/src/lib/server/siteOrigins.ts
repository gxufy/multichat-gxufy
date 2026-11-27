import {
	CANONICAL_ORIGIN,
	CANONICAL_WWW_ORIGIN,
	HOME_ORIGIN,
	HOME_WWW_ORIGIN,
	LEGACY_ORIGIN,
	LEGACY_WWW_ORIGIN
} from '../../../../app/src/lib/domains.mjs';

/*
 * The site's own origins: the ones the sign-in routes accept a POST from
 * (isSameOriginRequest in app/src/lib/server/session.ts). SvelteKit checks a
 * POST without a JSON body (sign-out sends none) against the origin it works
 * out from the proxy headers before any route runs; trusting these same six
 * (csrf.trustedOrigins in vite.config.ts) leaves the decision to the route,
 * whatever scheme or host the proxy reports.
 */
export const SITE_ORIGINS: readonly string[] = [
	CANONICAL_ORIGIN,
	CANONICAL_WWW_ORIGIN,
	HOME_ORIGIN,
	HOME_WWW_ORIGIN,
	LEGACY_ORIGIN,
	LEGACY_WWW_ORIGIN
];
