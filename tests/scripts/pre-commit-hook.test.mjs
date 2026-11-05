// tests/scripts/pre-commit-hook.test.mjs
//
// The versioned pre-commit hook (.github/hooks/pre-commit.sh) in a linked worktree. The admin builds a proposal's
// branch by committing in a detached worktree under its state directory (0.6 P2 spec §3.5), and such a worktree has
// no node_modules: the hook's checks import js-yaml, so every build failed there. In a linked worktree with no
// node_modules the hook skips its node checks and says so on stderr; in the main checkout, and in a linked worktree
// that has node_modules, it runs them as before. Every repository is a throwaway one under the OS temp dir; every git
// call names it with `-C`, and the environment carries no GIT_DIR of the caller's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { ORG_ROOT } from '../helpers/repo-paths.mjs'

const HOOK = path.join(ORG_ROOT, '.github', 'hooks', 'pre-commit.sh')
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
for (const key of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete ENV[key]
const WHO = { GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@example.org', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@example.org' }

const git = (root, args) => spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf-8', env: { ...ENV, ...WHO } })
function ok(root, args) {
  const r = git(root, args)
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

/**
 * A repository whose `validate:structure` needs a module that only the main checkout's node_modules holds (as the
 * real one needs js-yaml), with the real hook installed, and one commit. Answers the root.
 */
function repoWithHook() {
  const root = mkdtempSync(path.join(tmpdir(), 'pre-commit-hook-'))
  ok(root, ['init', '-q', '-b', 'main'])
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'hook-fixture', private: true,
    scripts: { 'validate:structure': 'node -e "require(\'only-in-main\'); console.log(\'structure checked\')"' },
  }, null, 2))
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')
  mkdirSync(path.join(root, 'data'))
  writeFileSync(path.join(root, 'data', 'notes.yaml'), 'notes: []\n')
  ok(root, ['add', '-A'])
  ok(root, ['commit', '-q', '--no-verify', '-m', 'fixture: a package with a check'])
  mkdirSync(path.join(root, 'node_modules', 'only-in-main'), { recursive: true })
  writeFileSync(path.join(root, 'node_modules', 'only-in-main', 'index.js'), 'module.exports = {}\n')
  const hooks = path.resolve(root, ok(root, ['rev-parse', '--git-path', 'hooks']))
  mkdirSync(hooks, { recursive: true })
  copyFileSync(HOOK, path.join(hooks, 'pre-commit'))
  chmodSync(path.join(hooks, 'pre-commit'), 0o755)
  return root
}

/** A commit of one changed file in `dir` (a checkout of the repository), the hook running. */
function commitIn(dir, text) {
  writeFileSync(path.join(dir, 'data', 'notes.yaml'), text)
  ok(dir, ['add', 'data/notes.yaml'])
  return git(dir, ['commit', '-q', '-m', 'a change'])
}

test('in a linked worktree with no node_modules, the hook skips its node checks, says so on stderr, and the commit is made', (t) => {
  const root = repoWithHook()
  const wt = mkdtempSync(path.join(tmpdir(), 'pre-commit-hook-wt-'))
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }) })
  const at = path.join(wt, 'build')
  ok(root, ['worktree', 'add', '-q', '--detach', at, 'HEAD'])
  const before = ok(at, ['rev-parse', 'HEAD'])
  const r = commitIn(at, 'notes: [one]\n')
  assert.equal(r.status, 0, `the commit was refused: ${r.stdout}${r.stderr}`)
  assert.notEqual(ok(at, ['rev-parse', 'HEAD']), before)
  assert.match(r.stderr, /linked worktree with no node_modules/)
  assert.match(r.stderr, /node checks skipped/)
  assert.doesNotMatch(r.stdout + r.stderr, /structure checked/)
})

test('in the main checkout the hook runs the checks as before', (t) => {
  const root = repoWithHook()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const r = commitIn(root, 'notes: [two]\n')
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.match(r.stdout + r.stderr, /structure checked/)
  assert.doesNotMatch(r.stderr, /linked worktree/)
})

test('the main checkout without node_modules is still refused: the skip is for a linked worktree only', (t) => {
  const root = repoWithHook()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  rmSync(path.join(root, 'node_modules'), { recursive: true, force: true })
  const r = commitIn(root, 'notes: [three]\n')
  assert.notEqual(r.status, 0, 'the commit went through with its check unable to run')
  assert.doesNotMatch(r.stderr, /linked worktree/)
})

test('a linked worktree that has node_modules runs the checks', (t) => {
  const root = repoWithHook()
  const wt = mkdtempSync(path.join(tmpdir(), 'pre-commit-hook-wt-'))
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(wt, { recursive: true, force: true }) })
  const at = path.join(wt, 'build')
  ok(root, ['worktree', 'add', '-q', '--detach', at, 'HEAD'])
  mkdirSync(path.join(at, 'node_modules', 'only-in-main'), { recursive: true })
  writeFileSync(path.join(at, 'node_modules', 'only-in-main', 'index.js'), 'module.exports = {}\n')
  const r = commitIn(at, 'notes: [four]\n')
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.match(r.stdout + r.stderr, /structure checked/)
})
