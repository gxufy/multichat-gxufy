import { error } from '@sveltejs/kit';
import { hasChannelParam } from '@/lib/multichatRouting';
import { parsedQuery } from '#lib/site/query.ts';
import type { PageServerLoad } from './$types';

/*
 * The generator: flosschat.app/ (rerouted here by src/hooks.ts) or a bare
 * /multichat. A URL that names a channel is the chat overlay, which
 * src/hooks.ts reroutes to src/routes/overlay/chat before it gets here; this
 * check only guards against reaching the generator with one some other way.
 */
export const load: PageServerLoad = ({ url }) => {
	if (hasChannelParam(parsedQuery(url.searchParams))) error(404, 'Not here yet');
	return {};
};
