// Checks a Protobuf contract for changes that would break existing readers, against
// main. Run from the contract library's folder (its nx `proto-breaking` target), which
// holds buf.yaml. Skipped while main has no contract there yet (the PR that adds it).
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// buf's bin is a small Node script; running it with node needs no shell on any OS
const buf = createRequire(import.meta.url).resolve('@bufbuild/buf/bin/buf');

const AGAINST_REF = process.env.PROTO_AGAINST_REF ?? 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
// This folder relative to the repository root, and the way back up to it
const moduleDir = git('rev-parse', '--show-prefix').replace(/\/$/, '');
const toRoot = git('rev-parse', '--show-cdup') || '.';

const onMain = spawnSync(
  'git',
  ['cat-file', '-e', `${AGAINST_REF}:${moduleDir}/buf.yaml`],
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
    `${toRoot}/.git#ref=${AGAINST_REF},subdir=${moduleDir}`,
  ],
  { stdio: 'inherit' },
);
