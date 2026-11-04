import type { Platform } from './types';

const CONTROL_CHANNEL = 'multichat-control-v1';
const COUNTER_BG_PREFIX = 'multichat:counter-bg:';
const OVERRIDE_TTL_MS = 12 * 60 * 60 * 1000;
const ORDER: readonly Platform[] = ['kick', 'twitch', 'youtube', 'tiktok'];

type Channels = Partial<Record<Platform, string>>;

type CounterBackgroundMessage = {
  type: 'counter-background';
  scope: string;
  enabled: boolean;
  at: number;
};

function normalizeChannel(value: string | undefined): string {
  return (value ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function multichatControlScope(channels: Channels): string {
  return ORDER.map((platform) => `${platform}:${normalizeChannel(channels[platform])}`).join('|');
}

function storageKey(scope: string): string {
  return `${COUNTER_BG_PREFIX}${scope}`;
}

function parseMessage(value: unknown): CounterBackgroundMessage | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<CounterBackgroundMessage>;
  if (candidate.type !== 'counter-background') return null;
  if (typeof candidate.scope !== 'string' || typeof candidate.enabled !== 'boolean') return null;
  if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return null;
  return candidate as CounterBackgroundMessage;
}

function parseStored(raw: string | null, scope: string): CounterBackgroundMessage | null {
  if (!raw) return null;
  try {
    const parsed = parseMessage(JSON.parse(raw));
    if (!parsed || parsed.scope !== scope) return null;
    if (Date.now() - parsed.at > OVERRIDE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Last command override for this channel set, or null when none is current. */
export function readCounterBackgroundControl(channels: Channels): boolean | null {
  if (typeof window === 'undefined') return null;
  const scope = multichatControlScope(channels);
  try {
    const key = storageKey(scope);
    const raw = window.localStorage.getItem(key);
    const parsed = parseStored(raw, scope);
    if (!parsed && raw) window.localStorage.removeItem(key);
    return parsed?.enabled ?? null;
  } catch {
    return null;
  }
}

/** Publish a counter-background override to other gxufy.com browser sources. */
export function publishCounterBackgroundControl(channels: Channels, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  const message: CounterBackgroundMessage = {
    type: 'counter-background',
    scope: multichatControlScope(channels),
    enabled,
    at: Date.now(),
  };
  try {
    window.localStorage.setItem(storageKey(message.scope), JSON.stringify(message));
  } catch {
    /* Storage can be disabled; BroadcastChannel can still carry the live event. */
  }
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(CONTROL_CHANNEL);
      channel.postMessage(message);
      channel.close();
    } catch {
      /* One transport failing must not break the chat command. */
    }
  }
}

/** Subscribe a counter source to overrides for its exact configured channel set. */
export function subscribeCounterBackgroundControl(
  channels: Channels,
  onChange: (enabled: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const scope = multichatControlScope(channels);
  const key = storageKey(scope);
  let channel: BroadcastChannel | null = null;

  const accept = (value: unknown) => {
    const message = parseMessage(value);
    if (!message || message.scope !== scope) return;
    if (Date.now() - message.at > OVERRIDE_TTL_MS) return;
    onChange(message.enabled);
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CONTROL_CHANNEL);
      channel.onmessage = (event) => accept(event.data);
    } catch {
      channel = null;
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;
    const message = parseStored(event.newValue, scope);
    if (message) onChange(message.enabled);
  };
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}
