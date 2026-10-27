// Integration tests: *.integration.ts against a real Postgres started by Testcontainers
const config = require('./jest.config.cts');

module.exports = {
  ...config,
  displayName: 'catalog-integration',
  testMatch: ['<rootDir>/src/**/*.integration.ts'],
  // nodenext requires '.js' in import(); map it back to the .ts source
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Starting a container (and pulling its image on the first run) takes a while
  testTimeout: 180_000,
};
