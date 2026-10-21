import { describe, expect, it } from 'vitest';
import { isSafeRemoteMediaUrl } from '@/lib/remoteMediaUrl';

describe('remote media URL policy', () => {
  it.each([
    'https://images.example.com/picture.png',
    'https://cdn.images.example.com/animated.gif?Expires=2000000000&Signature=a%2Fb%2Bc',
    'https://localhost.example.com/not-the-localhost-suffix.png',
    'https://example.com./trailing-dot-is-explicit.png',
    'https://example.com:443/default-port.png',
    'https://8.8.8.8/public-ip.png',
    'https://[2606:4700:4700::1111]/public-ipv6.png',
    'https://m\u00fcnich.example.com/idna.png',
  ])('accepts a public HTTPS URL: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(true);
  });

  it.each([
    'http://images.example.com/picture.png',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg></svg>',
    'blob:https://images.example.com/id',
    'file:///etc/passwd',
    'ftp://images.example.com/picture.png',
    '//images.example.com/picture.png',
  ])('rejects a non-HTTPS scheme or protocol-relative input: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(false);
  });

  it.each([
    'https://localhost/picture.png',
    'https://localhost./picture.png',
    'https://foo.localhost/picture.png',
    'https://router/picture.png',
    'https://printer.local/picture.png',
    'https://service.internal/picture.png',
    'https://gateway.lan/picture.png',
    'https://router.home/picture.png',
    'https://host.home.arpa/picture.png',
    'https://host.localdomain/picture.png',
  ])('rejects a local-only hostname: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(false);
  });

  it.each([
    'https://0.0.0.0/image.png',
    'https://10.0.0.1/image.png',
    'https://100.64.0.1/image.png',
    'https://100.127.255.254/image.png',
    'https://127.0.0.1/image.png',
    'https://127.255.255.254/image.png',
    'https://169.254.1.1/image.png',
    'https://172.16.0.1/image.png',
    'https://172.31.255.254/image.png',
    'https://192.0.0.1/image.png',
    'https://192.0.2.1/image.png',
    'https://192.88.99.1/image.png',
    'https://192.168.1.1/image.png',
    'https://198.18.0.1/image.png',
    'https://198.51.100.1/image.png',
    'https://203.0.113.1/image.png',
    'https://224.0.0.1/image.png',
    'https://240.0.0.1/image.png',
    'https://255.255.255.255/image.png',
  ])('rejects a non-public IPv4 literal: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(false);
  });

  it.each([
    'https://[::]/image.png',
    'https://[::1]/image.png',
    'https://[fc00::1]/image.png',
    'https://[fd00::1]/image.png',
    'https://[fe80::1]/image.png',
    'https://[fec0::1]/image.png',
    'https://[ff02::1]/image.png',
    'https://[2001:db8::1]/image.png',
    'https://[2002:7f00:1::]/image.png',
    'https://[3fff::1]/image.png',
    'https://[::ffff:127.0.0.1]/image.png',
    'https://[::ffff:10.0.0.1]/image.png',
  ])('rejects a non-public IPv6 literal: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(false);
  });

  it.each([
    'https://2130706433/image.png',
    'https://0x7f000001/image.png',
    'https://0177.0.0.1/image.png',
    'https://127.1/image.png',
    'https://0x0a000001/image.png',
    'https://012.0.0.1/image.png',
  ])('cannot bypass local IPv4 checks with alternate notation: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(false);
  });

  it.each([
    'https://user:pass@images.example.com/picture.png',
    'https://images.example.com/picture.png#fragment',
    'https://images.example.com/picture.png#',
    'https://images.example.com:8443/picture.png',
    'https://images.example.com..//picture.png',
    'https://',
    'not a URL',
  ])('rejects credentials, fragments, nonstandard ports, and malformed URLs: %s', (url) => {
    expect(isSafeRemoteMediaUrl(url)).toBe(false);
  });
});
