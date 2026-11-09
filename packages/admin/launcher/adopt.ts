import { randomUUID } from 'node:crypto'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { Answers } from '../lib/open-instance.mjs'
import { isInstance } from './folders.ts'
import { launcherGit } from './git-write.ts'
import { scaffold } from './scaffold.ts'

/** Adopting a repo that is not org-os yet (spec R7/R8): the only place the launcher writes into a repo that already
 *  exists. The org-os files are made in a scratch folder first; only the ones the repo lacks are copied, each with an
 *  exclusive create, onto a new branch. The default branch is never written, nothing is ever overwritten, nothing is
 *  pushed. Every git command goes through `launcherGit` and its fixed vocabulary. */

export const ADOPT_BRANCH = 'org-os/adopt'
const SCRATCH_PREFIX = 'org-os-adopt-'

export interface AdoptPlan { id: string; dir: string; add: string[]; kept: string[]; scratch: string }

/** A refusal or a stop, with the HTTP status the launcher answers it with and, for a scaffold failure, its log. */
export class AdoptError extends Error {
  constructor(message: string, readonly status: 409 | 500, readonly log?: string) { super(message) }
}

/** git's own sentence from what it printed: the last `fatal:`/`error:` line when there is one, else every line that is
 *  not a hint, joined. */
function gitSentence(stderr: string, fallback: string): string {
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean)
  const fatal = lines.filter(l => /^(fatal|error):/i.test(l)).pop()
  const said = (fatal ?? lines.filter(l => !/^hint:/i.test(l)).join(' ')).replace(/^(fatal|error):\s*/i, '').trim()
  if (!said) return fallback
  const first = said[0]!.toUpperCase() + said.slice(1)
  return /[.!?]$/.test(first) ? first : `${first}.`
}

const isDirectory = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }

/** Why `dir` cannot be adopted now, in a sentence; or null when it can. Reads only. */
export async function adoptProblem(dir: string): Promise<string | null> {
  if (!isDirectory(dir)) return `${dir} is not a folder.`
  const top = await launcherGit(dir, 'rev-parse', ['--show-toplevel'])
  if (top.code !== 0) return `${dir} is not a git repo. Adopt works on the top folder of a git repo.`
  let topReal: string, dirReal: string
  try { topReal = realpathSync(top.stdout.trim()); dirReal = realpathSync(dir) } catch { return `${dir} cannot be read.` }
  if (topReal !== dirReal) return `${dir} is inside the git repo at ${topReal}. Choose that top folder instead.`
  if (isInstance(dir)) return 'This is already an org-os instance. Open it instead.'
  const head = await launcherGit(dir, 'rev-parse', ['--verify', '--quiet', 'HEAD'])
  if (head.code !== 0) return 'This repo has no commits yet. Make a first commit, then adopt it.'
  const marks = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']
  const paths = await launcherGit(dir, 'rev-parse', marks.flatMap(m => ['--git-path', m]))
  if (paths.code !== 0) return gitSentence(paths.stderr, 'git could not read this repo.')
  const found = paths.stdout.split('\n').filter(Boolean).map((p, i) => ({ mark: marks[i]!, there: existsSync(resolve(dir, p)) }))
  if (found.some(f => f.there && /^(MERGE_HEAD|rebase-)/.test(f.mark))) return 'A merge or rebase is in progress in this repo. Finish it or abort it, then adopt.'
  if (found.some(f => f.there)) return 'A cherry-pick or revert is in progress in this repo. Finish it or abort it, then adopt.'
  const st = await launcherGit(dir, 'status', ['--porcelain', '--untracked-files=all'])
  if (st.code !== 0) return gitSentence(st.stderr, 'git could not read this repo.')
  const dirty = st.stdout.split('\n').filter(Boolean).map(l => l.slice(3))
  if (dirty.length > 0) {
    const named = dirty.slice(0, 3).join(', ') + (dirty.length > 3 ? ` and ${dirty.length - 3} more` : '')
    return `This repo has uncommitted or untracked files (${named}). Commit them or move them out, then adopt.`
  }
  const branch = await launcherGit(dir, 'show-ref', ['--verify', '--quiet', `refs/heads/${ADOPT_BRANCH}`])
  if (branch.code === 0) return `This repo already has a branch called ${ADOPT_BRANCH}. Merge it or remove it, then adopt again.`
  return null
}

/** Every regular file under `root`, as POSIX paths relative to it. A symlink or anything else that is not a file or a
 *  folder is left out: it is never copied. */
function filesUnder(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...filesUnder(root, path))
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/** Whether nothing at all is at `rel` in `dir`, looked at with lstat one segment at a time, never following a link.
 *  A parent that is a file, a symlink or anything not a folder, or a path that cannot be read, counts as something. */
function nothingAt(dir: string, rel: string): boolean {
  let at = dir
  const parts = rel.split('/')
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]!)
    let st
    try { st = lstatSync(at) } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT'
    }
    if (i === parts.length - 1 || !st.isDirectory()) return false
  }
  return false
}

/** A path from the scaffold that is plain: relative, no `..`, no empty segment, nothing inside a `.git` folder. */
const plainPath = (rel: string) => rel !== '' && !rel.startsWith('/') && rel.split('/').every(s => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git')

/** Removes a scratch folder this module made, and nothing else. */
export function removeScratch(scratch: string): void {
  const base = basename(scratch)
  if (!base.startsWith(SCRATCH_PREFIX)) return
  const parent = dirname(scratch)
  const tmp = [tmpdir(), (() => { try { return realpathSync(tmpdir()) } catch { return tmpdir() } })()]
  if (!tmp.includes(parent)) return
  rmSync(scratch, { recursive: true, force: true })
}

/** Makes the org-os files for `answers` in a scratch folder (`clone:framework --no-git`) and sorts each into `add`
 *  (nothing at that path in `dir`) or `kept` (something is there, or a parent is a file or a link). Writes nothing in `dir`. */
export async function planAdopt(dir: string, answers: Answers, frameworkDir: string): Promise<AdoptPlan> {
  const problem = await adoptProblem(dir)
  if (problem) throw new AdoptError(problem, 409)
  const scratch = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX))
  try {
    const made = join(scratch, 'scaffold')
    let result
    try { result = await scaffold(answers, made, { git: false }, frameworkDir) } catch (err) {
      result = { code: 1, log: err instanceof Error ? err.message : String(err) }
    }
    if (result.code !== 0) throw new AdoptError('The framework could not make the org-os files. Nothing was written to your repo.', 500, result.log)
    const add: string[] = [], kept: string[] = []
    for (const rel of filesUnder(made)) {
      if (!plainPath(rel)) continue
      ;(nothingAt(dir, rel) ? add : kept).push(rel)
    }
    add.sort(); kept.sort()
    return { id: randomUUID(), dir, add, kept, scratch }
  } catch (err) {
    removeScratch(scratch)
    throw err
  }
}

/** What to say about the branch after a stop that came after the switch. */
const leftOnBranch = (copied: number) =>
  `${copied === 0 ? 'No files were copied' : `The ${copied} file${copied === 1 ? '' : 's'} already copied stay${copied === 1 ? 's' : ''} on ${ADOPT_BRANCH}, not committed`}; your repo is on ${ADOPT_BRANCH} now, and your default branch is as it was.`

/** Makes each missing parent folder of `rel` in `dir`, one segment at a time and never through a link; throws naming the
 *  segment when something other than a folder is in the way. */
function makeParents(dir: string, rel: string): void {
  const parts = rel.split('/').slice(0, -1)
  let at = dir
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]!)
    let st
    try { st = lstatSync(at) } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      try { mkdirSync(at) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
      st = lstatSync(at)
    }
    if (!st.isDirectory()) throw Object.assign(new Error(`${parts.slice(0, i + 1).join('/')} is in the way`), { code: 'EEXIST', segment: parts.slice(0, i + 1).join('/') })
  }
}

/** Adds the plan's missing files on a new branch and commits them with the repo's own identity. The repo is checked
 *  again first. Each file is copied with an exclusive create: if anything has appeared at one of the paths since the
 *  plan was made, it stops there, naming the path, and leaves what it copied uncommitted on the branch. The scratch
 *  folder is removed whatever happens. */
export async function applyAdopt(plan: AdoptPlan): Promise<{ branch: string; commit: string; added: number; kept: number }> {
  const { dir, add, kept, scratch } = plan
  try {
    const problem = await adoptProblem(dir)
    if (problem) throw new AdoptError(problem, 409)
    const made = join(scratch, 'scaffold')
    if (!isDirectory(made)) throw new AdoptError('The files this plan made are gone. Start the adoption again.', 409)
    for (const rel of add) {
      const inside = relative(dir, join(dir, rel))
      if (!plainPath(rel) || inside.startsWith('..') || inside.split(sep).join('/') !== rel) throw new AdoptError(`${rel} is not a plain path inside the repo. Nothing was written.`, 500)
    }

    const sw = await launcherGit(dir, 'switch', ['-c', ADOPT_BRANCH])
    if (sw.code !== 0) throw new AdoptError(`${gitSentence(sw.stderr, `git could not make the branch ${ADOPT_BRANCH}.`)} Nothing was written.`, 500)

    let copied = 0
    for (const rel of add) {
      const src = join(made, rel)
      const dst = join(dir, rel)
      try {
        makeParents(dir, rel)
        copyFileSync(src, dst, constants.COPYFILE_EXCL) // keeps the source's mode; never replaces what is there
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { segment?: string }
        if (e.code === 'EEXIST') {
          const what = e.segment ?? rel
          throw new AdoptError(`${what} appeared in your repo after the plan was made, so adopt stopped there and wrote nothing over it. ${leftOnBranch(copied)}`, 409)
        }
        throw new AdoptError(`${rel} could not be copied (${e.message}). ${leftOnBranch(copied)}`, 500)
      }
      copied++
    }

    if (add.length > 0) {
      const staged = await launcherGit(dir, 'add', ['--', ...add.map(p => `:(literal)${p}`)])
      if (staged.code !== 0) throw new AdoptError(`${gitSentence(staged.stderr, 'git could not add the files.')} ${leftOnBranch(copied)}`, 500)
    }
    const message = `chore(org-os): adopt — add the org-os files (${add.length} added, ${kept.length} kept as they were)`
    const committed = await launcherGit(dir, 'commit', ['-m', message])
    if (committed.code !== 0) throw new AdoptError(`${gitSentence(committed.stderr || committed.stdout, 'git could not commit.')} ${leftOnBranch(copied)}`, 500)
    const head = await launcherGit(dir, 'rev-parse', ['HEAD'])
    return { branch: ADOPT_BRANCH, commit: head.stdout.trim(), added: add.length, kept: kept.length }
  } finally {
    removeScratch(scratch)
  }
}
