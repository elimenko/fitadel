import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Credentials {
  issuer: string;
  refreshToken: string;
  accessToken: string;
  /** Unix seconds */
  accessTokenExpiresAt: number;
}

/**
 * Where the tokens live: the user's config directory, like other developer CLIs.
 * %APPDATA% on Windows (only the user can read it by default), $XDG_CONFIG_HOME or
 * ~/.config elsewhere, with the file readable by its owner only.
 */
export function credentialsPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const base =
    platform === 'win32' && env.APPDATA
      ? env.APPDATA
      : (env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  return join(base, 'fitadel-dev', 'credentials.json');
}

export function readCredentials(
  path = credentialsPath(),
): Credentials | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Credentials;
  } catch {
    return undefined;
  }
}

export function writeCredentials(
  credentials: Credentials,
  path = credentialsPath(),
): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  // The mode only applies when the file is created; tighten an existing one too.
  // (A no-op on Windows, where the directory's ACL does the job.)
  chmodSync(path, 0o600);
}

export function deleteCredentials(path = credentialsPath()): boolean {
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Refresh a little early, so a token doesn't expire on its way to the server */
export function isFresh(
  credentials: Credentials,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return credentials.accessTokenExpiresAt - nowSeconds > 60;
}
