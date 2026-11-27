<script lang="ts" generics="C">
	/*
	 * One catalog setting in the generator's look. Labels, options and defaults all come off the descriptor;
	 * `segmented` and `range` only change how a value is drawn, never the
	 * value itself, so the generated URL is the same either way.
	 */
	import {
		optionAvailable,
		type Setting as CatalogSetting,
		type SettingAvailability,
		type SettingValue
	} from '@/lib/tools/settingTypes';
	import {
		asStringList,
		unavailableReasons,
		type SettingRange
	} from '@/components/classic/settingRow';
	import { glide } from './glide.ts';

	let {
		setting,
		value,
		onChange,
		availability,
		idPrefix,
		segmented = false,
		range
	}: {
		setting: CatalogSetting<C>;
		value: SettingValue;
		onChange: (key: keyof C & string, next: SettingValue) => void;
		availability?: SettingAvailability;
		/** Namespace for this setting's ids, e.g. 'mc' or 'vc'. */
		idPrefix: string;
		/** Draw a `select` as a segmented pill row instead of a dropdown. */
		segmented?: boolean;
		/** Draw a numeric `text` setting as a slider instead of a field. */
		range?: SettingRange;
	} = $props();

	const inputId = $derived(`${idPrefix}-${setting.key}`);
	const descriptionId = $derived(setting.description ? `${inputId}-desc` : undefined);
	const reasonId = $derived(setting.disabledReason ? `${inputId}-reason` : undefined);
	const disabled = $derived(setting.disabled === true);
	const gatedReasons = $derived(unavailableReasons(setting, availability));
	const gatedId = $derived(gatedReasons.length > 0 ? `${inputId}-gated` : undefined);
	const describedBy = $derived(
		[descriptionId, reasonId, gatedId].filter(Boolean).join(' ') || undefined
	);

	/* Values per control type, falling back to the declared default exactly as
	   the row always has when state disagrees with the type. */
	const stringValue = $derived(
		typeof value === 'string' ? value : (setting as { default: unknown }).default
	) as string;
	const boolValue = $derived(
		typeof value === 'boolean' ? value : Boolean((setting as { default: unknown }).default)
	);

	/* Slider readout for a numeric text setting (fade seconds, emote scale). */
	const rangeState = $derived.by(() => {
		if (!range || setting.type !== 'text') return null;
		const raw = stringValue;
		const blank = raw === '';
		const numeric = Number(raw);
		const fallback = Number(setting.default) || range.min;
		const shown = blank || !Number.isFinite(numeric) ? fallback : numeric;
		return { blank, shown };
	});

	const selectedChips = $derived.by(() => {
		if (setting.type !== 'multiselect') return [] as string[];
		const raw = asStringList(value, setting.default);
		return setting.options.map((option) => option.value).filter((v) => raw.includes(v));
	});

	function emit(next: SettingValue) {
		onChange(setting.key, next);
	}

	/* A text field emits what was typed (cut to the declared length) and then
	   shows exactly what the state holds (a controlled input). */
	function onText(event: Event & { currentTarget: HTMLInputElement }) {
		if (setting.type !== 'text') return;
		const typed = event.currentTarget.value;
		const next = setting.maxLength === undefined ? typed : typed.slice(0, setting.maxLength);
		emit(next);
		if (event.currentTarget.value !== next) event.currentTarget.value = next;
	}

	function onNumber(event: Event & { currentTarget: HTMLInputElement }) {
		const raw = event.currentTarget.value;
		const next = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(next)) return;
		emit(next);
	}

	function toggleChip(optionValue: string, checked: boolean) {
		if (setting.type !== 'multiselect') return;
		const next = new Set(selectedChips);
		if (checked) next.add(optionValue);
		else next.delete(optionValue);
		emit(setting.options.map((o) => o.value).filter((v) => next.has(v)));
	}
</script>

{#snippet help()}
	{#if setting.description}
		<p id={descriptionId} class="sr-only">{setting.description}</p>
	{/if}
	{#if setting.disabledReason}
		<p id={reasonId} class="classic-help">{setting.disabledReason}</p>
	{/if}
	{#if gatedId}
		<div id={gatedId}>
			{#each gatedReasons as reason (reason)}
				<p class="classic-help warn">{reason}</p>
			{/each}
		</div>
	{/if}
{/snippet}

{#if !setting.hidden}
	{#if setting.type === 'select' && segmented}
		<div class="classic-field">
			<fieldset id={inputId} class="classic-seg" aria-describedby={describedBy}>
				<legend>{setting.label}</legend>
				<div class="classic-seg-row" use:glide={'.classic-seg-label.on'}>
					{#each setting.options as option (option.value)}
						{@const optionId = `${inputId}-${option.value}`}
						{@const on = stringValue === option.value}
						<span class="classic-seg-item">
							<input
								id={optionId}
								type="radio"
								name={inputId}
								value={option.value}
								checked={on}
								disabled={disabled || !optionAvailable(availability, option.value).available}
								onchange={() => emit(option.value)}
							/>
							<label for={optionId} class="classic-seg-label{on ? ' on' : ''}">{option.label}</label>
						</span>
					{/each}
				</div>
			</fieldset>
			{@render help()}
		</div>
	{:else if setting.type === 'select'}
		<div class="classic-field">
			<div class="form_row left">
				<select
					id={inputId}
					value={stringValue}
					aria-describedby={describedBy}
					{disabled}
					onchange={(e) => emit(e.currentTarget.value)}
				>
					{#each setting.options as option (option.value)}
						<option
							value={option.value}
							disabled={!optionAvailable(availability, option.value).available}
						>{option.label}</option>
					{/each}
				</select>
				<label for={inputId}>{setting.label}</label>
			</div>
			{@render help()}
		</div>
	{:else if setting.type === 'toggle'}
		<div class="classic-field">
			<div class="toggle-wrap">
				<label for={inputId}>{setting.label}</label>
				<span class="toggle">
					<input
						id={inputId}
						type="checkbox"
						checked={boolValue}
						aria-describedby={describedBy}
						{disabled}
						onchange={(e) => emit(e.currentTarget.checked)}
					/>
					<span class="toggle-slider" aria-hidden="true"></span>
				</span>
			</div>
			{@render help()}
		</div>
	{:else if setting.type === 'text' && range && rangeState}
		<div class="classic-field stacked">
			<label for={inputId}>{setting.label}</label>
			<div class="classic-range">
				<input
					id={inputId}
					type="range"
					min={range.min}
					max={range.max}
					step={range.step}
					value={rangeState.shown}
					aria-describedby={describedBy}
					{disabled}
					aria-valuetext={rangeState.blank
						? `${range.blankLabel}`
						: range.unit
							? `${rangeState.shown} ${range.unit}`
							: String(rangeState.shown)}
					oninput={(e) => emit(String(Number(e.currentTarget.value)))}
				/>
				<output for={inputId} class="classic-range-out"
					>{rangeState.blank
						? range.blankLabel
						: range.unit
							? `${rangeState.shown}${range.unit}`
							: rangeState.shown}</output
				>
				<button
					type="button"
					class="classic-clear{rangeState.blank ? ' on' : ''}"
					aria-pressed={rangeState.blank}
					{disabled}
					onclick={() => emit('')}>{range.blankLabel}</button
				>
			</div>
			{@render help()}
		</div>
	{:else if setting.type === 'text'}
		<div class="classic-field stacked">
			<label for={inputId}>{setting.label}</label>
			<input
				id={inputId}
				type="text"
				value={stringValue}
				placeholder={setting.placeholder}
				aria-describedby={describedBy}
				readonly={disabled}
				oninput={onText}
			/>
			{@render help()}
		</div>
	{:else if setting.type === 'color'}
		{@const clearId = `${inputId}-clear`}
		<div class="classic-field">
			<div class="toggle-wrap">
				<label for={inputId}>{setting.label}</label>
				<span class="classic-color">
					{#if setting.allowTransparent}
						<button
							type="button"
							id={clearId}
							class="classic-clear{stringValue === '' ? ' on' : ''}"
							aria-pressed={stringValue === ''}
							{disabled}
							onclick={() => emit('')}>Transparent</button
						>
					{/if}
					<input
						id={inputId}
						type="color"
						value={stringValue || '#191919'}
						aria-describedby={describedBy}
						{disabled}
						oninput={(e) => emit(e.currentTarget.value)}
					/>
				</span>
			</div>
			{@render help()}
		</div>
	{:else if setting.type === 'multiselect'}
		<div class="classic-field">
			<fieldset class="classic-chips" aria-describedby={describedBy}>
				<legend>{setting.label}</legend>
				<div class="classic-chip-row">
					{#each setting.options as option (option.value)}
						{@const available = optionAvailable(availability, option.value).available}
						{@const on = selectedChips.includes(option.value) && available}
						{@const chipId = `${inputId}-${option.value}`}
						<span class="classic-chip">
							<input
								id={chipId}
								type="checkbox"
								checked={on}
								disabled={disabled || !available}
								onchange={(e) => toggleChip(option.value, e.currentTarget.checked)}
							/>
							<label for={chipId} class="classic-chip-label{on ? ' on' : ''}" data-platform={option.value}
								>{option.label}</label
							>
						</span>
					{/each}
				</div>
			</fieldset>
			{@render help()}
		</div>
	{:else if setting.type === 'number'}
		<div class="classic-field">
			<div class="form_row left">
				<input
					id={inputId}
					type="number"
					class="short"
					value={typeof value === 'number' ? value : setting.default}
					min={setting.min}
					max={setting.max}
					step={setting.step}
					aria-describedby={describedBy}
					{disabled}
					oninput={onNumber}
				/>
				<label for={inputId}>{setting.unit ? `${setting.label} (${setting.unit})` : setting.label}</label>
			</div>
			{@render help()}
		</div>
	{/if}
{/if}
