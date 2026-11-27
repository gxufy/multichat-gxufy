/** POST to an owner endpoint; the error text the server gave, or a plain one. */
export async function ownerPost(
	url: string,
	payload?: Record<string, string>
): Promise<{ ok: true; body: Record<string, unknown> | null } | { ok: false; error: string }> {
	try {
		const response = await fetch(url, {
			method: 'POST',
			cache: 'no-store',
			...(payload
				? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
				: {})
		});
		const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		if (response.ok) return { ok: true, body };
		return { ok: false, error: typeof body?.error === 'string' ? body.error : 'That did not work.' };
	} catch {
		return { ok: false, error: 'That did not work.' };
	}
}

export type Phase = 'idle' | 'sending' | 'sent' | 'error';
