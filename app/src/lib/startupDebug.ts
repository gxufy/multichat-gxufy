import type { Platform, UnifiedMessage } from './types';
import { recordPerformanceAcceptedMessage } from './multichatPerformanceRuntime';

const PANEL_ID = 'multichat-startup-debug';
const DEBUG_PARAM = 'startupDebug';
const FIRST_ACCEPTED = new Map<Platform, StartupDebugAccepted>();
let overlayStartedAt: number | null = null;

export type StartupDebugAccepted = {
  messageAt: number | null;
  acceptedAt: number;
};

function searchParams(search?: string): URLSearchParams | null {
  if (search !== undefined) return new URLSearchParams(search);
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

export function startupDebugEnabled(search?: string): boolean {
  const value = searchParams(search)?.get(DEBUG_PARAM)?.trim().toLowerCase() ?? '';
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

export function configuredStartupDebugPlatforms(search?: string): Platform[] {
  const params = searchParams(search);
  if (!params) return [];
  const platforms: Platform[] = [];
  if ((params.get('kick') ?? params.get('channel') ?? '').trim()) platforms.push('kick');
  if ((params.get('twitch') ?? '').trim()) platforms.push('twitch');
  if ((params.get('youtube') ?? '').trim()) platforms.push('youtube');
  if ((params.get('tiktok') ?? '').trim()) platforms.push('tiktok');
  return platforms;
}

export function startupDebugOverlayStartedAt(): number {
  if (overlayStartedAt !== null) return overlayStartedAt;
  const origin = typeof performance !== 'undefined' ? Number(performance.timeOrigin) : NaN;
  overlayStartedAt = Number.isFinite(origin) && origin > 0 ? Math.floor(origin) : Date.now();
  return overlayStartedAt;
}

function localClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function formatStartupDebugDelta(deltaMs: number): string {
  const sign = deltaMs < 0 ? '-' : '+';
  return `${sign}${(Math.abs(deltaMs) / 1000).toFixed(3)}s`;
}

function platformLabel(platform: Platform): string {
  if (platform === 'youtube') return 'YouTube';
  if (platform === 'tiktok') return 'TikTok';
  return platform[0].toUpperCase() + platform.slice(1);
}

function configuredPlatforms(): Platform[] {
  return configuredStartupDebugPlatforms();
}

function renderPanel(panel: HTMLElement): void {
  const startedAt = startupDebugOverlayStartedAt();
  const configured = configuredPlatforms();
  const rows = [
    'MultiChat startup debug',
    `Overlay start: ${localClock(startedAt)}`,
  ];

  for (const platform of configured) {
    const accepted = FIRST_ACCEPTED.get(platform);
    if (!accepted) {
      rows.push(`${platformLabel(platform)}: waiting for first accepted chat...`);
      continue;
    }
    const arrival = formatStartupDebugDelta(accepted.acceptedAt - startedAt);
    if (accepted.messageAt === null) {
      rows.push(`${platformLabel(platform)}: provider timestamp unknown | accepted ${arrival}`);
      continue;
    }
    const providerDelta = accepted.messageAt - startedAt;
    const backlog = providerDelta < 0 ? ' | BACKLOG?' : '';
    rows.push(
      `${platformLabel(platform)}: ${localClock(accepted.messageAt)} (${formatStartupDebugDelta(providerDelta)}) | accepted ${arrival}${backlog}`,
    );
  }

  panel.textContent = rows.join('\n');
}

export function ensureStartupDebugPanel(): HTMLElement | null {
  if (!startupDebugEnabled() || typeof document === 'undefined') return null;
  const configured = configuredPlatforms();
  if (!configured.length) return null;

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('pre');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'MultiChat startup debug');
    panel.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'max-width:calc(100vw - 16px)',
      'margin:0',
      'padding:8px 10px',
      'background:rgba(0,0,0,0.82)',
      'color:#fff',
      'font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'white-space:pre-wrap',
      'overflow-wrap:anywhere',
      'border-radius:6px',
      'z-index:2147483647',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(panel);
  }
  renderPanel(panel);
  return panel;
}

export function reportStartupAcceptedMessage(message: UnifiedMessage): void {
  /* This hook already runs once for every UnifiedMessage that reaches parsing,
     making it the cheapest shared ingress point for provider-age diagnostics. */
  recordPerformanceAcceptedMessage(message);

  const configured = configuredPlatforms();
  if (
    message.kind !== 'chat'
    || !startupDebugEnabled()
    || !configured.includes(message.platform)
    || FIRST_ACCEPTED.has(message.platform)
  ) return;

  const acceptedAt = Date.now();
  const rawTimestamp = Number(message.timestamp);
  const messageAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : null;
  FIRST_ACCEPTED.set(message.platform, { messageAt, acceptedAt });

  const startedAt = startupDebugOverlayStartedAt();
  const providerDelta = messageAt === null ? null : messageAt - startedAt;
  console.info('[multichat startup]', {
    platform: message.platform,
    overlayStartedAt: startedAt,
    messageAt,
    acceptedAt,
    providerDeltaMs: providerDelta,
    acceptedDeltaMs: acceptedAt - startedAt,
    possibleBacklog: providerDelta !== null && providerDelta < 0,
  });

  const panel = ensureStartupDebugPanel();
  if (panel) renderPanel(panel);
}

export function resetStartupDebugForTests(): void {
  FIRST_ACCEPTED.clear();
  overlayStartedAt = null;
  if (typeof document !== 'undefined') document.getElementById(PANEL_ID)?.remove();
}
