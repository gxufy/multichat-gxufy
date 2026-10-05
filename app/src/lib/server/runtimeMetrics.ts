import { monitorEventLoopDelay } from 'node:perf_hooks';

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function ms(nanoseconds: number): number {
  if (!Number.isFinite(nanoseconds)) return 0;
  return Math.round((nanoseconds / 1_000_000) * 100) / 100;
}

function mib(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

export function runtimeProcessStats() {
  const memory = process.memoryUsage();
  return {
    uptimeSeconds: Math.round(process.uptime()),
    memoryMiB: {
      rss: mib(memory.rss),
      heapUsed: mib(memory.heapUsed),
      heapTotal: mib(memory.heapTotal),
      external: mib(memory.external),
    },
    eventLoopDelayMs: {
      mean: ms(eventLoopDelay.mean),
      max: ms(eventLoopDelay.max),
      p99: ms(eventLoopDelay.percentile(99)),
    },
  };
}
