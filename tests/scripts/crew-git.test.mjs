// tests/scripts/crew-git.test.mjs
//
// The one piece of the git adapter with logic worth pinning: finding the
// repository's primary checkout from a linked worktree. Uses real git on
// throwaway repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
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

test('changes lists untracked and ignored files, but not installed dependencies', () => {
  const base = tmp();
  sh(base, 'init', '-q', '-b', 'main', 'repo');
  const repo = join(base, 'repo');
  writeFileSync(join(repo, '.gitignore'), '.env\nnode_modules/\nscratch/\n');
  sh(repo, 'add', '.gitignore');
  sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '-q', '-m', 'init');
  const git = createGit(repo);
  assert.deepEqual(git.changes(repo), []);
  mkdirSync(join(repo, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'x', 'index.js'), '');
  assert.deepEqual(git.changes(repo), [], 'node_modules alone is not work');
  writeFileSync(join(repo, '.env'), 'SECRET=1');
  mkdirSync(join(repo, 'scratch'));
  writeFileSync(join(repo, 'scratch', 'findings.md'), 'draft');
  writeFileSync(join(repo, 'new.md'), 'untracked');
  assert.deepEqual(git.changes(repo).sort(), ['!! .env', '!! scratch/', '?? new.md']);
});

test('rescueDetached saves commits that are on no branch, and only those', () => {
  const base = tmp();
  sh(base, 'init', '-q', '-b', 'main', 'repo');
  const repo = join(base, 'repo');
  commit(repo);
  const copy = join(base, 'copy');
  sh(repo, 'worktree', 'add', '-q', '--detach', copy, 'main');
  const git = createGit(repo);
  assert.equal(git.rescueDetached(copy, 'crew/saved'), null, 'HEAD is still main: nothing to save');
  commit(copy);
  const head = sh(copy, 'rev-parse', 'HEAD').trim();
  assert.equal(git.rescueDetached(copy, 'crew/saved'), 'crew/saved');
  assert.equal(sh(repo, 'rev-parse', 'crew/saved').trim(), head);
  assert.equal(git.rescueDetached(copy, 'crew/other'), null, 'now reachable from crew/saved');
});
