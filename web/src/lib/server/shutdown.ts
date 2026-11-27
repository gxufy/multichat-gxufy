/*
 * Stopping the web app (pm2 sends SIGINT at a deploy or a restart): the
 * adapter stops taking connections, closes the ones still open after
 * SHUTDOWN_TIMEOUT seconds, then emits `sveltekit:shutdown`. The chat hubs
 * keep their upstream connections and timers for a while after the last
 * viewer leaves (a Kick channel stays connected 30 s), which would keep the
 * process running until pm2 kills it, so it exits here instead.
 */

type ShutdownProcess = {
	once(event: 'sveltekit:shutdown', listener: () => void): unknown;
	exit(code?: number): never | void;
};

const INSTALLED = Symbol.for('flosschat.web.exitOnShutdown');

/** Exit once the adapter has closed every connection; installs only once. */
export function exitOnShutdown(proc: ShutdownProcess = process): boolean {
	const marked = proc as ShutdownProcess & { [INSTALLED]?: true };
	if (marked[INSTALLED]) return false;
	marked[INSTALLED] = true;
	proc.once('sveltekit:shutdown', () => proc.exit(0));
	return true;
}
