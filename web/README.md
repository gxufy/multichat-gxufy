# FlossChat web (SvelteKit)

The FlossChat site and overlays, built with SvelteKit 3 and Svelte 5: the
generator, the chat overlay, FlossCounter, the support and badges pages and
the gxufy.com homepage. It also answers the API (`/api/*`, the handlers in
`app/src/api` run through `src/lib/server/apiRoute.ts`) and the site's public
files (`web/public`, through `src/lib/server/appPublic.ts`). Caddy sends it
every request.

Needs Node 22.17 or newer.

```
cd web
npm install              # first time, and after package.json changes
npm run dev              # local dev server
npm run check            # type check
npm test                 # unit tests + component tests (in a real browser)
npm run build            # production build into web/build
```

`npm run dev` answers `/api/*` itself, with the keys in the repo-root
`.env.local` (and the other repo-root `.env` files; restart the dev server
after changing them). Signing in with Twitch from port 5173 needs
`http://localhost:5173/api/twitch/oauth/callback` on the Twitch app's OAuth
Redirect URLs; if a sign-in fails, the dev server's window logs a
`[twitch sign-in]` line saying which step broke. PayPal and Stripe sandbox
payments work from http://localhost:5173/support with sandbox keys in that
file.

Component tests (`*.svelte.spec.ts`) run in Chromium. The first time, install
it with `npx playwright install chromium`.

## Shared code

`@/…` imports come from `app/src`, the shared code: channel validation,
config parsing, routing, badge layout, the chat renderer, the API handlers,
and so on. Code that only this app uses lives in `src/lib` and is imported as
`#lib/…`.
