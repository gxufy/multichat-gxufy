import { describe, expect, it } from 'vitest';
import {
  PREVIEW_FRAME_PATHS,
  PREVIEW_FRAME_READY,
  fromSameOriginParent,
  isChatPreviewUpdate,
  isPreviewFrameReady,
  isViewersPreviewUpdate,
} from '@/lib/previewBridge';

function fakeWindow(origin: string, parent?: object) {
  const win = { location: { origin } } as unknown as Window & { parent: Window };
  (win as { parent: unknown }).parent = parent ?? win;
  return win;
}

describe('generator preview bridge', () => {
  it('frame paths stay off the word "counter" (content blockers)', () => {
    expect(Object.values(PREVIEW_FRAME_PATHS)).toEqual(['/preview-frame/chat', '/preview-frame/viewers']);
    for (const path of Object.values(PREVIEW_FRAME_PATHS)) expect(path).not.toMatch(/counter/i);
  });

  it('frames accept messages only from their parent on the same origin', () => {
    const parent = {};
    const frame = fakeWindow('https://flosschat.app', parent);
    expect(fromSameOriginParent({ origin: 'https://flosschat.app', source: parent as MessageEventSource }, frame)).toBe(true);
    expect(fromSameOriginParent({ origin: 'https://evil.example', source: parent as MessageEventSource }, frame)).toBe(false);
    expect(fromSameOriginParent({ origin: 'https://flosschat.app', source: {} as MessageEventSource }, frame)).toBe(false);
    expect(fromSameOriginParent({ origin: 'https://flosschat.app', source: null }, frame)).toBe(false);
    /* A top-level page (no parent) never takes updates, even from itself. */
    const top = fakeWindow('https://flosschat.app');
    expect(fromSameOriginParent({ origin: 'https://flosschat.app', source: top as unknown as MessageEventSource }, top)).toBe(false);
  });

  it('checks the shape of every message', () => {
    expect(isPreviewFrameReady({ type: PREVIEW_FRAME_READY, kind: 'chat' }, 'chat')).toBe(true);
    expect(isPreviewFrameReady({ type: PREVIEW_FRAME_READY, kind: 'viewers' }, 'chat')).toBe(false);
    expect(isChatPreviewUpdate({ type: 'flosschat-preview:chat', query: 'kick=a', messages: [] })).toBe(true);
    expect(isChatPreviewUpdate({ type: 'flosschat-preview:chat', query: 5 })).toBe(false);
    expect(isChatPreviewUpdate({ type: 'flosschat-preview:chat', messages: 'x' })).toBe(false);
    expect(isChatPreviewUpdate({ type: 'flosschat-preview:viewers' })).toBe(false);
    expect(isViewersPreviewUpdate({ type: 'flosschat-preview:viewers', statuses: { kick: { state: 'offline' } } })).toBe(true);
    expect(isViewersPreviewUpdate({ type: 'flosschat-preview:viewers', statuses: 'x' })).toBe(false);
    expect(isViewersPreviewUpdate(null)).toBe(false);
  });
});
