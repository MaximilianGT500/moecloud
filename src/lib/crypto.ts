import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function randomId(length = 16): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue;
      out += ALPHABET[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const hmac = (key: string, value: string) => createHmac('sha256', key).update(value).digest('base64url');

export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => argon2.hash(password, ARGON);

let dummy: Promise<string> | null = null;

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    dummy ??= hashPassword(randomId(24));
    await argon2.verify(await dummy, password).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export const totpCounter = (time = Date.now()) => Math.floor(time / 30_000);

export function verifyTotp(secret: string, code: string, last = 0): number | null {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) return null;
  const now = totpCounter();
  for (const counter of [now, now - 1, now + 1]) {
    if (counter <= last) continue;
    if (safeEqual(hotp(secret, counter), clean)) return counter;
  }
  return null;
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function recoveryCode(): string {
  const raw = randomId(10).toLowerCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
