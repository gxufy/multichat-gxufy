const LOCAL_DNS_NAMES = new Set([
  'localhost',
  'local',
  'lan',
  'home',
  'home.arpa',
  'internal',
  'localdomain',
]);

const LOCAL_DNS_SUFFIXES = [
  '.localhost',
  '.local',
  '.lan',
  '.home',
  '.home.arpa',
  '.internal',
  '.localdomain',
];

const RESERVED_DNS_SUFFIXES = ['.invalid', '.test', '.example', '.onion'];

function ipv4Bytes(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.some((part) => part < 0 || part > 255) ? null : bytes;
}

function isRestrictedIpv4(bytes: readonly number[]): boolean {
  const [a, b, c] = bytes;
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Bytes(input: string): number[] | null {
  let address = input.toLowerCase();
  if (address.includes('%')) return null;

  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':');
    const tail = ipv4Bytes(address.slice(lastColon + 1));
    if (!tail) return null;
    address = `${address.slice(0, lastColon)}:${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }

  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

/** IANA global unicast, excluding special/documentation allocations. */
function isPublicIpv6(hostname: string): boolean {
  const bytes = ipv6Bytes(hostname);
  if (!bytes || (bytes[0] & 0xe0) !== 0x20) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] < 2) return false;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false;
  if (bytes[0] === 0x3f && bytes[1] === 0xff && (bytes[2] & 0xf0) === 0) return false;
  return true;
}

function isPublicDnsName(rawHostname: string): boolean {
  const trailingDots = rawHostname.match(/\.+$/)?.[0].length ?? 0;
  if (trailingDots > 1) return false;
  const hostname = trailingDots === 1 ? rawHostname.slice(0, -1) : rawHostname;
  if (!hostname || hostname.length > 253) return false;
  if (LOCAL_DNS_NAMES.has(hostname)) return false;
  if (LOCAL_DNS_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (RESERVED_DNS_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;

  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  if (labels.some((label) => (
    label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ))) return false;
  return !/^\d+$/.test(labels[labels.length - 1]);
}

/**
 * Practical browser-side policy for user-supplied remote image URLs.
 *
 * DNS can change after validation, so this deliberately makes no DNS-rebinding
 * guarantee. It blocks direct local/private targets and requires a normal HTTPS
 * public-looking host without credentials, fragments, or a nonstandard port.
 */
export function isSafeRemoteMediaUrl(candidate: string): boolean {
  if (candidate !== candidate.trim() || /[\u0000-\u001f\u007f]/.test(candidate)) return false;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || candidate.includes('#')
  ) return false;

  let hostname = parsed.hostname.toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
    return isPublicIpv6(hostname);
  }

  const ipv4 = ipv4Bytes(hostname);
  if (ipv4) return !isRestrictedIpv4(ipv4);
  if (/^[\d.]+$/.test(hostname)) return false;
  return isPublicDnsName(hostname);
}
