import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, searchForWorkspaceRoot, type Plugin } from 'vite';
import { appPublicMiddleware } from './src/lib/server/appPublic.ts';
import { SITE_ORIGINS } from './src/lib/server/siteOrigins.ts';

const sharedAppSource = fileURLToPath(new URL('../app/src', import.meta.url));
const appPublic = fileURLToPath(new URL('./public', import.meta.url));
const rootModules = fileURLToPath(new URL('../node_modules', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/*
 * Local dev, preview and the browser tests: answer requests for the site's
 * public files (images, fonts, clips in web/public), with byte ranges so the
 * clips can seek (src/lib/server/appPublic.ts). In production the server
 * hooks give the same answers from the same folder, so nothing is copied into
 * this build (SvelteKit copies only web/static).
 */
function serveAppPublic(): Plugin {
	const middleware = appPublicMiddleware(appPublic);
	return {
		name: 'flosschat:app-public',
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		}
	};
}

/*
 * The one build-time setting the shared code reads, the JilTV cosmetics switch
 * (app/src/lib/jiltvCosmetics.ts), is written into the code when it is built,
 * taken from the environment or else from the repository root's .env files (on
 * the server, the linked .env.local). Only NEXT_PUBLIC_* names are read from
 * the files. Tests use the environment alone.
 */
function nextPublicEnv(): Plugin {
	const key = 'NEXT_PUBLIC_GXUFY_JILTV_COSMETICS';
	return {
		name: 'flosschat:next-public-env',
		config(_config, { mode }) {
			const files = mode === 'test' ? {} : loadEnv(mode, repositoryRoot, 'NEXT_PUBLIC_');
			const value = process.env[key] ?? files[key] ?? '';
			return { define: { [`process.env.${key}`]: JSON.stringify(value) } };
		}
	};
}

/*
 * Local dev and preview: the API routes read their keys from process.env, as
 * on the server (where pm2 starts the app with them). Here any that are not
 * already set are filled from the repository root's .env files (.env.local
 * and the rest, the dev set for `npm run dev`), never replacing a value the
 * environment already has. Under `npm run dev` the supporter database
 * defaults to the repository root's .data folder (git-ignored), where it has
 * always been. Tests use the environment alone.
 */
function localServerEnv(): Plugin {
	return {
		name: 'flosschat:local-server-env',
		config(_config, { command, mode }) {
			if (command !== 'serve' || mode === 'test') return;
			for (const [key, value] of Object.entries(loadEnv(mode, repositoryRoot, ''))) {
				if (process.env[key] === undefined) process.env[key] = value;
			}
			if (mode === 'development' && process.env.GXUFY_SUPPORTER_STORE_PATH === undefined) {
				process.env.GXUFY_SUPPORTER_STORE_PATH = join(repositoryRoot, '.data', 'supporters.db');
			}
		}
	};
}

/*
 * FlossChat's SvelteKit app: the whole site (Caddy sends it every request).
 * Shared logic is not copied: `@/…` imports the TypeScript in `app/src`, so
 * the site follows the same rules as before (the same mapping is in
 * tsconfig.json for type checking).
 */
export default defineConfig({
	plugins: [
		localServerEnv(),
		nextPublicEnv(),
		serveAppPublic(),
		sveltekit({
			compilerOptions: {
				// Runes mode for our own components (libraries decide for themselves).
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ out: 'build' }),
			/* Our own six origins may POST without a JSON body (sign-out); the
			   routes check the origin themselves (see siteOrigins.ts). */
			csrf: { trustedOrigins: [...SITE_ORIGINS] }
		})
	],
	resolve: {
		alias: [{ find: /^@\//, replacement: `${sharedAppSource}/` }]
	},
	server: {
		fs: {
			// The dev server may read this app, the shared code in ../app/src
			// and the packages it imports, and nothing else in the repo (not
			// app/.env.local, configs or data).
			allow: [searchForWorkspaceRoot(process.cwd()), sharedAppSource, rootModules]
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						/* The test browser reaches this machine only: images from other
						   sites (sample emotes and badges) fail at once, the same way
						   everywhere, so what the tests see never depends on the network. */
						provider: playwright({
							launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'] }
						}),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
