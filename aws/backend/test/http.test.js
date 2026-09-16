import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHttpHandler } from '../http.js';
import { HttpError } from '../errors.js';
import { memoryLogger } from './helpers.js';

function event({ method = 'POST', path = '/api/distribute', body, base64 = false, origin = 'https://faucet.example.test', hash } = {}) {
  const text = body ?? JSON.stringify({ recipientAddress: '0x1111111111111111111111111111111111111111', turnstileToken: 'token' });
  const bytes = Buffer.from(text);
  return {
    rawPath: path,
    body: base64 ? bytes.toString('base64') : text,
    isBase64Encoded: base64,
    headers: {
      origin,
      'content-type': 'application/json',
      'cloudfront-viewer-address': '[2001:db8::1]:443',
      'x-forwarded-for': '8.8.8.8',
      'x-amz-content-sha256': hash ?? createHash('sha256').update(bytes).digest('hex'),
    },
    requestContext: { requestId: 'request', http: { method, sourceIp: '203.0.113.9' } },
  };
}

function fixture(service = {}) {
  const logger = memoryLogger();
  const calls = [];
  const runtime = {
    config: { allowedOrigins: ['https://faucet.example.test'], trustCloudFrontViewerAddress: true },
    logger,
    service: {
      health: async () => ({ ok: true, enabled: false }),
      claim: async (body, ip) => { calls.push({ body, ip }); return { status: 'submitted', txHashes: [`0x${'a'.repeat(64)}`] }; },
      ...service,
    },
  };
  return { handler: createHttpHandler(async () => runtime), calls, logger };
}

test('Function URL handler validates exact bytes and uses only CloudFront viewer IP', async () => {
  const f = fixture();
  const result = await f.handler(event(), { awsRequestId: 'aws-request' });
  assert.equal(result.statusCode, 202);
  assert.equal(f.calls[0].ip, '2001:db8::1');
  assert.equal(JSON.parse(result.body).status, 'submitted');
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://faucet.example.test');
});

test('accepts base64 Function URL bodies but rejects missing/mismatched hashes and oversize bodies', async () => {
  assert.equal((await fixture().handler(event({ base64: true }))).statusCode, 202);
  assert.equal((await fixture().handler(event({ hash: '0'.repeat(64) }))).statusCode, 400);
  const missing = event();
  delete missing.headers['x-amz-content-sha256'];
  assert.equal((await fixture().handler(missing)).statusCode, 400);
  assert.equal((await fixture().handler(event({ body: JSON.stringify({ value: 'x'.repeat(8200) }) }))).statusCode, 413);
});

test('health reports disabled without exposing configuration and OPTIONS includes payload header', async () => {
  const f = fixture();
  const health = await f.handler(event({ method: 'GET', path: '/api/health', body: '' }));
  assert.equal(health.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true, enabled: false });
  const options = await f.handler(event({ method: 'OPTIONS', body: '' }));
  assert.equal(options.statusCode, 204);
  assert.match(options.headers['Access-Control-Allow-Headers'], /X-Amz-Content-Sha256/);
});

test('fails closed for untrusted origin, missing CloudFront header and disabled service', async () => {
  assert.equal((await fixture().handler(event({ origin: 'https://evil.example' }))).statusCode, 403);
  const missingViewer = event();
  delete missingViewer.headers['cloudfront-viewer-address'];
  assert.equal((await fixture().handler(missingViewer)).statusCode, 503);
  const disabled = fixture({ claim: async () => { throw new HttpError(503, 'FAUCET_DISABLED', 'The faucet is temporarily disabled.', 300); } });
  const result = await disabled.handler(event());
  assert.equal(result.statusCode, 503);
  assert.equal(result.headers['Retry-After'], '300');
  assert.equal(JSON.parse(result.body).code, 'FAUCET_DISABLED');
});
