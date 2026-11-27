/*
 * The chat overlay's DOM, frozen: the whole overlay corpus (every sample
 * message plus edge cases under each snapshot configuration, and every Twitch
 * event including the Hype Train). The snapshots are what the React overlay
 * drew (this one was checked against it in the same browser, row for row,
 * before it was retired). A change here is a visible change to every stream:
 * update them only for a change that is meant.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ParsedMessage } from '@/lib/kick';
import type { MultichatConfig } from '@/lib/multichatConfig';
import type { SourceTagMode } from '@/lib/renderCore';
import { POGLY_CHAT_CONFIG, poglyChatMessages } from '@/features/poglyPreview';
import { settledText } from '../../testing/domSnapshot.ts';
import ChatOverlay from './ChatOverlay.svelte';
import {
	CONFIGS,
	EVENT_CONFIGS,
	parsedEvents,
	parsedFor
} from '../../../../../app/tests/fixtures/overlayCorpus.ts';

afterEach(() => {
	document.querySelectorAll('#chat_container').forEach((node) => node.remove());
	vi.restoreAllMocks();
});

async function draw(
	name: string,
	config: MultichatConfig,
	messages: ParsedMessage[],
	sourceTagOverride?: SourceTagMode
) {
	/* The Hype Train card takes its animations' phase from the clock: a fixed one. */
	vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-22T12:00:00.000Z'));
	const svelte = await render(ChatOverlay, {
		config,
		messages,
		fadingIds: new Set<string>(),
		loaderPhase: 'hidden',
		sourceTagExplicit: true,
		sourceTagOverride
	});
	const chat = svelte.container.querySelector('#chat_container') as HTMLElement;
	expect(chat.querySelectorAll('.gx-message-row')).toHaveLength(messages.length);
	await expect(await settledText(chat)).toMatchFileSnapshot(`./__snapshots__/overlay/${name}.txt`);
	return messages.length;
}

describe('the chat overlay', () => {
	for (const [name, query] of Object.entries(CONFIGS)) {
		it(name, async () => {
			const { config, parsed } = parsedFor({ ...query, animation: 'none' });
			expect(await draw(name, config, parsed)).toBeGreaterThanOrEqual(20);
		});
	}

	for (const [name, query] of Object.entries(EVENT_CONFIGS)) {
		it(name, async () => {
			const { config, parsed } = await parsedEvents(query);
			expect(await draw(name, config, parsed)).toBeGreaterThanOrEqual(19);
		});
	}

	/* The generator's preview frame forces the chosen source mark. */
	for (const [name, query] of Object.entries(CONFIGS)) {
		it(`${name}, source mark forced to icon`, async () => {
			const { config, parsed } = parsedFor({ ...query, animation: 'none' });
			expect(await draw(`${name}-icon`, config, parsed, 'icon')).toBeGreaterThanOrEqual(20);
		});
	}

	/* The fixed sample rows of the Pogly preview page, source mark forced to icon. */
	it('the Pogly chat preview', async () => {
		expect(await draw('pogly', POGLY_CHAT_CONFIG, poglyChatMessages(), 'icon')).toBe(4);
	});
});
