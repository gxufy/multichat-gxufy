/*
 * The site's chat Preview Data: the preview catalog's identities, refreshed
 * with the cosmetics each one wears now, and the sample chat feed that cycles
 * through them. The generator's chat preview and the Pogly chat preview page
 * both draw it, so they show the same thing. Call during component setup.
 */
import { buildPreviewIdentityCosmetics } from '@/features/multichat/previewIdentity';
import {
	PREVIEW_CATALOG_FEED_TEMPLATES,
	PREVIEW_CATALOG_RESPONSES,
	PREVIEW_CATALOG_TEMPLATES
} from '@/features/multichat/previewCatalog';
import {
	PREVIEW_FIXED_SEVENTV_EMOTES,
	PREVIEW_ROSTER,
	rosterFeedTemplates,
	rosterTemplates
} from '@/features/multichat/previewRoster';
import { NO_COSMETICS, type MessageCosmetics } from '@/lib/messageCosmetics';
import type { UnifiedMessage } from '@/lib/types';
import {
	createChatPreviewFeed,
	createPreviewLiveCosmetics,
	type PreviewLiveCosmeticsStatus
} from './previewFeeds.svelte.ts';

export function createSampleChatPreview(options: { suspended: () => boolean }) {
	/* The bundled catalog first, then each identity's equipped 7TV paint and
	   badge, community badges and JilTV paint from the live sources. */
	const liveCosmetics = createPreviewLiveCosmetics(PREVIEW_CATALOG_RESPONSES);
	const responses = $derived(liveCosmetics.responses);
	const identityTemplates = $derived(
		responses === PREVIEW_CATALOG_RESPONSES
			? PREVIEW_CATALOG_TEMPLATES
			: rosterTemplates(responses, 0)
	);
	const feedTemplates = $derived(
		responses === PREVIEW_CATALOG_RESPONSES
			? PREVIEW_CATALOG_FEED_TEMPLATES
			: rosterFeedTemplates(responses, 0)
	);

	const feed = createChatPreviewFeed({
		speed: 'fast',
		suspended: options.suspended,
		identityTemplates: () => feedTemplates
	});

	const cosmetics = $derived.by((): MessageCosmetics => {
		const identityCosmetics = PREVIEW_ROSTER.reduce((current, entry) => {
			const response = responses.get(entry.login);
			return response ? buildPreviewIdentityCosmetics(response, current) : current;
		}, NO_COSMETICS);
		const twitchEmotes = new Map(
			(identityCosmetics.emotes.twitch ?? []).map((emote) => [emote.name.toLowerCase(), emote] as const)
		);
		for (const emote of PREVIEW_FIXED_SEVENTV_EMOTES) twitchEmotes.set(emote.name.toLowerCase(), emote);
		return {
			...identityCosmetics,
			emotes: { ...identityCosmetics.emotes, twitch: [...twitchEmotes.values()] }
		};
	});

	/* One message from each identity first, then the feed. */
	const messages = $derived.by((): readonly UnifiedMessage[] => {
		const showcase = identityTemplates.map((template, index) => ({
			...template,
			id: `identity-showcase-${index + 1}`,
			timestamp: index + 1
		}));
		return feed.messages.length ? [...showcase, ...feed.messages] : showcase;
	});

	return {
		get messages() {
			return messages;
		},
		get cosmetics() {
			return cosmetics;
		},
		/** How far the live cosmetics got (the generator shows it under the preview). */
		get liveStatus(): PreviewLiveCosmeticsStatus {
			return liveCosmetics.status;
		},
		get running() {
			return feed.running;
		},
		get paused() {
			return feed.paused;
		}
	};
}
