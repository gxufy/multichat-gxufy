import * as route from '@/api/jiltv/cosmetics';
import { apiRoute } from '#lib/server/apiRoute.ts';

/* The handler in app/src/api, answered as it always has been (see apiRoute).
   Off (404) unless GXUFY_JILTV_COSMETICS_ENABLED=1. */
export const fallback = apiRoute(route);
