import type { ParsedUrlQuery } from 'querystring';

/**
 * The query in the shape the shared routing rules take (a ParsedUrlQuery:
 * repeated keys become arrays), so the rules reach the same decision for the
 * same URL however it is spelled.
 */
export function parsedQuery(searchParams: Pick<URLSearchParams, 'keys' | 'getAll'>): ParsedUrlQuery {
	const query: ParsedUrlQuery = {};
	for (const key of searchParams.keys()) {
		const all = searchParams.getAll(key);
		query[key] = all.length > 1 ? all : all[0];
	}
	return query;
}
