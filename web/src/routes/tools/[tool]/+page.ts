import { error } from '@sveltejs/kit';
import { retiredToolDestination } from '@/lib/retiredRoutes';
import type { PageLoad } from './$types';

/* /tools/multichat and /tools/counter (app/src/lib/retiredRoutes.ts). Any
   other segment never existed and is a 404. */
export const load: PageLoad = ({ params, setHeaders }) => {
	const destination = retiredToolDestination(params.tool);
	if (!destination) error(404, 'Not found');
	/* Built once, these pages never change. */
	setHeaders({ 'cache-control': 's-maxage=31536000' });
	return { destination };
};
