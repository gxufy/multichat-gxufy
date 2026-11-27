import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  perfDebugEnabled,
  recordPerformanceBatch,
  noteLongFrameForSlideForTests,
  resetPerformanceRuntimeForTests,
  runtimeSlideSuppressed,
  runtimeVisualEffectsReduced,
  viewportRowLimit,
} from '@/lib/multichatPerformanceRuntime';

afterEach(() => {
  resetPerformanceRuntimeForTests();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('MultiChat adaptive performance runtime', () => {
  it('keeps diagnostics opt-in', () => {
    expect(perfDebugEnabled('?perfDebug=1')).toBe(true);
    expect(perfDebugEnabled('?perfDebug=true')).toBe(true);
    expect(perfDebugEnabled('?perfDebug=0')).toBe(false);
    expect(perfDebugEnabled('')).toBe(false);
  });

  it('uses a viewport-sized row budget with a safety buffer', () => {
    expect(viewportRowLimit(1080, 34)).toBe(38);
    expect(viewportRowLimit(720, 34)).toBe(29);
    expect(viewportRowLimit(1080, 48)).toBe(30);
    expect(viewportRowLimit(2160, 20)).toBe(60);
  });

  it('marks an extreme presentation batch as temporary visual pressure', () => {
    expect(runtimeVisualEffectsReduced()).toBe(false);
    recordPerformanceBatch(12, 'auto', false);
    expect(runtimeVisualEffectsReduced()).toBe(true);
  });

  it('suppresses the Motion directional wrapper while frame pressure is active', () => {
    recordPerformanceBatch(12, 'auto', false);
    const css = document.getElementById('multichat-performance-style')?.textContent ?? '';

    expect(document.documentElement.getAttribute('data-gx-performance-pressure')).toBe('1');
    expect(css).toMatch(/data-gx-performance-pressure="1"[^}]*\.gx-message-entry/);
    expect(css).toMatch(/\.gx-message-entry\s*\{[^}]*transform:\s*none !important/);
    expect(css).toMatch(/\.gx-message-entry\s*\{[^}]*opacity:\s*1 !important/);
  });

  it('prunes only old rendered rows while leaving slide measurement ghosts alone', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    const container = document.createElement('div');
    container.id = 'chat_container';
    container.style.fontSize = '34px';
    for (let index = 0; index < 40; index += 1) {
      const row = document.createElement('div');
      row.className = 'gx-message-row';
      row.textContent = String(index);
      container.appendChild(row);
    }
    const ghost = document.createElement('div');
    ghost.setAttribute('data-slide-ghost', '');
    const ghostRow = document.createElement('div');
    ghostRow.className = 'gx-message-row';
    ghost.appendChild(ghostRow);
    container.appendChild(ghost);
    document.body.appendChild(container);

    recordPerformanceBatch(1, 'auto', true);

    const rows = Array.from(container.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('gx-message-row'),
    );
    const pruned = rows.filter((row) => row.getAttribute('data-gx-render-pruned') === '1');
    expect(pruned).toHaveLength(11);
    expect(rows.slice(-29).every((row) => !row.hasAttribute('data-gx-render-pruned'))).toBe(true);
    expect(ghostRow.hasAttribute('data-gx-render-pruned')).toBe(false);
  });
});

describe('Slide suppression', () => {
  it('is never set by a large chat batch', () => {
    recordPerformanceBatch(40, 'auto', false);
    expect(runtimeVisualEffectsReduced()).toBe(true);
    expect(runtimeSlideSuppressed()).toBe(false);
  });

  it('ignores one or two slow frames', () => {
    const now = Date.now();
    noteLongFrameForSlideForTests(now);
    noteLongFrameForSlideForTests(now + 200);
    expect(runtimeSlideSuppressed(now + 200)).toBe(false);
  });

  it('turns on after three slow frames within a second, then wears off', () => {
    const now = Date.now();
    noteLongFrameForSlideForTests(now);
    noteLongFrameForSlideForTests(now + 300);
    noteLongFrameForSlideForTests(now + 600);
    expect(runtimeSlideSuppressed(now + 600)).toBe(true);
    expect(runtimeSlideSuppressed(now + 600 + 1_500)).toBe(false);
  });

  it('does not count slow frames that are more than a second apart', () => {
    const now = Date.now();
    noteLongFrameForSlideForTests(now);
    noteLongFrameForSlideForTests(now + 1_100);
    noteLongFrameForSlideForTests(now + 2_200);
    expect(runtimeSlideSuppressed(now + 2_200)).toBe(false);
  });
});
