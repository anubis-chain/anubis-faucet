import test from 'node:test';
import assert from 'node:assert/strict';
import { hashIpIdentity, normalizeSourceIp, sourceIpFromEvent } from '../ip.js';

test('normalizes IPv4 and IPv4-mapped IPv6 to the same rate-limit identity', () => {
  assert.deepEqual(normalizeSourceIp('192.0.2.1'), { verificationIp: '192.0.2.1', rateLimitIdentity: 'ipv4:192.0.2.1' });
  assert.deepEqual(normalizeSourceIp('::ffff:192.0.2.1'), normalizeSourceIp('::ffff:c000:201'));
  assert.equal(normalizeSourceIp('::ffff:c000:201').rateLimitIdentity, 'ipv4:192.0.2.1');
});

test('masks real IPv6 identities to /64 deterministically', () => {
  const first = normalizeSourceIp('2001:0db8:abcd:12::1');
  const samePrefix = normalizeSourceIp('2001:db8:abcd:12:ffff::99');
  const otherPrefix = normalizeSourceIp('2001:db8:abcd:13::1');
  assert.equal(first.rateLimitIdentity, samePrefix.rateLimitIdentity);
  assert.notEqual(first.rateLimitIdentity, otherPrefix.rateLimitIdentity);
  assert.equal(first.rateLimitIdentity, 'ipv6:2001:db8:abcd:12::/64');
});

test('only accepts the CloudFront-generated viewer address in production mode', () => {
  const base = { requestContext: { http: { sourceIp: '203.0.113.99' } }, headers: { 'x-forwarded-for': '8.8.8.8' } };
  assert.throws(() => sourceIpFromEvent(base, true), /CloudFront/);
  assert.equal(sourceIpFromEvent({ ...base, headers: { 'CloudFront-Viewer-Address': '192.0.2.4:443' } }, true), '192.0.2.4');
  assert.equal(sourceIpFromEvent({ ...base, headers: { 'cloudfront-viewer-address': '[2001:db8::1]:65535' } }, true), '2001:db8::1');
  assert.equal(sourceIpFromEvent({ ...base, headers: { 'cloudfront-viewer-address': '2001:db8::1:443' } }, true), '2001:db8::1');
  assert.throws(() => sourceIpFromEvent({ ...base, headers: { 'cloudfront-viewer-address': '192.0.2.4:0' } }, true));
  assert.throws(() => sourceIpFromEvent({ ...base, headers: { 'cloudfront-viewer-address': '192.0.2.4' } }, true));
});

test('HMAC is domain-separated, stable and requires a strong pepper', () => {
  const pepper = 'p'.repeat(32);
  const a = hashIpIdentity('ipv4:192.0.2.1', pepper);
  assert.match(a, /^[\da-f]{64}$/);
  assert.equal(a, hashIpIdentity('ipv4:192.0.2.1', pepper));
  assert.notEqual(a, hashIpIdentity('ipv4:192.0.2.2', pepper));
  assert.throws(() => hashIpIdentity('ipv4:192.0.2.1', 'short'));
});
