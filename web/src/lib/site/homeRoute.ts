import { isCanonicalHost } from '@/lib/domains.mjs';
import { hasChannelParam } from '@/lib/multichatRouting';
import { parsedQuery } from './query.ts';

export type HomeRoute =
	/* A channel-carrying `/` is an OBS overlay URL: hand it to /multichat with
	   the query exactly as it came (the old page did this in the browser). */
	| { kind: 'overlay'; location: string }
	/* flosschat.app's `/` is the generator, which has not moved yet. */
	| { kind: 'generator' }
	| { kind: 'home' };

/** What `/` should do for this host and URL. */
export function homeRoute(host: string | undefined, url: URL): HomeRoute {
	if (hasChannelParam(parsedQuery(url.searchParams))) {
		return { kind: 'overlay', location: `/multichat${url.search}` };
	}
	if (isCanonicalHost(host)) return { kind: 'generator' };
	return { kind: 'home' };
}
