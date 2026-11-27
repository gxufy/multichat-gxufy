/* Small per-visitor sliding-window limiter for low-volume routes. */
export function createClientWindowLimit(options: { windowMs: number; max: number; maxKeys?: number }) {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 4_096;
  return {
    /** True (and counted) while the client is within its allowance. */
    admit(clientKey: string, now = Date.now()): boolean {
      const recent = (hits.get(clientKey) ?? []).filter((at) => at > now - options.windowMs);
      if (recent.length >= options.max) {
        hits.set(clientKey, recent);
        return false;
      }
      recent.push(now);
      hits.delete(clientKey);
      hits.set(clientKey, recent);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next();
        if (oldest.done) break;
        hits.delete(oldest.value);
      }
      return true;
    },
    reset(): void {
      hits.clear();
    },
  };
}
