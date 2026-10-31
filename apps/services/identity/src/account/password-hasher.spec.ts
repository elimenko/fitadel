import { hash } from '@node-rs/argon2';
import { PASSWORD_HASH_OPTIONS, PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('produces an argon2id PHC string with the current parameters and a random salt', async () => {
    const first = await hasher.hash('correct horse battery staple');
    const second = await hasher.hash('correct horse battery staple');

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toBe(second);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify(stored, 'correct horse battery staple')).toEqual(
      {
        ok: true,
        needsRehash: false,
      },
    );
    expect(
      await hasher.verify(stored, 'correct horse battery stapler'),
    ).toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('asks for a rehash when the stored hash used weaker parameters', async () => {
    const weak = await hash('correct horse battery staple', {
      ...PASSWORD_HASH_OPTIONS,
      memoryCost: 4096,
      timeCost: 1,
    });

    expect(await hasher.verify(weak, 'correct horse battery staple')).toEqual({
      ok: true,
      needsRehash: true,
    });
    expect(await hasher.verify(weak, 'wrong')).toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it('treats composed and decomposed Unicode forms as the same password', async () => {
    const composed = 'мой пароль'; // "й" as one code point, U+0439
    const decomposed = 'мой пароль'; // "и" + combining breve
    expect(composed).not.toBe(decomposed);

    const stored = await hasher.hash(composed);

    expect((await hasher.verify(stored, decomposed)).ok).toBe(true);
  });

  it('spends a real hash on unknown accounts, so timing does not reveal them', async () => {
    const stored = await hasher.hash('correct horse battery staple');
    await hasher.verify(undefined, 'warm-up'); // the dummy hash is computed once
    const timeOf = async (storedHash: string | undefined) => {
      const started = performance.now();
      for (let i = 0; i < 5; i++) await hasher.verify(storedHash, 'wrong');
      return performance.now() - started;
    };

    expect(await hasher.verify(undefined, 'any')).toEqual({
      ok: false,
      needsRehash: false,
    });
    // Compared with a real wrong-password check on the same machine, so the test doesn't
    // depend on how fast the machine is. Returning early would be orders of magnitude faster.
    const unknown = await timeOf(undefined);
    const known = await timeOf(stored);
    expect(unknown).toBeGreaterThan(known / 2);
  });
});
