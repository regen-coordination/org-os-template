import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'
import { withTrailers, parseTrailers, type TrailerValues } from '../lib/trailers.mjs'
import { validTrunkName } from '../lib/rules.mjs'
import { stateDir } from './state.ts'

export interface RepoStatus { branch: string; dirty: boolean }

/** The whole vocabulary of this service is the list below (`ALLOWED`, `CLIENT_METHODS`) and nothing else:
 *  status (of the repo or of paths), add(paths), commit(paths), config reads, and the reads, the one
 *  ref move and the one push (the trunk, fast-forward only) that `run` lets through. stash/clean/reset/force are deliberately absent — vault safety is
 *  enforced here, not by convention. Do not add pass-through git access. The list is held by
 *  tests/server/git.vocabulary.test.ts, which scans this file: adding a command is an edit of both. */
export async function repoStatus(repo: string): Promise<RepoStatus> {
  const status = await simpleGit(repo).status()
  return { branch: status.current ?? 'HEAD', dirty: status.files.length > 0 }
}

// ── the vocabulary ─────────────────────────────────────────────────────────────────────────────
// A command is forbidden unless it is on a list. Every git command this module runs goes through
// `run`, whose first act is `checkArgv`; the few client methods that do not (`status`, `add`,
// `commit`, `revparse`, `getConfig`) are the ones in CLIENT_METHODS, and the vocabulary test reads
// this file to see that nothing else is called.

/** Subcommand → the exact flags it may carry. A flag nobody listed is refused whatever it does;
 *  `--` ends the flags, and what follows is a path. `worktree`, `update-ref` and `push` have a shape of
 *  their own (below), and so has `clone` (`hub init`, ruling P8). The vocabulary test holds a copy of this map in its own
 *  text. */
const ALLOWED: Record<string, readonly string[]> = {
  '--version': [],
  'check-ignore': ['-q'],
  'check-ref-format': ['--branch'],
  clone: [],
  fetch: [],
  commit: ['-F', '--allow-empty'],
  diff: ['--name-only', '--cached', '--no-renames'],
  'diff-tree': ['-r', '--name-only'],
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

/** The methods of the simple-git client this module may call. `env` only as `client` calls it: this process's
 *  environment and a commit's ident (L5 spec §6.4). */
const CLIENT_METHODS = ['add', 'commit', 'status', 'revparse', 'getConfig', 'raw', 'env'] as const

/** Who a commit is authored and committed by, when it is not git's own configured identity (L5 spec §6.4). */
export interface GitIdent { name: string; email: string }
/** How a commit is made. `ident`: authored and committed by it (HOUSE_IDENT for a signed-in actor, `commitIdent`);
 *  absent, by git's configured identity, as 0.6. `allowEmpty`: `commitDataPaths` with no paths makes an empty commit (the
 *  record of a change to private data, L5 spec §10.3) instead of refusing. One options object for every commit helper
 *  (controller ruling P11). */
export interface CommitOptions { ident?: GitIdent; allowEmpty?: boolean }

type OnExit = NonNullable<Partial<SimpleGitOptions>['errors']>

/** The client every git process of this module starts from: `errors` decides what counts as a failure. With `ident`,
 *  that one client runs with this process's own environment (which every other call inherits as it is) plus the four
 *  ident variables. simple-git checks an environment only when it is handed one, and refuses one that holds an editor,
 *  a pager, a config path and the like (GIT_EDITOR, GIT_CONFIG_GLOBAL), which this process's environment may hold: those
 *  categories are allowed here, because every value in them is the environment every other call already runs under.
 *  The argv is still the vocabulary's. */
function client(repo: string, errors: OnExit, ident?: GitIdent, blockMs?: number): SimpleGit {
  // A block time ends a process that has said nothing for that long (simple-git kills it): the push's, so a remote that
  // takes the connection and never answers cannot hold the Pusher, or the server's close, for ever.
  // A block of 0 adds no limit (simple-git's own rule), so every other command runs as before.
  if (!ident) return simpleGit(repo, { errors, timeout: { block: blockMs ?? 0 } })
  return simpleGit(repo, {
    errors,
    timeout: { block: blockMs ?? 0 },
    unsafe: {
      allowUnsafeAskPass: true, allowUnsafeConfigEnvCount: true, allowUnsafeConfigPaths: true, allowUnsafeDiffExternal: true,
      allowUnsafeEditor: true, allowUnsafeGitProxy: true, allowUnsafePager: true, allowUnsafeSshCommand: true, allowUnsafeTemplateDir: true,
    },
  }).env({ ...process.env, GIT_AUTHOR_NAME: ident.name, GIT_AUTHOR_EMAIL: ident.email, GIT_COMMITTER_NAME: ident.name, GIT_COMMITTER_EMAIL: ident.email })
}

const HEX40 = /^[0-9a-f]{40}$/
const ZEROS = '0'.repeat(40)
const REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/
/** What `hub init` may clone from: `ssh://…`, `https://…`, `git@host:path` (scp-like ssh), or an absolute path. */
const CLONE_URL = /^(?:ssh:\/\/[^\s]+|https:\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+|\/[^\s]*)$/
/** The proposal id the server mints, `p-<date>-<NNN>-<4 hex>` (final review I5), and its branch's ref: nothing else. */
const PROPOSAL_ID = /^p-\d{4}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/
const PROPOSAL_REF = /^refs\/heads\/proposal\/p-\d{4}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/

/** Throws, in words, before any process starts, when `argv` is not on the list. */
function checkArgv(argv: readonly string[]): void {
  const refuse = (why: string): never => { throw new Error(`git guardrail: refusing to run git ${argv.join(' ')}: ${why}`) }
  const [sub, ...args] = argv
  if (sub === undefined || sub === '') return refuse('there is no subcommand.')
  if (!Object.hasOwn(ALLOWED, sub)) return refuse(`"${sub}" is not on the list of git commands this service runs.`)
  if (sub === '--version') { if (args.length > 0) refuse('--version takes nothing else.'); return }
  const flags = ALLOWED[sub]!
  let afterDashes = false
  for (const arg of args) {
    if (arg === '--') { afterDashes = true; continue }
    if (afterDashes) continue
    if ((arg.startsWith('-') || arg.startsWith('+')) && !flags.includes(arg)) refuse(`"${arg}" is not a flag ${sub} may carry here.`)
  }
  if (sub === 'check-ignore' && (args.length !== 3 || args[0] !== '-q' || args[1] !== '--')) refuse('check-ignore takes -q -- <path>, nothing else.')
  if (sub === 'worktree') {
    const [verb, ...rest] = args
    if (verb === 'add') { if (rest.length !== 3 || rest[0] !== '--detach') refuse('worktree add takes --detach <path> <rev>.') }
    else if (verb === 'remove') { if (rest.length !== 1 || rest[0]!.startsWith('-')) refuse('worktree remove takes a path and no flag.') }
    else refuse('worktree takes add or remove, nothing else.')
  }
  const operands = (list: readonly string[]) => list.filter(a => a !== '--')
  if (sub === 'merge') {
    const shape = args.join(' ')
    const ok = (args.length === 1 && args[0] === '--abort')
      || (args.length === 3 && args[0] === '--ff-only' && args[1] === '--no-autostash')
      || (args.length === 4 && args[0] === '--no-ff' && args[1] === '--no-commit' && args[2] === '--no-autostash')
    if (!ok) refuse(`merge takes --no-ff --no-commit --no-autostash <rev>, --ff-only --no-autostash <rev> or --abort, nothing else (got "${shape}").`)
    if (args[0] !== '--abort' && (args[args.length - 1]!.startsWith('-') || args[args.length - 1]!.startsWith('+'))) refuse('merge takes a revision, not a flag.')
  }
  if (sub === 'merge-tree') {
    const named = args[1] === '--name-only'
    const rest = args.slice(named ? 2 : 1)
    if (args[0] !== '--write-tree' || rest.length !== 2 || rest.some(a => a.startsWith('-') || a.startsWith('+'))) {
      refuse('merge-tree takes --write-tree [--name-only] <a> <b>, nothing else.')
    }
  }
  if (sub === 'fetch') {
    const [remote] = args
    if (args.length !== 1 || !REMOTE_NAME.test(remote!)) refuse('fetch takes the name of one remote (not a URL, not a refspec).')
  }
  if (sub === 'clone') {
    // L9 Task 17 (ruling P8): exactly `clone -- <url> <dir>`, for `hub init`. No flag; the url an ssh or https remote or
    // an absolute path (a local bare repository), never one that git would read as an option or as another transport.
    const [dashes, url, dir] = args
    if (args.length !== 3 || dashes !== '--' || !CLONE_URL.test(url!) || dir!.startsWith('-') || !isAbsolute(dir!)) {
      refuse('clone takes -- <ssh, https or absolute-path url> <absolute folder>, nothing else.')
    }
  }
  if (sub === 'push') {
    // L9 §5.6: exactly `<remote> refs/heads/<b>:refs/heads/<b>`. No flag and no `+` (the loop above refuses both), so
    // never a force push; one remote by name, never a URL; the same valid trunk name on both sides, so nothing else is
    // pushed, renamed or deleted (an empty source would delete the remote's branch).
    const [remote, spec] = args
    if (args.length !== 2 || !REMOTE_NAME.test(remote!)) refuse('push takes the name of one remote (not a URL) and one refspec, nothing else.')
    const m = /^refs\/heads\/([^:]+):refs\/heads\/([^:]+)$/.exec(spec!)
    if (!m || m[1] !== m[2]) refuse('push takes refs/heads/<trunk>:refs/heads/<trunk>, the same branch on both sides.')
    const named = validTrunkName(m![1])
    if (named !== true) refuse(`push takes a trunk name the platform accepts: ${named}`)
  }
  if (sub === 'commit') {
    const file = args[0] === '--allow-empty' ? args.slice(1) : args
    if (file.length !== 2 || file[0] !== '-F' || file[1]!.startsWith('-') || operands(file).length !== 2) refuse('commit takes [--allow-empty] -F <message file>, nothing else.')
  }
  if (sub === 'update-ref') {
    const [ref, next, old] = args
    if (args.length !== 3 || !PROPOSAL_REF.test(ref!) || !HEX40.test(next!) || !HEX40.test(old!)) {
      refuse('update-ref takes refs/heads/proposal/<id>, a new value and an old value, 40 hex each.')
    }
    if (next === ZEROS) refuse('update-ref never takes an all-zero new value: that would delete the ref.')
  }
}

/** A git command that exited non-zero. `code` is its exit status; the message is git's own words. */
export class GitExit extends Error {
  constructor(public code: number, message: string) { super(message); this.name = 'GitExit' }
}

// ── onCommit: one in-process event after every commit this module makes (L9 §5.6) ──────────────────

/** A commit this module made: the repository (or the build's worktree) it was made in, and its full sha. */
export interface CommitEvent { repo: string; commit: string }
const commitListeners = new Set<(e: CommitEvent) => void>()

/** Hears every commit `commitDataPaths` and `commitMerge` make once it has landed, the build commits among them (a build
 *  commits through `commitDataPaths` in its worktree, so its `repo` is that worktree). The Pusher and the DoorPublisher
 *  listen. Answers the unsubscribe. A listener that throws is not the commit's failure, and the others still hear it. */
export function onCommit(listener: (e: CommitEvent) => void): () => void {
  commitListeners.add(listener)
  return () => { commitListeners.delete(listener) }
}

/** Tells every listener; never throws. No sha (git printed none and HEAD could not be read): nothing is told. */
function committed(repo: string, commit: string): string {
  if (commit === '') return commit
  for (const listener of [...commitListeners]) {
    try { listener({ repo, commit }) } catch { /* a listener's failure is not the commit's */ }
  }
  return commit
}

/** Every git process this server starts runs with git's optional locks off. A read such as `git status` refreshes the
 *  index and, with them on, holds `index.lock` while it does; the server's reads run outside its write lock, so a write
 *  that met one mid-way was refused ("Unable to create …/index.lock: File exists"). It is git's own switch, set in the
 *  environment and not on the command line, so the vocabulary is unchanged. simple-git and node's spawn pass this
 *  process's environment on: it reaches `run`, every client in this module, the resource reads, and the executor's
 *  commands (spawned with `process.env`). Set once, when the module loads. */
process.env.GIT_OPTIONAL_LOCKS = '0'
/** And none of them asks for a password on the server's terminal, where nobody answers: a fetch, or the executor's push,
 *  that needs credentials git does not have fails in git's words instead of waiting (final review I7). Git's own switch,
 *  in the environment as the one above. */
process.env.GIT_TERMINAL_PROMPT = '0'

/** The one place a git command is run: checked first, then run with every non-zero exit a failure
 *  (simple-git reads a silent non-zero exit as success), the exit status kept in `GitExit`. */
async function run(sub: string, args: string[], repo: string, ident?: GitIdent, blockMs?: number): Promise<string> {
  const argv = [sub, ...args]
  checkArgv(argv)
  let code = -1
  const git = client(repo, (error, result) => {
    code = result.exitCode // kept also when simple-git has already made an error of git's words
    if (error) return error
    if (result.exitCode === 0) return undefined
    const said = Buffer.concat([...result.stdOut, ...result.stdErr]).toString('utf8').trim()
    return Buffer.from(said || `git exited with code ${result.exitCode} and gave no reason`)
  }, ident, blockMs)
  try { return await git.raw(argv) } catch (err) {
    throw new GitExit(code, err instanceof Error ? err.message : String(err))
  }
}

/** For the tests only: the choke point and the lists. */
export const __internal = { run, checkArgv, ALLOWED, CLIENT_METHODS }

const lines = (text: string): string[] => text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')
const firstLine = (text: string): string => text.trim().split('\n')[0] ?? ''

function assertInsideData(repo: string, path: string): void {
  const dataRoot = resolve(repo, 'data') + sep
  if (!resolve(repo, path).startsWith(dataRoot)) {
    throw new Error(`guardrail: refusing to commit path outside data/: ${path}`)
  }
}

/** Which of `paths` differ from the last commit, staged or not. A save commits
 *  the whole file, so edits already sitting in it would be committed with it. */
export async function uncommittedDataPaths(repo: string, paths: string[]): Promise<string[]> {
  for (const p of paths) assertInsideData(repo, p)
  const status = await simpleGit(repo).status(['--', ...paths])
  return status.files.map(f => f.path)
}

export interface HiddenPath { path: string; flag: 'assume-unchanged' | 'skip-worktree' }

/** Which of `paths` git has been told not to look at (`git update-index
 *  --assume-unchanged` or `--skip-worktree`). `git status` calls such a file
 *  clean whatever it holds, so `uncommittedDataPaths` cannot speak for it.
 *  `git ls-files -v` marks the first with a lower-case letter, the second with S. */
export async function hiddenDataPaths(repo: string, paths: string[]): Promise<HiddenPath[]> {
  for (const p of paths) assertInsideData(repo, p)
  return hiddenOf(repo, paths)
}

/** `ls-files -v` read for the two flags; the caller has checked the paths. */
async function hiddenOf(repo: string, paths: string[]): Promise<HiddenPath[]> {
  const listed = await run('ls-files', ['-v', '--', ...paths], repo)
  return listed.split('\n').filter(line => line.length > 2).flatMap((line): HiddenPath[] => {
    const tag = line[0]!; const path = line.slice(2)
    if (tag.toUpperCase() === 'S') return [{ path, flag: 'skip-worktree' }]
    return tag !== tag.toUpperCase() ? [{ path, flag: 'assume-unchanged' }] : []
  })
}

/** The address git makes this repository's commits with (`git config user.email`,
 *  the value that applies here), or null when none is set. */
export async function configuredEmail(repo: string): Promise<string | null> {
  const { value } = await simpleGit(repo).getConfig('user.email')
  return value !== null && value.trim() !== '' ? value.trim() : null
}

/** simple-git takes a command that exits non-zero but writes nothing to stderr for a success, so
 *  a commit hook that refuses without a word would read as a commit made, and the save would
 *  answer the old sha with its change left uncommitted. The writes count every non-zero exit as a
 *  failure, in git's words when it gave any. */
function writer(repo: string, ident?: GitIdent): SimpleGit {
  return client(repo, (error, result) => {
    if (error) return error
    if (result.exitCode === 0) return undefined
    const said = Buffer.concat([...result.stdOut, ...result.stdErr]).toString('utf8').trim()
    return Buffer.from(said || `git exited with code ${result.exitCode} and gave no reason`)
  }, ident)
}

/** Commit `paths` (inside data/ only) with `message` and, after a blank line, the
 *  Org-* trailers (lib/trailers.mjs); authored and committed by `opts.ident` when given. Answers the new commit's full
 *  sha. Throws only when no commit was made: once it has landed, a failure to read its sha, or git exiting non-zero
 *  after the ref update, is not a failure of the commit. */
export async function commitDataPaths(repo: string, paths: string[], message: string, trailers?: TrailerValues, opts: CommitOptions = {}): Promise<string> {
  return committed(repo, await commitPaths(repo, paths, message, trailers, opts))
}

/** `commitDataPaths` before the event. */
async function commitPaths(repo: string, paths: string[], message: string, trailers: TrailerValues | undefined, opts: CommitOptions): Promise<string> {
  if (paths.length === 0) {
    if (!opts.allowEmpty) throw new Error('no paths to commit')
    return commitEmpty(repo, message, trailers, opts.ident)
  }
  for (const p of paths) assertInsideData(repo, p)
  await writer(repo).add(paths)
  const full = withTrailers(message, trailers ?? {})
  const before = await headSha(repo)
  let made: { commit: string }
  try {
    made = await writer(repo, opts.ident).commit(full, paths)
  } catch (err) {
    // git can exit 128 after the ref update ("unable to write new index file"): the commit is
    // made though git reports a failure, and a throw would have the caller put old bytes over it.
    const landed = await landedDespite(repo, before, full, trailers?.change)
    if (landed) return landed
    throw err
  }
  // The commit has landed. Nothing from here may throw: a caller that sees a throw puts the files
  // back, over a change git already holds.
  return landedSha(repo, made.commit)
}

/** An empty commit: HEAD's tree again, with `message` and the trailers. Refused, before git runs, while anything is
 *  staged: git would carry it into this commit. */
async function commitEmpty(repo: string, message: string, trailers?: TrailerValues, ident?: GitIdent): Promise<string> {
  const staged = await stagedNames(repo)
  if (staged.length > 0) throw new Error(`guardrail: refusing the empty commit: ${staged.join(', ')} ${staged.length === 1 ? 'is' : 'are'} staged, and it would carry ${staged.length === 1 ? 'it' : 'them'}.`)
  const full = withTrailers(message, trailers ?? {})
  const before = await headSha(repo)
  const file = await gitPath(repo, 'COMMIT_EDITMSG')
  writeFileSync(file, full.endsWith('\n') ? full : `${full}\n`)
  try { await run('commit', ['--allow-empty', '-F', file], repo, ident) } catch (err) {
    const landed = await landedDespite(repo, before, full, trailers?.change)
    if (landed) return landed
    throw err
  }
  return (await headSha(repo)) ?? ''
}

/** HEAD's full sha, or null when it cannot be read (no commit yet, or a broken HEAD). Never throws. */
async function headSha(repo: string): Promise<string | null> {
  try { return (await simpleGit(repo).revparse(['--verify', 'HEAD'])).trim() || null } catch { return null }
}

const cleaned = (text: string) => text.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim()

/** After a commit git reported failed: HEAD's sha when HEAD moved from `before` to a commit that is
 *  this one (its Org-Change trailer is `change`; with no change id, its message is exactly
 *  `message`), else null. Never throws. */
async function landedDespite(repo: string, before: string | null, message: string, change: string | undefined): Promise<string | null> {
  const head = await headSha(repo)
  if (!head || head === before) return null
  try {
    const said = await run('log', ['-1', '--format=%B', head], repo)
    const ours = change ? parseTrailers(said).change === change : cleaned(said) === cleaned(message)
    return ours ? head : null
  } catch { return null }
}

/** The full sha of the commit just made: its own (abbreviated) sha from git's summary, expanded,
 *  which a hook that moves HEAD cannot change; else HEAD; else the abbreviation as git printed it
 *  ('' when it printed none). Never throws. */
async function landedSha(repo: string, short: string): Promise<string> {
  const git = simpleGit(repo)
  for (const ref of short ? [`${short}^{commit}`, 'HEAD'] : ['HEAD']) {
    try { return (await git.revparse(['--verify', ref])).trim() } catch { /* try the next */ }
  }
  return short
}

/** Make the index agree with the files again after a commit that failed
 *  part-way (the add went through, the commit did not). Still only `add`.
 *  A save starts only when the file has no uncommitted edits, so the file put
 *  back is the committed one and this leaves the index as the save found it. */
export async function restageDataPaths(repo: string, paths: string[]): Promise<void> {
  for (const p of paths) assertInsideData(repo, p)
  await writer(repo).add(paths)
}

// ── reading history, and the one ref move ──────────────────────────────────────────────────────

export interface GitVersion { major: number; minor: number; patch: number }

/** `git version 2.43.0`, with or without a distribution suffix (`(Apple Git-154)`, `.windows.1`). */
export function parseGitVersion(text: string): GitVersion {
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text)
  if (!m) throw new Error(`cannot read a git version from "${text.trim()}": expected something like "git version 2.43.0".`)
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) }
}

/** The installed git's version. Sync's merge path needs 2.38 (`merge-tree --write-tree`). */
export async function gitVersion(): Promise<GitVersion> {
  return parseGitVersion(await run('--version', [], process.cwd()))
}

/** The text of `path` at `rev`, byte for byte, or a sentence when it is not there. */
export async function showFile(repo: string, rev: string, path: string): Promise<string> {
  try { return await run('show', [`${rev}:${path}`], repo) } catch (err) {
    if (err instanceof GitExit) throw new Error(`${path} is not in ${rev} (${firstLine(err.message)}).`)
    throw err
  }
}

/** A detached worktree of `repo` at `rev`, at a path that is not there yet. */
export async function addWorktree(repo: string, path: string, rev: string): Promise<void> {
  if (existsSync(path)) throw new Error(`${path} already exists: a worktree is made at a path that is not there yet.`)
  await run('worktree', ['add', '--detach', path, rev], repo)
}

/** Remove a worktree. There is no force flag: a worktree with changes in it is refused, by git. The one kind the platform
 *  removes is a branch build's, under `stateDir(repo)/proposals`; any other path is refused before git runs (final
 *  review M5), so a caller that went wrong cannot remove the operator's own worktrees. */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  const home = join(stateDir(repo), 'proposals')
  if (!isAbsolute(path) || resolve(path) !== path || !path.startsWith(home + sep) || path.slice(home.length + 1).includes(sep)) {
    throw new Error(`guardrail: refusing to remove ${path}: the platform removes only the worktrees it builds, under ${home}.`)
  }
  await run('worktree', ['remove', path], repo)
}

/** Create `refs/heads/proposal/<id>` at `next` (when `old` is null: it must not exist yet) or move it
 *  from `old` to `next` (it must be at `old`). Compare-and-swap, by git. Takes an id, never a ref, and
 *  never deletes: an all-zero `next` is refused. */
export async function moveProposalBranch(repo: string, id: string, next: string, old: string | null): Promise<void> {
  if (!PROPOSAL_ID.test(id)) throw new Error(`"${id}" is not a proposal id: expected p-YYYY-MM-DD-NNN-xxxx.`)
  if (!HEX40.test(next)) throw new Error('A proposal branch is moved to a full 40-hex commit id.')
  if (next === ZEROS) throw new Error('A proposal branch is never deleted: the new value cannot be all zeros.')
  if (old !== null && !HEX40.test(old)) throw new Error('The old value of a proposal branch is a full 40-hex commit id, or null to create it.')
  await run('update-ref', [`refs/heads/proposal/${id}`, next, old ?? ZEROS], repo)
}

/** Whether `a` is an ancestor of (or the same as) `b`. */
export async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  try { await run('merge-base', ['--is-ancestor', a, b], repo); return true } catch (err) {
    if (err instanceof GitExit && err.code === 1) return false
    throw err
  }
}

/** The best common ancestor of `a` and `b`, or null when they share none. */
export async function mergeBase(repo: string, a: string, b: string): Promise<string | null> {
  try { return (await run('merge-base', [a, b], repo)).trim() || null } catch (err) {
    if (err instanceof GitExit && err.code === 1) return null
    throw err
  }
}

/** The author's address of the commit `rev` names (`log -1 --format=%ae`). Throws when `rev` names no commit. */
export async function authorEmail(repo: string, rev: string): Promise<string> {
  return (await run('log', ['-1', '--format=%ae', rev], repo)).trim()
}

/** A commit's whole message (`log -1 --format=%B`, the form the landed-commit check uses). Throws when `rev` names
 *  nothing. */
export async function messageOf(repo: string, rev: string): Promise<string> {
  return run('log', ['-1', '--format=%B', rev], repo)
}

/** The full sha `rev` names, or null when it names nothing. */
export async function resolveRev(repo: string, rev: string): Promise<string | null> {
  try { return (await run('rev-parse', ['--verify', '-q', rev], repo)).trim() || null } catch (err) {
    if (err instanceof GitExit && err.code === 1) return null
    throw err
  }
}

/** The commits in `a..b` along the first parent of each: what a trunk did, in order, oldest first. The
 *  commits beneath a merge's second parent are not in it. */
export async function trunkLine(repo: string, a: string, b: string): Promise<string[]> {
  return lines(await run('rev-list', ['--first-parent', '--reverse', `${a}..${b}`], repo))
}

/** The paths that differ between two revisions (names only). */
export async function diffNames(repo: string, a: string, b: string): Promise<string[]> {
  return lines(await run('diff', ['--name-only', a, b], repo))
}

/** The paths staged for the next commit. */
export async function stagedNames(repo: string): Promise<string[]> {
  return lines(await run('diff', ['--cached', '--name-only', '--no-renames'], repo))
}

/** The paths that differ between two trees (`diff-tree -r`). */
export async function treeDiffNames(repo: string, a: string, b: string): Promise<string[]> {
  return lines(await run('diff-tree', ['-r', '--name-only', a, b], repo))
}

/** What `b` changed since it left `a` (`a...b`), as a patch. Read only. */
export async function diffText(repo: string, a: string, b: string): Promise<string> {
  return run('diff', [`${a}...${b}`], repo)
}

/** How many commits `b` has that `a` lacks. */
export async function countBetween(repo: string, a: string, b: string): Promise<number> {
  return Number((await run('rev-list', ['--count', `${a}..${b}`], repo)).trim())
}

/** Where git keeps `name` (`MERGE_HEAD`, `FETCH_HEAD`) for this checkout, as an absolute path. */
export async function gitPath(repo: string, name: string): Promise<string> {
  return resolve(repo, (await run('rev-parse', ['--git-path', name], repo)).trim())
}

/** Whether a merge is waiting to be committed: the file `MERGE_HEAD` exists. (Not `rev-parse --verify
 *  MERGE_HEAD`: a branch called MERGE_HEAD would answer yes with no merge in progress.) */
export async function mergeInProgress(repo: string): Promise<boolean> {
  return existsSync(await gitPath(repo, 'MERGE_HEAD'))
}

// ── merging, the one undo, and the network read ───────────────────────────────────────────────

export interface MergeStart {
  /** True when a merge is now waiting to be committed (the file `MERGE_HEAD` exists). */
  pending: boolean
  /** git's own words. */
  said: string
}

/** `git merge --no-ff --no-commit <rev>`. Answers whether a merge is now pending; "Already up to date"
 *  exits 0 with no merge in progress, so the answer is read from the `MERGE_HEAD` file. A merge git could not
 *  complete (a conflict) throws a `GitExit` and leaves the merge pending: `mergeAbort` is the undo. */
export async function mergeNoFf(repo: string, rev: string): Promise<MergeStart> {
  const said = (await run('merge', ['--no-ff', '--no-commit', '--no-autostash', rev], repo)).trim()
  return { pending: await mergeInProgress(repo), said }
}

/** `git merge --ff-only <rev>`: moves the checked-out branch forward or refuses (a diverged history). */
export async function mergeFfOnly(repo: string, rev: string): Promise<string> {
  return run('merge', ['--ff-only', '--no-autostash', rev], repo)
}

/** `git merge --abort`: the platform's one undo. With no merge in progress it throws git's sentence. It restores
 *  staged files and keeps unstaged edits, and it refuses a file whose working bytes differ from the index
 *  (`not uptodate`): see the spec, §3.8 step 6. */
export async function mergeAbort(repo: string): Promise<void> {
  await run('merge', ['--abort'], repo)
}

export interface MergeTreeResult {
  /** The id of the tree git computed (written into the object store; the working tree and index are untouched). */
  tree: string
  /** The paths git could not merge; empty for a clean merge. */
  conflicts: string[]
}

/** `git merge-tree --write-tree --name-only <a> <b>` (git 2.38 or later). Exit 1 means conflicts, and is an answer. */
export async function mergeTree(repo: string, a: string, b: string): Promise<MergeTreeResult> {
  let out: string
  try { out = await run('merge-tree', ['--write-tree', '--name-only', a, b], repo) } catch (err) {
    if (!(err instanceof GitExit) || err.code !== 1) throw err
    out = err.message
  }
  const all = out.split('\n').map(l => l.replace(/\r$/, ''))
  const tree = all[0] ?? ''
  if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`git merge-tree gave no tree id: ${firstLine(out)}`)
  const end = all.indexOf('', 1)
  const conflicts = all.slice(1, end === -1 ? undefined : end).filter(l => l !== '')
  return { tree, conflicts }
}

/** `git fetch <remote>`: the one network read. Called by the `fetch` operation's job and by a read-only Hub's refresh
 *  (`hosted/refresh.ts`, which ends a fetch that says nothing for `blockMs`). The remote is `origin`, the one
 *  `lastFetch` reads and Share pushes to, and it must be configured (`remote.origin.url`): git reads a bare word that names
 *  no remote as a path, and fetches from the repository it finds there. */
export async function fetchRemote(repo: string, remote = 'origin', opts: { blockMs?: number } = {}): Promise<void> {
  checkArgv(['fetch', remote]) // a URL or a refspec is refused for what it is, before anything runs
  if (remote !== 'origin') throw new Error(`"${remote}" is not a remote this platform fetches: it fetches origin only, so nothing was fetched.`)
  const url = (await simpleGit(repo).getConfig('remote.origin.url')).value
  if (url === null || url.trim() === '') throw new Error('"origin" is not a remote of this repository (it has no remote.origin.url), so nothing was fetched.')
  await run('fetch', [remote], repo, undefined, opts.blockMs)
}

/** `git push <remote> refs/heads/<trunk>:refs/heads/<trunk>`: the one network write (L9 §5.6), the hosted Hub's Pusher's
 *  only. Fast-forward only: no flag and no `+`, so a remote that has commits the trunk lacks refuses it, and the `GitExit`
 *  carries git's words (`[rejected]`). The remote is `origin`, the one rule 4 is read for (`RemoteWatch`), and it must be
 *  configured: git reads a bare word that names no remote as a path. Reads refs only; runs outside the write lock. */
export async function pushTrunk(repo: string, remote: string, trunk: string, opts: { blockMs?: number } = {}): Promise<void> {
  const args = [remote, `refs/heads/${trunk}:refs/heads/${trunk}`]
  checkArgv(['push', ...args]) // a URL, a flag, a `+` or another branch is refused for what it is, before anything runs
  if (remote !== 'origin') throw new Error(`"${remote}" is not a remote this platform pushes to: it pushes to origin only, whose privacy it checks, so nothing was sent.`)
  if ((await remoteUrl(repo)) === null) throw new Error('"origin" is not a remote of this repository (it has no remote.origin.url), so nothing was sent.')
  // A push that says nothing for two minutes is ended, a GitExit without `[rejected]`: the Pusher tries again later.
  await run('push', args, repo, undefined, opts.blockMs ?? 120_000)
}

/** Clones `url` into `dir`, which must be absent or an empty folder (`hub init`, L9 §6, ruling P8): the only command that
 *  runs outside a repository, from `dir`'s parent. The deploy key reaches git through `GIT_SSH_COMMAND`, which every git
 *  process inherits. Answers nothing; throws git's words as a `GitExit`. */
export async function cloneInstance(url: string, dir: string): Promise<void> {
  const target = resolve(dir)
  const parent = resolve(target, '..')
  mkdirSync(parent, { recursive: true })
  await run('clone', ['--', url, target], parent)
}

/** Commit the pending merge: what is staged, with `message` and, after a blank line, the Org-* trailers; authored and
 *  committed by `opts.ident` when given. Takes no paths; it refuses unless a merge is pending and every staged path is
 *  in `allowedPaths`. A hook that refuses leaves the merge pending (the caller aborts). Answers the new commit's full sha. */
export async function commitMerge(repo: string, message: string, allowedPaths: string[], trailers?: TrailerValues, opts: CommitOptions = {}): Promise<string> {
  return committed(repo, await commitPendingMerge(repo, message, allowedPaths, trailers, opts))
}

/** `commitMerge` before the event. */
async function commitPendingMerge(repo: string, message: string, allowedPaths: string[], trailers: TrailerValues | undefined, opts: CommitOptions): Promise<string> {
  if (!(await mergeInProgress(repo))) throw new Error('there is no merge waiting to be committed.')
  const staged = await stagedNames(repo)
  const outside = staged.filter(p => !allowedPaths.includes(p))
  if (outside.length > 0) throw new Error(`guardrail: refusing to commit the merge: ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} staged and not on the list of paths this merge may change.`)
  const full = withTrailers(message, trailers ?? {})
  const before = await headSha(repo)
  const file = await gitPath(repo, 'COMMIT_EDITMSG')
  writeFileSync(file, full.endsWith('\n') ? full : `${full}\n`)
  try { await run('commit', ['-F', file], repo, opts.ident) } catch (err) {
    const landed = await landedDespite(repo, before, full, trailers?.change)
    if (landed) return landed
    throw err
  }
  return (await headSha(repo)) ?? ''
}

/** A path ratify's merge may stage or ask about: exactly `DECISIONS.md` at the root, or a plain path under `data/`
 *  (no `.` or `..` segment, nothing absolute, nothing that git could read as a flag). Throws before any git runs. */
function assertMergePath(repo: string, path: string): void {
  const plain = path === 'DECISIONS.md'
    || (path.startsWith('data/') && path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..')
      && resolve(repo, path).startsWith(resolve(repo, 'data') + sep))
  if (!plain) throw new Error(`guardrail: refusing ${path}: a merge stages only DECISIONS.md and files under data/.`)
}

/** `git add` of `paths` into the pending merge (ratify, spec §3.8 step 6). Refuses, before git runs, a path that is
 *  not in `allowedPaths` or is neither `DECISIONS.md` nor under `data/`; then refuses unless a merge is pending (the
 *  `MERGE_HEAD` file). `DECISIONS.md` is staged by nothing else. */
export async function stageMergeFiles(repo: string, paths: string[], allowedPaths: string[]): Promise<void> {
  if (paths.length === 0) throw new Error('no paths to stage')
  for (const p of paths) {
    assertMergePath(repo, p)
    if (!allowedPaths.includes(p)) throw new Error(`guardrail: refusing to stage ${p}: it is not on the list of paths this merge may change.`)
  }
  if (!(await mergeInProgress(repo))) throw new Error('there is no merge in progress, so nothing is staged into one.')
  await writer(repo).add(paths)
}

/** `hiddenDataPaths` for ratify's three files: the same reading, with `DECISIONS.md` allowed beside `data/`. */
export async function hiddenMergePaths(repo: string, paths: string[]): Promise<HiddenPath[]> {
  for (const p of paths) assertMergePath(repo, p)
  return hiddenOf(repo, paths)
}

/** Refuses, naming the file, a path git does not track. */
export async function assertTracked(repo: string, paths: string[]): Promise<void> {
  try { await run('ls-files', ['--error-unmatch', '--', ...paths], repo) } catch (err) {
    if (err instanceof GitExit) {
      const named = /pathspec '([^']+)' did not match/.exec(err.message)?.[1]
      throw new Error(`${named ?? paths.join(', ')} is not tracked by git, so it cannot be part of this change.`)
    }
    throw err
  }
}

/** Whether git accepts `name` as a branch name. A name that begins with `-` or `+` is refused here
 *  without asking, since this module could not pass it to git as an argument; whether the platform
 *  accepts it as a trunk is `validTrunkName`'s question. */
export async function validBranchName(repo: string, name: string): Promise<boolean> {
  if (name === '' || name.startsWith('-') || name.startsWith('+')) return false
  try { await run('check-ref-format', ['--branch', name], repo); return true } catch (err) {
    if (err instanceof GitExit && /not a valid branch name/.test(err.message)) return false
    throw err
  }
}

/** Whether git ignores `path` (relative to the repository; a folder named with a trailing `/`). A tracked file is
 *  not ignored, whatever .gitignore says. Throws for what git cannot answer (a path outside the repository). */
export async function isIgnored(repo: string, path: string): Promise<boolean> {
  try { await run('check-ignore', ['-q', '--', path], repo); return true } catch (err) {
    if (err instanceof GitExit && err.code === 1) return false
    throw err
  }
}

/** The tracked files that differ from HEAD, staged or not. Untracked files are not changes. */
export async function trackedChanges(repo: string): Promise<string[]> {
  const status = await simpleGit(repo).status()
  return status.files.filter(f => !(f.index === '?' && f.working_dir === '?')).map(f => f.path)
}

/** The paths the index holds unmerged (a conflict a merge left: `UU`, `AA`, `DU` …), read from `git status`. */
export async function unmergedPaths(repo: string): Promise<string[]> {
  return (await simpleGit(repo).status()).conflicted
}

export interface FetchState {
  state: 'no remote' | 'remote has no trunk' | 'never fetched' | 'the last fetch was not of the trunk' | 'no local trunk' | 'fetched'
  /** When the last fetch of the trunk happened (the file's own time); null unless `state` is 'fetched'. */
  fetchedAt: Date | null
  /** Commits the trunk has that `origin/<trunk>` lacks, and the other way, as of that fetch. */
  ahead: number
  behind: number
}

/** How long a reading of the remote stays fresh: a fetch for Propose, an absent trunk for `lastFetch` (15 min). */
export const FETCH_FRESH_MS = 15 * 60e3

const ABSENT_FILE = 'remote-trunk-absent.json'

/** `remote.origin.url`, or null when there is none. */
export async function remoteUrl(repo: string): Promise<string | null> {
  const url = (await simpleGit(repo).getConfig('remote.origin.url')).value
  return url === null || url.trim() === '' ? null : url
}

/** Sync's finding (F-L3-2): its fetch of every branch ended with no `refs/remotes/origin/<trunk>`, so the remote has no such
 *  branch and there is nothing to be behind. One record in the server's state directory, replaced by the next. */
export function recordRemoteTrunkAbsent(repo: string, rec: { url: string; trunk: string; at: Date }): void {
  const dir = stateDir(repo)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ABSENT_FILE), `${JSON.stringify({ url: rec.url, trunk: rec.trunk, at: rec.at.toISOString() })}\n`)
}

/** Whether a fresh record names this url and trunk. A record that cannot be read is no record. */
function absenceRecorded(repo: string, url: string, trunk: string, now: Date): boolean {
  try {
    const rec = JSON.parse(readFileSync(join(stateDir(repo), ABSENT_FILE), 'utf8')) as { url?: unknown; trunk?: unknown; at?: unknown }
    if (rec.url !== url || rec.trunk !== trunk || typeof rec.at !== 'string') return false
    const at = Date.parse(rec.at)
    return Number.isFinite(at) && now.getTime() - at <= FETCH_FRESH_MS
  } catch { return false }
}

/** What the last fetch of `trunk` from `origin` says. Reads files, runs no fetch, touches no network.
 *  Age and subject come from `FETCH_HEAD`: the reading is fresh only when one of its lines names the
 *  trunk (`branch '<trunk>' of …`, also when marked `not-for-merge`) and that line's sha is the
 *  remote-tracking ref's, or (after this clone's own Share, which moves the tracking ref to what it pushed and leaves
 *  `FETCH_HEAD` as it was) an ancestor of the tracking ref, which is itself an ancestor of, or equal to, the local
 *  trunk: the only difference is then what this clone pushed. Any `git fetch` rewrites the file with only what it
 *  fetched, so a fetch of some other branch leaves a young file that does not speak for the trunk; and a tracking ref
 *  that moved past the local trunk without a fetch that says so is not trusted. A recorded absence (`recordRemoteTrunkAbsent`)
 *  younger than `FETCH_FRESH_MS` at `now`, for this url and trunk, with no tracking ref, reads 'remote has no trunk'. */
export async function lastFetch(repo: string, trunk: string, now: Date = new Date()): Promise<FetchState> {
  const none = (state: FetchState['state']): FetchState => ({ state, fetchedAt: null, ahead: 0, behind: 0 })
  const url = (await simpleGit(repo).getConfig('remote.origin.url')).value
  if (url === null || url.trim() === '') return none('no remote')
  // a remote Sync found to hold no such branch (and no tracking ref has appeared since): nothing on it to be behind
  if (absenceRecorded(repo, url, trunk, now) && (await resolveRev(repo, `refs/remotes/origin/${trunk}`)) === null) return none('remote has no trunk')
  const file = await gitPath(repo, 'FETCH_HEAD')
  if (!existsSync(file)) return none('never fetched')
  const remoteRef = `refs/remotes/origin/${trunk}`
  const tip = await resolveRev(repo, remoteRef)
  const subject = `branch '${trunk}' of `
  const named = tip === null ? [] : readFileSync(file, 'utf8').split('\n').flatMap(line => {
    const [sha, , what] = line.split('\t')
    return sha !== undefined && HEX40.test(sha) && what !== undefined && what.startsWith(subject) ? [sha] : []
  })
  const local = `refs/heads/${trunk}`
  const localTip = await resolveRev(repo, local)
  /** `a` is an ancestor of `b`; false, not a throw, when either names no commit this repository holds. */
  const below = async (a: string, b: string): Promise<boolean> => {
    try { return await isAncestor(repo, a, b) } catch (err) { if (err instanceof GitExit) return false; throw err }
  }
  let speaks = tip !== null && named.includes(tip)
  if (!speaks && tip !== null && localTip !== null && (await below(tip, localTip))) {
    for (const sha of named) if (await below(sha, tip)) { speaks = true; break }
  }
  if (!speaks) return none('the last fetch was not of the trunk')
  if (localTip === null) return none('no local trunk') // deleted, or a detached clone
  return {
    state: 'fetched', fetchedAt: statSync(file).mtime,
    ahead: await countBetween(repo, remoteRef, local), behind: await countBetween(repo, local, remoteRef),
  }
}
