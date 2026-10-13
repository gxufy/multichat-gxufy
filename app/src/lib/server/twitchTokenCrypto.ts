/* Private helpers for encrypting and decrypting Twitch OAuth tokens
 * before they are persisted in Supabase.
 *
 * Algorithm: AES-256-GCM with a fresh random 12-byte IV per encryption.
 * Serialized format : v1:<base64url-iv>:<base64url-tag>:<base64url-ciphertext>
 * Additional data   : "twitch-token:v1"
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const AAD = 'twitch-token:v1';
const IV_BYTE_LENGTH = 12;
const KEY_BYTE_LENGTH = 32;
const KEY_HEX_LENGTH = 64;
const VERSION_PREFIX = 'v1:';

const GENERIC_ERR = 'Token operation failed.';

/* ------------------------------------------------------------------ */
/* Lazy key cache — parsed once on first use so a missing env var     */
/* does not break static builds.                                       */
/* ------------------------------------------------------------------ */

let cachedKey: Buffer | null = null;

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse, validate, and cache the hex-encoded encryption key.
 *
 * Throws on first call when the environment variable is missing or
 * malformed.  Subsequent calls return the cached Buffer.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.TWITCH_TOKEN_ENCRYPTION_KEY;
  if (!raw || typeof raw !== 'string') {
    throw new Error(GENERIC_ERR);
  }

  if (raw.length !== KEY_HEX_LENGTH) {
    throw new Error(GENERIC_ERR);
  }

  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(GENERIC_ERR);
  }

  const parsed = Buffer.from(raw, 'hex');
  if (parsed.length !== KEY_BYTE_LENGTH) {
    throw new Error(GENERIC_ERR);
  }
  cachedKey = parsed;
  return cachedKey;
}

/**
 * Strictly decode a base64url field.
 *
 * Rejects empty strings, invalid characters, unpadded lengths (mod 4 === 1),
 * and non-canonical encodings.
 */
function decodeBase64url(value: string): Buffer {
  if (value.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(GENERIC_ERR);
  }

  if (value.length % 4 === 1) {
    throw new Error(GENERIC_ERR);
  }

  const decoded = Buffer.from(value, 'base64url');

  if (decoded.toString('base64url') !== value) {
    throw new Error(GENERIC_ERR);
  }

  return decoded;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Encrypt a plaintext Twitch OAuth token.
 *
 * Returns a versioned base64url string.
 */
export function encryptTwitchToken(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error(GENERIC_ERR);
  }

  const key = getKey();

  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(AAD, 'utf-8'));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * Decrypt a versioned base64url string produced by
 * {@link encryptTwitchToken}.
 *
 * Throws on any authentication or format failure.
 */
export function decryptTwitchToken(serialized: string): string {
  if (!serialized || typeof serialized !== 'string') {
    throw new Error(GENERIC_ERR);
  }

  if (!serialized.startsWith(VERSION_PREFIX)) {
    throw new Error(GENERIC_ERR);
  }

  const parts = serialized.slice(VERSION_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error(GENERIC_ERR);
  }

  const [ivB64, tagB64, ctB64] = parts;

  const key = getKey();

  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;

  try {
    iv = decodeBase64url(ivB64);
    authTag = decodeBase64url(tagB64);
    ciphertext = decodeBase64url(ctB64);
  } catch {
    throw new Error(GENERIC_ERR);
  }

  if (iv.length !== IV_BYTE_LENGTH) {
    throw new Error(GENERIC_ERR);
  }
  if (authTag.length !== 16) {
    throw new Error(GENERIC_ERR);
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(AAD, 'utf-8'));
  decipher.setAuthTag(authTag);

  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new Error(GENERIC_ERR);
  }

  // Strictly reject invalid UTF-8 after decryption.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch {
    throw new Error(GENERIC_ERR);
  }
}
