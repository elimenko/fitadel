import { validateEnv } from './env';

const DATABASE_URL = 'postgresql://catalog_app:secret@localhost:5432/catalog';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
    });
  });

  it('parses strings into typed values', () => {
    expect(
      validateEnv({ NODE_ENV: 'production', PORT: '8080', DATABASE_URL }),
    ).toMatchObject({ NODE_ENV: 'production', PORT: 8080 });
  });

  it('requires DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a Postgres URL', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'http://localhost/catalog' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an invalid port with a readable message', () => {
    expect(() => validateEnv({ PORT: 'abc', DATABASE_URL })).toThrow(/PORT/);
  });

  it('lists every invalid variable at once', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'staging', PORT: '0', DATABASE_URL }),
    ).toThrow(/NODE_ENV[\s\S]*PORT|PORT[\s\S]*NODE_ENV/);
  });
});
