import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, publicError } from './errors.js';
import { sourceIpFromEvent } from './ip.js';
import { createLogger } from './logger.js';

const fallbackLogger = createLogger();

function lowerHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function decodeBody(event, headers) {
  if (typeof event.body !== 'string' || !event.body) throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON request.');
  let bytes;
  try {
    bytes = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
  } catch {
    throw new HttpError(400, 'INVALID_BODY_ENCODING', 'Invalid request body encoding.');
  }
  if (bytes.length > 8192) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');

  const supplied = headers['x-amz-content-sha256'];
  if (typeof supplied !== 'string' || !/^[\da-f]{64}$/i.test(supplied)) {
    throw new HttpError(400, 'PAYLOAD_HASH_REQUIRED', 'A valid payload hash is required.');
  }
  const actual = createHash('sha256').update(bytes).digest();
  const expected = Buffer.from(supplied, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(400, 'PAYLOAD_HASH_MISMATCH', 'The request payload hash does not match.');
  }
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Invalid JSON request.');
  }
}

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
    body: body === null ? '' : JSON.stringify(body),
  };
}

function corsHeaders(origin) {
  return origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Content-Sha256',
    Vary: 'Origin',
  } : {};
}

export function createHttpHandler(runtimeProvider) {
  return async (event, context = {}) => {
    let runtime;
    let origin;
    const started = Date.now();
    const requestId = context.awsRequestId || event?.requestContext?.requestId || 'unknown';
    const method = event?.requestContext?.http?.method || '';
    const path = event?.rawPath || '';
    try {
      runtime = await runtimeProvider();
      const headers = lowerHeaders(event?.headers);
      origin = typeof headers.origin === 'string' ? headers.origin : undefined;
      if (origin && !runtime.config.allowedOrigins.includes(origin)) {
        throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.');
      }
      const cors = corsHeaders(origin);
      if (method === 'OPTIONS') return response(204, null, cors);
      if (path === '/api/health' && method === 'GET') {
        const result = await runtime.service.health();
        runtime.logger.info('http_health', { requestId, method, path, status: 200, durationMs: Date.now() - started });
        return response(200, result, cors);
      }
      if (path !== '/api/distribute') throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      if (method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST for this endpoint.');
      if (headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
      }
      const body = decodeBody(event, headers);
      // Production is intentionally CloudFront-only. The OAC resource policy and
      // origin request policy must overwrite this viewer-address header.
      const sourceIp = sourceIpFromEvent(event, runtime.config.trustCloudFrontViewerAddress);
      const result = await runtime.service.claim(body, sourceIp);
      runtime.logger.info('http_claim', { requestId, method, path, status: 202, durationMs: Date.now() - started });
      return response(202, result, cors);
    } catch (error) {
      const outward = publicError(error);
      const headers = { ...corsHeaders(origin) };
      if (outward.retryAfter) headers['Retry-After'] = String(outward.retryAfter);
      (runtime?.logger || fallbackLogger).warn('http_request_failed', {
        requestId, method, path, status: outward.status, code: outward.code,
        durationMs: Date.now() - started,
      });
      const body = { error: outward.message, code: outward.code };
      if (path === '/api/health' && runtime?.config) body.enabled = runtime.config.faucetEnabled;
      return response(outward.status, body, headers);
    }
  };
}

export const testing = { decodeBody, lowerHeaders };
