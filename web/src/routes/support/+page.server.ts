import { error } from '@sveltejs/kit';
import { supportPageEnabled } from '@/lib/supportPage';
import type { PageServerLoad } from './$types';

/* Off (404) unless GXUFY_SUPPORT_PAGE_ENABLED=1. Whether
   checkout is set up is asked from /api/support/status by the page, so its
   server load never reads the PayPal keys or opens the supporter store. */
export const load: PageServerLoad = ({ setHeaders }) => {
	if (!supportPageEnabled()) error(404, 'Not found');
	setHeaders({ 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' });
};
