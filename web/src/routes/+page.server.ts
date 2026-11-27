import { error, redirect } from '@sveltejs/kit';
import { homeRoute } from '#lib/site/homeRoute.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, request, setHeaders }) => {
	const route = homeRoute(request.headers.get('host') ?? undefined, url);
	if (route.kind === 'overlay') redirect(307, route.location);
	if (route.kind === 'generator') error(404, 'Not here yet');

	/* Rendered per request, never stored by a cache. */
	setHeaders({ 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' });
	return { year: new Date().getFullYear() };
};
