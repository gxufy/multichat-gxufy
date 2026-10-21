import { isIP } from 'node:net';

export const CADDY_CLIENT_IP_HEADER = 'x-gxufy-client-ip';
export const TRUST_CADDY_PROXY_ENV = 'TRUST_CADDY_PROXY';

type NodeRequestLike = {
  headers: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string | null;
  };
};

function mappedIpv4Address(address: string): string {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (!match) return '';

  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

/**
 * Accept exactly one bare IP address. Forwarding chains, ports, whitespace,
 * hostnames, and duplicate Node header values are deliberately not normalized.
 */
export function normalizeClientIp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return '';
  if (value.includes(',') || value.includes('%')) return '';

  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return '';

  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    const canonical = hostname.slice(1, -1).toLowerCase();
    return mappedIpv4Address(canonical) || canonical;
  } catch {
    return '';
  }
}

function nodeHeader(
  request: NodeRequestLike,
  name: string,
): string {
  const value = request.headers[name];
  return typeof value === 'string' ? value : '';
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1';
}

function isTrustedCaddyMode(): boolean {
  return process.env[TRUST_CADDY_PROXY_ENV] === '1';
}

function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

/**
 * Resolve identity for Pages API / Node requests.
 *
 * Vercel owns and overwrites X-Forwarded-For. Self-hosted Caddy identity is
 * accepted only with the explicit production flag and a loopback TCP peer.
 * Every other request is identified solely by its direct socket address.
 */
export function resolveNodeClientKey(request: NodeRequestLike): string {
  const socketAddress = normalizeClientIp(request.socket?.remoteAddress ?? '');

  // Vercel is authoritative when both deployment markers are accidentally set.
  if (isVercelRuntime()) {
    return normalizeClientIp(nodeHeader(request, 'x-forwarded-for'))
      || socketAddress
      || 'unknown';
  }

  if (isTrustedCaddyMode() && isLoopbackAddress(socketAddress)) {
    return normalizeClientIp(nodeHeader(request, CADDY_CLIENT_IP_HEADER))
      || socketAddress
      || 'unknown';
  }

  return socketAddress || 'unknown';
}

/**
 * Resolve identity for App Router Web Requests.
 *
 * Next.js 16's Request/NextRequest APIs expose no TCP peer address. In the VPS
 * deployment, trusting the dedicated header therefore depends on both the
 * explicit flag and the separately enforced `-H 127.0.0.1` PM2 boundary.
 * Local/direct mode ignores the header. Vercel remains independently trusted.
 */
export function resolveWebClientKey(request: Pick<Request, 'headers'>): string {
  if (isVercelRuntime()) {
    return normalizeClientIp(request.headers.get('x-forwarded-for')) || 'unknown';
  }

  if (isTrustedCaddyMode()) {
    return normalizeClientIp(request.headers.get(CADDY_CLIENT_IP_HEADER)) || 'unknown';
  }

  return 'unknown';
}
