/*
 * FlossChat sign-in session: a small signed cookie, nothing stored server-side.
 *
 * The cookie holds only the Twitch account the visitor proved they own (id,
 * login, display name, avatar) and an expiry, signed with HMAC-SHA256. No
 * Twitch token is kept anywhere: the callback uses the token once to read the
 * account, then revokes it.
 *
 * The signing key is FLOSSCHAT_SESSION_SECRET (at least 32 characters). Under
 * `npm run dev` with no key set, a random key is made for this server process,
 * so sign-in can be tried locally without touching .env files; sessions then
 * end when the dev server restarts. Production without a key: sign-in is off.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  CANONICAL_ORIGIN,
  CANONICAL_WWW_ORIGIN,
  HOME_ORIGIN,
  HOME_WWW_ORIGIN,
  LEGACY_ORIGIN,
  LEGACY_WWW_ORIGIN,
} from '@/lib/domains.mjs';

export const SESSION_SECRET_ENV = 'FLOSSCHAT_SESSION_SECRET';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export type SessionUser = {
  id: string;
  login: string;
  displayName: string;
  avatarUrl?: string;
};

type SessionPayload = SessionUser & { exp: number };
type OAuthStatePayload = { state: string; next: string; exp: number };

/* Dev only. Next dev can load this module once per API route, so the random
   key lives on globalThis to be shared by the login and callback routes. */
const DEV_SECRET_KEY = '__flosschatDevSessionSecret';

export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env[SESSION_SECRET_ENV]?.trim();
  if (configured) return configured.length >= 32 ? configured : null;
  if (env.NODE_ENV !== 'development') return null;
  const holder = globalThis as typeof globalThis & { [DEV_SECRET_KEY]?: string };
  holder[DEV_SECRET_KEY] ??= randomBytes(32).toString('hex');
  return holder[DEV_SECRET_KEY]!;
}

function secure(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'development';
}

/* __Host- cookies must be Secure, so local http dev uses plain names. */
export function sessionCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return secure(env) ? '__Host-fc_session' : 'fc_session';
}

export function oauthStateCookieName(env: NodeJS.ProcessEnv = process.env): string {
  return secure(env) ? '__Host-fc_oauth' : 'fc_oauth';
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: object, secret: string): string {
  const body = base64url(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token: string | undefined, secret: string): unknown {
  if (!token || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const expected = createHmac('sha256', secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(token.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function cookie(name: string, value: string, maxAge: number, env: NodeJS.ProcessEnv): string {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure(env) ? ['Secure'] : []),
  ].join('; ');
}

function appendCookie(res: NextApiResponse, value: string): void {
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [...list, value]);
}

function readCookie(req: NextApiRequest | { headers: NextApiRequest['headers'] }, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

const TWITCH_ID_RE = /^\d{1,20}$/;
const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

function isSessionPayload(value: unknown, now: number): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && TWITCH_ID_RE.test(v.id)
    && typeof v.login === 'string' && TWITCH_LOGIN_RE.test(v.login)
    && typeof v.displayName === 'string' && v.displayName.length > 0 && v.displayName.length <= 64
    && (v.avatarUrl === undefined || (typeof v.avatarUrl === 'string' && v.avatarUrl.startsWith('https://')))
    && typeof v.exp === 'number' && v.exp > now;
}

/** The signed-in account, or null (no cookie, bad signature, expired, sign-in off). */
export function readSession(
  req: NextApiRequest | { headers: NextApiRequest['headers'] },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): SessionUser | null {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const payload = verify(readCookie(req, sessionCookieName(env)), secret);
  if (!isSessionPayload(payload, now)) return null;
  return {
    id: payload.id,
    login: payload.login,
    displayName: payload.displayName,
    ...(payload.avatarUrl ? { avatarUrl: payload.avatarUrl } : {}),
  };
}

export function writeSession(
  res: NextApiResponse,
  user: SessionUser,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const token = sign({ ...user, exp: now + SESSION_MAX_AGE_SECONDS * 1000 }, secret);
  appendCookie(res, cookie(sessionCookieName(env), token, SESSION_MAX_AGE_SECONDS, env));
  return true;
}

export function clearSession(res: NextApiResponse, env: NodeJS.ProcessEnv = process.env): void {
  appendCookie(res, cookie(sessionCookieName(env), '', 0, env));
}

/** Only same-site paths: "/badges", never "//evil.example" or a full URL. */
export function safeNextPath(raw: unknown, fallback = '/badges'): string {
  if (typeof raw !== 'string' || raw.length > 200) return fallback;
  if (!/^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/.test(raw) || raw.includes('\\')) return fallback;
  return raw;
}

export function writeOAuthState(
  res: NextApiResponse,
  next: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string | null {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const state = randomBytes(24).toString('base64url');
  const token = sign({ state, next, exp: now + OAUTH_STATE_MAX_AGE_SECONDS * 1000 }, secret);
  appendCookie(res, cookie(oauthStateCookieName(env), token, OAUTH_STATE_MAX_AGE_SECONDS, env));
  return state;
}

/** Checks the state Twitch echoed against our cookie; one use only. */
export function takeOAuthState(
  req: NextApiRequest,
  res: NextApiResponse,
  echoed: unknown,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): { next: string } | null {
  const secret = sessionSecret(env);
  appendCookie(res, cookie(oauthStateCookieName(env), '', 0, env));
  if (!secret || typeof echoed !== 'string' || !echoed) return null;
  const payload = verify(readCookie(req, oauthStateCookieName(env)), secret) as OAuthStatePayload | null;
  if (!payload || typeof payload.state !== 'string' || typeof payload.exp !== 'number' || payload.exp <= now) return null;
  const a = Buffer.from(payload.state);
  const b = Buffer.from(echoed);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { next: safeNextPath(payload.next) };
}

/**
 * State-changing requests must come from our own pages. The cookie is already
 * SameSite=Lax; this Origin check is the second lock.
 */
export function isSameOriginRequest(req: NextApiRequest, env: NodeJS.ProcessEnv = process.env): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!origin) return false;
  const allowed = new Set([
    CANONICAL_ORIGIN,
    CANONICAL_WWW_ORIGIN,
    HOME_ORIGIN,
    HOME_WWW_ORIGIN,
    LEGACY_ORIGIN,
    LEGACY_WWW_ORIGIN,
  ]);
  if (allowed.has(origin)) return true;
  if (env.NODE_ENV === 'development') {
    return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(origin)
      && origin === `http://${req.headers.host ?? ''}`;
  }
  return false;
}
