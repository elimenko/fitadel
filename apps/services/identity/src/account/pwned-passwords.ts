import { createHash } from 'node:crypto';

export interface PwnedPasswordsOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
}

/**
 * Have I Been Pwned's Pwned Passwords range API, with k-anonymity: only the first 5 hex
 * characters of the password's SHA-1 leave the service. The API returns the remaining
 * characters of every breached hash with that prefix, and the match happens here.
 */
export class PwnedPasswords {
  constructor(private readonly options: PwnedPasswordsOptions) {}

  /** Throws on timeouts, network errors and server errors: they say nothing either way. */
  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1')
      .update(password)
      .digest('hex')
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const response = await fetch(
      new URL(`/range/${prefix}`, this.options.baseUrl),
      {
        headers: {
          'User-Agent': this.options.userAgent,
          // Pads the response with fake entries (count 0), so its size doesn't hint
          // at how many real matches the prefix has
          'Add-Padding': 'true',
        },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`Pwned Passwords answered ${response.status}`);
    }
    // One "SUFFIX:COUNT" per line
    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate === suffix && Number(count) > 0) return true;
    }
    return false;
  }
}
