/*
 * Which channel-search avatars the generator shows: https images from the
 * platforms' own image hosts only. They load straight from those hosts,
 * without a Referer, so a host that refuses images linked from other sites
 * still answers. Anything else shows the letter instead.
 */
export const CHANNEL_AVATAR_HOSTS: ReadonlySet<string> = new Set([
	'files.kick.com',
	'cdn.7tv.app',
	'static-cdn.jtvnw.net',
	'yt3.ggpht.com',
	'yt3.googleusercontent.com',
	'p16-common-sign.tiktokcdn-us.com',
	'p19-common-sign.tiktokcdn-us.com'
]);

/** The avatar's address to load, or null to show the letter. */
export function channelAvatarUrl(url: string | undefined): string | null {
	if (!url) return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
	return CHANNEL_AVATAR_HOSTS.has(parsed.hostname) ? parsed.href : null;
}
