import { createHash } from 'node:crypto';
import { normalizeEmail } from '../account/email';
import type { Limit } from './rate-limiter';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Failed sign-ins per email. Slows guessing down without locking anyone out for good. */
export const SIGN_IN_PER_EMAIL: Limit = { max: 10, windowMs: FIFTEEN_MINUTES };
/** Every sign-in attempt from one IP; each one costs a password hash */
export const SIGN_IN_PER_IP: Limit = { max: 50, windowMs: FIFTEEN_MINUTES };
export const REGISTER_PER_IP: Limit = { max: 10, windowMs: FIFTEEN_MINUTES };

/** The email as a hash: rate limit rows outlive the attempt, the address needn't */
export function emailKey(prefix: string, email: string): string {
  const digest = createHash('sha256')
    .update(normalizeEmail(email))
    .digest('hex');
  return `${prefix}:email:${digest}`;
}

export function ipKey(prefix: string, ip: string | undefined): string {
  return `${prefix}:ip:${ip ?? 'unknown'}`;
}
