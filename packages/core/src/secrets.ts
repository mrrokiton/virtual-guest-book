import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/** No 0/O or 1/I so a PIN copied from a printed card is unambiguous. */
export const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PIN_LENGTH = 6;

export function generatePin(): string {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) pin += PIN_ALPHABET[randomInt(PIN_ALPHABET.length)];
  return pin;
}

export function normalizePin(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isWellFormedPin(pin: string): boolean {
  return pin.length === PIN_LENGTH && [...pin].every((c) => PIN_ALPHABET.includes(c));
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** 120 bits of randomness, lowercase base32: safe in URLs and QR codes, infeasible to enumerate. */
export function generateSlug(): string {
  const bytes = randomBytes(15);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z2-7]{24}$/.test(slug);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function keyFrom(secret: string): Buffer {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes, base64-encoded.');
  return key;
}

/** AES-256-GCM; output is `iv.tag.ciphertext` in base64url. */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string, secret: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Malformed encrypted payload.');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
