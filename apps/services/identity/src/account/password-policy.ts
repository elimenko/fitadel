import { Logger } from '@nestjs/common';
import { PwnedPasswords } from './pwned-passwords';

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound for the work one request can cause: argon2 reads the whole input */
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordProblem = 'too_short' | 'too_long' | 'breached';

/**
 * Rules for new passwords (OWASP ASVS 5.0, NIST SP 800-63B-4): a minimum length and no
 * known-breached passwords, which is what stops credential stuffing. No composition
 * rules ("one uppercase, one symbol"): people satisfy them predictably.
 *
 * Created by AccountModule's factory, which leaves out the breach check when it's
 * disabled.
 */
export class PasswordPolicy {
  private readonly logger = new Logger(PasswordPolicy.name);

  /** `pwned` is undefined when the breach check is disabled (offline development). */
  constructor(private readonly pwned: PwnedPasswords | undefined) {}

  async check(password: string): Promise<PasswordProblem | undefined> {
    // Characters as people count them, after the same normalization as hashing
    const length = [...password.normalize('NFKC')].length;
    if (length < PASSWORD_MIN_LENGTH) return 'too_short';
    if (length > PASSWORD_MAX_LENGTH) return 'too_long';

    try {
      if (await this.pwned?.isBreached(password.normalize('NFKC'))) {
        return 'breached';
      }
    } catch (error) {
      // Fail open: an outage of the breach API must not block registrations. The
      // length rule still applies.
      this.logger.warn({ err: error }, 'Breached-password check unavailable');
    }
    return undefined;
  }
}
