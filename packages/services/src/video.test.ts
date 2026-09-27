import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStreamWebhook } from './video';

const secret = 'whsec_test';
const body = JSON.stringify({ uid: 'abc', readyToStream: true });
const now = 1_800_000_000;

function sign(time: number, payload = body) {
  return `time=${time},sig1=${createHmac('sha256', secret).update(`${time}.${payload}`).digest('hex')}`;
}

describe('verifyStreamWebhook', () => {
  it('accepts a correctly signed, fresh payload', () => {
    expect(verifyStreamWebhook(secret, sign(now), body, now)).toBe(true);
  });

  it('rejects tampered bodies, stale timestamps and missing headers', () => {
    expect(verifyStreamWebhook(secret, sign(now), body.replace('abc', 'xyz'), now)).toBe(false);
    expect(verifyStreamWebhook(secret, sign(now - 600), body, now)).toBe(false);
    expect(verifyStreamWebhook(secret, null, body, now)).toBe(false);
    expect(verifyStreamWebhook('other', sign(now), body, now)).toBe(false);
  });
});
