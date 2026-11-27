import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { canonicalRedirectTarget } from '@/lib/canonicalRedirect';
import { parsedQuery } from '#lib/site/query.ts';
import { appPublicDir } from '@/lib/server/appPublicDir';
import { startPayPalRechecks } from '@/lib/server/paypalRecheck';
import { startStreamHandover } from '@/lib/server/streamHandover';
import { securityHeadersFor } from '#lib/site/securityHeaders.ts';
import { appPublicFiles } from '#lib/server/appPublic.ts';
import { exitOnShutdown } from '#lib/server/shutdown.ts';

/*
 * When the server starts: exit once connections are closed when pm2 stops the
 * app (see shutdown.ts), run the PayPal check every few minutes
 * (app/src/lib/server/paypalRecheck.ts), and keep note of the chats this copy
 * serves, taking over the other copy's during a deploy
 * (app/src/lib/server/streamHandover.ts).
 */
export const init: ServerInit = () => {
	exitOnShutdown();
	startPayPalRechecks();
	startStreamHandover();
};

/* What the error pages say about caching (404 and 500 alike), so a browser
   or Cloudflare never keeps a "not found". */
const ERROR_PAGE_CACHE_CONTROL = 'private, no-cache, no-store, max-age=0, must-revalidate';

/* The site's public files in web/public (see appPublic.ts). */
const publicFiles = appPublicFiles(appPublicDir());

/*
 * What happens on every request: forward the
 * website's pages to their canonical domain (the shared rule in
 * app/src/lib/canonicalRedirect.ts, never a copy), answer a public file
 * before any page, and add the security headers (lib/site/securityHeaders.ts).
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { url, request } = event;
	const target = canonicalRedirectTarget(
		request.headers.get('host') ?? undefined,
		url.pathname,
		parsedQuery(url.searchParams),
		url.search
	);

	const response = target
		? new Response(null, { status: 308, headers: { location: target } })
		: ((await publicFiles.answer(request, url)) ?? (await resolve(event)));

	for (const [key, value] of securityHeadersFor(url.pathname)) {
		if (!response.headers.has(key)) response.headers.set(key, value);
	}
	/* An error page (a page that failed or was not found, not an API answer). */
	if (
		response.status >= 400 &&
		response.headers.get('content-type')?.startsWith('text/html') &&
		!response.headers.has('cache-control')
	) {
		response.headers.set('cache-control', ERROR_PAGE_CACHE_CONTROL);
	}
	return response;
};
