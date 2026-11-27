<script lang="ts">
	/*
	 * Searchable font picker, with recent fonts remembered. The catalog,
	 * search ranking and storage live in the shared multichatFontCatalog.ts.
	 */
	import { tick } from 'svelte';
	import { googleFontValue, normalizeGoogleFontFamily } from '@/lib/overlayFonts';
	import type { SettingOption } from '@/lib/tools/settingTypes';
	import {
		addRecentMultichatFont,
		browserLocalStorage,
		buildMultichatFontCatalog,
		choiceFromToken,
		deduplicateChoices,
		matchRank,
		normalizedSearch,
		presetChoice,
		presetToken,
		readRecentMultichatFonts,
		writeRecentMultichatFonts,
		type FontChoice,
		type MultichatFontSelection
	} from '@/components/classic/multichatFontCatalog';

	let {
		id,
		customInputId,
		showCustomInput = false,
		label,
		description,
		options,
		presetFont,
		customFont,
		fontFamilies,
		onChange
	}: {
		id: string;
		customInputId: string;
		showCustomInput?: boolean;
		label: string;
		description?: string;
		options: readonly SettingOption[];
		presetFont: string;
		customFont: string;
		fontFamilies: Readonly<Record<string, string>>;
		onChange: (selection: MultichatFontSelection) => void;
	} = $props();

	const selectedChoice = $derived.by<FontChoice>(() => {
		const family = normalizeGoogleFontFamily(customFont);
		if (family) return { token: googleFontValue(family)!, label: family, kind: 'custom' };
		const option = options.find(({ value }) => value === presetFont) ?? options[0];
		return option
			? presetChoice(option)
			: { token: presetToken(presetFont), label: presetFont, kind: 'preset', presetValue: presetFont };
	});

	const catalog = $derived(buildMultichatFontCatalog(options));
	let query = $state('');
	let open = $state(false);
	let activeIndex = $state(-1);
	/* Read on mount (the server has no storage). */
	let recentTokens = $state<string[]>([]);
	let recentLoaded = false;
	let root: HTMLDivElement | undefined = $state();
	const optionNodes: Array<HTMLButtonElement | null> = [];
	let keyboardNavigation = false;

	$effect(() => {
		if (recentLoaded) return;
		recentLoaded = true;
		recentTokens = readRecentMultichatFonts(browserLocalStorage(), options);
	});

	const descriptionId = $derived(description ? `${id}-description` : undefined);
	const listboxId = $derived(`${id}-options`);
	const normalizedQuery = $derived(normalizedSearch(query));

	const recentChoices = $derived(
		recentTokens
			.map((token) => choiceFromToken(token, options))
			.filter((choice): choice is FontChoice => choice !== null)
	);

	const choices = $derived.by<FontChoice[]>(() => {
		if (!normalizedQuery) return deduplicateChoices([selectedChoice, ...recentChoices, ...catalog]);
		const matches = catalog
			.map((choice) => ({ choice, rank: matchRank(choice.label, normalizedQuery) }))
			.filter((entry): entry is { choice: FontChoice; rank: number } => entry.rank !== null)
			.sort(
				(a, b) =>
					a.rank - b.rank ||
					a.choice.label.localeCompare(b.choice.label, undefined, { sensitivity: 'base' })
			)
			.map(({ choice }) => choice);
		if (matches.length) return matches;
		const family = normalizeGoogleFontFamily(query);
		return family ? [{ token: googleFontValue(family)!, label: family, kind: 'custom' }] : [];
	});

	$effect(() => {
		if (!recentLoaded) return;
		writeRecentMultichatFonts(recentTokens);
	});

	$effect(() => {
		if (!open) return;
		const handleOutsidePointer = (event: PointerEvent) => {
			if (!root?.contains(event.target as Node)) {
				open = false;
				query = '';
				activeIndex = -1;
			}
		};
		document.addEventListener('pointerdown', handleOutsidePointer);
		return () => document.removeEventListener('pointerdown', handleOutsidePointer);
	});

	$effect(() => {
		const index = activeIndex;
		if (!open || !keyboardNavigation || index < 0) return;
		keyboardNavigation = false;
		void tick().then(() => optionNodes[index]?.scrollIntoView?.({ block: 'nearest' }));
	});

	function rememberChoice(choice: FontChoice) {
		recentTokens = addRecentMultichatFont(recentTokens, choice, options);
	}

	function selectChoice(choice: FontChoice) {
		if (choice.kind === 'preset') {
			onChange({ font: choice.presetValue!, googleFont: '' });
		} else {
			const family = normalizeGoogleFontFamily(choice.label);
			if (!family) return;
			onChange({ font: presetFont, googleFont: family });
		}
		rememberChoice(choice);
		query = '';
		open = false;
		activeIndex = -1;
	}

	function openMenu() {
		query = '';
		open = true;
		activeIndex = 0;
	}

	function close() {
		query = '';
		open = false;
		activeIndex = -1;
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (open) event.preventDefault();
			close();
			return;
		}
		if (event.key === 'Tab') {
			close();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			keyboardNavigation = true;
			if (!open) {
				openMenu();
				return;
			}
			if (!choices.length) return;
			if (event.key === 'ArrowDown') activeIndex = activeIndex < choices.length - 1 ? activeIndex + 1 : 0;
			else activeIndex = activeIndex > 0 ? activeIndex - 1 : choices.length - 1;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (!open) {
				openMenu();
				return;
			}
			const choice = choices[activeIndex] ?? choices[0];
			if (choice) selectChoice(choice);
			else close();
		}
	}

	const selectedFontFamily = $derived(
		selectedChoice.kind === 'preset' ? fontFamilies[selectedChoice.presetValue ?? ''] : undefined
	);
	const statusText = $derived(
		open
			? choices.length
				? `${choices.length} font option${choices.length === 1 ? '' : 's'} available.`
				: 'No matching fonts.'
			: ''
	);
</script>

<div class="classic-field font-picker-field">
	<label for={id}>{label}</label>
	{#if description}
		<span id={descriptionId} class="sr-only">{description}</span>
	{/if}
	<div class="font-picker-control" bind:this={root}>
		<input
			{id}
			type="text"
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls={open ? listboxId : undefined}
			aria-activedescendant={open && choices[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
			aria-describedby={descriptionId}
			autocomplete="off"
			placeholder={open ? 'Search fonts' : undefined}
			value={open ? query : selectedChoice.label}
			style:font-family={!open && selectedFontFamily ? selectedFontFamily : undefined}
			onfocus={() => {
				if (!open) openMenu();
			}}
			oninput={(event) => {
				query = event.currentTarget.value;
				open = true;
				activeIndex = 0;
			}}
			onkeydown={handleKeyDown}
		/>

		{#if open}
			<div id={listboxId} class="font-picker-options" role="listbox" aria-label="Font options">
				{#each choices as choice, index (choice.token)}
					{@const current = choice.token === selectedChoice.token}
					<button
						id={`${listboxId}-${index}`}
						bind:this={optionNodes[index]}
						type="button"
						role="option"
						aria-selected={current}
						data-active={activeIndex === index ? 'true' : undefined}
						data-current={current ? 'true' : undefined}
						class="font-picker-option"
						tabindex={-1}
						style:font-family={choice.kind === 'preset' && choice.presetValue
							? fontFamilies[choice.presetValue]
							: undefined}
						onmouseenter={() => (activeIndex = index)}
						onclick={() => selectChoice(choice)}
					>
						<span>{choice.kind === 'custom' ? `Use “${choice.label}”` : choice.label}</span>
						{#if current}<span class="font-picker-current">Selected</span>{/if}
					</button>
				{/each}

				{#if !choices.length}
					<p class="font-picker-empty">No matching fonts</p>
				{/if}
			</div>
		{/if}
	</div>
	{#if showCustomInput}
		<div class="font-picker-custom-field">
			<label for={customInputId}>Custom Google Font</label>
			<span id={`${customInputId}-description`} class="sr-only">
				Optional Google Fonts family name. Overrides the preset font above.
			</span>
			<input
				id={customInputId}
				type="text"
				value={customFont}
				placeholder="Press Start 2P"
				aria-describedby={`${customInputId}-description`}
				maxlength={80}
				oninput={(event) => onChange({ font: presetFont, googleFont: event.currentTarget.value })}
			/>
		</div>
	{:else}
		<input id={customInputId} type="hidden" value={customFont} readonly />
	{/if}
	<span class="sr-only" role="status" aria-live="polite">{statusText}</span>
</div>
