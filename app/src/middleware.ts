/* Selective canonicalization at the edge: legacy-host website pages → gxufy.com.
 *
 * The whole decision lives in lib/canonicalRedirect, a pure function that is unit
 * tested without a request object. This file is only the adapter that reads the
 * incoming request, hands the three facts the decision needs to that function, and
 * issues a permanent redirect when it returns a target.
 *
 * Why the app and not Caddy: the rule has to consult the routing authority
 * (hasChannelParam) to tell a configured overlay from a bare generator visit, and
 * that is application logic, not something a reverse proxy can express without
 * duplicating — and eventually contradicting — the classifier.
 *
 * 308, not 302: the forward is permanent and must preserve the method, though in
 * practice these are all GETs. The matcher below keeps the middleware off Next's
 * internal asset routes so it runs only where a redirect could apply.
 *
 * /api/viewers is deliberately public and carries only public concurrent-viewer
 * data. The standalone counter calls it same-origin, but marketplace widgets run
 * on Pogly Cloud and therefore need a CORS-readable response. `*` is appropriate
 * here because the endpoint accepts no credentials, cookies, tokens, or writes.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { canonicalRedirectTarget } from '@/lib/canonicalRedirect';

const VIEWER_API_PATH = '/api/viewers';

function viewerApiCors(response: NextResponse): NextResponse {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { nextUrl } = request;

  /* The public viewer endpoint is consumed by third-party overlay hosts such as
     Pogly. A plain GET is a simple CORS request, while OPTIONS is handled too so
     future clients can probe the endpoint without receiving the app page. */
  if (nextUrl.pathname === VIEWER_API_PATH && request.method === 'OPTIONS') {
    return viewerApiCors(new NextResponse(null, { status: 204 }));
  }

  /* The routing authority takes a ParsedUrlQuery — a plain object whose repeated
     keys are arrays. Build that shape from the request's search params so the
     channel test here matches the one the page runs. */
  const query: Record<string, string | string[]> = {};
  for (const key of nextUrl.searchParams.keys()) {
    const all = nextUrl.searchParams.getAll(key);
    query[key] = all.length > 1 ? all : all[0];
  }

  const target = canonicalRedirectTarget(
    request.headers.get('host') ?? undefined,
    nextUrl.pathname,
    query,
    nextUrl.search,
  );

  if (target) return NextResponse.redirect(target, 308);

  const response = NextResponse.next();
  return nextUrl.pathname === VIEWER_API_PATH ? viewerApiCors(response) : response;
}

/**
 * Run everywhere except Next's own internals and static files. The decision
 * function is the real filter — it returns null for anything that must not move —
 * but excluding assets here keeps the middleware off requests that could never
 * redirect anyway.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};