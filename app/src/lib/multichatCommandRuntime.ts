import {
  createMultichatCommandRunner as createCoreMultichatCommandRunner,
  type CommandHost,
  type MultichatCommandRunner,
} from './multichatCommandRuntimeCore';
import { setPlatformChatDomVisible } from './platformChatVisibility';

export * from './multichatCommandRuntimeCore';

/**
 * Decorate the existing platform-neutral dispatcher with an immediate DOM guard.
 *
 * The page-level host still owns the canonical behavior: it records the hidden
 * platform, removes it from runtime state, keeps the connector alive, and blocks
 * future rows. The DOM guard covers the one gap that showed up live in OBS: an
 * already-presented row could remain visible until a delayed React/rAF reconcile.
 */
export function createMultichatCommandRunner(host: CommandHost): MultichatCommandRunner {
  return createCoreMultichatCommandRunner({
    ...host,
    setPlatformChatVisible(platform, visible) {
      host.setPlatformChatVisible(platform, visible);
      setPlatformChatDomVisible(platform, visible);
    },
  });
}
