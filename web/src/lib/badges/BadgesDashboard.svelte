<script lang="ts">
	/*
	 * /badges: sign in with Twitch, see your FlossChat badge, wear it or take it
	 * off. Saves on click (no Save button) and the preview updates at once; live
	 * overlays follow within about 15 seconds.
	 *
	 * Motion follows the site's shared motion system (components/site/motion.ts)
	 * and is off under prefers-reduced-motion.
	 */
	import { onMount } from 'svelte';
	import MotionBase from '#lib/site/MotionBase.svelte';
	import { cssText } from '#lib/site/cssText.ts';
	import OwnerTools from './owner/OwnerTools.svelte';
	import './badges.css';
	import { acquirePreviewIdentity } from '@/features/multichat/previewIdentityClient';
	import type { PreviewIdentityResponse } from '@/features/multichat/previewIdentity';
	import {
		parseMe,
		signInHref,
		signInNote,
		withoutFlossChatBadge,
		type MeState
	} from '@/lib/badgesPage';
	import { SUPPORT_AMOUNT_LABEL } from '@/lib/supportPage';
	import { isSupporterTierId } from '@/lib/supporterTiers';
	import { buildSupportBadgePreview, buildSupportUsernameStyle } from '@/lib/supportPreview';

	type SaveState = 'idle' | 'saving' | 'saved' | 'error';

	let {
		variant = 'page',
		signInNext = '/badges',
		onGetBadge
	}: {
		/** 'modal' inside the generator's Badges popup; 'page' on /badges. */
		variant?: 'page' | 'modal';
		/** Path to come back to after Twitch sign-in. */
		signInNext?: string;
		/** Popup only: open the Support popup instead of going to /support. */
		onGetBadge?: () => void;
	} = $props();

	const isModal = $derived(variant === 'modal');
	let me = $state<MeState>({ kind: 'loading' });
	let save = $state<SaveState>('idle');
	let note = $state('');
	let identity = $state<PreviewIdentityResponse | null>(null);

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const flag = params.get('signin');
		if (flag) {
			note = signInNote(flag);
			params.delete('signin');
			const rest = params.toString();
			window.history.replaceState(
				history.state,
				'',
				`${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
			);
		}
		let cancelled = false;
		fetch('/api/auth/me', { cache: 'no-store' })
			.then(async (response) => {
				const body = response.ok ? await response.json().catch(() => null) : null;
				if (!cancelled) me = response.ok ? parseMe(body) : { kind: 'unavailable' };
			})
			.catch(() => {
				if (!cancelled) me = { kind: 'unavailable' };
			});
		return () => {
			cancelled = true;
		};
	});

	const login = $derived(me.kind === 'signed-in' ? me.user.login : null);
	const userId = $derived(me.kind === 'signed-in' ? me.user.id : null);

	/* The real chat look: Twitch/FFZ/BTTV/7TV badges and the 7TV paint. */
	$effect(() => {
		const name = login;
		const id = userId;
		if (!name || !id) return;
		let cancelled = false;
		const acquired = acquirePreviewIdentity(name);
		const accept = (response: PreviewIdentityResponse) => {
			if (!cancelled && response.identity.userId === id) identity = response;
		};
		void acquired.promise
			.then(accept)
			.catch(() => undefined)
			.finally(() => acquired.release());
		void acquired.enrichment.then(accept).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	});

	/* The FlossChat badges this account holds: Owner, Founder, its tier.
	   One shows in chat at a time. */
	const held = $derived(me.kind === 'signed-in' ? me.badges.filter((badge) => badge.owned) : []);
	const tierBadge = $derived(held.find((badge) => isSupporterTierId(badge.id)) ?? null);
	const wearing = $derived(held.find((badge) => badge.worn) ?? null);
	const previewBadges = $derived([
		...buildSupportBadgePreview(withoutFlossChatBadge(identity), [], null, false),
		...(wearing ? [{ key: `gxufy:${wearing.id}`, title: `FlossChat ${wearing.title}`, url: wearing.url }] : [])
	]);
	const nameStyle = $derived(cssText(buildSupportUsernameStyle(identity)));

	/* Which badge shows (null: none). */
	function setWearing(badgeId: string | null) {
		if (me.kind !== 'signed-in') return;
		me = { ...me, badges: me.badges.map((badge) => ({ ...badge, worn: badge.id === badgeId })) };
	}

	/* Wear this badge in place of the one shown; click the one shown to take it off. */
	async function toggle(badgeId: string) {
		const badge = held.find((item) => item.id === badgeId);
		if (me.kind !== 'signed-in' || !badge || save === 'saving') return;
		const before = wearing?.id ?? null;
		const next = !badge.worn;
		setWearing(next ? badge.id : null);
		save = 'saving';
		try {
			const response = await fetch('/api/badges/wear', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ badgeId: badge.id, worn: next }),
				cache: 'no-store'
			});
			if (response.status === 401) {
				me = { kind: 'signed-out' };
				note = 'Your sign-in expired. Please sign in again.';
				save = 'idle';
				return;
			}
			if (!response.ok) throw new Error(String(response.status));
			save = 'saved';
		} catch {
			setWearing(before);
			save = 'error';
		}
	}

	$effect(() => {
		if (save !== 'saved') return;
		const timer = window.setTimeout(() => {
			save = 'idle';
		}, 2200);
		return () => window.clearTimeout(timer);
	});

	async function signOut() {
		await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
		identity = null;
		me = { kind: 'signed-out' };
	}
</script>

<MotionBase />

{#snippet userChip(inline: boolean)}
	{#if me.kind === 'signed-in'}
		<div class="fc-user{inline ? ' is-inline' : ''}">
			{#if me.user.avatarUrl}<img src={me.user.avatarUrl} alt="" class="fc-avatar" />{/if}
			<span class="fc-handle">@{me.user.login}</span>
			<button type="button" class="fc-ghost" onclick={signOut}>Sign out</button>
		</div>
	{/if}
{/snippet}

{#snippet tileBody(badge: { url: string; title: string }, state: string)}
	<img src={badge.url} alt="" />
	<span class="fc-tile-name">{badge.title}</span>
	<span class="fc-tile-state">{state}</span>
{/snippet}

<div class="fc-badges{isModal ? ' is-modal' : ''}">
	{#if !isModal}
		<header class="fc-bar">
			<a class="fc-brand" href="/multichat" aria-label="FlossChat">
				<img src="/flosschat-logo.png" alt="" width="127" height="192" />
				<span>FlossChat</span>
			</a>
			<nav class="fc-nav" aria-label="Pages">
				<a href="/multichat">Overlay</a>
				<a href="/support">Support</a>
				<a href="/badges" aria-current="page">Badges</a>
			</nav>
			{#if me.kind === 'signed-in'}
				{@render userChip(false)}
			{:else}
				<span></span>
			{/if}
		</header>
	{/if}

	<main class="fc-main">
		<div class="fc-heading">
			<div>
				{#if isModal}
					<h2 class="fc-title">Your badges</h2>
				{:else}
					<h1 class="fc-title">Your badges</h1>
				{/if}
				<p>What shows beside your name in FlossChat overlays.</p>
				{#if isModal}{@render userChip(true)}{/if}
			</div>
			<span class="fc-save is-{save}" role="status" aria-live="polite">
				{save === 'saving' ? 'Saving…' : save === 'saved' ? '✓ Saved' : save === 'error' ? 'Could not save' : ''}
			</span>
		</div>

		{#if note}<p class="fc-note" role="status">{note}</p>{/if}

		{#if me.kind === 'loading'}
			<section class="fc-card fc-skeleton" aria-busy="true"><div></div><div></div></section>
		{:else if me.kind === 'unavailable'}
			<section class="fc-card fc-empty">
				<h2>Sign-in is not available right now</h2>
				<p>Please try again in a little while.</p>
			</section>
		{:else if me.kind === 'signed-out'}
			<section class="fc-card fc-signin">
				<img class="fc-signin-badge" src="/badges/gxufy/supporter-hand.webp" alt="" />
				<h2>Sign in to manage your badges</h2>
				<p>Wear or take off your FlossChat badges. Changes show in chat within seconds.</p>
				<a class="fc-twitch" href={signInHref(signInNext)}>
					<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
						<path d="M4.3 3 3 6.3v13.2h4.5V22h2.5l2.5-2.5h3.7l5-5V3H4.3Zm15.2 10.6-2.9 2.9H12l-2.5 2.5v-2.5H5.8V4.7h13.7v8.9ZM16.3 7.6v5h-1.8v-5h1.8Zm-4.5 0v5H10v-5h1.8Z" />
					</svg>
					Sign in with Twitch
				</a>
				<p class="fc-fine">Only reads your Twitch name. No permissions, nothing posted.</p>
			</section>
		{:else}
			<div class="fc-grid">
				<section class="fc-card" aria-labelledby="fc-badges-title">
					<h2 id="fc-badges-title">FlossChat badges</h2>
					<p class="fc-sub">
						{held.length > 1
							? 'One shows beside your name at a time. Click a badge to wear it; click it again to show none.'
							: held.length
								? 'Click to wear it. Click again to take it off.'
								: `You don’t have a FlossChat badge yet. Sanctioned is yours for a one-time ${SUPPORT_AMOUNT_LABEL}, and payments add up to Suvy and Top Suvy.`}
					</p>
					<div class="fc-tiles">
						{#each held as badge (badge.id)}
							<button
								type="button"
								class="fc-tile{badge.worn ? ' is-worn' : ''}"
								aria-pressed={badge.worn}
								onclick={() => toggle(badge.id)}
								disabled={save === 'saving'}
							>
								{@render tileBody(badge, badge.worn ? 'Wearing' : 'Not shown')}
							</button>
						{/each}
						{#if !tierBadge}
							{@const sanctioned = { url: '/badges/gxufy/supporter-hand.webp', title: 'Sanctioned' }}
							{#if onGetBadge}
								<button type="button" class="fc-tile is-locked" onclick={onGetBadge}>
									{@render tileBody(sanctioned, `Get it from ${SUPPORT_AMOUNT_LABEL}`)}
								</button>
							{:else}
								<a class="fc-tile is-locked" href="/support">
									{@render tileBody(sanctioned, `Get it from ${SUPPORT_AMOUNT_LABEL}`)}
								</a>
							{/if}
						{/if}
					</div>
				</section>

				<section class="fc-card fc-preview" aria-labelledby="fc-preview-title">
					<h2 id="fc-preview-title">Live preview</h2>
					<div class="fc-chat" aria-label="How your name looks in chat">
						<div class="fc-chat-row">
							{#each previewBadges as badge (badge.key)}
								<img
									class="fc-chat-badge{badge.key.startsWith('gxufy:') ? ' is-flosschat' : ''}"
									src={badge.url}
									alt={badge.title}
									title={badge.title}
								/>
							{/each}
							<strong class="fc-chat-name" style={nameStyle}>{me.user.displayName}</strong>
							<span class="fc-chat-text">: hey chat</span>
						</div>
					</div>
					<p class="fc-fine">Your Twitch, 7TV, BTTV and FFZ badges and paint, as FlossChat shows them.</p>
				</section>
				{#if me.owner}<OwnerTools />{/if}
			</div>
		{/if}
	</main>
</div>
