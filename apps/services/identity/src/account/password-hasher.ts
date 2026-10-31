import { Injectable } from '@nestjs/common';
import { hash, parseOptions, verify } from '@node-rs/argon2';

// The library declares Algorithm as an ambient const enum, which isolatedModules can't
// read across files, so the value is spelled out: 2 = Algorithm.Argon2id.
const ARGON2ID = 2;

// argon2id with OWASP's baseline parameters (Password Storage Cheat Sheet): 19 MiB,
// 2 passes, 1 lane. Raising them later is safe: every hash carries its own parameters
// in the PHC string, and verify() reports needsRehash so a login can upgrade it.
export const PASSWORD_HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface PasswordCheck {
  ok: boolean;
  /** The password was right but hashed with outdated parameters: hash it again and save. */
  needsRehash: boolean;
}

/**
 * Hashes and verifies passwords. Hashing runs on libuv's thread pool (4 threads by
 * default), so it doesn't block the event loop, and at most 4 hashes run at once.
 */
@Injectable()
export class PasswordHasher {
  // Unknown accounts are checked against this hash, so "no such email" takes as long as
  // "wrong password" and response times don't reveal which emails have accounts.
  private readonly dummyHash = this.hash('not a real password');

  hash(password: string): Promise<string> {
    return hash(normalize(password), PASSWORD_HASH_OPTIONS);
  }

  /** `storedHash` is undefined when the account doesn't exist or has no password. */
  async verify(
    storedHash: string | undefined,
    password: string,
  ): Promise<PasswordCheck> {
    if (storedHash === undefined) {
      await verify(await this.dummyHash, normalize(password));
      return { ok: false, needsRehash: false };
    }
    const ok = await verify(storedHash, normalize(password));
    return { ok, needsRehash: ok && isOutdated(storedHash) };
  }
}

// The same characters can arrive in different Unicode forms, e.g. "й" as one code point
// or as "и" plus a combining breve, depending on the keyboard. NFKC makes them equal, as
// NIST SP 800-63B recommends. Changing this later would break existing hashes.
function normalize(password: string): string {
  return password.normalize('NFKC');
}

function isOutdated(storedHash: string): boolean {
  const used = parseOptions(storedHash);
  return (
    used.algorithm !== PASSWORD_HASH_OPTIONS.algorithm ||
    used.memoryCost !== PASSWORD_HASH_OPTIONS.memoryCost ||
    used.timeCost !== PASSWORD_HASH_OPTIONS.timeCost ||
    used.parallelism !== PASSWORD_HASH_OPTIONS.parallelism
  );
}
