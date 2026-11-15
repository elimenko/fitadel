// Checks the contract for changes that would break existing clients, against main.
// Skipped while main has no contract yet (the PR that adds it).
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// buf's bin is a small Node script; running it with node needs no shell on any OS
const buf = createRequire(import.meta.url).resolve('@bufbuild/buf/bin/buf');

const AGAINST_REF = process.env.PROTO_AGAINST_REF ?? 'origin/main';
const MODULE_DIR = 'libs/catalog/grpc';

const onMain = spawnSync(
  'git',
  ['cat-file', '-e', `${AGAINST_REF}:${MODULE_DIR}/buf.yaml`],
  { stdio: 'ignore' },
);
if (onMain.status !== 0) {
  console.log(`No contract on ${AGAINST_REF} yet: nothing to compare against.`);
  process.exit(0);
}

execFileSync(
  process.execPath,
  [
    buf,
    'breaking',
    '--against',
    `../../../.git#ref=${AGAINST_REF},subdir=${MODULE_DIR}`,
  ],
  { stdio: 'inherit' },
);
