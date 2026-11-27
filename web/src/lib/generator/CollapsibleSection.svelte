<script lang="ts">
	/*
	 * A collapsible settings group. `hidden` is the source of truth; the disclosure
	 * motion only animates the change.
	 */
	import type { Snippet } from 'svelte';
	import type { ClassicCollapsibleSectionId } from '@/components/classic/collapsedSections';
	import { disclosureMotion } from './disclosureMotion.ts';

	let {
		sectionId,
		title,
		collapsed,
		onToggle,
		className = '',
		bodyClassName = '',
		headingLevel = 'h3',
		headingId,
		children
	}: {
		sectionId: ClassicCollapsibleSectionId;
		title: string;
		collapsed: boolean;
		onToggle: (sectionId: ClassicCollapsibleSectionId) => void;
		className?: string;
		bodyClassName?: string;
		headingLevel?: 'h2' | 'h3';
		headingId?: string;
		children: Snippet;
	} = $props();

	const buttonId = $derived(`${sectionId}-toggle`);
	const bodyId = $derived(`${sectionId}-body`);
</script>

<div class="form_col settings-group{className ? ` ${className}` : ''}" data-collapsed={collapsed ? 'true' : 'false'}>
	<svelte:element this={headingLevel} id={headingId} class="col-heading settings-group-heading">
		<button
			id={buttonId}
			type="button"
			class="settings-group-toggle"
			aria-expanded={!collapsed}
			aria-controls={bodyId}
			onclick={() => onToggle(sectionId)}
		>
			<span>{title}</span>
			<span class="settings-group-chevron" aria-hidden="true">›</span>
		</button>
	</svelte:element>
	<div
		id={bodyId}
		class="settings-group-body{bodyClassName ? ` ${bodyClassName}` : ''}"
		role="region"
		aria-labelledby={buttonId}
		hidden={collapsed}
		use:disclosureMotion={!collapsed}
	>
		{@render children()}
	</div>
</div>
