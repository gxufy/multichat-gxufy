import { error } from '@sveltejs/kit';
import { supportPageEnabled } from '@/lib/supportPage';
import type { PageServerLoad } from './$types';

/* Same private-preview gate as /support until the supporter flow launches. */
export const load: PageServerLoad = ({ setHeaders }) => {
	if (!supportPageEnabled()) error(404, 'Not found');
	setHeaders({ 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' });
};
