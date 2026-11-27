import { error } from '@sveltejs/kit';
import { supportPageEnabled } from '@/lib/supportPage';
import type { PageServerLoad } from './$types';

/* Shown with the support page (same switch), so it goes live with it. */
export const load: PageServerLoad = ({ setHeaders }) => {
	if (!supportPageEnabled()) error(404, 'Not found');
	setHeaders({ 'cache-control': 'public, max-age=0, must-revalidate' });
};
