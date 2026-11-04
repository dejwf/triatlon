import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Náhodný token do URL (256 bitů). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 6místný kód pro ruční zadání v mobilní appce. */
export function randomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Hash vysokoentropického tokenu (pro vyhledání v DB). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Hash krátkého kódu. Kód má jen 10^6 možností, proto HMAC s tajným klíčem a ID tokenu —
 * z uniklé DB nejde kód dopočítat.
 */
export function hashCode(secret: Uint8Array, tokenId: string, code: string): string {
  return createHmac('sha256', secret).update(`${tokenId}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
