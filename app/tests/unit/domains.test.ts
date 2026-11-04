/* Public domain/origin and Host-classification contract.
 *
 * The browser-safe module contains only public compile-time location
 * constants and Host helpers; it must never carry a credential.
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_HOST,
  CANONICAL_ORIGIN,
  CANONICAL_WWW_HOST,
  CANONICAL_WWW_ORIGIN,
  KNOWN_HOSTS,
  LEGACY_HOSTS,
  LEGACY_ORIGIN,
  LOCAL_ORIGIN,
  isCanonicalHost,
  isLegacyHost,
  stripPort,
} from '@/lib/domains.mjs';

describe('origins', () => {
  it('makes gxufy.com the canonical primary origin', () => {
    expect(CANONICAL_ORIGIN).toBe('https://gxufy.com');
  });

  it('keeps multichat-gxufy.com as the legacy compatibility origin', () => {
    expect(LEGACY_ORIGIN).toBe('https://multichat-gxufy.com');
  });

  it('names the www and local origins', () => {
    expect(CANONICAL_WWW_ORIGIN).toBe('https://www.gxufy.com');
    expect(LOCAL_ORIGIN).toBe('http://localhost:3000');
  });

  it('is https for both production origins', () => {
    expect(new URL(CANONICAL_ORIGIN).protocol).toBe('https:');
    expect(new URL(LEGACY_ORIGIN).protocol).toBe('https:');
  });

  it('stores each origin without a trailing slash', () => {
    for (const origin of [
      CANONICAL_ORIGIN,
      CANONICAL_WWW_ORIGIN,
      LEGACY_ORIGIN,
      LOCAL_ORIGIN,
    ]) {
      expect(origin.endsWith('/')).toBe(false);
    }
  });
});


describe('host classification', () => {
  it('recognises the canonical host in apex and www form', () => {
    expect(isCanonicalHost('gxufy.com')).toBe(true);
    expect(isCanonicalHost('www.gxufy.com')).toBe(true);
    expect(CANONICAL_HOST).toBe('gxufy.com');
    expect(CANONICAL_WWW_HOST).toBe('www.gxufy.com');
  });

  it('recognises the legacy hosts in apex and www form', () => {
    expect(isLegacyHost('multichat-gxufy.com')).toBe(true);
    expect(isLegacyHost('www.multichat-gxufy.com')).toBe(true);
    expect(LEGACY_HOSTS).toEqual([
      'multichat-gxufy.com',
      'www.multichat-gxufy.com',
    ]);
  });

  it('does not confuse the two domains for each other', () => {
    expect(isLegacyHost('gxufy.com')).toBe(false);
    expect(isCanonicalHost('multichat-gxufy.com')).toBe(false);
  });

  it('tolerates a port and case on the Host header', () => {
    expect(isCanonicalHost('GXUFY.COM:443')).toBe(true);
    expect(isLegacyHost('Multichat-Gxufy.com:80')).toBe(true);
    expect(stripPort('gxufy.com:3000')).toBe('gxufy.com');
  });

  it('treats an unknown or empty host as neither', () => {
    for (const host of ['evil.example.com', '', undefined]) {
      expect(isCanonicalHost(host)).toBe(false);
      expect(isLegacyHost(host)).toBe(false);
    }
  });

  it('lists every host the app knowingly answers on', () => {
    expect(KNOWN_HOSTS).toEqual([
      'gxufy.com',
      'www.gxufy.com',
      'multichat-gxufy.com',
      'www.multichat-gxufy.com',
      'localhost',
      '127.0.0.1',
    ]);
  });
});

describe('browser safety', () => {
  it('carries no value that looks like a secret', async () => {
    /* The module is imported by browser code; a secret reaching it would ship to
       the client. Read the source and assert only public domain strings appear —
       nothing shaped like a key, token, or credential. */
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const path = join(process.cwd(), 'src', 'lib', 'domains.mjs');
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/SECRET|TOKEN|PASSWORD|CLIENT_SECRET|api[_-]?key/i);
  });
});
