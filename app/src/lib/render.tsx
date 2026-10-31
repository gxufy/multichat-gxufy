import React from 'react';
import type { Platform } from './types';
import {
  sourceTag as coreSourceTag,
  type SourceTagMode,
} from './renderCore';

export * from './renderCore';

/**
 * Preserve the existing visible source-tag renderer while always emitting one
 * hidden platform marker. Runtime platform-off commands use this marker to hide an
 * already-rendered row immediately, including overlays whose visible source-tag
 * mode is `none`.
 */
export function sourceTag(
  platform: Platform,
  mode: SourceTagMode,
  iconShadowFilter = '',
): React.ReactNode {
  return (
    <>
      <span
        data-chat-platform={platform}
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      {coreSourceTag(platform, mode, iconShadowFilter)}
    </>
  );
}
