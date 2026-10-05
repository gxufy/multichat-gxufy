import type { Platform, UnifiedMessage } from './types';

const PERF_PARAM = 'perfDebug';
const PANEL_ID = 'multichat-perf-debug';
const STYLE_ID = 'multichat-performance-style';
const PRESSURE_ATTR = 'data-gx-performance-pressure';
const PRUNED_ATTR = 'data-gx-render-pruned';
const FRAME_PRESSURE_MS = 1_500;
const EXTREME_BATCH_SIZE = 12;
const BATCH_WINDOW_MS = 5_000;
const FRAME_SAMPLE_MAX = 120;
const AGE_SAMPLE_MAX = 200;
const ROW_BUFFER = 12;
const ROW_LIMIT_MIN = 24;
const ROW_LIMIT_MAX = 60;

type BatchSample = { at: number; size: number };
type AgeSample = { platform: Platform; ageMs: number };

let pressureUntil = 0;
let frameHandle: number | null = null;
let lastFrameAt = 0;
let longFrames = 0;
let frameSamples: number[] = [];
let batchSamples: BatchSample[] = [];
let ageSamples: AgeSample[] = [];
let latestBatchSize = 0;
let latestBatchAnimated = true;
let latestMode = 'auto';
let latestCommitMs: number | null = null;
let batchRecordedAt = 0;
let observer: MutationObserver | null = null;
let observedContainer: HTMLElement | null = null;
let resizeBound = false;
let rowLimit = ROW_LIMIT_MAX;
let domRows = 0;
let renderedRows = 0;
let prunedRows = 0;
let lastPanelAt = 0;

function browserNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function searchParams(search?: string): URLSearchParams | null {
  if (search !== undefined) return new URLSearchParams(search);
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

export function perfDebugEnabled(search?: string): boolean {
  const value = searchParams(search)?.get(PERF_PARAM)?.trim().toLowerCase() ?? '';
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

export function viewportRowLimit(viewportHeight: number, fontSize: number): number {
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 720;
  const font = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 34;
  const nominalRow = Math.max(24, font * 1.25);
  return Math.max(
    ROW_LIMIT_MIN,
    Math.min(ROW_LIMIT_MAX, Math.ceil(height / nominalRow) + ROW_BUFFER),
  );
}

function markPressure(durationMs = FRAME_PRESSURE_MS): void {
  pressureUntil = Math.max(pressureUntil, Date.now() + durationMs);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(PRESSURE_ATTR, '1');
  }
}

function syncPressureAttribute(): void {
  if (typeof document === 'undefined') return;
  if (Date.now() < pressureUntil) document.documentElement.setAttribute(PRESSURE_ATTR, '1');
  else document.documentElement.removeAttribute(PRESSURE_ATTR);
}

export function runtimeVisualEffectsReduced(now = Date.now()): boolean {
  return now < pressureUntil;
}

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .gx-message-row[${PRUNED_ATTR}="1"] { display: none !important; }
    html[${PRESSURE_ATTR}="1"] .gx-message-row { transition: none !important; }
    html[${PRESSURE_ATTR}="1"] .gx-message-entry {
      animation: none !important;
      transform: none !important;
      opacity: 1 !important;
    }
    html[${PRESSURE_ATTR}="1"] .gx-fade-group { animation: none !important; }
  `;
  document.head.appendChild(style);
}

function computeRowLimit(container: HTMLElement): number {
  let fontSize = 34;
  try {
    const parsed = parseFloat(getComputedStyle(container).fontSize);
    if (Number.isFinite(parsed) && parsed > 0) fontSize = parsed;
  } catch { /* best-effort in embedded Chromium */ }
  return viewportRowLimit(typeof window !== 'undefined' ? window.innerHeight : 720, fontSize);
}

function eligibleRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.gx-message-row'))
    .filter((row) => !row.closest('[data-slide-ghost]'));
}

function applyRowBudget(): void {
  const container = observedContainer;
  if (!container) return;
  const rows = eligibleRows(container);
  rowLimit = computeRowLimit(container);
  const firstRendered = Math.max(0, rows.length - rowLimit);
  rows.forEach((row, index) => {
    if (index < firstRendered) row.setAttribute(PRUNED_ATTR, '1');
    else row.removeAttribute(PRUNED_ATTR);
  });
  domRows = rows.length;
  prunedRows = firstRendered;
  renderedRows = rows.length - firstRendered;
}

function mutationContainsChatRow(records: MutationRecord[]): boolean {
  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) {
      if (!(node instanceof Element)) continue;
      if (node.matches('.gx-message-row') || node.querySelector('.gx-message-row')) return true;
    }
  }
  return false;
}

function ensureDomObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const container = document.getElementById('chat_container');
  if (!container) return;
  if (observedContainer === container && observer) return;
  observer?.disconnect();
  observedContainer = container;
  observer = new MutationObserver((records) => {
    if (mutationContainsChatRow(records) && batchRecordedAt > 0) {
      latestCommitMs = Math.max(0, browserNow() - batchRecordedAt);
    }
    applyRowBudget();
    renderPanelMaybe();
  });
  observer.observe(container, { childList: true, subtree: true });
  if (!resizeBound && typeof window !== 'undefined') {
    resizeBound = true;
    window.addEventListener('resize', applyRowBudget, { passive: true });
  }
  applyRowBudget();
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function recentBatchRate(now = Date.now()): number {
  batchSamples = batchSamples.filter((sample) => now - sample.at <= BATCH_WINDOW_MS);
  if (!batchSamples.length) return 0;
  return batchSamples.reduce((sum, sample) => sum + sample.size, 0) / (BATCH_WINDOW_MS / 1000);
}

function ensurePanel(): HTMLElement | null {
  if (!perfDebugEnabled() || typeof document === 'undefined') return null;
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('pre');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'MultiChat performance debug');
    panel.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'max-width:calc(100vw - 16px)',
      'margin:0', 'padding:8px 10px', 'background:rgba(0,0,0,.84)', 'color:#fff',
      'font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'white-space:pre-wrap', 'border-radius:6px', 'z-index:2147483647', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(panel);
  }
  return panel;
}

function renderPanelMaybe(force = false): void {
  if (!perfDebugEnabled()) return;
  const nowPerf = browserNow();
  if (!force && nowPerf - lastPanelAt < 250) return;
  lastPanelAt = nowPerf;
  const panel = ensurePanel();
  if (!panel) return;
  const avgFrame = average(frameSamples);
  const fps = avgFrame > 0 ? Math.min(240, 1000 / avgFrame) : 0;
  const ages = ageSamples.map((sample) => sample.ageMs);
  const pressure = runtimeVisualEffectsReduced() ? 'YES' : 'no';
  panel.textContent = [
    'MultiChat perf debug',
    `FPS: ${fps ? fps.toFixed(1) : '--'} | long frames: ${longFrames} | pressure: ${pressure}`,
    `Batch: ${latestBatchSize} | rate: ${recentBatchRate().toFixed(1)} msg/s | mode: ${latestMode} | animated: ${latestBatchAnimated ? 'yes' : 'no'}`,
    `Commit: ${latestCommitMs === null ? '--' : `${latestCommitMs.toFixed(1)}ms`}`,
    `Provider age avg/p95: ${ages.length ? `${average(ages).toFixed(0)}/${percentile(ages, .95).toFixed(0)}ms` : '--'}`,
    `DOM: ${renderedRows} rendered / ${domRows} rows | pruned: ${prunedRows} | limit: ${rowLimit}`,
  ].join('\n');
}

function frameLoop(at: number): void {
  if (lastFrameAt > 0) {
    const delta = at - lastFrameAt;
    if (delta > 0 && delta < 1000) {
      frameSamples.push(delta);
      if (frameSamples.length > FRAME_SAMPLE_MAX) frameSamples.shift();
      if (
        delta >= 50
        && (typeof document === 'undefined' || document.visibilityState !== 'hidden')
      ) {
        longFrames += 1;
        markPressure();
      }
    }
  }
  lastFrameAt = at;
  syncPressureAttribute();
  renderPanelMaybe();
  if (typeof requestAnimationFrame === 'function') frameHandle = requestAnimationFrame(frameLoop);
}

function ensureFrameMonitor(): void {
  if (frameHandle !== null || typeof requestAnimationFrame !== 'function') return;
  frameHandle = requestAnimationFrame(frameLoop);
}

export function ensurePerformanceRuntime(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  ensureStyle();
  ensureDomObserver();
  ensureFrameMonitor();
  renderPanelMaybe(true);
}

export function recordPerformanceAcceptedMessage(message: UnifiedMessage): void {
  /* Provider-age collection is diagnostic-only; the always-on adaptive guard is
     driven by real presentation batches and frames, so ordinary users do not pay
     per-message bookkeeping for a panel they cannot see. */
  if (!perfDebugEnabled()) return;
  const timestamp = Number(message.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    ageSamples.push({ platform: message.platform, ageMs: Math.max(0, Date.now() - timestamp) });
    if (ageSamples.length > AGE_SAMPLE_MAX) ageSamples.shift();
  }
  ensurePerformanceRuntime();
  renderPanelMaybe();
}

export function recordPerformanceBatch(
  batchSize: number,
  mode: string,
  animated: boolean,
): void {
  latestBatchSize = Math.max(0, batchSize);
  latestMode = mode;
  latestBatchAnimated = animated;
  const now = Date.now();
  batchSamples.push({ at: now, size: latestBatchSize });
  batchSamples = batchSamples.filter((sample) => now - sample.at <= BATCH_WINDOW_MS);
  batchRecordedAt = browserNow();
  if (latestBatchSize >= EXTREME_BATCH_SIZE) markPressure(1_000);
  ensurePerformanceRuntime();
  applyRowBudget();
  renderPanelMaybe();
}

export function resetPerformanceRuntimeForTests(): void {
  pressureUntil = 0;
  if (frameHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameHandle);
  frameHandle = null;
  lastFrameAt = 0;
  longFrames = 0;
  frameSamples = [];
  batchSamples = [];
  ageSamples = [];
  latestBatchSize = 0;
  latestBatchAnimated = true;
  latestMode = 'auto';
  latestCommitMs = null;
  batchRecordedAt = 0;
  observer?.disconnect();
  observer = null;
  observedContainer = null;
  if (resizeBound && typeof window !== 'undefined') {
    window.removeEventListener('resize', applyRowBudget);
    resizeBound = false;
  }
  rowLimit = ROW_LIMIT_MAX;
  domRows = 0;
  renderedRows = 0;
  prunedRows = 0;
  lastPanelAt = 0;
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute(PRESSURE_ATTR);
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }
}
