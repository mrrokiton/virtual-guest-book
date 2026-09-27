import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generatePin,
  generateSlug,
  isValidSlug,
  isWellFormedPin,
  normalizePin,
  PIN_LENGTH,
} from './secrets';

describe('PIN', () => {
  it('generates well-formed PINs without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin();
      expect(pin).toHaveLength(PIN_LENGTH);
      expect(isWellFormedPin(pin)).toBe(true);
      expect(pin).not.toMatch(/[01IO]/);
    }
  });

  it('normalizes case, spaces and dashes', () => {
    expect(normalizePin(' ab3-k9z ')).toBe('AB3K9Z');
  });
});

describe('slug', () => {
  it('is 24 base32 chars and unique', () => {
    const slugs = new Set(Array.from({ length: 500 }, generateSlug));
    expect(slugs.size).toBe(500);
    for (const s of slugs) expect(isValidSlug(s)).toBe(true);
  });
});

describe('encryptSecret', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('AB3K9Z', key);
    const b = encryptSecret('AB3K9Z', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('AB3K9Z');
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const payload = encryptSecret('AB3K9Z', key);
    const [iv, tag, data] = payload.split('.');
    const tampered = [iv, tag, Buffer.from('xxxxxx').toString('base64url') + data].join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32).toString('base64'))).toThrow();
  });
});
