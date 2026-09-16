import { isIP } from 'node:net';
import { HttpError } from './errors.js';

export function normalizeIp(value) {
  if (typeof value !== 'string' || !isIP(value)) throw new HttpError(400, 'Unable to determine client IP.');
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f\d]+):([a-f\d]+)$/);
  if (mapped) { const parts = mapped.slice(1).map(part => parseInt(part, 16)); return [parts[0] >> 8, parts[0] & 255, parts[1] >> 8, parts[1] & 255].join('.'); }
  return canonical;
}

async function jsonBody(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
  if (!request.body) throw new HttpError(400, 'Invalid JSON request.');
  const reader = request.body.getReader();
  let size = 0;
  let body = '';
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new HttpError(413, 'Request body is too large.'); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'Invalid JSON request.'); }
}

export async function handleApi(request, config, service) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin && !config.allowedOrigins.includes(origin)) throw new HttpError(403, 'Origin is not allowed.');
    if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    if (url.pathname !== '/api/distribute') throw new HttpError(404, 'Not found.');
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST for this endpoint.');
    // This header is supplied by Cloudflare's edge. Never use X-Forwarded-For,
    // X-Real-IP or a JSON value. Do not expose this handler behind a non-CF server.
    const ip = normalizeIp(request.headers.get('CF-Connecting-IP'));
    return Response.json(await service.claim(await jsonBody(request), ip), { status: 202, headers });
  } catch (error) {
    if (error.retryAfter) headers['Retry-After'] = String(error.retryAfter);
    return Response.json({ error: error instanceof HttpError ? error.message : 'The faucet is temporarily unavailable.' }, { status: error instanceof HttpError ? error.status : 503, headers });
  }
}
