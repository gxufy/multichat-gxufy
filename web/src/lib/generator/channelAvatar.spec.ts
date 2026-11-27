import { describe, expect, it } from 'vitest';
import { CHANNEL_AVATAR_HOSTS, channelAvatarUrl } from './channelAvatar.ts';

describe('channel-search avatars', () => {
	it('come only from the platforms\' own image hosts', () => {
		expect([...CHANNEL_AVATAR_HOSTS].sort()).toEqual([
			'cdn.7tv.app',
			'files.kick.com',
			'p16-common-sign.tiktokcdn-us.com',
			'p19-common-sign.tiktokcdn-us.com',
			'static-cdn.jtvnw.net',
			'yt3.ggpht.com',
			'yt3.googleusercontent.com'
		]);
	});

	it('load https images from those hosts as they are', () => {
		expect(channelAvatarUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/a-profile_image-70x70.png')).toBe(
			'https://static-cdn.jtvnw.net/jtv_user_pictures/a-profile_image-70x70.png'
		);
		expect(channelAvatarUrl('https://p16-common-sign.tiktokcdn-us.com/a~tplv.jpeg?x-expires=1&x-signature=abc%3D')).toBe(
			'https://p16-common-sign.tiktokcdn-us.com/a~tplv.jpeg?x-expires=1&x-signature=abc%3D'
		);
	});

	it('show the letter for anything else', () => {
		for (const url of [
			undefined,
			'',
			'not a url',
			'http://static-cdn.jtvnw.net/a.png',
			'https://evil.example/a.png',
			'https://static-cdn.jtvnw.net.evil.example/a.png',
			'https://user:pass@static-cdn.jtvnw.net/a.png',
			'https://static-cdn.jtvnw.net:8443/a.png',
			'javascript:alert(1)',
			'data:image/png;base64,AAAA'
		]) {
			expect(channelAvatarUrl(url), String(url)).toBeNull();
		}
	});
});
