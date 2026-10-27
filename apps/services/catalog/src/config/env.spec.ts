import { validateEnv } from './env';

describe('validateEnv', () => {
  it('applies defaults when variables are missing', () => {
    expect(validateEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3000 });
  });

  it('parses strings into typed values', () => {
    expect(validateEnv({ NODE_ENV: 'production', PORT: '8080' })).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
    });
  });

  it('rejects an invalid port with a readable message', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('lists every invalid variable at once', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging', PORT: '0' })).toThrow(
      /NODE_ENV[\s\S]*PORT|PORT[\s\S]*NODE_ENV/,
    );
  });
});
