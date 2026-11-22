// Checks a Protobuf contract for changes that would break existing readers, against
// main. Run from the contract library's folder (its nx `proto-breaking` target), which
// holds buf.yaml. Skipped while main has no contract there yet (the PR that adds it).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

// buf's bin is a small Node script; running it with node needs no shell on any OS
const buf = createRequire(import.meta.url).resolve('@bufbuild/buf/bin/buf');

const AGAINST_REF = process.env.PROTO_AGAINST_REF ?? 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
// This folder relative to the repository root
const moduleDir = git('rev-parse', '--show-prefix').replace(/\/$/, '');

const onMain = spawnSync(
  'git',
  ['cat-file', '-e', `${AGAINST_REF}:${moduleDir}/buf.yaml`],
  { stdio: 'ignore' },
);
if (onMain.status !== 0) {
  console.log(`No contract on ${AGAINST_REF} yet: nothing to compare against.`);
  process.exit(0);
}

// The contract as it is on main, copied into a temporary folder. Not buf's own
// `.git#ref=` input: buf clones the repository for that, and a partial clone (CI
// checks out without trees) can't serve objects it doesn't have. git show fetches
// them on demand.
const against = mkdtempSync(join(tmpdir(), 'proto-breaking-'));
try {
  const files = git(
    'ls-tree',
    '-r',
    '--name-only',
    '--full-tree',
    AGAINST_REF,
    '--',
    moduleDir,
  ).split('\n');
  for (const file of files) {
    const target = join(against, relative(moduleDir, file));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      execFileSync('git', ['show', `${AGAINST_REF}:${file}`], {
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  }
  // buf prints what breaks; pass its status on, without a Node stack trace
  process.exitCode =
    spawnSync(process.execPath, [buf, 'breaking', '--against', against], {
      stdio: 'inherit',
    }).status ?? 1;
} finally {
  rmSync(against, { recursive: true, force: true });
}
