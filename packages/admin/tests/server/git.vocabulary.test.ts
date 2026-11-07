import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as git from '../../server/git.ts'
import { programFor, scanVocabulary, type ScanRules } from './git.vocabulary.scan.ts'
import { withGitTrace } from '../git-shim.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const GIT_TS = join(here, '../../server/git.ts')
const FIXTURES = join(here, 'git.vocabulary.fixtures')
const list = (dir: string) => readdirSync(join(FIXTURES, dir)).filter(f => f.endsWith('.ts')).sort().map(f => join(FIXTURES, dir, f))

// What the module may do, written out here so that adding a command or a flag is an edit of two files.
const EXPECTED_ALLOWED = {
  '--version': [],
  'check-ignore': ['-q'],
  'check-ref-format': ['--branch'],
  clone: [],
  commit: ['-F', '--allow-empty'],
  diff: ['--name-only', '--cached', '--no-renames'],
  'diff-tree': ['-r', '--name-only'],
  fetch: [],
  log: ['-1', '--format=%B', '--format=%ae'],
  'ls-files': ['-v', '--error-unmatch'],
  'merge-base': ['--is-ancestor'],
  merge: ['--no-ff', '--no-commit', '--ff-only', '--abort', '--no-autostash'],
  'merge-tree': ['--write-tree', '--name-only'],
  push: [],
  'rev-list': ['--first-parent', '--reverse', '--count'],
  'rev-parse': ['--git-path', '--verify', '-q'],
  show: [],
  'update-ref': [],
  worktree: ['--detach'],
}
const EXPECTED_CLIENT_METHODS = ['add', 'commit', 'status', 'revparse', 'getConfig', 'raw', 'env']
// L5 §6.4: a commit made as the house's ident runs under this process's own environment plus the four ident variables;
// simple-git checks an environment it is handed, and these are the categories that environment may hold.
const EXPECTED_UNSAFE = [
  'allowUnsafeAskPass', 'allowUnsafeConfigEnvCount', 'allowUnsafeConfigPaths', 'allowUnsafeDiffExternal', 'allowUnsafeEditor',
  'allowUnsafeGitProxy', 'allowUnsafePager', 'allowUnsafeSshCommand', 'allowUnsafeTemplateDir',
]
const EXPECTED_ENV = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']
const EXPECTED_EXPORTS = [
  'FETCH_FRESH_MS', 'GitExit', '__internal', 'addWorktree', 'assertTracked', 'authorEmail', 'cloneInstance', 'commitDataPaths', 'commitMerge', 'configuredEmail', 'countBetween', 'diffNames',
  'diffText', 'fetchRemote', 'gitPath', 'gitVersion', 'hiddenDataPaths', 'hiddenMergePaths', 'isAncestor', 'isIgnored', 'lastFetch', 'mergeAbort', 'mergeBase',
  'mergeFfOnly', 'mergeInProgress', 'mergeNoFf', 'mergeTree', 'messageOf',
  'moveProposalBranch', 'onCommit', 'parseGitVersion', 'pushTrunk', 'recordRemoteTrunkAbsent', 'remoteUrl', 'removeWorktree', 'repoStatus', 'resolveRev', 'restageDataPaths', 'showFile',
  'stageMergeFiles', 'stagedNames', 'trackedChanges', 'treeDiffNames', 'trunkLine', 'uncommittedDataPaths', 'unmergedPaths', 'validBranchName',
]
const RULES: ScanRules = {
  allowed: EXPECTED_ALLOWED,
  clientMethods: EXPECTED_CLIENT_METHODS,
  // ./state.ts runs no git: it names the admin state directory, the only place removeWorktree removes from (final review M5).
  // ../lib/rules.mjs runs no git: its validTrunkName is the trunk name a push may carry (L9 §5.6).
  imports: ['node:path', 'node:fs', 'simple-git', '../lib/trailers.mjs', '../lib/rules.mjs', './state.ts'],
  unsafe: EXPECTED_UNSAFE,
  env: EXPECTED_ENV,
}

describe('the lists are fixed here, so a change to them is a visible edit', () => {
  it('ALLOWED, CLIENT_METHODS and the exported names are the ones written in this file', () => {
    expect(git.__internal.ALLOWED).toEqual(EXPECTED_ALLOWED)
    expect([...git.__internal.CLIENT_METHODS]).toEqual(EXPECTED_CLIENT_METHODS)
    expect(Object.keys(git).sort()).toEqual([...EXPECTED_EXPORTS].sort())
  })
  it('__internal is the one extra export, and holds only what the tests reach for', () => {
    expect(Object.keys(git.__internal).sort()).toEqual(['ALLOWED', 'CLIENT_METHODS', 'checkArgv', 'run'])
  })
})

/** A program in which `file` holds `text`, to scan a changed copy of the real module without writing it. */
function programWith(base: ts.Program, file: string, text: string): ts.Program {
  const options = base.getCompilerOptions()
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (name, lang, ...rest) => (name === file ? ts.createSourceFile(name, text, lang) : read(name, lang, ...rest))
  const fileExists = host.fileExists.bind(host)
  host.fileExists = name => name === file || fileExists(name)
  return ts.createProgram([file], options, host)
}

describe('the scan of server/git.ts', () => {
  const failing = list('fail')
  const passing = list('pass')
  const program = programFor([GIT_TS, ...failing, ...passing])

  it('passes the real module (whose comments say stash, clean and reset are absent, and which has a function called cleaned)', () => {
    expect(scanVocabulary(program, GIT_TS, RULES)).toEqual([])
  })
  it.each(passing.map(f => [f.slice(FIXTURES.length + 1), f] as const))('passes the allowed fixture %s', (_name, file) => {
    expect(scanVocabulary(program, file, RULES)).toEqual([])
  })
  it('has the planted cases it names: the 23 of the second round and the 11 argument-level ones, and more', () => {
    expect(failing.length).toBeGreaterThanOrEqual(34)
  })
  it.each(failing.map(f => [f.slice(FIXTURES.length + 1), f] as const))('fails the planted fixture %s', (_name, file) => {
    expect(scanVocabulary(program, file, RULES).length).toBeGreaterThan(0)
  })

  it('says why, for the kinds a reader will ask about', () => {
    const why = (name: string) => scanVocabulary(program, join(FIXTURES, 'fail', name), RULES).join(' | ')
    expect(why('03-method-clean.ts')).toMatch(/".clean" is not on the list/)
    expect(why('10-aliased-client.ts')).toMatch(/".clean" is not on the list/)
    expect(why('11-destructured-client.ts')).toMatch(/destructuring/)
    expect(why('06-concatenated-subcommand.ts')).toMatch(/not a plain string literal/)
    expect(why('15-import-child-process.ts')).toMatch(/node:child_process/)
    expect(why('17-dynamic-import.ts')).toMatch(/dynamic import/)
    expect(why('18-binary-option.ts')).toMatch(/binary/)
    expect(why('25-update-ref-delete.ts')).toMatch(/"-d" is not a flag update-ref/)
    expect(why('27-diff-output.ts')).toMatch(/"--output=data\/x" is not a flag diff/)
    expect(why('29-commit-options-object.ts')).toMatch(/\.commit takes exactly/)
    expect(why('31-add-force.ts')).toMatch(/"-f" is an option/)
    expect(why('37-commit-identifier-object.ts')).toMatch(/string\[\]/)
    expect(why('32-worktree-prune.ts')).toMatch(/worktree prune/)
    expect(why('34-global-option-first.ts')).toMatch(/not a plain string literal|not a subcommand on the list/)
    expect(why('22-ts-ignore.ts')).toMatch(/@ts-ignore/)
    expect(why('24-env.ts')).toMatch(/\.env takes one object literal/)
    expect(why('45-env-other-variable.ts')).toMatch(/\.env may not set "GIT_SSH_COMMAND"/)
    expect(why('46-unsafe-pack.ts')).toMatch(/unsafe "allowUnsafePack" is not a category/)
    expect(why('47-env-without-process-env.ts')).toMatch(/must spread process\.env exactly once/)
    expect(why('48-unsafe-not-true.ts')).toMatch(/unsafe "allowUnsafeEditor" must be true/)
  })

  it('catches a planted line in a copy of the real module (the scan is able to fail on it)', () => {
    const real = program.getSourceFile(GIT_TS)!.text
    const planted = join(FIXTURES, 'fail', '.planted-copy.ts')
    const changed = real.replace("run('ls-files', ['-v'", "run('clean', ['-fd'")
    expect(changed).not.toBe(real)
    expect(scanVocabulary(programWith(program, planted, changed), planted, RULES).join('|')).toMatch(/"clean" is not a subcommand on the list/)
  })

  it('allows simpleGit\'s timeout as { block } only (the push\'s limit, L9 §5.6): another key in it is caught', () => {
    const real = program.getSourceFile(GIT_TS)!.text
    const planted = join(FIXTURES, 'fail', '.planted-copy.ts')
    // stdErr: false would let a process that writes only to stderr run on without a limit.
    const changed = real.replace('timeout: { block: blockMs ?? 0 } })', 'timeout: { block: blockMs ?? 0, stdErr: false } })')
    expect(changed).not.toBe(real)
    expect(scanVocabulary(programWith(program, planted, changed), planted, RULES).join('|')).toMatch(/simpleGit option "timeout" takes \{ block \} only/)
  })
})

describe('run() refuses, before any process starts, what the scan cannot see', () => {
  // The directory run() is pointed at is a repository of its own, fresh under the temp directory and
  // empty. A guard that failed to refuse could then only act on this repository, and never on one
  // that encloses the temp directory (git searches upward; GIT_CEILING_DIRECTORIES would stop that
  // too, but a repository of its own is what is certain).
  let scratch: string
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'git-guard-'))
    execFileSync('git', ['init', '-q', scratch], { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
  })
  afterEach(() => { rmSync(scratch, { recursive: true, force: true }) })

  const H40 = 'a'.repeat(40)
  const Z40 = '0'.repeat(40)
  const REF = 'refs/heads/proposal/p-2026-10-18-001-a3f9' // the id shape the server mints (final review I5)
  // The argv the guard must refuse. The third round's proof FS counted 33; its list was not kept, so
  // these were derived from the vocabulary table and the eleven argument-level plants.
  const REFUSED: [string, string[]][] = [
    ['hard reset', ['reset', '--hard']],
    ['clean', ['clean', '-fd']],
    ['stash', ['stash']],
    ['push to a plus refspec', ['push', 'origin', '+main']],
    ['push --force', ['push', '--force']],
    ['checkout -- .', ['checkout', '--', '.']],
    ['rebase', ['rebase', 'main']],
    ['branch -d', ['branch', '-d', 'x']],
    ['cherry-pick', ['cherry-pick', H40]],
    ['update-ref -d', ['update-ref', '-d', 'refs/heads/main']],
    ['update-ref --stdin', ['update-ref', '--stdin']],
    ['update-ref of another ref', ['update-ref', 'refs/heads/main', H40, H40]],
    ['update-ref deleting a proposal ref (new value all zeros)', ['update-ref', REF, Z40, H40]],
    ['update-ref with no old value', ['update-ref', REF, H40]],
    ['update-ref with a short sha', ['update-ref', REF, 'abc123', H40]],
    ['update-ref with a flag among the values', ['update-ref', REF, H40, H40, '--no-deref']],
    ['update-ref of a proposal ref with a bad id', ['update-ref', 'refs/heads/proposal/main', H40, H40]],
    ['update-ref of a proposal ref of the old id shape (no suffix)', ['update-ref', 'refs/heads/proposal/p-2026-10-18-001', H40, H40]],
    ['update-ref of a proposal ref whose suffix is upper-case', ['update-ref', 'refs/heads/proposal/p-2026-10-18-001-A3F9', H40, H40]],
    ['update-ref of a proposal ref whose suffix is five hex', ['update-ref', 'refs/heads/proposal/p-2026-10-18-001-a3f90', H40, H40]],
    ['diff --output', ['diff', '--output=data/x']],
    ['show --output', ['show', '--output=x', 'HEAD']],
    ['show -p', ['show', '-p', 'HEAD']],
    ['worktree prune', ['worktree', 'prune']],
    ['worktree remove --force', ['worktree', 'remove', '--force', '/x']],
    ['worktree move', ['worktree', 'move', '/x', '/y']],
    ['worktree lock', ['worktree', 'lock', '/x']],
    ['worktree unlock', ['worktree', 'unlock', '/x']],
    ['update-ref with 39 hex', ['update-ref', REF, 'a'.repeat(39), H40]],
    ['update-ref with 41 hex', ['update-ref', REF, 'a'.repeat(41), H40]],
    ['update-ref with an old value of 39 hex', ['update-ref', REF, H40, 'a'.repeat(39)]],
    ['update-ref with upper-case hex', ['update-ref', REF, 'A'.repeat(40), H40]],
    ['worktree add -b', ['worktree', 'add', '-b', 'x', '/x', 'HEAD']],
    ['worktree add --lock', ['worktree', 'add', '--detach', '--lock', '/x', 'HEAD']],
    ['merge --strategy-option', ['merge', '--strategy-option', 'theirs', 'x']],
    ['merge with no operand', ['merge']],
    ['merge --no-ff without --no-commit', ['merge', '--no-ff', '--no-autostash', 'x']],
    ['merge --no-ff --no-commit without --no-autostash', ['merge', '--no-ff', '--no-commit', 'x']],
    ['merge --ff-only without --no-autostash', ['merge', '--ff-only', 'x']],
    ['merge --abort --no-autostash', ['merge', '--abort', '--no-autostash']],
    ['merge --abort with a revision', ['merge', '--abort', 'x']],
    ['merge --ff-only of a flag-like revision', ['merge', '--ff-only', '--no-autostash', '-x']],
    ['merge --no-commit --no-ff of a plus revision', ['merge', '--no-ff', '--no-commit', '--no-autostash', '+x']],
    ['merge-tree without --write-tree', ['merge-tree', 'a', 'b']],
    ['merge-tree --write-tree with three revisions', ['merge-tree', '--write-tree', 'a', 'b', 'c']],
    ['merge-tree --messages', ['merge-tree', '--write-tree', '--messages', 'a', 'b']],
    ['fetch --force', ['fetch', '--force', 'origin']],
    ['fetch of a URL', ['fetch', 'https://example.org/x.git']],
    ['fetch of a remote starting with a dash', ['fetch', '-origin']],
    ['fetch with a refspec', ['fetch', 'origin', 'main']],
    ['fetch with no remote', ['fetch']],
    ['commit -F with a flag-like file', ['commit', '-F', '-x']],
    ['commit -F - (stdin)', ['commit', '-F', '-']],
    ['commit --amend', ['commit', '--amend', '-F', 'm']],
    ['commit -F with a pathspec', ['commit', '-F', 'm', '--', 'a.txt']],
    ['commit with no -F', ['commit', 'x']],
    ['commit --allow-empty with no -F', ['commit', '--allow-empty']],
    ['commit -F then --allow-empty', ['commit', '-F', 'm', '--allow-empty']],
    ['commit --allow-empty -F with a flag-like file', ['commit', '--allow-empty', '-F', '-x']],
    ['commit --allow-empty twice', ['commit', '--allow-empty', '--allow-empty', '-F', 'm']],
    ['commit --allow-empty -F with a pathspec', ['commit', '--allow-empty', '-F', 'm', '--', 'a.txt']],
    ['-c first', ['-c', 'core.hooksPath=/x', 'status']],
    ['-C first', ['-C', '/tmp', 'status']],
    ['fetch with a forcing refspec', ['fetch', '+refs/heads/*:refs/heads/*']],
    ['log --force', ['log', '--force']],
    ['a plus ref for rev-list', ['rev-list', '--count', '+main..HEAD']],
    ['status (a client method, not a subcommand to raw)', ['status', '+main']],
    ['ls-files --others', ['ls-files', '--others']],
    ['rev-list --max-count', ['rev-list', '--max-count=1', 'HEAD']],
    ['diff-tree --stdin', ['diff-tree', '--stdin']],
    ['merge-base --octopus', ['merge-base', '--octopus', 'a', 'b']],
    ['check-ref-format --allow-onelevel', ['check-ref-format', '--allow-onelevel', 'x']],
    ['check-ignore --no-index (would ignore what is tracked)', ['check-ignore', '-q', '--no-index', '--', 'x']],
    ['check-ignore --stdin', ['check-ignore', '--stdin']],
    ['check-ignore -v', ['check-ignore', '-v', '--', 'x']],
    ['check-ignore without -q', ['check-ignore', '--', 'x']],
    ['check-ignore of two paths', ['check-ignore', '-q', '--', 'x', 'y']],
    ['check-ignore without --', ['check-ignore', '-q', 'x']],
    ['commit -n', ['commit', '-n']],
    ['rev-parse --git-dir', ['rev-parse', '--git-dir']],
    ['rev-parse of a revision starting with a dash', ['rev-parse', '--verify', '-x']],
    ['a revision starting with a dash', ['diff', '--name-only', '-x', 'HEAD']],
    ['an empty argv', []],
    ['an empty subcommand', ['', 'x']],
    ['--version with an argument', ['--version', 'x']],
    ['--exec-path', ['--exec-path']],
    // L9 §5.6: push is exactly `<remote> refs/heads/<b>:refs/heads/<b>`, the same valid trunk on both sides, no flag, no +.
    ['push --force with the shape', ['push', '--force', 'origin', 'refs/heads/main:refs/heads/main']],
    ['push --force after the shape', ['push', 'origin', 'refs/heads/main:refs/heads/main', '--force']],
    ['push -f', ['push', '-f', 'origin', 'refs/heads/main:refs/heads/main']],
    ['push --mirror', ['push', '--mirror', 'origin']],
    ['push --delete', ['push', 'origin', '--delete', 'refs/heads/main']],
    ['push a forcing refspec', ['push', 'origin', '+refs/heads/main:refs/heads/main']],
    ['push a plus refspec, short', ['push', 'origin', '+main']],
    ['push a: b with a and b different', ['push', 'origin', 'refs/heads/main:refs/heads/other']],
    ['push a short refspec', ['push', 'origin', 'main:main']],
    ['push a source with no destination', ['push', 'origin', 'refs/heads/main']],
    ['push an empty source (deletes the remote branch)', ['push', 'origin', ':refs/heads/main']],
    ['push a tag', ['push', 'origin', 'refs/tags/v1:refs/tags/v1']],
    ['push a proposal branch', ['push', 'origin', 'refs/heads/proposal/p-2026-10-18-001-a3f9:refs/heads/proposal/p-2026-10-18-001-a3f9']],
    ['push a bad ref name (two dots)', ['push', 'origin', 'refs/heads/a..b:refs/heads/a..b']],
    ['push a bad ref name (begins with a dash)', ['push', 'origin', 'refs/heads/-x:refs/heads/-x']],
    ['push a bad ref name (a wildcard)', ['push', 'origin', 'refs/heads/*:refs/heads/*']],
    ['push a bad ref name (reserved)', ['push', 'origin', 'refs/heads/HEAD:refs/heads/HEAD']],
    ['push to an https URL', ['push', 'https://example.org/x.git', 'refs/heads/main:refs/heads/main']],
    // L9 Task 17 (ruling P8): clone is exactly `-- <url> <absolute dir>`, no flag, no other transport.
    ['clone with no --', ['clone', '/srv/remote.git', '/srv/instance']],
    ['clone --mirror', ['clone', '--mirror', '--', '/srv/remote.git', '/srv/instance']],
    ['clone with an option after --', ['clone', '--', '--upload-pack=touch /tmp/x', '/srv/instance']],
    ['clone an ext:: transport', ['clone', '--', 'ext::sh -c touch% /tmp/x', '/srv/instance']],
    ['clone a file:// url', ['clone', '--', 'file:///srv/remote.git', '/srv/instance']],
    ['clone an http url', ['clone', '--', 'http://example.org/x.git', '/srv/instance']],
    ['clone into a relative folder', ['clone', '--', '/srv/remote.git', 'instance']],
    ['clone with a third operand', ['clone', '--', '/srv/remote.git', '/srv/instance', 'more']],
    ['push to an scp-like address', ['push', 'git@example.org:x/y.git', 'refs/heads/main:refs/heads/main']],
    ['push to a path', ['push', '/tmp/remote.git', 'refs/heads/main:refs/heads/main']],
    ['push to a remote starting with a dash', ['push', '-origin', 'refs/heads/main:refs/heads/main']],
    ['push with an extra refspec', ['push', 'origin', 'refs/heads/main:refs/heads/main', 'refs/heads/main:refs/heads/main']],
    ['push with -- and a refspec', ['push', 'origin', '--', 'refs/heads/main:refs/heads/main']],
    ['push with -- before a forcing refspec', ['push', '--', '+refs/heads/main:refs/heads/main']],
    ['push with no refspec', ['push', 'origin']],
    ['push with nothing', ['push']],
  ]
  // What the module itself builds, form by form.
  const ACCEPTED: [string, string[]][] = [
    ['--version', ['--version']],
    ['ls-files -v', ['ls-files', '-v', '--', 'data/members.yaml']],
    ['ls-files --error-unmatch', ['ls-files', '--error-unmatch', '--', 'data/a.yaml', 'DECISIONS.md']],
    ['log -1', ['log', '-1', '--format=%B', H40]],
    ['log -1 author', ['log', '-1', '--format=%ae', H40]],
    ['rev-parse --verify', ['rev-parse', '--verify', 'HEAD']],
    ['rev-parse --verify -q', ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main']],
    ['rev-parse of a parent', ['rev-parse', '--verify', '-q', `${H40}^`]],
    ['rev-parse --git-path', ['rev-parse', '--git-path', 'MERGE_HEAD']],
    ['diff --name-only', ['diff', '--name-only', H40, H40]],
    ['diff --cached --name-only', ['diff', '--cached', '--name-only']],
    ['diff --cached --name-only --no-renames', ['diff', '--cached', '--name-only', '--no-renames']],
    ['diff a...b', ['diff', `${H40}...${H40}`]],
    ['diff-tree', ['diff-tree', '-r', '--name-only', H40, H40]],
    ['merge-base --is-ancestor', ['merge-base', '--is-ancestor', H40, 'main']],
    ['merge-base', ['merge-base', H40, H40]],
    ['merge --no-ff --no-commit', ['merge', '--no-ff', '--no-commit', '--no-autostash', 'refs/heads/proposal/p-2026-10-18-001-a3f9']],
    ['merge --ff-only', ['merge', '--ff-only', '--no-autostash', H40]],
    ['merge --abort', ['merge', '--abort']],
    ['merge-tree --write-tree', ['merge-tree', '--write-tree', H40, H40]],
    ['merge-tree --write-tree --name-only', ['merge-tree', '--write-tree', '--name-only', 'main', 'origin/main']],
    ['fetch', ['fetch', 'origin']],
    ['push the trunk', ['push', 'origin', 'refs/heads/main:refs/heads/main']],
    ['push a trunk with a slash', ['push', 'origin', 'refs/heads/release/1.0:refs/heads/release/1.0']],
    ['commit -F', ['commit', '-F', '/x/.git/COMMIT_EDITMSG']],
    ['commit --allow-empty -F', ['commit', '--allow-empty', '-F', '/x/.git/COMMIT_EDITMSG']],
    ['rev-list --first-parent', ['rev-list', '--first-parent', '--reverse', `${H40}..${H40}`]],
    ['rev-list --count', ['rev-list', '--count', 'main..refs/remotes/origin/main']],
    ['worktree add', ['worktree', 'add', '--detach', '/tmp/wt', H40]],
    ['worktree remove', ['worktree', 'remove', '/tmp/wt']],
    ['update-ref create', ['update-ref', REF, H40, Z40]],
    ['update-ref move', ['update-ref', REF, H40, 'b'.repeat(40)]],
    ['show', ['show', `${H40}:data/proposals.yaml`]],
    ['check-ref-format --branch', ['check-ref-format', '--branch', 'release/1.0']],
    ['check-ignore -q', ['check-ignore', '-q', '--', '.org-os/private/']],
  ]

  it('refuses every planted argv with a sentence', () => {
    expect(REFUSED.length).toBeGreaterThanOrEqual(33)
    for (const [name, argv] of REFUSED) {
      expect(() => git.__internal.checkArgv(argv), name).toThrow(/git guardrail/)
    }
  })
  // simple-git does not go through any property of child_process that a spy could watch (a spy on
  // `spawn` saw zero calls on a real run, so it held whatever run() did). What does see a start is a
  // `git` first on PATH that writes a marker: the control below proves the marker is reachable.
  it('control: a git first on PATH is reached by an accepted run, so the marker can see a start', async () => {
    await withGitTrace(async started => {
      expect(started()).toEqual([])
      await git.__internal.run('--version', [], scratch)
      expect(started()).toEqual(['--version'])
    })
  })
  it('run() throws for each planted argv before git starts: no process, so no marker', async () => {
    await withGitTrace(async started => {
      for (const [name, argv] of REFUSED) {
        await expect(git.__internal.run(argv[0] ?? '', argv.slice(1), scratch), name).rejects.toThrow(/git guardrail/)
        expect(started(), `git was started for: ${name}`).toEqual([])
      }
    })
  })
  it('accepts every argv the module builds', () => {
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(30)
    for (const [name, argv] of ACCEPTED) {
      expect(() => git.__internal.checkArgv(argv), name).not.toThrow()
    }
  })
  it('every flag on ALLOWED appears in an accepted row, so no flag is listed that nothing builds', () => {
    for (const [sub, flags] of Object.entries(git.__internal.ALLOWED)) {
      for (const flag of flags) {
        const row = ACCEPTED.find(([, argv]) => argv[0] === sub && argv.includes(flag))
        expect(row, `${sub} ${flag} is listed but no accepted row carries it`).toBeDefined()
      }
    }
  })
  it('refuses the words, however they arrive', () => {
    for (const word of ['reset', 'clean', 'stash', 'push', 'checkout', 'rebase', 'branch', 'cherry-pick', 'restore', 'switch', 'gc', 'prune', 'config', 'remote', 'tag']) {
      expect(() => git.__internal.checkArgv([word, 'x']), word).toThrow()
    }
    for (const flag of ['--force', '-f', '-D', '--hard', '--mirror', '--delete', '--no-verify', '-n', '--output=x', '-c', '--exec-path']) {
      for (const sub of Object.keys(EXPECTED_ALLOWED).filter(s => s !== '--version')) {
        expect(() => git.__internal.checkArgv([sub, flag, 'x']), `${sub} ${flag}`).toThrow()
      }
    }
  })
  it('a flag after a bare -- is a path, not a flag', () => {
    expect(() => git.__internal.checkArgv(['ls-files', '-v', '--', '-odd-file-name'])).not.toThrow()
  })
})
