import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokens for emailed links (registration, password reset): 32 random bytes, so they
 * can't be guessed. Links carry the token; the database only its hash, so a leaked
 * table opens nothing.
 */
export function newLinkToken(): {
  token: string;
  hash: Uint8Array<ArrayBuffer>;
} {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: linkTokenHash(token) };
}

export function linkTokenHash(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token).digest());
}
