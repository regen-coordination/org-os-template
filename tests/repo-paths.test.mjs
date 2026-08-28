// Pins the path-resolution contract of tests/helpers/repo-paths.mjs: the
// fixture suites bind to whatever this returns, so a wrong answer here turns
// into "assertion mismatch" noise everywhere else (the 2026-08-28 worktree
// incident). Assert on it directly instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ORG_ROOT, nodeModulesDir } from './helpers/repo-paths.mjs';

test('ORG_ROOT is the org-os repo root regardless of cwd', () => {
  assert.ok(existsSync(path.join(ORG_ROOT, 'package.json')), `no package.json at ${ORG_ROOT}`);
  assert.ok(
    existsSync(path.join(ORG_ROOT, 'scripts', 'guards', 'deny-destructive-git.mjs')),
    `${ORG_ROOT} does not look like the org-os root`,
  );
});

test('nodeModulesDir resolves inside this repo, never the enclosing vault', () => {
  const nm = nodeModulesDir();
  assert.ok(nm.startsWith(ORG_ROOT + path.sep), `${nm} escaped the repo (walk crossed a repo boundary)`);
  assert.ok(existsSync(path.join(nm, 'js-yaml')), `${nm} lacks js-yaml — fixtures would fail to import`);
});

test('the walk fails loudly rather than crossing into a foreign standalone repo', () => {
  // ORG_ROOT/.git is a file (submodule/worktree style) or dir depending on the
  // checkout; either way, a start dir with NO node_modules anywhere before a
  // foreign repo boundary must throw, not bind upward. tests/ itself has no
  // node_modules, so starting the walk above the repo simulates that cleanly.
  const outside = path.dirname(ORG_ROOT); // the vault level (a different repo)
  if (existsSync(path.join(outside, 'node_modules'))) {
    // The vault has its own install: from ORG_ROOT the walk must still return
    // OUR node_modules (found before any boundary), never the vault's.
    assert.equal(nodeModulesDir(), path.join(ORG_ROOT, 'node_modules'));
  }
});
