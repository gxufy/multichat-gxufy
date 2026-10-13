import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { NextApiRequest } from 'next';
import { resolveNodeClientKey } from '@/lib/server/clientIdentity';

export const TTS_MAX_CONCURRENT_WORK = 8;
export const TTS_ADMISSION_WINDOW_MS = 60_000;
export const TTS_ADMISSION_MAX_REQUESTS = 30;
export const TTS_ADMISSION_MAX_CLIENTS = 2_048;
export const TTS_CAPACITY_RETRY_AFTER_SECONDS = 2;

export const TTS_AUDIO_MAX_BYTES = 4 * 1024 * 1024;
export const TTS_METADATA_MAX_BYTES = 32 * 1024;
export const TTS_STREAMLABS_AUDIO_MAX_REDIRECTS = 2;
export const TTS_SPEAK_URL_MAX_LENGTH = 4_096;

export const TTS_ACCEPTED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
]);

export const TTS_STREAMLABS_AUDIO_HOSTS = new Set([
  'polly.streamlabs.com',
]);

type AdmissionBucket = {
  count: number;
  startedAt: number;
};

type AdmissionOptions = {
  maxConcurrent?: number;
  windowMs?: number;
  maxRequests?: number;
  maxClients?: number;
};

export type TtsAdmissionKind = 'rate' | 'capacity';

export class TtsAdmissionError extends Error {
  readonly statusCode: 429 | 503;

  constructor(
    readonly kind: TtsAdmissionKind,
    readonly retryAfterSeconds: number,
  ) {
    super(kind === 'rate' ? 'TTS request rate exceeded' : 'TTS work capacity exceeded');
    this.name = 'TtsAdmissionError';
    this.statusCode = kind === 'rate' ? 429 : 503;
  }
}

export class TtsUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsUpstreamError';
  }
}

export function ttsClientKey(req: NextApiRequest): string {
  return resolveNodeClientKey(req);
}

/**
 * Process-local admission with no waiter queue. A successful acquisition owns
 * one slot until its idempotent release callback is invoked.
 */
export function createTtsAdmissionController(options: AdmissionOptions = {}) {
  const maxConcurrent = options.maxConcurrent ?? TTS_MAX_CONCURRENT_WORK;
  const windowMs = options.windowMs ?? TTS_ADMISSION_WINDOW_MS;
  const maxRequests = options.maxRequests ?? TTS_ADMISSION_MAX_REQUESTS;
  const maxClients = options.maxClients ?? TTS_ADMISSION_MAX_CLIENTS;
  const buckets = new Map<string, AdmissionBucket>();
  let active = 0;

  function pruneExpired(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  function acquire(clientKey: string, now = Date.now()): () => void {
    if (active >= maxConcurrent) {
      throw new TtsAdmissionError('capacity', TTS_CAPACITY_RETRY_AFTER_SECONDS);
    }

    pruneExpired(now);
    let bucket = buckets.get(clientKey);
    if (!bucket) {
      while (buckets.size >= maxClients) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      bucket = { count: 0, startedAt: now };
      buckets.set(clientKey, bucket);
    } else {
      buckets.delete(clientKey);
      buckets.set(clientKey, bucket);
    }

    if (bucket.count >= maxRequests) {
      throw new TtsAdmissionError(
        'rate',
        Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1_000)),
      );
    }

    bucket.count += 1;
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
    };
  }

  return {
    acquire,
    reset: () => {
      active = 0;
      buckets.clear();
    },
    statsForTests: () => ({ active, clientBuckets: buckets.size }),
  };
}

/** Abort fetch-based work and also bound callers that fail to observe the signal. */
export async function withTtsAbortTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve().then(() => run(controller.signal));
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TtsUpstreamError('upstream timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort after a response has already been rejected.
  }
}

function declaredContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/** Read a web Response stream without ever exceeding the configured byte cap. */
export async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > maximumBytes) {
    await cancelBody(response);
    throw new TtsUpstreamError('upstream response too large');
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new TtsUpstreamError('upstream response too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original read/limit error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    total,
  );
}

export async function readBoundedAudioResponse(
  response: Response,
  maximumBytes = TTS_AUDIO_MAX_BYTES,
): Promise<{ bytes: Buffer; contentType: string }> {
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!TTS_ACCEPTED_AUDIO_MIME_TYPES.has(contentType)) {
    await cancelBody(response);
    throw new TtsUpstreamError('unexpected upstream content type');
  }

  const bytes = await readBoundedResponseBody(response, maximumBytes);
  if (bytes.byteLength === 0) throw new TtsUpstreamError('empty upstream audio');
  return { bytes, contentType };
}

function restrictedIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Bytes(input: string): number[] | null {
  let address = input.toLowerCase();
  const zoneIndex = address.indexOf('%');
  if (zoneIndex >= 0) address = address.slice(0, zoneIndex);

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const tail = address.slice(lastColon + 1).split('.').map(Number);
    if (tail.length !== 4 || tail.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    address = `${address.slice(0, lastColon)}:${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/** Reject non-global destinations, including IPv4 embedded in IPv6. */
export function isRestrictedTtsAddress(input: string): boolean {
  const unwrapped = input.startsWith('[') && input.endsWith(']')
    ? input.slice(1, -1)
    : input;
  const version = isIP(unwrapped.split('%', 1)[0]);
  if (version === 4) return restrictedIpv4(unwrapped.split('.').map(Number));
  if (version !== 6) return true;

  const bytes = ipv6Bytes(unwrapped);
  if (!bytes) return true;
  // IANA currently allocates global unicast from 2000::/3. Fail closed for
  // translation, discard, unique-local, link-local, multicast, and reserved
  // space outside that range.
  if ((bytes[0] & 0xe0) !== 0x20) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] < 2) return true;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;
  if (bytes[0] === 0x3f && (bytes[1] & 0xf0) === 0xf0) return true;
  return false;
}

export type TtsAddressResolver = (hostname: string) => Promise<string[]>;

export async function resolveTtsHostnameAddresses(hostname: string): Promise<string[]> {
  const [ipv4, ipv6] = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  const allowedEmptyCodes = new Set(['ENODATA', 'ENOTFOUND']);
  for (const result of [ipv4, ipv6]) {
    if (result.status === 'rejected') {
      const code = (result.reason as NodeJS.ErrnoException | undefined)?.code ?? '';
      if (!allowedEmptyCodes.has(code)) throw new TtsUpstreamError('DNS resolution failed');
    }
  }

  const addresses = [
    ...(ipv4.status === 'fulfilled' ? ipv4.value : []),
    ...(ipv6.status === 'fulfilled' ? ipv6.value : []),
  ];
  if (addresses.length === 0) throw new TtsUpstreamError('DNS resolution failed');
  return addresses;
}

export async function validateTrustedTtsAudioUrl(
  rawUrl: string,
  resolveAddresses: TtsAddressResolver = resolveTtsHostnameAddresses,
): Promise<URL> {
  if (!rawUrl || rawUrl.length > TTS_SPEAK_URL_MAX_LENGTH) {
    throw new TtsUpstreamError('invalid audio URL');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TtsUpstreamError('invalid audio URL');
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hash
    || (url.port && url.port !== '443')
    || !TTS_STREAMLABS_AUDIO_HOSTS.has(hostname)) {
    throw new TtsUpstreamError('untrusted audio URL');
  }

  const addresses = await resolveAddresses(hostname);
  if (addresses.length === 0 || addresses.some(isRestrictedTtsAddress)) {
    throw new TtsUpstreamError('untrusted audio destination');
  }
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type TrustedAudioFetchOptions = {
  fetchImpl?: typeof fetch;
  resolveAddresses?: TtsAddressResolver;
  timeoutMs: number;
  maximumBytes?: number;
  maximumRedirects?: number;
};

/** Fetch Streamlabs audio without delegating redirects to the HTTP client. */
export async function fetchTrustedTtsAudio(
  rawUrl: string,
  options: TrustedAudioFetchOptions,
): Promise<{ bytes: Buffer; contentType: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveAddresses = options.resolveAddresses ?? resolveTtsHostnameAddresses;
  const maximumRedirects = options.maximumRedirects ?? TTS_STREAMLABS_AUDIO_MAX_REDIRECTS;

  return withTtsAbortTimeout(options.timeoutMs, async (signal) => {
    let current = await validateTrustedTtsAudioUrl(rawUrl, resolveAddresses);
    let redirects = 0;

    while (true) {
      const response = await fetchImpl(current, {
        headers: { Accept: 'audio/mpeg, audio/*' },
        redirect: 'manual',
        signal,
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) {
          await cancelBody(response);
          throw new TtsUpstreamError('upstream audio unavailable');
        }
        return readBoundedAudioResponse(response, options.maximumBytes);
      }

      await cancelBody(response);
      if (redirects >= maximumRedirects) {
        throw new TtsUpstreamError('too many audio redirects');
      }
      const location = response.headers.get('location');
      if (!location) throw new TtsUpstreamError('invalid audio redirect');
      current = await validateTrustedTtsAudioUrl(
        new URL(location, current).toString(),
        resolveAddresses,
      );
      redirects += 1;
    }
  });
}
