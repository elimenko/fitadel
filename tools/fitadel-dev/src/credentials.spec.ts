import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  credentialsPath,
  deleteCredentials,
  isFresh,
  readCredentials,
  writeCredentials,
} from './credentials';

const credentials = {
  issuer: 'http://localhost:3010/oidc',
  refreshToken: 'r',
  accessToken: 'a',
  accessTokenExpiresAt: 1_000,
};

describe('credentials', () => {
  it('live in the user config directory', () => {
    expect(
      credentialsPath({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32'),
    ).toBe(
      join(
        'C:\\Users\\me\\AppData\\Roaming',
        'fitadel-dev',
        'credentials.json',
      ),
    );
    expect(
      credentialsPath({ XDG_CONFIG_HOME: '/home/me/.config' }, 'linux'),
    ).toBe(join('/home/me/.config', 'fitadel-dev', 'credentials.json'));
  });

  it('round-trip through a file only its owner can read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fitadel-dev-'));
    const path = join(dir, 'nested', 'credentials.json');

    writeCredentials(credentials, path);

    expect(readCredentials(path)).toEqual(credentials);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    expect(deleteCredentials(path)).toBe(true);
    expect(readCredentials(path)).toBeUndefined();
  });

  it('count as stale a minute before the access token expires', () => {
    expect(isFresh(credentials, 900)).toBe(true);
    expect(isFresh(credentials, 941)).toBe(false);
  });
});
