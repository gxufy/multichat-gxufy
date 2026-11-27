<script lang="ts">
	/*
	 * A platform channel field with suggestions. The searches live in the
	 * shared channelSearch.ts.
	 * Avatars load straight from the platforms' image hosts, and only from
	 * those (channelAvatar.ts).
	 */
	import {
		CHANNEL_SEARCHES,
		formatViewers,
		type ChannelAutocompleteSuggestion,
		type ChannelSearchPlatform
	} from '@/components/classic/channelSearch';
	import { channelAvatarUrl } from './channelAvatar.ts';

	let {
		id,
		name,
		placeholder,
		value,
		onValueChange,
		platform
	}: {
		id: string;
		name: string;
		placeholder?: string;
		value: string;
		onValueChange: (value: string) => void;
		platform: ChannelSearchPlatform;
	} = $props();

	type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

	const source = $derived(CHANNEL_SEARCHES[platform]);
	let suggestions = $state.raw<ChannelAutocompleteSuggestion[]>([]);
	let status = $state<SearchStatus>('idle');
	let open = $state(false);
	let activeIndex = $state(-1);
	let root: HTMLDivElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let pending: AbortController | null = null;
	let request = 0;
	let alive = true;

	const listboxId = $derived(`${id}-suggestions`);

	function isAbort(error: unknown): boolean {
		return error instanceof DOMException && error.name === 'AbortError';
	}

	function cancelPending() {
		if (debounce) clearTimeout(debounce);
		debounce = null;
		pending?.abort();
		pending = null;
		request += 1;
	}

	function close() {
		cancelPending();
		open = false;
		activeIndex = -1;
	}

	$effect(() => {
		alive = true;
		const handleOutsidePointer = (event: PointerEvent) => {
			if (!root?.contains(event.target as Node)) close();
		};
		document.addEventListener('pointerdown', handleOutsidePointer);
		return () => {
			alive = false;
			document.removeEventListener('pointerdown', handleOutsidePointer);
			cancelPending();
		};
	});

	function scheduleSearch(rawValue: string) {
		cancelPending();
		suggestions = [];
		open = false;
		activeIndex = -1;

		const query = source.normalizeQuery(rawValue);
		if (!query) {
			status = 'idle';
			return;
		}
		const requestId = request;
		const { search, debounceMs } = source;
		debounce = setTimeout(() => {
			debounce = null;
			const controller = new AbortController();
			pending = controller;
			status = 'loading';
			void search(query, controller.signal)
				.then((results) => {
					if (!alive || controller.signal.aborted || requestId !== request) return;
					suggestions = results;
					status = 'success';
					open = results.length > 0;
					activeIndex = -1;
				})
				.catch((error: unknown) => {
					if (isAbort(error) || controller.signal.aborted || !alive || requestId !== request) return;
					suggestions = [];
					status = 'error';
					open = false;
					activeIndex = -1;
				})
				.finally(() => {
					if (pending === controller) pending = null;
				});
		}, debounceMs);
	}

	function selectSuggestion(suggestion: ChannelAutocompleteSuggestion) {
		cancelPending();
		onValueChange(suggestion.value);
		input?.focus();
		suggestions = [];
		status = 'idle';
		open = false;
		activeIndex = -1;
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			if (open || status === 'loading') event.preventDefault();
			close();
			return;
		}
		if (!suggestions.length) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			open = true;
			activeIndex = activeIndex < suggestions.length - 1 ? activeIndex + 1 : 0;
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			open = true;
			activeIndex = activeIndex > 0 ? activeIndex - 1 : suggestions.length - 1;
			return;
		}
		if (event.key === 'Enter' && open && activeIndex >= 0) {
			event.preventDefault();
			selectSuggestion(suggestions[activeIndex]);
		}
	}

	const statusText = $derived(
		status === 'loading'
			? `Searching ${source.label} channels.`
			: status === 'error'
				? `${source.label} channel search is temporarily unavailable.`
				: status === 'success'
					? suggestions.length
						? `${suggestions.length} ${source.label} channel suggestion${suggestions.length === 1 ? '' : 's'} available.`
						: `No ${source.label} channels found.`
					: ''
	);
</script>

<div class="channel-autocomplete" data-platform={platform} bind:this={root}>
	<input
		bind:this={input}
		{id}
		type="text"
		{name}
		{placeholder}
		{value}
		autocomplete="off"
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={open ? listboxId : undefined}
		aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
		oninput={(event) => {
			const nextValue = event.currentTarget.value;
			onValueChange(nextValue);
			scheduleSearch(nextValue);
		}}
		onfocus={() => {
			if (suggestions.length) open = true;
		}}
		onkeydown={handleKeyDown}
	/>

	{#if open}
		<div id={listboxId} class="channel-suggestions" role="listbox" aria-label={`${source.label} channel suggestions`}>
			{#each suggestions as suggestion, index (suggestion.value)}
				{@const avatar = channelAvatarUrl(suggestion.thumbnailUrl)}
				<button
					id={`${listboxId}-${index}`}
					class="channel-suggestion"
					type="button"
					role="option"
					aria-selected={activeIndex === index}
					tabindex={-1}
					onmouseenter={() => (activeIndex = index)}
					onpointerdown={(event) => event.preventDefault()}
					onclick={() => selectSuggestion(suggestion)}
				>
					{#if avatar}<img
							class="channel-suggestion-avatar"
							src={avatar}
							alt=""
							width="38"
							height="38"
							loading="lazy"
							decoding="async"
							referrerpolicy="no-referrer"
							style:color="transparent"
						/>{:else}<span class="channel-suggestion-avatar channel-suggestion-avatar-fallback" aria-hidden="true"
							>{suggestion.displayName.slice(0, 1).toUpperCase()}</span
						>{/if}<span class="channel-suggestion-copy"
						><span class="channel-suggestion-title"
							><span class="channel-suggestion-display-name">{suggestion.displayName}</span
							>{#if suggestion.isLive}<span class="channel-suggestion-live">LIVE</span>{/if}{#if suggestion.isLive && typeof suggestion.viewers === 'number'}<span
									class="channel-suggestion-viewers"
									aria-label={`${suggestion.viewers.toLocaleString('en-US')} viewers`}
									><span class="channel-suggestion-dot" aria-hidden="true"></span>{formatViewers(suggestion.viewers)}</span
								>{/if}{#if suggestion.isLive && suggestion.category}<span class="channel-suggestion-category"
									>{suggestion.category}</span
								>{/if}</span
						><span class="channel-suggestion-meta"
							><span>{suggestion.meta}</span
							>{#if suggestion.sharedChat}<span class="channel-suggestion-shared"
									>Shared chat · {suggestion.sharedChat} channels</span
								>{/if}{#if suggestion.secondary && !(suggestion.isLive && suggestion.category)}<span
									>{suggestion.secondary}</span
								>{/if}</span
						></span
					>
				</button>
			{/each}
		</div>
	{/if}

	<span class="sr-only" role="status" aria-live="polite">{statusText}</span>
</div>
