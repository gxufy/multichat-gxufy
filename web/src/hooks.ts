import type { Reroute } from '@sveltejs/kit/hooks';
import { isCanonicalHost } from '@/lib/domains.mjs';
import { hasChannelParam } from '@/lib/multichatRouting';
import { parsedQuery } from '#lib/site/query.ts';

/*
 * /multichat?<channels> is the chat overlay (src/routes/overlay/chat).
 *
 * flosschat.app/ is the generator: a channel-less root draws the /multichat
 * page. Only the route changes; the address stays flosschat.app/ and load functions
 * still see the original URL. A root that names a channel is an overlay and
 * is left alone (the root route sends it on to /multichat).
 */
export const reroute: Reroute = ({ url }) => {
	/* /multichat naming a channel is the chat overlay; without one, the
	   generator (src/routes/multichat). Same address either way. */
	if (url.pathname === '/multichat') {
		return hasChannelParam(parsedQuery(url.searchParams)) ? '/overlay/chat' : undefined;
	}
	if (url.pathname !== '/') return;
	if (!isCanonicalHost(url.host)) return;
	if (hasChannelParam(parsedQuery(url.searchParams))) return;
	return '/multichat';
};
