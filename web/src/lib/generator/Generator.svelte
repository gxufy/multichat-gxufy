<script lang="ts">
	/*
	 * The FlossChat generator.
	 *
	 * Generated URLs come from the tools' own serializers (multichatTool,
	 * counterTool, buildOverlayUrl), so a URL from here is byte-identical for
	 * the same settings. The previews draw
	 * with the production renderers through the preview bridge (see
	 * BridgeFrame.svelte); Live Overlay embeds the exact generated URL.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { CLASSIC_GENERATOR_CSS } from '@/components/classic/classicStyles';
	import { GENERATOR_MOTION_CSS } from '@/components/site/motion';
	import { GENERATOR_THEME_CSS, GENERATOR_THEME_FONT_SPECS } from './generatorTheme.ts';
	import { GENERATOR_SPRING_MOTION_CSS } from './generatorMotion.ts';
	import { glide } from './glide.ts';
	import {
		browserLocalStorage,
		defaultCollapsedSections,
		readCollapsedSections,
		writeCollapsedSections,
		type ClassicCollapsibleSectionId
	} from '@/components/classic/collapsedSections';
	import type { SettingRange } from '@/components/classic/settingRow';
	import type { MultichatFontSelection } from '@/components/classic/multichatFontCatalog';
	import { PREVIEW_ROSTER } from '@/features/multichat/previewRoster';
	import {
		LOCAL_OVERLAY_FONT_CSS,
		OVERLAY_FONT_FAMILIES,
		OVERLAY_FONT_SPECS,
		UI_FONT_SPECS,
		googleFontsImportCss
	} from '@/lib/overlayFonts';
	import { MULTICHAT_OBS_RECOMMENDED, MULTICHAT_OBS_SIZE } from '@/features/multichat/obs';
	import { multichatTool } from '@/features/multichat/config';
	import { counterTool } from '@/features/counter/config';
	import { SAMPLE_COUNTER_COUNTS, sampleCounterStatuses } from '@/features/counter/samples';
	import type { MultichatPlatform, MultichatWorkspaceStyle } from '@/lib/multichatConfig';
	import {
		COUNTER_FONT_FAMILY,
		DEFAULT_STYLE as COUNTER_DEFAULT_STYLE,
		type ViewerCounterStyle,
		type ViewerPlatform
	} from '@/lib/viewerCounterConfig';
	import type { ToolChannels } from '@/features/registry';
	import {
		colorSetting,
		selectSetting,
		textSetting,
		toggleSetting,
		type Setting as CatalogSetting,
		type SettingValue
	} from '@/lib/tools/settingTypes';
	import { buildOverlayUrl } from '@/lib/tools/toolContext';
	import {
		CANONICAL_MULTICHAT_ROUTE,
		COUNTER_SECTION_ID,
		wantsCounterSection
	} from '@/lib/multichatRouting';
	import { CANONICAL_ORIGIN, HOME_ORIGIN } from '@/lib/domains.mjs';
	import { parsedQuery } from '#lib/site/query.ts';
	import SiteFooter from '#lib/site/SiteFooter.svelte';
	import BadgesDashboard from '#lib/badges/BadgesDashboard.svelte';
	import SupportCheckout from '#lib/support/SupportCheckout.svelte';
	import ChannelAutocomplete from './ChannelAutocomplete.svelte';
	import ChatPreview from './ChatPreview.svelte';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import CommandsHelp from './CommandsHelp.svelte';
	import FontPicker from './FontPicker.svelte';
	import LiveOverlayFrame from './LiveOverlayFrame.svelte';
	import PopupShell from './PopupShell.svelte';
	import SectionNav from './SectionNav.svelte';
	import Setting from './Setting.svelte';
	import ViewersPreview from './ViewersPreview.svelte';
	import UsedBy from './usedBy/UsedBy.svelte';
	import { createCounterPreviewFeed } from './previewFeeds.svelte.ts';
	import { createSampleChatPreview } from './sampleChatPreview.svelte.ts';

	/* Every face this page needs: its own UI typography plus all overlay
	   families, because the font picker renders each option in its own face. */
	const GENERATOR_FONT_CSS = googleFontsImportCss([
		...Object.values(UI_FONT_SPECS),
		...GENERATOR_THEME_FONT_SPECS,
		...Object.values(OVERLAY_FONT_SPECS)
	]);

	const FONT_FAMILIES = OVERLAY_FONT_FAMILIES;
	const COUNTER_FONT_FAMILIES: Readonly<Record<string, string>> = {
		...FONT_FAMILIES,
		dejavu: COUNTER_FONT_FAMILY
	};

	const COPIED_MS = 2000;
	const RESET_STATUS_MS = 3000;

	const MC = multichatTool.catalog;
	const VC = counterTool.catalog;

	const MC_FONT = selectSetting(MC, 'font');
	const MC_TEXT_SIZE = selectSetting(MC, 'textSize');
	const MC_FONT_WEIGHT = selectSetting(MC, 'fontWeight');
	const MC_TEXT_TRANSFORM = selectSetting(MC, 'textTransform');
	const MC_FONT_ITALIC = toggleSetting(MC, 'fontItalic');
	const MC_STROKE = selectSetting(MC, 'stroke');
	const MC_TEXT_SHADOW = selectSetting(MC, 'textShadow');
	const MC_ANIMATION = selectSetting(MC, 'animation');
	const MC_ENTRY_ANIMATION = selectSetting(MC, 'entryAnimation');
	const MC_EMOTE_SCALE = textSetting(MC, 'emoteScale');
	const MC_GIF_SIZE = textSetting(MC, 'gifSize');
	const MC_SOURCE_TAG = selectSetting(MC, 'sourceTag');
	const MC_SEVENTV_EMOTES = toggleSetting(MC, 'sevenTVEmotesEnabled');
	const MC_SEVENTV_COSMETICS = toggleSetting(MC, 'sevenTVCosmeticsEnabled');
	const MC_JILTV_EMOTES = toggleSetting(MC, 'jiltvEmotesEnabled');
	const MC_JILTV_COSMETICS = toggleSetting(MC, 'jiltvCosmeticsEnabled');
	const MC_JILTV_PAINT_SHADOWS = toggleSetting(MC, 'jiltvPaintShadows');
	const MC_COMMUNITY_BADGES = toggleSetting(MC, 'showCommunityBadges');
	const MC_HIDE_BADGES = toggleSetting(MC, 'hideBadges');
	const MC_PAINT_SHADOWS = toggleSetting(MC, 'paintShadows');
	const MC_FADE_ENABLED = toggleSetting(MC, 'fadeEnabled');
	const MC_FADE = textSetting(MC, 'fade');
	const MC_SHARED_CHAT = toggleSetting(MC, 'sharedChatEnabled');
	const MC_REPLY_STYLE = selectSetting(MC, 'replyStyle');
	const MC_RESTORE_ON_RELOAD = toggleSetting(MC, 'restoreOnReload');
	const MC_MAX_MESSAGE_LINES = textSetting(MC, 'maxMessageLines');
	const MC_MAX_MESSAGE_AGE = textSetting(MC, 'maxMessageAge');
	const MC_SHOW_SYSTEM_MSGS = toggleSetting(MC, 'showSystemMsgs');
	const MC_SHOW_FIRST_MESSAGES = toggleSetting(MC, 'showFirstMessages');
	const MC_SHOW_REDEEMS = toggleSetting(MC, 'showRedeems');
	const MC_HIDE_NAMES = toggleSetting(MC, 'hideNames');
	const MC_MOD_ACTION = toggleSetting(MC, 'modAction');
	const MC_MENTION_COLOR = toggleSetting(MC, 'mentionColor');
	const MC_BG_COLOR = colorSetting(MC, 'bgColor');
	const MC_FONT_COLOR = colorSetting(MC, 'fontColor');
	const MC_PERMITTED_BOTS = textSetting(MC, 'permittedBots');
	const MC_USER_BL = textSetting(MC, 'userBL');
	const MC_PREFIX_BL = textSetting(MC, 'prefixBL');

	const VC_COMBINED = toggleSetting(VC, 'combined');
	const VC_ICONS = toggleSetting(VC, 'icons');
	const VC_BG = toggleSetting(VC, 'bg');
	const VC_ALIGN = selectSetting(VC, 'align');
	const VC_FONT = selectSetting(VC, 'font');
	const VC_FONT_WEIGHT = selectSetting(VC, 'fontWeight');
	const VC_TEXT_TRANSFORM = selectSetting(VC, 'textTransform');
	const VC_FONT_ITALIC = toggleSetting(VC, 'fontItalic');
	const VC_TEXT_SIZE = selectSetting(VC, 'textSize');
	const VC_FONT_COLOR = colorSetting(VC, 'fontColor');
	const VC_TEXT_SHADOW = selectSetting(VC, 'textShadow');
	const VC_STROKE = selectSetting(VC, 'stroke');

	const FADE_RANGE: SettingRange = { min: 1, max: 120, step: 1, unit: 's', blankLabel: 'Never' };
	const EMOTE_SCALE_RANGE: SettingRange = { min: 0.5, max: 3, step: 0.1, unit: '×', blankLabel: 'Default' };

	const PLATFORM_TAG: Record<string, string> = {
		kick: 'kick-tag',
		twitch: 'tw-tag',
		youtube: 'yt-tag',
		tiktok: 'tt-tag'
	};

	/* ---------------------------------------------------------------- */
	/* State                                                            */
	/* ---------------------------------------------------------------- */

	let chatStyle = $state.raw<MultichatWorkspaceStyle>(multichatTool.defaults);
	let counterStyle = $state.raw<ViewerCounterStyle>(counterTool.defaults);
	let channels = $state.raw<ToolChannels<string>>({});
	let baseUrl = $state(CANONICAL_ORIGIN);
	let support = $state.raw<{ checkoutReady: boolean; signInReady: boolean } | null>(null);
	let supportOpen = $state(false);
	let badgesOpen = $state(false);
	let copiedChat = $state(false);
	let copiedCounter = $state(false);
	let chatResetStatus = $state('');
	let counterResetStatus = $state('');
	let collapsedSections = $state.raw<Set<ClassicCollapsibleSectionId>>(defaultCollapsedSections());
	let collapsePreferencesReady = $state(false);
	let chatResetTimer: ReturnType<typeof setTimeout> | null = null;
	let counterResetTimer: ReturnType<typeof setTimeout> | null = null;
	let chatPreviewMode = $state<'data' | 'live'>('data');
	let chatPreviewHovered = $state(false);

	/* Preview Data: the catalog's identities with their live cosmetics and the
	   sample feed (the Pogly chat preview page shows the same). The feed holds
	   while the pointer is over the preview. */
	const samplePreview = createSampleChatPreview({
		suspended: () => chatPreviewMode === 'data' && chatPreviewHovered
	});

	const counterPlatforms = $derived(
		counterTool.configuredPlatforms(channels as ToolChannels<ViewerPlatform>)
	);
	const counterConfigured = $derived(counterPlatforms.length > 0);

	/* The counter's Preview Data: a rotation of sample states; the fixed sample
	   counts until its first tick. */
	const counterSim = createCounterPreviewFeed();
	const manualStatuses = sampleCounterStatuses({ ...SAMPLE_COUNTER_COUNTS });
	const counterStatuses = $derived(counterSim.statuses ?? manualStatuses);

	/* Back from Twitch sign-in started in a popup: open it again and tidy the URL. */
	onMount(() => {
		let cancelled = false;
		void fetch('/api/support/status', { cache: 'no-store' })
			.then(async (response) => {
				if (!response.ok) return null;
				const body = (await response.json().catch(() => null)) as {
					checkoutReady?: unknown;
					signInReady?: unknown;
				} | null;
				return { checkoutReady: body?.checkoutReady === true, signInReady: body?.signInReady === true };
			})
			.catch(() => null)
			.then((value) => {
				if (cancelled || !value) return;
				support = value;
				const params = new URLSearchParams(window.location.search);
				const reopenBadges = params.get('badges') === '1';
				const reopenSupport = params.get('support') === '1';
				if (reopenBadges || reopenSupport) {
					params.delete('badges');
					params.delete('support');
					const rest = params.toString();
					/* Keep SvelteKit's own history entry data (Back/Forward). */
					window.history.replaceState(
						window.history.state,
						'',
						`${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`
					);
					if (reopenBadges && value.signInReady) badgesOpen = true;
					else if (reopenSupport && value.checkoutReady) supportOpen = true;
				}
			});

		baseUrl = window.location.origin;
		collapsedSections = readCollapsedSections(browserLocalStorage());
		collapsePreferencesReady = true;

		/* Old links: ?tab=counter (no fragment to act on) or #viewer-counter. */
		if (wantsCounterSection(parsedQuery(new URLSearchParams(page.url.search)), window.location.hash)) {
			document.getElementById(COUNTER_SECTION_ID)?.scrollIntoView({ block: 'start' });
		}

		return () => {
			cancelled = true;
			if (chatResetTimer) clearTimeout(chatResetTimer);
			if (counterResetTimer) clearTimeout(counterResetTimer);
		};
	});

	$effect(() => {
		if (!collapsePreferencesReady) return;
		writeCollapsedSections(browserLocalStorage(), collapsedSections);
	});

	/* ---------------------------------------------------------------- */
	/* Change handlers                                                  */
	/* ---------------------------------------------------------------- */

	function changeChat(key: string, next: SettingValue) {
		chatStyle = multichatTool.normalize({ ...chatStyle, [key]: next });
	}

	function changeChatFont(selection: MultichatFontSelection) {
		chatStyle = multichatTool.normalize({ ...chatStyle, ...selection });
	}

	function changeCounter(key: string, next: SettingValue) {
		counterStyle = counterTool.normalize({ ...counterStyle, [key]: next });
	}

	function changeCounterFont(selection: MultichatFontSelection) {
		counterStyle = counterTool.normalize({
			...counterStyle,
			font: selection.font as ViewerCounterStyle['font'],
			googleFont: selection.googleFont
		});
	}

	function toggleSettingsSection(sectionId: ClassicCollapsibleSectionId) {
		const next = new Set(collapsedSections);
		if (next.has(sectionId)) next.delete(sectionId);
		else next.add(sectionId);
		collapsedSections = next;
	}

	function resetChatSettings() {
		chatStyle = multichatTool.normalize({ ...multichatTool.defaults });
		chatResetStatus = 'Chat settings restored to defaults.';
		if (chatResetTimer) clearTimeout(chatResetTimer);
		chatResetTimer = setTimeout(() => {
			chatResetTimer = null;
			chatResetStatus = '';
		}, RESET_STATUS_MS);
	}

	function resetCounterSettings() {
		counterStyle = counterTool.normalize({ ...counterTool.defaults });
		counterResetStatus = 'Viewer settings restored to defaults.';
		if (counterResetTimer) clearTimeout(counterResetTimer);
		counterResetTimer = setTimeout(() => {
			counterResetTimer = null;
			counterResetStatus = '';
		}, RESET_STATUS_MS);
	}

	function changeChannel(platform: string, raw: string) {
		channels = { ...channels, [platform]: raw };
	}

	/* ---------------------------------------------------------------- */
	/* Derived URLs: the tools' own serializers                         */
	/* ---------------------------------------------------------------- */

	const chatQuery = $derived(
		multichatTool.serialize(channels as ToolChannels<MultichatPlatform>, chatStyle)
	);
	const chatUrl = $derived(
		buildOverlayUrl({ baseUrl, route: multichatTool.overlayRoute, query: chatQuery })
	);
	const counterQuery = $derived(
		counterTool.serialize(channels as ToolChannels<ViewerPlatform>, counterStyle)
	);
	const counterUrl = $derived(
		buildOverlayUrl({ baseUrl, route: counterTool.overlayRoute, query: counterQuery })
	);
	const chatConfigured = $derived(
		multichatTool.configuredPlatforms(channels as ToolChannels<MultichatPlatform>).length > 0
	);

	/* Channels appear → Live Overlay; the last one cleared → Preview Data. */
	let previousChatConfigured = false;
	$effect(() => {
		const configured = chatConfigured;
		const was = previousChatConfigured;
		previousChatConfigured = configured;
		if (!was && configured) chatPreviewMode = 'live';
		if (was && !configured) chatPreviewMode = 'data';
	});

	const counterShowingSamples = $derived(!counterConfigured);
	const chatHasFragment = $derived(chatUrl.includes('#'));

	function copyChat() {
		void navigator.clipboard?.writeText(chatUrl);
		copiedChat = true;
		setTimeout(() => (copiedChat = false), COPIED_MS);
	}

	function copyCounter() {
		void navigator.clipboard?.writeText(counterUrl);
		copiedCounter = true;
		setTimeout(() => (copiedCounter = false), COPIED_MS);
	}

	const chatSize = `${MULTICHAT_OBS_RECOMMENDED.width} × ${MULTICHAT_OBS_RECOMMENDED.height}`;
	const counterSize = `${counterTool.obs.width} × ${counterTool.obs.height}`;
</script>

<svelte:head>
	<title>FlossChat | Kick · Twitch · YouTube · TikTok Chat Overlay</title>
	<meta
		name="description"
		content="Free multi-platform chat overlay for OBS by gxufy — Kick, Twitch, YouTube & TikTok in one browser source. 7TV/BTTV/FFZ emotes, real badges, name-paints, pins, and a live viewer counter. No login required."
	/>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	{@html `<style>${GENERATOR_FONT_CSS}\n${LOCAL_OVERLAY_FONT_CSS}</style>`}
	{@html '<style>@font-face{font-family:Alsina;src:url(/fonts/Alsina_Ultrajada.ttf);}</style>'}
</svelte:head>

{@html `<style>${CLASSIC_GENERATOR_CSS}</style>`}
{@html `<style>${GENERATOR_MOTION_CSS}</style>`}
{@html `<style>${GENERATOR_THEME_CSS}</style>`}
{@html `<style>${GENERATOR_SPRING_MOTION_CSS}</style>`}

<a href="#generator-main" class="skip-link">Skip to the generator</a>

{#snippet chatSetting(setting: CatalogSetting<MultichatWorkspaceStyle>, extra?: { segmented?: boolean; range?: SettingRange })}
	<Setting
		{setting}
		value={chatStyle[setting.key] as SettingValue}
		onChange={changeChat}
		idPrefix="mc"
		segmented={extra?.segmented}
		range={extra?.range}
	/>
{/snippet}

{#snippet counterSetting(setting: CatalogSetting<ViewerCounterStyle>, extra?: { segmented?: boolean })}
	<Setting
		{setting}
		value={counterStyle[setting.key] as SettingValue}
		onChange={changeCounter}
		idPrefix="vc"
		segmented={extra?.segmented}
	/>
{/snippet}

<div class="page">
	<header class="header-strip">
		<a href={HOME_ORIGIN} class="home-link" title="Back to homepage"
			><svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				width="15"
				height="15"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"></path><path d="M5 9.5V20h14V9.5"></path></svg
			>Home</a
		>
		<a href={CANONICAL_MULTICHAT_ROUTE} aria-label="FlossChat home" class="header-logo-link"
			><img src="/flosschat-logo.png" alt="" class="header-logo" width="127" height="192" /></a
		>
		<div class="header-copy">
			<p class="header-title">FlossChat</p>
			<p class="header-sub">Every chat. One overlay. No login.</p>
			<div class="platform-row">
				<span class="platform-chip kick-tag">Kick</span><span class="platform-chip tw-tag">Twitch</span><span
					class="platform-chip yt-tag">YouTube</span
				><span class="platform-chip tt-tag">TikTok</span>
			</div>
		</div>
	</header>
	<SectionNav
		onSupport={support ? () => (supportOpen = true) : undefined}
		onBadges={support?.signInReady ? () => (badgesOpen = true) : undefined}
	/>
	{#if support}
		<PopupShell open={supportOpen} onClose={() => (supportOpen = false)} label="Support FlossChat">
			<SupportCheckout variant="modal" />
		</PopupShell>
	{/if}
	{#if support?.signInReady}
		<PopupShell open={badgesOpen} onClose={() => (badgesOpen = false)} label="Your FlossChat badges" width="860px">
			<BadgesDashboard
				variant="modal"
				signInNext="/multichat?badges=1"
				onGetBadge={() => {
					badgesOpen = false;
					supportOpen = true;
				}}
			/>
		</PopupShell>
	{/if}

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<main id="generator-main" tabindex={-1}>
		<h1 class="sr-only">FlossChat and FlossCounter — chat overlay and viewer counter generator for OBS</h1>

		<section class="card hero" id="channels" aria-labelledby="channels-heading">
			<h2 id="channels-heading" class="section-title">Your channels</h2>

			<div class="platform-inputs">
				{#each multichatTool.platforms as platform (platform.key)}
					{@const inputId = `channel-${platform.key}`}
					<div class="platform-input">
						<label for={inputId} class={`platform-tag ${PLATFORM_TAG[platform.key] ?? ''}`}>{platform.label}</label>
						{#if platform.key === 'twitch' || platform.key === 'kick' || platform.key === 'youtube' || platform.key === 'tiktok'}
							<ChannelAutocomplete
								id={inputId}
								name={platform.key}
								placeholder={platform.placeholder}
								value={channels[platform.key] ?? ''}
								onValueChange={(value) => changeChannel(platform.key, value)}
								platform={platform.key}
							/>
						{:else}
							<input
								id={inputId}
								type="text"
								name={platform.key}
								placeholder={platform.placeholder}
								value={channels[platform.key] ?? ''}
								oninput={(e) => changeChannel(platform.key, e.currentTarget.value)}
							/>
						{/if}
					</div>
				{/each}
			</div>

			<UsedBy />
		</section>

		<div class="tool-grid">
			<section class="card panel-chat-output" id="chat" aria-labelledby="chat-output-heading">
				<div class="preview-content-head">
					<div>
						<h2 id="chat-output-heading" class="preview-content-title">Chat Preview</h2>
						<p class="section-sub">See exactly how chat looks before you add it to OBS.</p>
					</div>
					{#if chatPreviewMode === 'data'}
						<span class="preview-badge">Preview Data</span>
					{/if}
				</div>

				<div class="preview-mode-tabs" role="tablist" aria-label="Chat preview mode" use:glide={'.preview-mode-tab.active'}>
					<button
						type="button"
						role="tab"
						id="chat-preview-mode-data"
						aria-controls="chat-preview-mode-panel"
						aria-selected={chatPreviewMode === 'data'}
						class="preview-mode-tab{chatPreviewMode === 'data' ? ' active' : ''}"
						onclick={() => (chatPreviewMode = 'data')}>Preview Data</button
					>
					<button
						type="button"
						role="tab"
						id="chat-preview-mode-live"
						aria-controls="chat-preview-mode-panel"
						aria-selected={chatPreviewMode === 'live'}
						class="preview-mode-tab{chatPreviewMode === 'live' ? ' active' : ''}"
						onclick={() => (chatPreviewMode = 'live')}
						disabled={!chatConfigured}>Live Overlay</button
					>
				</div>
				{#key chatPreviewMode}
					<div
						id="chat-preview-mode-panel"
						class="preview-mode-panel"
						role="tabpanel"
						aria-labelledby={`chat-preview-mode-${chatPreviewMode}`}
					>
						<p class="preview-mode-label">
							{chatPreviewMode === 'data'
								? 'Preview Data — sample messages, not live channel chat'
								: 'Live Overlay — exact generated Chat URL'}
						</p>

						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="preview-surface checkered"
							data-testid="chat-preview-surface"
							data-preview-background="transparent"
							data-preview-feed-running={samplePreview.running ? 'true' : 'false'}
							data-preview-feed-paused={samplePreview.paused ? 'true' : 'false'}
							onmouseenter={() => {
								if (chatPreviewMode === 'data') chatPreviewHovered = true;
							}}
							onmouseleave={() => (chatPreviewHovered = false)}
							style:background="transparent"
						>
							{#if chatPreviewMode === 'live'}
								<LiveOverlayFrame
									url={chatUrl}
									configured={chatConfigured}
									title="Live chat overlay preview"
									height={MULTICHAT_OBS_SIZE.height}
								/>
							{:else}
								<ChatPreview
									query={chatQuery}
									messages={samplePreview.messages}
									cosmetics={samplePreview.cosmetics}
									width={MULTICHAT_OBS_SIZE.width}
									height={MULTICHAT_OBS_SIZE.height}
									scale={63}
								/>
							{/if}
						</div>

						{#if chatPreviewMode === 'data'}
							<div class="preview-data-controls preview-data-controls-compact">
								<div class="preview-primary-actions preview-roster-actions">
									<p class="preview-roster-status" role="status">
										Preview catalog  {PREVIEW_ROSTER.length} identities{samplePreview.liveStatus === 'loading'
											? ' · updating cosmetics…'
											: ''}{samplePreview.liveStatus === 'live' ? ' · live cosmetics' : ''}{samplePreview.liveStatus ===
										'partial'
											? ' · some cosmetics from catalog'
											: ''}{samplePreview.liveStatus === 'failed' ? ' · cosmetics from catalog' : ''}
									</p>
								</div>
							</div>
						{/if}

						<a class="pogly-widget-button" href="https://widget.pogly.gg/4105" target="_blank" rel="noopener noreferrer"
							><img
								src="/images/pogly.png"
								alt="Pogly"
								width="18"
								height="18"
								style:flex="0 0 auto"
								style:object-fit="contain"
								style:margin-right="7px"
							/>Pogly Widget</a
						>
					</div>
				{/key}

				<div class="url-box">
					<div class="url-code" aria-label="Generated FlossChat overlay URL">{chatUrl}</div>
					<div class="url-actions">
						<button type="button" onclick={copyChat} class="url-copy{copiedChat ? ' ok' : ''}"
							>{copiedChat ? '✓ Copied' : 'Copy'}</button
						>
						<a class="url-open" href={chatUrl} target="_blank" rel="noreferrer">Open</a>
					</div>
					<p class="url-warn" role="status">
						{chatHasFragment
							? 'This URL ends in a private connection key for your Twitch pins. Paste it into your own OBS only — do not share it or post it publicly.'
							: ''}
					</p>
				</div>
				<p class="sr-only" role="status">{copiedChat ? 'FlossChat overlay URL copied to the clipboard.' : ''}</p>
			</section>

			<section class="card panel-chat-settings" id="settings" aria-labelledby="chat-settings-heading">
				<div class="settings-panel-head">
					<h2 id="chat-settings-heading" class="section-title">Chat settings</h2>
					<button
						type="button"
						class="classic-conn-btn settings-reset-btn"
						aria-label="Reset Chat Settings to Default"
						onclick={resetChatSettings}>Reset Chat Defaults</button
					>
				</div>
				<p class="sr-only" role="status" aria-live="polite">{chatResetStatus}</p>

				<div class="form_table cols-3">
					<CollapsibleSection
						sectionId="chat-text"
						title="Text"
						collapsed={collapsedSections.has('chat-text')}
						onToggle={toggleSettingsSection}
						className="settings-group-wide text-settings-group"
						bodyClassName="text-settings-layout"
					>
						<div class="typography-panel">
							<div class="typography-heading">
								<h4>Typography</h4>
							</div>
							<div class="typography-primary-grid">
								<FontPicker
									id="mc-font"
									customInputId="mc-googleFont"
									showCustomInput
									label={MC_FONT.label}
									options={MC_FONT.options}
									presetFont={chatStyle.font}
									customFont={chatStyle.googleFont}
									fontFamilies={FONT_FAMILIES}
									onChange={changeChatFont}
								/>
								<div class="typography-style-field">
									{@render chatSetting(MC_FONT_WEIGHT)}
								</div>
							</div>
							<div class="typography-secondary-grid">
								{@render chatSetting(MC_TEXT_TRANSFORM, { segmented: true })}
								<div class="typography-italic-field">
									{@render chatSetting(MC_FONT_ITALIC)}
								</div>
							</div>
							{@render chatSetting(MC_FONT_COLOR)}
							<div class="typography-size-field">
								{@render chatSetting(MC_TEXT_SIZE, { segmented: true })}
							</div>
						</div>
						<div class="typography-effects">
							<p class="typography-subheading">Effects &amp; background</p>
							{@render chatSetting(MC_STROKE, { segmented: true })}
							{@render chatSetting(MC_TEXT_SHADOW, { segmented: true })}
							{@render chatSetting(MC_BG_COLOR)}
						</div>
					</CollapsibleSection>

					<CollapsibleSection
						sectionId="chat-appearance"
						title="Appearance"
						collapsed={collapsedSections.has('chat-appearance')}
						onToggle={toggleSettingsSection}
					>
						{@render chatSetting(MC_ANIMATION, { segmented: true })}
						{@render chatSetting(MC_ENTRY_ANIMATION, { segmented: true })}
						{@render chatSetting(MC_SOURCE_TAG, { segmented: true })}
						{@render chatSetting(MC_EMOTE_SCALE, { range: EMOTE_SCALE_RANGE })}
						{@render chatSetting(MC_FADE_ENABLED)}
						{#if chatStyle.fadeEnabled}{@render chatSetting(MC_FADE, { range: FADE_RANGE })}{/if}
					</CollapsibleSection>

					<CollapsibleSection
						sectionId="chat-emotes"
						title="Emotes & Badges"
						collapsed={collapsedSections.has('chat-emotes')}
						onToggle={toggleSettingsSection}
					>
						{@render chatSetting(MC_SEVENTV_EMOTES)}
						{@render chatSetting(MC_SEVENTV_COSMETICS)}
						{@render chatSetting(MC_JILTV_EMOTES)}
						{@render chatSetting(MC_JILTV_COSMETICS)}
						<p class="classic-help paint-tip">
							Wearing both a 7TV and a JilTV paint? Type <code>!flosschat paint jiltv</code> in chat
							to show your JilTV one, or <code>!flosschat paint 7tv</code> to go back.
						</p>
						{@render chatSetting(MC_GIF_SIZE)}
						{@render chatSetting(MC_COMMUNITY_BADGES)}
						{@render chatSetting(MC_HIDE_BADGES)}
						{@render chatSetting(MC_PAINT_SHADOWS)}
						{@render chatSetting(MC_JILTV_PAINT_SHADOWS)}
					</CollapsibleSection>
				</div>

				<div class="form_table cols-3">
					<CollapsibleSection
						sectionId="chat-messages"
						title="Messages"
						collapsed={collapsedSections.has('chat-messages')}
						onToggle={toggleSettingsSection}
					>
						{@render chatSetting(MC_REPLY_STYLE, { segmented: true })}
						{@render chatSetting(MC_HIDE_NAMES)}
						{@render chatSetting(MC_MENTION_COLOR)}
					</CollapsibleSection>

					<CollapsibleSection
						sectionId="chat-events"
						title="Events"
						collapsed={collapsedSections.has('chat-events')}
						onToggle={toggleSettingsSection}
					>
						{@render chatSetting(MC_SHOW_SYSTEM_MSGS)}
						{@render chatSetting(MC_SHOW_FIRST_MESSAGES)}
						{@render chatSetting(MC_SHOW_REDEEMS)}
						{@render chatSetting(MC_MOD_ACTION)}
					</CollapsibleSection>

					<CollapsibleSection
						sectionId="chat-extras"
						title="Extras"
						collapsed={collapsedSections.has('chat-extras')}
						onToggle={toggleSettingsSection}
					>
						{@render chatSetting(MC_SHARED_CHAT)}
						{@render chatSetting(MC_RESTORE_ON_RELOAD)}
						{#if chatStyle.restoreOnReload}{@render chatSetting(MC_MAX_MESSAGE_LINES)}{/if}
						{#if chatStyle.restoreOnReload}{@render chatSetting(MC_MAX_MESSAGE_AGE)}{/if}
					</CollapsibleSection>
				</div>

				<div class="form_table cols-2 settings-filter-table">
					<CollapsibleSection
						sectionId="chat-filters"
						title="Filters"
						collapsed={collapsedSections.has('chat-filters')}
						onToggle={toggleSettingsSection}
						className="settings-group-wide"
						bodyClassName="settings-filter-grid"
					>
						<div class="form_col">
							{@render chatSetting(MC_PERMITTED_BOTS)}
							{@render chatSetting(MC_PREFIX_BL)}
						</div>
						<div class="form_col">
							{@render chatSetting(MC_USER_BL)}
						</div>
					</CollapsibleSection>
				</div>
			</section>

			<section class="card panel-counter-output" id={COUNTER_SECTION_ID} aria-labelledby="counter-output-heading">
				<div class="preview-content-head">
					<div>
						<h2 id="counter-output-heading" class="preview-content-title">FlossCounter</h2>
						<p class="section-sub">Live viewers from every platform, combined into one count.</p>
					</div>
					{#if counterShowingSamples}<span class="preview-badge">Preview Data</span>{/if}
				</div>

				<div
					class="preview-surface checkered"
					data-testid="counter-preview-surface"
					data-preview-background="transparent"
					style:background="transparent"
				>
					{#if counterConfigured}
						<LiveOverlayFrame
							url={counterUrl}
							configured={counterConfigured}
							title="Live FlossCounter preview"
							height={counterTool.obs.height}
						/>
					{:else}
						<ViewersPreview
							query={counterQuery}
							statuses={counterStatuses}
							width={counterTool.obs.width}
							height={counterTool.obs.height}
						/>
					{/if}
				</div>

				<a class="pogly-widget-button" href="https://widget.pogly.gg/4106" target="_blank" rel="noopener noreferrer"
					><img
						src="/images/pogly.png"
						alt="Pogly"
						width="18"
						height="18"
						style:flex="0 0 auto"
						style:object-fit="contain"
						style:margin-right="7px"
					/>Pogly Widget</a
				>

				<div class="url-box">
					<div class="url-code" aria-label="Generated FlossCounter URL">{counterUrl}</div>
					<div class="url-actions">
						<button type="button" onclick={copyCounter} class="url-copy{copiedCounter ? ' ok' : ''}"
							>{copiedCounter ? '✓ Copied' : 'Copy'}</button
						>
						<a class="url-open" href={counterUrl} target="_blank" rel="noreferrer">Open</a>
					</div>
				</div>
				<p class="sr-only" role="status">{copiedCounter ? 'FlossCounter URL copied to the clipboard.' : ''}</p>
			</section>

			<section class="card panel-counter-settings" aria-labelledby="counter-settings-heading">
				<div class="settings-panel-head">
					<h2 id="counter-settings-heading" class="section-title">Counter settings</h2>
					<button
						type="button"
						class="classic-conn-btn settings-reset-btn"
						aria-label="Reset Viewer Settings to Default"
						onclick={resetCounterSettings}>Reset Counter Defaults</button
					>
				</div>
				<p class="sr-only" role="status" aria-live="polite">{counterResetStatus}</p>

				<div class="form_table cols-2">
					<CollapsibleSection
						sectionId="counter-typography"
						title="Typography"
						collapsed={collapsedSections.has('counter-typography')}
						onToggle={toggleSettingsSection}
						className="settings-group-wide counter-typography-group"
					>
						<div class="typography-panel counter-typography-panel">
							<div class="typography-primary-grid">
								<FontPicker
									id="vc-font"
									customInputId="vc-googleFont"
									label={VC_FONT.label}
									options={VC_FONT.options}
									presetFont={counterStyle.font ?? COUNTER_DEFAULT_STYLE.font!}
									customFont={counterStyle.googleFont ?? ''}
									fontFamilies={COUNTER_FONT_FAMILIES}
									onChange={changeCounterFont}
								/>
								<div class="typography-style-field">
									{@render counterSetting(VC_FONT_WEIGHT)}
								</div>
							</div>
							<div class="typography-secondary-grid">
								{@render counterSetting(VC_TEXT_TRANSFORM, { segmented: true })}
								<div class="typography-italic-field">
									{@render counterSetting(VC_FONT_ITALIC)}
								</div>
							</div>
							{@render counterSetting(VC_FONT_COLOR)}
							<div class="typography-size-field">
								{@render counterSetting(VC_TEXT_SIZE, { segmented: true })}
							</div>
						</div>
					</CollapsibleSection>
					<CollapsibleSection
						sectionId="counter-layout"
						title="Layout"
						collapsed={collapsedSections.has('counter-layout')}
						onToggle={toggleSettingsSection}
					>
						{@render counterSetting(VC_ALIGN, { segmented: true })}
						{@render counterSetting(VC_TEXT_SHADOW, { segmented: true })}
						{@render counterSetting(VC_STROKE, { segmented: true })}
					</CollapsibleSection>
					<CollapsibleSection
						sectionId="counter-display"
						title="Display"
						collapsed={collapsedSections.has('counter-display')}
						onToggle={toggleSettingsSection}
					>
						{@render counterSetting(VC_COMBINED)}
						{@render counterSetting(VC_ICONS)}
						{@render counterSetting(VC_BG)}
					</CollapsibleSection>
				</div>
			</section>

			<section class="card panel-commands" id="commands" aria-labelledby="commands-heading">
				<CollapsibleSection
					sectionId="chat-commands"
					title="Commands & help"
					collapsed={collapsedSections.has('chat-commands')}
					onToggle={toggleSettingsSection}
					headingLevel="h2"
					headingId="commands-heading"
				>
					<CommandsHelp />
				</CollapsibleSection>
			</section>

			<section class="card panel-obs" id="obs-setup" aria-labelledby="obs-heading">
				<h2 id="obs-heading" class="section-title">OBS setup</h2>
				<p class="section-sub">
					FlossChat and FlossCounter are two separate browser sources. Add one or both; neither needs the other.
				</p>

				<div class="obs-grid">
					<article class="obs-card" aria-labelledby="obs-chat-title">
						<div class="obs-card-head">
							<h3 id="obs-chat-title" class="obs-card-title">FlossChat</h3>
							<span class="obs-size" aria-label={`Size ${chatSize}`}>{chatSize}</span>
						</div>
						<ol class="steps">
							<li>
								Copy the <strong>chat overlay URL</strong><button
									type="button"
									class="obs-copy{copiedChat ? ' ok' : ''}"
									onclick={copyChat}>{copiedChat ? '✓ Copied' : 'Copy chat URL'}</button
								>
							</li>
							<li>
								In OBS, choose <strong>Add Source → Browser</strong> and paste it into <strong>URL</strong>.
							</li>
							<li>Set the size to <strong>{chatSize}</strong>.</li>
							<li>
								Leave <strong>Shutdown source when not visible</strong> off. The overlay reconnects on load, so toggling
								it drops recent messages.
							</li>
						</ol>
					</article>

					<article class="obs-card" aria-labelledby="obs-counter-title">
						<div class="obs-card-head">
							<h3 id="obs-counter-title" class="obs-card-title">FlossCounter</h3>
							<span class="obs-size" aria-label={`Size ${counterSize}`}>{counterSize}</span>
						</div>
						<ol class="steps">
							<li>
								Copy the <strong>FlossCounter URL</strong><button
									type="button"
									class="obs-copy{copiedCounter ? ' ok' : ''}"
									onclick={copyCounter}>{copiedCounter ? '✓ Copied' : 'Copy counter URL'}</button
								>
							</li>
							<li>
								Add a <strong>second Browser source</strong> and paste it in. It is a different URL, not a setting on the
								overlay.
							</li>
							<li>Set the size to <strong>{counterSize}</strong>.</li>
						</ol>
					</article>
				</div>

				<p class="obs-note">
					<span class="obs-note-icon" aria-hidden="true">✓</span><span>
						Both backgrounds are already transparent, so no custom CSS is needed. The preview background buttons only
						change this page; they never reach OBS.
					</span>
				</p>
			</section>
		</div>
	</main>
</div>

<div class="page page-footer">
	<SiteFooter />
</div>
