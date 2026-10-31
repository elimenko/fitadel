import { PasswordPolicy } from './password-policy';
import type { PwnedPasswords } from './pwned-passwords';

describe('PasswordPolicy', () => {
  const isBreached = jest.fn();
  const policy = new PasswordPolicy({
    isBreached,
  } as unknown as PwnedPasswords);

  beforeEach(() => {
    isBreached.mockReset();
    isBreached.mockResolvedValue(false);
  });

  it('accepts a long enough password that was never breached', async () => {
    expect(await policy.check('river cat lantern')).toBeUndefined();
  });

  it('counts characters, not UTF-16 code units', async () => {
    // 7 characters, but 14 code units: still too short
    expect(await policy.check('🔒🔒🔒🔒🔒🔒🔒')).toBe('too_short');
    expect(await policy.check('пароль12')).toBeUndefined();
  });

  it('rejects passwords outside the length bounds before calling the API', async () => {
    expect(await policy.check('short')).toBe('too_short');
    expect(await policy.check('x'.repeat(257))).toBe('too_long');
    expect(isBreached).not.toHaveBeenCalled();
  });

  it('rejects a breached password', async () => {
    isBreached.mockResolvedValue(true);

    expect(await policy.check('password123')).toBe('breached');
  });

  it('allows the password when the breach check is unavailable (fails open)', async () => {
    isBreached.mockRejectedValue(new Error('timeout'));

    expect(await policy.check('river cat lantern')).toBeUndefined();
  });

  it('skips the breach check when it is disabled', async () => {
    expect(
      await new PasswordPolicy(undefined).check('password123'),
    ).toBeUndefined();
  });
});
