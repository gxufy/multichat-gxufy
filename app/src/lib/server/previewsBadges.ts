const PREVIEWS_UPDATES_URL =
  'https://previews-app.com/subs/get-updates-v6/';

export const PREVIEWS_APP_ID = 'gxufy-multichat';

const CACHE_TTL_MS = 3_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_MAX_BYTES = 256 * 1024;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export type PreviewsTwitchDataset = {
  version: number;
  updatedAt: string | null;
  twitch: Record<string, number>;
};

let cachedDataset: PreviewsTwitchDataset | null = null;
let cachedAt = 0;
let inFlight: Promise<PreviewsTwitchDataset> | null = null;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function normalizeUpdatedAt(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

export function parsePreviewsTwitchDataset(
  input: unknown,
): PreviewsTwitchDataset {
  if (!isRecord(input)) {
    throw new Error('Malformed Previews response');
  }

  const subsEnvelope = input.subs;

  if (!isRecord(subsEnvelope)) {
    throw new Error('Missing Previews subscriber dataset');
  }

  const version = subsEnvelope.v;

  if (
    typeof version !== 'number'
    || !Number.isInteger(version)
    || version < 0
  ) {
    throw new Error('Invalid Previews dataset version');
  }

  const platforms = subsEnvelope.subs;

  if (!isRecord(platforms) || !isRecord(platforms.ttv)) {
    throw new Error('Missing Previews Twitch assignments');
  }

  const twitch: Record<string, number> = {};

  for (const [rawHash, rawMonths] of Object.entries(platforms.ttv)) {
    const hash = rawHash.trim().toLowerCase();

    if (!SHA256_HEX_RE.test(hash)) continue;

    if (
      typeof rawMonths !== 'number'
      || !Number.isInteger(rawMonths)
      || rawMonths < 0
    ) {
      continue;
    }

    twitch[hash] = rawMonths;
  }

  return {
    version,
    updatedAt: normalizeUpdatedAt(subsEnvelope.updated_at),
    twitch,
  };
}

async function readBoundedJson(
  response: Response,
): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');

  if (
    declaredLength
    && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > RESPONSE_MAX_BYTES
  ) {
    throw new Error('Previews response too large');
  }

  const text = await response.text();
  const bytes = new TextEncoder().encode(text).byteLength;

  if (bytes > RESPONSE_MAX_BYTES) {
    throw new Error('Previews response too large');
  }

  return JSON.parse(text);
}

async function fetchPreviewsTwitchDataset(): Promise<PreviewsTwitchDataset> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(PREVIEWS_UPDATES_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        u: PREVIEWS_APP_ID,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Previews upstream returned ${response.status}`);
    }

    return parsePreviewsTwitchDataset(
      await readBoundedJson(response),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPreviewsTwitchDataset():
Promise<PreviewsTwitchDataset> {
  const now = Date.now();

  if (
    cachedDataset
    && now - cachedAt < CACHE_TTL_MS
  ) {
    return cachedDataset;
  }

  if (inFlight) return inFlight;

  const work = fetchPreviewsTwitchDataset()
    .then((dataset) => {
      cachedDataset = dataset;
      cachedAt = Date.now();
      return dataset;
    })
    .catch((error) => {
      /*
       * Keep serving the last valid assignment table if Previews has
       * a temporary outage. Never replace valid cached data with a
       * malformed or failed response.
       */
      if (cachedDataset) return cachedDataset;
      throw error;
    });

  inFlight = work;

  void work.then(
    () => {
      if (inFlight === work) {
        inFlight = null;
      }
    },
    () => {
      if (inFlight === work) {
        inFlight = null;
      }
    },
  );

  return work;
}

export function __resetPreviewsBadgeCache(): void {
  cachedDataset = null;
  cachedAt = 0;
  inFlight = null;
}