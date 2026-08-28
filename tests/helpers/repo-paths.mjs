// Shared path resolution for the script-level fixture suites.
//
// Those suites copy a real script out of scripts/ into a temp instance (the
// scripts resolve their instance root from their own location, so they have to
// be *deployed* to be tested) and symlink a node_modules into that instance so
// the copy can resolve js-yaml.
//
// Both paths used to come from `path.resolve('.')` — process.cwd() — which
// silently assumed the suite is always run from the repo root. It is not:
// inside a git worktree, dependencies are installed once at the primary
// checkout, so <worktree>/node_modules does not exist. The symlink then pointed
// at nothing, every fixture died on an unresolvable import, and because the
// crash left stdout empty the 19 resulting failures read as ordinary assertion
// mismatches rather than "the script never ran". Deriving both from this file's
// own location makes the suite independent of the working directory.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, derived from this file's location rather than the cwd. */
export const ORG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Nearest installed node_modules at or above the repo root. Git worktrees
 * share the primary checkout's install, so the upward walk is what makes these
 * fixtures work from a worktree as well as from the main checkout.
 */
export function nodeModulesDir(from = ORG_ROOT) {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, 'node_modules');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no node_modules found at or above ${from}`);
    dir = parent;
  }
}
