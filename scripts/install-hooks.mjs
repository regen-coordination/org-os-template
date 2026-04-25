#!/usr/bin/env node
// install-hooks.mjs — copy .github/hooks/pre-commit.sh into the git hooks dir.
//
// Resolves the destination by asking git itself (`git rev-parse --git-path hooks`).
// This handles all cases uniformly:
//   - regular checkouts (.git is a directory) → .git/hooks/
//   - worktrees (.git is a gitdir-pointer file) → <common>/.git/hooks/
//   - submodules → <super>/.git/modules/<name>/hooks/
//   - custom core.hooksPath → that path
//
// IMPORTANT: in a git worktree, hooks live in the COMMON gitdir and are shared
// across every worktree of the repo. Installing here will make sibling worktrees
// also run the hook. That's standard git behavior, not a bug — flag it for the
// operator if undesired (use `git commit --no-verify` per worktree to bypass).

import { copyFileSync, chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const SRC = '.github/hooks/pre-commit.sh';

if (!existsSync('.git')) {
  console.error('install-hooks: not a git repo (no .git entry in cwd)');
  process.exit(1);
}

if (!existsSync(SRC)) {
  console.error(`install-hooks: ${SRC} missing`);
  process.exit(1);
}

let hooksDir;
try {
  hooksDir = execSync('git rev-parse --git-path hooks', { encoding: 'utf8' }).trim();
} catch (err) {
  console.error('install-hooks: failed to query git for hooks path:', err.message);
  process.exit(1);
}

if (!hooksDir) {
  console.error('install-hooks: git returned empty hooks path');
  process.exit(1);
}

if (!existsSync(hooksDir)) {
  mkdirSync(hooksDir, { recursive: true });
}

const dst = path.join(hooksDir, 'pre-commit');
copyFileSync(SRC, dst);
chmodSync(dst, 0o755);

// Worktree-aware notice: warn the operator that installing in a worktree
// affects all sibling worktrees too (because hooks live in the common gitdir).
let isWorktree = false;
try {
  const gitEntry = statSync('.git');
  isWorktree = gitEntry.isFile();
} catch {
  // ignore
}

console.log(`install-hooks: ${SRC} → ${dst} (mode 755)`);
if (isWorktree) {
  console.log(
    'install-hooks: NOTE — you are in a git worktree; this hook is now active in all sibling worktrees of this repo (hooks live in the shared common gitdir). Use `git commit --no-verify` per worktree to bypass when needed.',
  );
}
