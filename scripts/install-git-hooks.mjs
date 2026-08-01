#!/usr/bin/env node
// Installs versioned git hooks from scripts/git-hooks/ into the active git
// hooks directory (correct even for this submodule, whose git dir lives under
// the parent's .git/modules/). Copies only hooks we version; refuses to
// overwrite an existing hook whose content differs (e.g. the pre-existing
// pre-commit), so foreign hooks are never clobbered.
import { execSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'scripts', 'git-hooks');
const hooksDir = resolve(
  repoRoot,
  execSync('git rev-parse --git-path hooks', { cwd: repoRoot, encoding: 'utf8' }).trim(),
);

let failed = false;
for (const name of readdirSync(srcDir)) {
  const src = join(srcDir, name);
  const dest = join(hooksDir, name);
  if (existsSync(dest) && readFileSync(dest, 'utf8') !== readFileSync(src, 'utf8')) {
    console.error(`hooks: ${name} exists at ${dest} with different content — resolve manually; not overwriting.`);
    failed = true;
    continue;
  }
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`hooks: installed ${name} -> ${dest}`);
}
process.exitCode = failed ? 1 : 0;
