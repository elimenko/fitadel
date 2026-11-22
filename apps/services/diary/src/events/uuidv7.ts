import { randomBytes } from 'node:crypto';

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix time in milliseconds, then random bits. Ids
 * made later sort later, to the millisecond, like the database's uuidv7(). Made here
 * rather than by the database when a row's own content needs its id.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 0b10 (RFC 9562)
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
