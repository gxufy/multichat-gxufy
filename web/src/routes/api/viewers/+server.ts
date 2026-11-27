import type { RequestHandler } from '@sveltejs/kit';
import * as route from '@/api/viewers';
import { apiRoute } from '#lib/server/apiRoute.ts';

const answer = apiRoute(route);

/* The handler in app/src/api (see apiRoute). The preflight is answered here,
   before the handler, as it always has been. */
export const fallback: RequestHandler = (event) =>
	event.request.method === 'OPTIONS'
		? new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type'
				}
			})
		: answer(event);
