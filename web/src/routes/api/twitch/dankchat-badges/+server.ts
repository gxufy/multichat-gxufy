import * as route from '@/api/twitch/dankchat-badges';
import { apiRoute } from '#lib/server/apiRoute.ts';

/* The handler in app/src/api, answered as it always has been (see apiRoute). */
export const fallback = apiRoute(route);
