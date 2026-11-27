/**
 * A React-style inline style object ({ WebkitBackgroundClip: 'text' }) as CSS
 * text ("-webkit-background-clip: text"), for the shared builders in app/src
 * that return style objects. Empty and undefined values are left out.
 */
export function cssText(style: Readonly<Record<string, string | number | undefined>> | undefined): string | undefined {
	if (!style) return undefined;
	const parts: string[] = [];
	for (const [key, value] of Object.entries(style)) {
		if (value === undefined || value === '') continue;
		const name = key
			.replace(/^(Webkit|Moz|ms)(?=[A-Z])/, (prefix) => `-${prefix.toLowerCase()}`)
			.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
		parts.push(`${name}: ${value}`);
	}
	return parts.length ? parts.join('; ') : undefined;
}
