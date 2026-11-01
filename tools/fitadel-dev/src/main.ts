import {
  type Credentials,
  credentialsPath,
  deleteCredentials,
  isFresh,
  readCredentials,
  writeCredentials,
} from './credentials';
import { ResponseBodyError } from 'openid-client';
import { login, refresh } from './oidc';

const USAGE = `Usage: fitadel-dev <command>

  login    sign in through the browser and store the tokens
  token    print a valid access token (refreshing it when needed)
  whoami   show the access token's claims
  logout   delete the stored tokens`;

/** A valid access token, refreshed (and the rotated refresh token saved) when needed */
async function currentCredentials(): Promise<Credentials> {
  const stored = readCredentials();
  if (!stored) {
    throw new Error('Not signed in: run `pnpm nx run fitadel-dev:login`.');
  }
  if (isFresh(stored)) return stored;
  const refreshed = await refresh(stored.refreshToken);
  writeCredentials(refreshed);
  return refreshed;
}

const commands: Record<string, () => Promise<void>> = {
  async login() {
    writeCredentials(await login());
    console.error(`Signed in. Tokens stored in ${credentialsPath()}`);
  },
  async token() {
    // stdout gets the token only, so $(...) captures exactly it
    console.log((await currentCredentials()).accessToken);
  },
  async whoami() {
    const { accessToken } = await currentCredentials();
    const payload = accessToken.split('.')[1] ?? '';
    console.log(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  },
  async logout() {
    console.error(
      deleteCredentials() ? 'Signed out locally.' : 'Not signed in.',
    );
  },
};

const run = commands[process.argv[2] ?? ''];
if (!run) {
  console.error(USAGE);
  process.exit(2);
}
run().catch((error: unknown) => {
  console.error(describe(error));
  // Not process.exit(): on Windows it aborts while fetch's sockets are still closing
  process.exitCode = 1;
});

/** OAuth errors carry the useful part (invalid_grant, ...) outside the message */
function describe(error: unknown): string {
  if (error instanceof ResponseBodyError) {
    const description = error.error_description
      ? `: ${error.error_description}`
      : '';
    return `${error.error} (HTTP ${error.status})${description}`;
  }
  return error instanceof Error ? error.message : String(error);
}
