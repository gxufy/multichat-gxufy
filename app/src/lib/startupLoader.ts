/* Timing of the startup card that the chat overlay and FlossCounter show
   while they connect: on screen for at least MIN, gone by MAX at the latest,
   then a FADE-long fade. */
export const STARTUP_LOADER_MIN_MS = 700;
export const STARTUP_LOADER_MAX_MS = 8_000;
export const STARTUP_LOADER_FADE_MS = 250;

export type StartupLoaderPhase = 'hidden' | 'visible' | 'fading';
