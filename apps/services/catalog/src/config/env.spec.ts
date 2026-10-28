import { validateEnv } from './env';

const DATABASE_URL = 'postgresql://catalog_app:secret@localhost:5432/catalog';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      OFF_LOOKUP: 'enabled',
      OFF_API_URL: 'https://world.openfoodfacts.org',
      OFF_USER_AGENT: 'Fitadel/0.1 (+https://github.com/elimenko/fitadel)',
      OFF_TIMEOUT_MS: 2000,
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
