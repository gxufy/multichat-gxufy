export function isMessageFromCurrentOverlaySession(
  timestamp: unknown,
  startedAt: number,
): boolean {
  const value = typeof timestamp === 'number' ? timestamp : Number(timestamp);

  /* A provider without a usable timestamp cannot be proven to be backlog. The
   * connector builders already fall back to Date.now() for truly live payloads,
   * so fail open here rather than silently dropping a platform's chat forever. */
  if (!Number.isFinite(value) || value <= 0) return true;
  return value >= startedAt;
}
