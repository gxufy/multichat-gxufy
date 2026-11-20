import {
  discardFixedProviderBody,
  readBoundedFixedProviderJson,
  withFixedProviderTimeout,
} from './fixedProviderProxy';

const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const REQUEST_TIMEOUT_MS = 15_000;
export const TWITCH_APP_TOKEN_MAX_BYTES = 32 * 1024;
const EXPIRY_SAFETY_MS = 60_000;
const GENERIC_ERROR = 'Twitch app authorization failed.';

type CachedAppToken = {
  accessToken: string;
  clientId: string;
  validUntil: number;
};

export type TwitchAppAuthorization = {
  accessToken: string;
  clientId: string;
};

let cachedToken: CachedAppToken | null = null;
let inFlight: Promise<CachedAppToken> | null = null;

function readCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error(GENERIC_ERROR);
  return { clientId, clientSecret };
}

function parseTokenResponse(
  body: unknown,
  clientId: string,
  now: number,
): CachedAppToken {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(GENERIC_ERROR);
  }

  const record = body as Record<string, unknown>;
  const accessToken = record.access_token;
  const expiresIn = record.expires_in;
  const tokenType = record.token_type;
  if (
    typeof accessToken !== 'string' ||
    accessToken.length === 0 ||
    typeof expiresIn !== 'number' ||
    !Number.isInteger(expiresIn) ||
    expiresIn <= 0 ||
    typeof tokenType !== 'string' ||
    tokenType.toLowerCase() !== 'bearer'
  ) {
    throw new Error(GENERIC_ERROR);
  }

  return {
    accessToken,
    clientId,
    validUntil: now + Math.max(0, expiresIn * 1_000 - EXPIRY_SAFETY_MS),
  };
}

async function requestAppToken(): Promise<CachedAppToken> {
  const { clientId, clientSecret } = readCredentials();

  try {
    return await withFixedProviderTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await fetch(TWITCH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
        }),
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        await discardFixedProviderBody(response);
        throw new Error(GENERIC_ERROR);
      }

      const body = await readBoundedFixedProviderJson(
        response,
        TWITCH_APP_TOKEN_MAX_BYTES,
      );
      return parseTokenResponse(body, clientId, Date.now());
    });
  } catch {
    throw new Error(GENERIC_ERROR);
  }
}

export async function getTwitchAppAuthorization(): Promise<TwitchAppAuthorization> {
  if (cachedToken && Date.now() < cachedToken.validUntil) {
    return { accessToken: cachedToken.accessToken, clientId: cachedToken.clientId };
  }

  if (!inFlight) {
    let pending: Promise<CachedAppToken>;
    pending = requestAppToken()
      .then((token) => {
        cachedToken = token;
        return token;
      })
      .finally(() => {
        if (inFlight === pending) inFlight = null;
      });
    inFlight = pending;
  }

  const token = await inFlight;
  return { accessToken: token.accessToken, clientId: token.clientId };
}

export function invalidateTwitchAppAccessToken(accessToken: string): void {
  if (cachedToken?.accessToken === accessToken) cachedToken = null;
}

export function __resetTwitchAppAccessTokenForTests(): void {
  cachedToken = null;
  inFlight = null;
}
