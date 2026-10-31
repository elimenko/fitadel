import { validateEnv } from './env';

const DATABASE_URL = 'postgresql://identity_app:secret@localhost:5432/identity';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3010,
      LOG_LEVEL: 'info',
      DATABASE_URL,
    });
  });

  it('requires a Postgres DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() =>
      validateEnv({ DATABASE_URL: 'http://localhost/identity' }),
    ).toThrow(/DATABASE_URL/);
  });
});
