import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

/* Live cosmetics and badges come from many providers; these tests are about
   the generator itself. Every live lookup answers "nothing new". */
vi.mock('@/features/multichat/previewLiveCosmetics', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/features/multichat/previewLiveCosmetics')>();
	return {
		...actual,
		loadPreviewLiveCosmetics: () => new Promise(() => {}),
		fetchPreviewJilChatShown: async () => new Map()
	};
});
vi.mock('@/lib/twitchProfileClient', () => ({ fetchTwitchProfile: async () => null }));

import Generator from './Generator.svelte';
import { multichatTool } from '@/features/multichat/config';
import { counterTool } from '@/features/counter/config';
import { buildOverlayUrl } from '@/lib/tools/toolContext';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const requests: string[] = [];

beforeEach(() => {
	requests.length = 0;
	localStorage.clear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			requests.push(url);
			if (url === '/api/support/status') return json({ checkoutReady: false, signInReady: false });
			if (url.startsWith('/api/twitch/channel-search')) {
				return json([
					{
						broadcaster_login: 'gxufy',
						display_name: 'Gxufy',
						thumbnail_url: 'https://static-cdn.jtvnw.net/x.png',
						is_live: false,
						game_name: ''
					}
				]);
			}
			return json({}, 404);
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** What the tools' own serializers make of the same state. */
function expectedChatUrl(channels: Record<string, string>, style: Record<string, unknown>) {
	const normalized = multichatTool.normalize({ ...multichatTool.defaults, ...style });
	return buildOverlayUrl({
		baseUrl: window.location.origin,
		route: multichatTool.overlayRoute,
		query: multichatTool.serialize(channels, normalized)
	});
}

function urlCodes(): string[] {
	return [...document.querySelectorAll('.url-code')].map((node) => node.textContent ?? '');
}

describe('generator', () => {
	it('starts with the default URLs, exactly as the serializers build them', async () => {
		await render(Generator);
		await expect.element(page.getByRole('heading', { name: 'Your channels' })).toBeInTheDocument();
		expect(urlCodes()).toEqual([
			expectedChatUrl({}, {}),
			buildOverlayUrl({
				baseUrl: window.location.origin,
				route: counterTool.overlayRoute,
				query: counterTool.serialize({}, counterTool.defaults)
			})
		]);
	});

	it('settings and channels change the URL byte for byte like the serializers', async () => {
		await render(Generator);
		await page.getByText('Large', { exact: true }).first().click();
		await page.getByLabelText('Show community badges').click();
		await userEvent.type(page.getByRole('combobox', { name: 'Kick' }), 'xqc');
		await expect
			.poll(() => urlCodes()[0])
			.toBe(expectedChatUrl({ kick: 'xqc' }, { textSize: 'large', showCommunityBadges: false }));
	});

	it('resetting chat settings goes back to the defaults and says so', async () => {
		await render(Generator);
		await page.getByText('Large', { exact: true }).first().click();
		await page.getByRole('button', { name: 'Reset Chat Settings to Default' }).click();
		await expect.poll(() => urlCodes()[0]).toBe(expectedChatUrl({}, {}));
		await expect.element(page.getByText('Chat settings restored to defaults.')).toBeInTheDocument();
	});

	it('a channel switches the chat preview to Live Overlay; clearing it switches back', async () => {
		await render(Generator);
		const live = page.getByRole('tab', { name: 'Live Overlay' });
		await expect.element(live).toBeDisabled();
		await userEvent.type(page.getByRole('combobox', { name: 'Kick' }), 'xqc');
		await expect.element(live).toHaveAttribute('aria-selected', 'true');
		await userEvent.clear(page.getByRole('combobox', { name: 'Kick' }));
		await expect.element(page.getByRole('tab', { name: 'Preview Data' })).toHaveAttribute('aria-selected', 'true');
	});

	it('remembers collapsed sections (same storage key and format as always)', async () => {
		await render(Generator);
		await page.getByRole('button', { name: 'Appearance' }).click();
		await expect
			.poll(() => localStorage.getItem('gxufy:multichat:collapsed-sections:v2'))
			.toBe(JSON.stringify(['chat-appearance', 'chat-filters']));
	});

	it('Twitch field suggests channels from the channel-search API', async () => {
		await render(Generator);
		await userEvent.type(page.getByRole('combobox', { name: 'Twitch' }), 'gxu');
		await expect.element(page.getByRole('option', { name: /Gxufy/ })).toBeInTheDocument();
		await page.getByRole('option', { name: /Gxufy/ }).click();
		await expect.element(page.getByRole('combobox', { name: 'Twitch' })).toHaveValue('gxufy');
		expect(requests.some((url) => url.startsWith('/api/twitch/channel-search?q=gxu'))).toBe(true);
	});

	it('back from sign-in (?support=1): tidies the URL but keeps the router’s history entry data', async () => {
		const start = `${window.location.pathname}${window.location.search}`;
		window.history.replaceState({ kit: 'entry' }, '', `${window.location.pathname}?support=1&keep=me#viewer-counter`);
		try {
			await render(Generator);
			await expect.poll(() => window.location.search).toBe('?keep=me');
			expect(window.location.hash).toBe('#viewer-counter');
			expect(window.history.state).toEqual({ kit: 'entry' });
		} finally {
			window.history.replaceState(null, '', start);
		}
	});

	it('no Badges or Support buttons while support is off', async () => {
		await render(Generator);
		await expect.element(page.getByRole('heading', { name: 'Your channels' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Support' })).not.toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: 'Badges' })).not.toBeInTheDocument();
	});

	it('the font picker searches and picks a Google font', async () => {
		await render(Generator);
		const font = page.getByRole('combobox', { name: 'Font' }).first();
		await font.click();
		await userEvent.keyboard('Press Start');
		await page.getByRole('option', { name: 'Press Start 2P' }).click();
		await expect.poll(() => urlCodes()[0]).toBe(expectedChatUrl({}, { googleFont: 'Press Start 2P' }));
	});
});
