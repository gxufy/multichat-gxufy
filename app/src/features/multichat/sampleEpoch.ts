/* A fixed instant, so sample timestamps are stable across runs and machines.
   2026-01-01T00:00:00Z. Never Date.now(). Plain module so the preview
   simulator (shared with the SvelteKit generator) needn't load samples.tsx. */
export const SAMPLE_EPOCH = 1_767_225_600_000;
