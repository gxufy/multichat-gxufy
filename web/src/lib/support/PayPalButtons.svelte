<script lang="ts">
	/*
	 * PayPal's button on the support page, like Chatlee's: one gold "PayPal
	 * Buy Now" (plus PayPal's card button only while Stripe doesn't take
	 * cards). Pressing it asks our server to create the order for the amount
	 * and recipient on the page; the buyer approves in PayPal's own window;
	 * then our server captures it and checks it before any badge is given.
	 */
	import { onDestroy, onMount } from 'svelte';
	import {
		loadPayPalSdk,
		paypalButtonSources,
		paypalButtonStyle,
		type PayPalButtonsActions,
		type PayPalButtonsInstance,
		type PayPalFundingSource
	} from './paypalSdk.ts';

	let {
		clientId,
		cards,
		disabled = false,
		createOrder,
		onApproved,
		onCancelled,
		onFailed,
		onUnavailable
	}: {
		clientId: string;
		/** PayPal's card button too (off when Stripe takes cards). */
		cards: boolean;
		disabled?: boolean;
		createOrder: (fundingSource: PayPalFundingSource) => Promise<string>;
		onApproved: (orderId: string) => Promise<void> | void;
		onCancelled: () => void;
		onFailed: () => void;
		/** The SDK didn't load (blocked, offline): the page falls back to the redirect. */
		onUnavailable: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	const sources = paypalButtonSources({ cards });
	let container: HTMLDivElement;
	let phase = $state<'loading' | 'ready'>('loading');
	const actions: PayPalButtonsActions[] = [];
	const rendered: PayPalButtonsInstance[] = [];
	let actionsCount = $state(0);
	let destroyed = false;

	onMount(() => {
		loadPayPalSdk(clientId, { cards })
			.then(async (paypal) => {
				if (destroyed) return;
				for (const source of sources) {
					const button = paypal.Buttons({
						fundingSource: source,
						style: paypalButtonStyle(source),
						onInit: (_data, given) => {
							actions.push(given);
							actionsCount = actions.length;
							if (disabled) void given.disable();
						},
						onClick: (_data, given) => {
							if (disabled) return given.reject?.();
							return given.resolve?.();
						},
						createOrder: () => createOrder(source),
						onApprove: (data) => {
							if (typeof data?.orderID === 'string') return onApproved(data.orderID);
							onFailed();
						},
						onCancel: () => onCancelled(),
						onError: () => onFailed()
					});
					if (button.isEligible?.() === false) continue;
					const slot = document.createElement('div');
					slot.className = 'pp-slot';
					container.append(slot);
					rendered.push(button);
					await button.render(slot);
					if (destroyed) return;
				}
				if (!rendered.length) throw new Error('No PayPal button can show here');
				phase = 'ready';
			})
			.catch(() => {
				if (!destroyed) onUnavailable();
			});
	});

	$effect(() => {
		const off = disabled;
		void actionsCount;
		for (const given of actions) void (off ? given.disable() : given.enable());
	});

	onDestroy(() => {
		destroyed = true;
		for (const button of rendered) void button.close?.();
	});
</script>

<div
	class="pp"
	class:is-off={disabled}
	style:--pp-count={sources.length}
	aria-busy={phase === 'loading'}
>
	{#if phase === 'loading'}
		<div class="pp-placeholder" aria-hidden="true">
			{#each sources as source (source)}<span class="is-{source}"></span>{/each}
		</div>
	{/if}
	<div class="pp-buttons" bind:this={container}></div>
</div>

<style>
	.pp {
		position: relative;
		min-height: calc(var(--pp-count) * 48px + (var(--pp-count) - 1) * 8px);
		transition: opacity 0.15s;
	}

	.pp.is-off {
		opacity: 0.45;
	}

	.pp-placeholder,
	.pp-buttons {
		display: grid;
		gap: 8px;
	}

	/* PayPal draws its buttons out of sight until they are all there. */
	.pp[aria-busy='true'] .pp-buttons {
		position: absolute;
		inset: 0 0 auto;
		opacity: 0;
		pointer-events: none;
	}

	.pp-placeholder span {
		height: 48px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.06);
	}

	.pp-placeholder span.is-paypal {
		background: rgba(255, 196, 57, 0.16);
	}

	@media (prefers-reduced-motion: no-preference) {
		.pp-placeholder span {
			animation: pp-pulse 1s ease-in-out infinite alternate;
		}
	}

	@keyframes pp-pulse {
		to {
			opacity: 0.45;
		}
	}
</style>
