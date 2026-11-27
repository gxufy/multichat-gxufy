import { describe, expect, it } from 'vitest';
import { normalizeChatChannel, validChatChannel } from '@/lib/channelValidation';

// The SvelteKit app reuses the current app's rules instead of copying them.
describe('shared code from app/src', () => {
	it('normalizes channels exactly like the current app', () => {
		expect(normalizeChatChannel('twitch', ' #Gxufy ')).toBe('Gxufy');
		expect(normalizeChatChannel('kick', '@some-name')).toBe('some-name');
		expect(validChatChannel('twitch', 'bad name')).toBe(false);
	});
});
