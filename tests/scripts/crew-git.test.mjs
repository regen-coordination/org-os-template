// tests/scripts/crew-git.test.mjs
//
// The one piece of the git adapter with logic worth pinning: finding the
// repository's primary checkout from a linked worktree. Uses real git on
// throwaway repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGit } from '../../scripts/crew/git.mjs';

const sh = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'crew-git-')));
const commit = (dir) => sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '-q', '--allow-empty', '-m', 'init');

test('primaryCheckout is the repository itself for an ordinary checkout', () => {
  const base = tmp();
  sh(base, 'init', '-q', '-b', 'main', 'repo');
  const repo = join(base, 'repo');
  commit(repo);
  assert.equal(createGit(repo).primaryCheckout(), repo);
});

test('primaryCheckout from a linked worktree is the primary checkout', () => {
  const base = tmp();
  sh(base, 'init', '-q', '-b', 'main', 'repo');
  const repo = join(base, 'repo');
  commit(repo);
  sh(repo, 'worktree', 'add', '-q', join(base, 'linked'), '-b', 'linked');
  assert.equal(createGit(join(base, 'linked')).primaryCheckout(), repo);
});

test('primaryCheckout follows core.worktree when the git directory lives elsewhere, as in a submodule', () => {
  const base = tmp();
  const checkout = join(base, 'checkout');
  sh(base, 'init', '-q', '-b', 'main', '--separate-git-dir', join(base, 'gitdir'), 'checkout');
  sh(checkout, 'config', 'core.worktree', checkout); // what `git submodule` records
  commit(checkout);
  sh(checkout, 'worktree', 'add', '-q', join(base, 'linked'), '-b', 'linked');
  assert.equal(createGit(join(base, 'linked')).primaryCheckout(), checkout);
  assert.equal(createGit(checkout).primaryCheckout(), checkout);
});

test('primaryCheckout falls back to the directory it was given outside a repository', () => {
  const base = tmp();
  assert.equal(createGit(base).primaryCheckout(), base);
});
