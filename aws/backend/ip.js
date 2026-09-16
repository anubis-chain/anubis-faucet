import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

function ipv4(value) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error('Invalid IPv4 address.');
  return parts.join('.');
}

function ipv6Words(value) {
  let input = value.toLowerCase();
  if (input.includes('%')) throw new Error('Scoped IPv6 addresses are not accepted.');
  const ipv4Tail = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const bytes = ipv4(ipv4Tail).split('.').map(Number);
    input = input.slice(0, -ipv4Tail.length) + `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const pieces = input.split('::');
  if (pieces.length > 2) throw new Error('Invalid IPv6 address.');
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) throw new Error('Invalid IPv6 address.');
  const words = [...left, ...Array(missing).fill('0'), ...right].map(part => {
    if (!/^[\da-f]{1,4}$/i.test(part)) throw new Error('Invalid IPv6 address.');
    return Number.parseInt(part, 16);
  });
  if (words.length !== 8) throw new Error('Invalid IPv6 address.');
  return words;
}

export function normalizeSourceIp(value) {
  if (typeof value !== 'string') throw new Error('Missing source IP.');
  const candidate = value.trim().replace(/^\[|\]$/g, '');
  const family = isIP(candidate);
  if (family === 4) {
    const normalized = ipv4(candidate);
    return { verificationIp: normalized, rateLimitIdentity: `ipv4:${normalized}` };
  }
  if (family !== 6) throw new Error('Invalid source IP.');
  const words = ipv6Words(candidate);
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const normalized = `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
    return { verificationIp: normalized, rateLimitIdentity: `ipv4:${normalized}` };
  }
  const verificationIp = words.map(word => word.toString(16)).join(':');
  const prefix = words.slice(0, 4).map(word => word.toString(16)).join(':');
  return { verificationIp, rateLimitIdentity: `ipv6:${prefix}::/64` };
}

function withoutViewerPort(value) {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)]:(\d{1,5})$/);
  if (bracketed && Number(bracketed[2]) >= 1 && Number(bracketed[2]) <= 65535 && isIP(bracketed[1])) return bracketed[1];
  const separator = trimmed.lastIndexOf(':');
  if (separator > 0) {
    const host = trimmed.slice(0, separator);
    const port = trimmed.slice(separator + 1);
    if (/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535 && isIP(host)) return host;
  }
  throw new Error('Invalid CloudFront viewer address.');
}

export function sourceIpFromEvent(event, trustCloudFrontViewerAddress = false) {
  if (trustCloudFrontViewerAddress) {
    const headers = Object.fromEntries(Object.entries(event?.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
    const header = headers['cloudfront-viewer-address'];
    if (typeof header !== 'string' || !header) throw new Error('Missing trusted CloudFront viewer address.');
    return withoutViewerPort(header);
  }
  const source = event?.requestContext?.http?.sourceIp;
  if (typeof source !== 'string' || !source) throw new Error('Missing Function URL source IP.');
  return source;
}

export function hashIpIdentity(identity, pepper) {
  if (typeof pepper !== 'string' || Buffer.byteLength(pepper, 'utf8') < 32) throw new Error('IP pepper must contain at least 32 bytes.');
  return createHmac('sha256', pepper).update(`faucet-ip-v1\0${identity}`).digest('hex');
}
