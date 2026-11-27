<script lang="ts">
	/*
	 * The Support/Badges popup frame (stylesheet in popupShell.ts). Opens with a fade and pop, closes
	 * after CLOSE_MS, locks page scroll, Esc or a click outside closes, focus
	 * returns to what opened it.
	 */
	import type { Snippet } from 'svelte';
	import { CLOSE_MS, SUPPORT_MODAL_CSS } from '@/components/support/popupShell';

	let {
		open,
		onClose,
		label,
		width,
		children
	}: { open: boolean; onClose: () => void; label: string; width?: string; children: Snippet } = $props();

	let mounted = $state(false);
	let closing = $state(false);
	let panel: HTMLDivElement | undefined = $state();
	let returnFocus: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			closing = false;
			mounted = true;
			return;
		}
		if (!mounted) return;
		closing = true;
		const timer = window.setTimeout(() => {
			mounted = false;
			closing = false;
			returnFocus?.focus();
		}, CLOSE_MS);
		return () => window.clearTimeout(timer);
	});

	$effect(() => {
		if (!mounted) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		panel?.focus();
		return () => {
			document.body.style.overflow = previous;
		};
	});

	function requestClose() {
		if (!closing) onClose();
	}

	$effect(() => {
		if (!mounted) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') requestClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#if mounted}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="support-modal"
		data-state={closing ? 'closing' : 'open'}
		onmousedown={(event) => {
			if (
				event.target === event.currentTarget ||
				(event.target as HTMLElement).classList.contains('support-modal-frame')
			) {
				requestClose();
			}
		}}
	>
		{@html `<style>${SUPPORT_MODAL_CSS}</style>`}
		<div class="support-modal-frame">
			<div
				bind:this={panel}
				class="support-modal-panel"
				role="dialog"
				aria-modal="true"
				aria-label={label}
				tabindex={-1}
				style:width={width ? `min(${width}, 100%)` : undefined}
			>
				<button type="button" class="support-modal-close" aria-label="Close" onclick={requestClose}
					><svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg
					></button
				>
				{@render children()}
			</div>
		</div>
	</div>
{/if}
