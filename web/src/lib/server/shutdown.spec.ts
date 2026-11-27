import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { exitOnShutdown } from './shutdown.ts';

function fakeProcess() {
	const emitter = new EventEmitter();
	const exit = vi.fn();
	return Object.assign(emitter, { exit });
}

describe('exitOnShutdown', () => {
	it('exits once the adapter reports every connection closed', () => {
		const proc = fakeProcess();
		expect(exitOnShutdown(proc)).toBe(true);
		expect(proc.exit).not.toHaveBeenCalled();
		proc.emit('sveltekit:shutdown', 'SIGINT');
		expect(proc.exit).toHaveBeenCalledExactlyOnceWith(0);
	});

	it('installs one listener however often the hooks start', () => {
		const proc = fakeProcess();
		expect(exitOnShutdown(proc)).toBe(true);
		expect(exitOnShutdown(proc)).toBe(false);
		expect(proc.listenerCount('sveltekit:shutdown')).toBe(1);
		proc.emit('sveltekit:shutdown', 'SIGTERM');
		proc.emit('sveltekit:shutdown', 'SIGTERM');
		expect(proc.exit).toHaveBeenCalledTimes(1);
	});

	it('leaves every other signal to the adapter', () => {
		const proc = fakeProcess();
		exitOnShutdown(proc);
		proc.emit('SIGINT');
		proc.emit('SIGTERM');
		expect(proc.exit).not.toHaveBeenCalled();
		expect(proc.listenerCount('SIGINT')).toBe(0);
	});
});
