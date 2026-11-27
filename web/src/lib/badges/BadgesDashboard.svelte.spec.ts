import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

/* Badge cosmetics come from many providers; these tests are about the page. */
vi.mock('@/features/multichat/previewIdentityClient', () => ({
	acquirePreviewIdentity: () => ({
		promise: new Promise(() => {}),
		enrichment: new Promise(() => {}),
		release: () => {}
	})
}));

import BadgesDashboard from './BadgesDashboard.svelte';

const OWNER = { id: '204219574', login: 'gxufy', displayName: 'Gxufy' };
/* /api/auth/me lists only the FlossChat badges the account holds. */
const badge = (worn: boolean, id = 'supporter', title = 'Sanctioned') => ({
	id,
	title,
	url: `/badges/gxufy/${id}-hand.webp`,
	owned: true,
	worn
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let wearResponse: () => Response;
const posts: unknown[] = [];

function mockApi(me: unknown, status = 200) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/auth/me') return json(me, status);
			if (url === '/api/badges/wear') {
				posts.push(JSON.parse(String(init?.body)));
				return wearResponse();
			}
			if (url === '/api/badges/give') {
				if (init?.method !== 'POST') return json({ given: [], founders: [], founderSlotsLeft: 24 });
				const sent = JSON.parse(String(init.body)) as { login?: string; takeBack?: string; tier?: string; badge?: string };
				posts.push({ give: sent });
				if (sent.takeBack) return json({ takenBack: true });
				if (sent.tier === 'founder') {
					return json({
						founder: { id: '778', login: sent.login, displayName: 'EarlyFan', givenAt: '2026-11-18T14:00:00.000Z' },
						founderSlotsLeft: 23
					});
				}
				return json({
					given: { id: '777', login: sent.login, displayName: 'TestViewer', givenAt: '2026-11-18T13:00:00.000Z', tier: sent.tier }
				});
			}
			if (url === '/api/overlay/refresh' && init?.method === 'POST') {
				posts.push(init.body ? { refresh: JSON.parse(String(init.body)) } : 'refresh');
				return json({ ok: true });
			}
			return json({}, 404);
		})
	);
}

const path = window.location.pathname;

beforeEach(() => {
	posts.length = 0;
	wearResponse = () => json({ worn: false });
	window.history.replaceState(window.history.state, '', path);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('/badges (SvelteKit)', () => {
	it('asks a signed-out visitor to sign in with Twitch and come back here', async () => {
		mockApi({ signInReady: true, user: null, badges: [] });
		await render(BadgesDashboard);
		const link = page.getByRole('link', { name: /Sign in with Twitch/ });
		await expect.element(link).toHaveAttribute('href', '/api/auth/twitch/login?next=%2Fbadges');
	});

	it('says when sign-in is not available', async () => {
		mockApi({ error: 'down' }, 503);
		await render(BadgesDashboard);
		await expect.element(page.getByText('Sign-in is not available right now')).toBeInTheDocument();
	});

	it('wears and takes off the badge with one click, saving straight away', async () => {
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)] });
		await render(BadgesDashboard);
		const tile = page.getByRole('button', { name: /Sanctioned/ });
		await expect.element(tile).toHaveAttribute('aria-pressed', 'true');
		await expect.element(page.getByAltText('FlossChat Sanctioned')).toBeInTheDocument();

		await tile.click();
		expect(posts).toEqual([{ badgeId: 'supporter', worn: false }]);
		await expect.element(page.getByText('✓ Saved')).toBeInTheDocument();
		await expect.element(tile).toHaveAttribute('aria-pressed', 'false');
		await expect.element(page.getByAltText('FlossChat Sanctioned')).not.toBeInTheDocument();
	});

	it('puts the badge back if saving fails', async () => {
		wearResponse = () => json({ error: 'nope' }, 503);
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)] });
		await render(BadgesDashboard);
		const tile = page.getByRole('button', { name: /Sanctioned/ });
		await tile.click();
		await expect.element(page.getByText('Could not save')).toBeInTheDocument();
		await expect.element(tile).toHaveAttribute('aria-pressed', 'true');
	});

	it('asks to sign in again when the sign-in expired', async () => {
		wearResponse = () => json({ error: 'signed out' }, 401);
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)] });
		await render(BadgesDashboard);
		await page.getByRole('button', { name: /Sanctioned/ }).click();
		await expect.element(page.getByText('Your sign-in expired. Please sign in again.')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: /Sign in with Twitch/ })).toBeInTheDocument();
	});

	it('points a signed-in visitor without the badge to the $5 support page', async () => {
		mockApi({ signInReady: true, user: { id: '555', login: 'viewer', displayName: 'Viewer' }, badges: [] });
		await render(BadgesDashboard);
		await expect.element(page.getByRole('link', { name: /Get it from \$5/ })).toHaveAttribute('href', '/support');
	});

	it('in the popup, "Get it from $5" switches to the Support popup and says why', async () => {
		mockApi({ signInReady: true, user: { id: '555', login: 'viewer', displayName: 'Viewer' }, badges: [] });
		const onGetBadge = vi.fn();
		await render(BadgesDashboard, { props: { variant: 'modal', onGetBadge } });
		const tile = page.getByRole('button', { name: /Get it from \$5/ });
		await expect.element(page.getByText(/Sanctioned is yours for a one-time \$5/)).toBeInTheDocument();
		await tile.click();
		expect(onGetBadge).toHaveBeenCalledTimes(1);
		expect(posts).toEqual([]);
	});

	it('explains a failed sign-in and cleans the URL', async () => {
		window.history.replaceState(window.history.state, '', `${path}?signin=failed`);
		mockApi({ signInReady: true, user: null, badges: [] });
		await render(BadgesDashboard);
		await expect.element(page.getByText('Sign-in did not work. Please try again.')).toBeInTheDocument();
		expect(window.location.search).toBe('');
	});

	it('shows owner tools only to the owner, and refresh-all fires on one click', async () => {
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)], owner: true });
		await render(BadgesDashboard);
		await page.getByRole('button', { name: 'Refresh all overlays' }).click();
		await expect.element(page.getByText('Sent. Every open overlay is reloading now.')).toBeInTheDocument();
		expect(posts).toEqual(['refresh']);
	});

	it('lets the owner run a command on one channel', async () => {
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)], owner: true });
		await render(BadgesDashboard);
		await page.getByRole('textbox', { name: 'Command channel name' }).fill('#SomeStreamer');
		await page.getByRole('textbox', { name: 'Search commands' }).fill('reload');
		await page.getByRole('button', { name: /^reload/ }).first().click();
		await page.getByRole('button', { name: 'Run command' }).click();
		await expect.element(page.getByText(/are running !flosschat reload now/)).toBeInTheDocument();
		expect(posts).toEqual([{ refresh: { platform: 'any', channel: 'SomeStreamer', command: 'reload' } }]);
	});

	it('lets the owner give a badge for free and take it back', async () => {
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)], owner: true });
		await render(BadgesDashboard);
		await page.getByRole('textbox', { name: 'Give to (Twitch username)' }).fill('@testviewer');
		await page.getByRole('combobox', { name: 'Badge to give' }).selectOptions('Suvy');
		await page.getByRole('button', { name: 'Give badge' }).click();
		await expect.element(page.getByText(/Given\. TestViewer has Suvy now/)).toBeInTheDocument();
		await expect.element(page.getByRole('list', { name: 'Badges given' })).toMatchTextContent('@testviewer · Suvy');
		await page.getByRole('button', { name: 'Take back Suvy from testviewer' }).click();
		await expect.element(page.getByText('Taken back from TestViewer (Suvy).')).toBeInTheDocument();
		expect(posts).toEqual([{ give: { login: 'testviewer', tier: 'suvy' } }, { give: { takeBack: '777' } }]);
	});

	it('lets the owner give a Founder badge, showing the spots left, and take it back', async () => {
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)], owner: true });
		await render(BadgesDashboard);
		const select = page.getByRole('combobox', { name: 'Badge to give' });
		await expect.element(page.getByRole('option', { name: 'Founder (24 left)' })).toBeInTheDocument();
		await page.getByRole('textbox', { name: 'Give to (Twitch username)' }).fill('earlyfan');
		await select.selectOptions('founder');
		await page.getByRole('button', { name: 'Give badge' }).click();
		await expect.element(page.getByText(/Given\. EarlyFan is a Founder now.*23 of 25 Founder spots left\./)).toBeInTheDocument();
		await expect.element(page.getByRole('list', { name: 'Badges given' })).toMatchTextContent('@earlyfan · Founder');
		await page.getByRole('button', { name: 'Take back Founder from earlyfan' }).click();
		await expect.element(page.getByText('Taken back from EarlyFan (Founder).')).toBeInTheDocument();
		await expect.element(page.getByRole('option', { name: 'Founder (24 left)' })).toBeInTheDocument();
		expect(posts).toEqual([
			{ give: { login: 'earlyfan', tier: 'founder' } },
			{ give: { takeBack: '778', badge: 'founder' } }
		]);
	});

	it('never shows owner tools to anyone else', async () => {
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true)] });
		await render(BadgesDashboard);
		await expect.element(page.getByRole('button', { name: /Sanctioned/ })).toBeInTheDocument();
		await expect.element(page.getByText('Owner tools')).not.toBeInTheDocument();
	});

	it('one badge at a time: clicking another wears it instead, clicking the worn one shows none', async () => {
		wearResponse = () => json({ worn: true });
		mockApi({
			signInReady: true,
			user: OWNER,
			badges: [badge(true, 'owner', 'Owner'), badge(false, 'founder', 'Founder'), badge(false, 'suvy', 'Suvy')]
		});
		await render(BadgesDashboard);
		const owner = page.getByRole('button', { name: /^Owner/ });
		const founder = page.getByRole('button', { name: /Founder/ });
		const suvy = page.getByRole('button', { name: /Suvy/ });
		await expect.element(owner).toHaveAttribute('aria-pressed', 'true');
		await expect.element(page.getByText(/One shows beside your name at a time/)).toBeInTheDocument();
		await expect.element(page.getByAltText('FlossChat Owner')).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: /Get it from/ })).not.toBeInTheDocument();

		await founder.click();
		await expect.element(founder).toHaveAttribute('aria-pressed', 'true');
		await expect.element(owner).toHaveAttribute('aria-pressed', 'false');
		await expect.element(suvy).toHaveAttribute('aria-pressed', 'false');
		await expect.element(page.getByAltText('FlossChat Founder')).toBeInTheDocument();
		await expect.element(page.getByAltText('FlossChat Owner')).not.toBeInTheDocument();

		await expect.element(page.getByText('✓ Saved')).toBeInTheDocument();
		await founder.click();
		await expect.element(founder).toHaveAttribute('aria-pressed', 'false');
		await expect.element(page.getByAltText('FlossChat Founder')).not.toBeInTheDocument();
		expect(posts).toEqual([{ badgeId: 'founder', worn: true }, { badgeId: 'founder', worn: false }]);
	});

	it('if saving the swap fails, the badge worn before comes back', async () => {
		wearResponse = () => json({ error: 'nope' }, 503);
		mockApi({ signInReady: true, user: OWNER, badges: [badge(true, 'owner', 'Owner'), badge(false, 'suvy', 'Suvy')] });
		await render(BadgesDashboard);
		await page.getByRole('button', { name: /Suvy/ }).click();
		await expect.element(page.getByText('Could not save')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /^Owner/ })).toHaveAttribute('aria-pressed', 'true');
		await expect.element(page.getByRole('button', { name: /Suvy/ })).toHaveAttribute('aria-pressed', 'false');
	});

	it('a Founder without a tier (refunded) can still wear Founder and is offered Sanctioned', async () => {
		mockApi({ signInReady: true, user: { id: '555', login: 'viewer', displayName: 'Viewer' }, badges: [badge(true, 'founder', 'Founder')] });
		await render(BadgesDashboard);
		await expect.element(page.getByRole('button', { name: /Founder/ })).toHaveAttribute('aria-pressed', 'true');
		await expect.element(page.getByRole('link', { name: /Sanctioned.*Get it from \$5/ })).toHaveAttribute('href', '/support');
	});
});
