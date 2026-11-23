// packages/admin/server/workspace/reads.ts
//
// Who reads the workspace's agent layer (0.7.1, D6). The rows of lib/workspace/editors.mjs marked `read: 'deciders'`
// (memory/**, MEMORY.md, HEARTBEAT.md, docs/plans/**, docs/agent-plans/**) are read, by a viewer a session signed in (SIWE
// or an emailed link), only when that viewer decides under the workspace rule that governs the path (lib/rules.mjs
// `workspaceRuleFor` at the path's targets). Every other row is read by every member, as before. Anyone else is answered
// as for a path that is not there, so nothing says whether the file exists.
//
//   - Ruling PR7-R91: the deciders are the members of the rule's `decide.by` role. A rule that names none (WORKSPACE_DIRECT,
//     when the org wrote no workspace rule) is read by the members of the org's own *defined* `maintainer` role; the
//     implied maintainer (every person, F2-R2) does not count, as in `suggestDecidable`, and neither does it for a rule
//     that names `maintainer` while the org defines none. A role the org does not define reads nobody. An agent and an
//     organization never decide, so they never read here either.
//   - Ruling PR7-R92: a viewer's governance roles are `viewer.roles` (request.ts `rolesFor`: members-listed, `all` and
//     hat-sourced roles). For a person signed in by emailed link that list also holds their Roles-table Roles (steward,
//     node-lead, network-member: `viewerRoles`), which are not governance roles; so the role's own resolution is asked too
//     (its members list, or the hat it is sourced from), and a Roles-table Role never stands for the governance role of the
//     same name.
//   - Ruling PR7-R93: the person at the machine (request.ts `byGit`: an actor with no `via`, or `via: 'git'`) reads what
//     git holds, as in 0.6, and is told apart by the actor's `via`; a read previewed `?as=` is judged as the previewed
//     viewer, whoever asks, so View as shows what that viewer would read.
//
//   readsDeciders(path)         → whether a path is read by its deciders only (re-exported from the editors table)
//   fileReader(c, repo)         → (path) => whether the request's viewer may read that path (`all`: every path, ungated)
//   viewerReader(repo, viewer)  → the same for a viewer alone, gating the person at the machine too (PR7-R98)
//   fileLevels(repo, viewer)    → 0.7.2: the `files` section's answer alone (viewerReader asks it first)
//   withheldOp(op)              → a file op as one who may not read its path is shown it: `{ op: 'file', withheld: true }`
//   readableEntry(entry, may)   → a ledger entry with its ops and its events' ops withheld where `may` refuses
//   mayReadWhole(repo, may, p)  → whether a file is read whole: its path, and the ledger while it holds an unread op (C2)
//   unreadRefusal(paths)        → the 422 a write naming such a path is refused with (revise, load, apply: I1)
//   diffFor(diff, may)          → a `git diff` without the files whose path `may` refuses, file by file
//   readableView(view, may)     → a proposal's view with all of those applied (ops, events, diff, compare, current, stale)

import type { Context } from 'hono'
import { readsDeciders } from '../../lib/workspace/editors.mjs'
import { MAINTAINER, WORKSPACE_DIRECT, effectiveRules, resolveRoles, workspaceRuleFor } from '../../lib/rules.mjs'
import { targetsOfPath } from '../../lib/workspace/targets.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import { readRuleContext } from '../governance/effective.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { HttpError } from '../errors.ts'
// The request's actor and viewer are read from `c.var` (set by request.ts `withRequest`), never by importing request.ts:
// it imports the change engine, which imports this module's importers, and the cycle would leave a class undefined.
import type {} from '../request.ts'
import type { Actor } from '../actor.ts'
import { fileAdmits, fileLevel, type Viewer } from '../../lib/visibility.mjs'
import { registryFile } from '../registries.ts'
import { readFilesConfig } from '../visibility/config.ts'

const actorOf = (c: Context): Actor | null => c.get('actor') ?? null
const viewerOf = (c: Context): Viewer => c.get('viewer') ?? { kind: 'public' }

export { readsDeciders }

/** Whether the request is one the agent layer is gated for: a viewer a session signed in, the public, or a preview. */
function gated(c: Context): boolean {
  if (c.req.query('as') !== undefined) return true
  const actor = actorOf(c)
  if (actor === null) return true
  return 'via' in actor && (actor.via === 'siwe' || actor.via === 'email')
}

/** Whether a viewer may read a path; `all` when they read every path git holds (the person at the machine). `records`
 *  (0.7.2): whether they may read the records of a record op's registry (`<registry>:<id>`), by its file; absent: all. */
export type FileReader = ((path: string) => boolean) & { all?: true; records?: (record: string) => boolean }

/** A reader of paths for the request's viewer. The governance is read once, when the first gated path is asked. */
export function fileReader(c: Context, repo: string): FileReader {
  if (!gated(c)) return Object.assign(() => true, { all: true as const })
  return viewerReader(repo, viewerOf(c))
}

/**
 * A reader of paths for `viewer` alone, whoever is asking: what a gate that knows the viewer and not the request uses
 * (visibility/gate.ts: the ledger as a registry, the map). It gates the person at the machine too (PR7-R98).
 *
 * The viewer decides under a rule when its deciding role is one the org defines and they hold it as the rules resolve it
 * (PR7-R92, fix round 1): `viewer.roles` names it (so a preview narrows it), and the role's own resolution says them — its
 * members list for a role written with members or `all`, the hat they wear for one sourced from a hat. A Roles-table Role
 * of the same name never stands for it. Only WORKSPACE_DIRECT falls back to `maintainer`; a written rule with no `by`, or
 * one that is not a role id, is read by nobody (PR7-R100, M3).
 */
export function viewerReader(repo: string, viewer: Viewer): FileReader {
  if (viewer.kind === 'public') return path => !readsDeciders(path)
  let decides: ((targets: readonly string[]) => boolean) | null = null
  const decider = (): ((targets: readonly string[]) => boolean) => {
    if (decides) return decides
    const rc = readRuleContext(repo, { unknown: '' })
    if (rc.governance === null) return (decides = () => false)
    const rules = effectiveRules(rc.governance).rules
    const book = resolveRoles(rc.governance, rc.members ?? [])
    if (book.agents.has(viewer.id) || book.organizations.has(viewer.id)) return (decides = () => false)
    decides = targets => {
      const rule = workspaceRuleFor(rules, targets)
      const by = rule === WORKSPACE_DIRECT ? MAINTAINER : rule.decide?.by
      if (typeof by !== 'string' || by === '') return false
      const role = book.roles.get(by)
      if (!role?.defined || !viewer.roles.includes(role.id)) return false
      return role.hat !== undefined ? viewer.hats.includes(role.hat) : role.members.includes(viewer.id)
    }
    return decides
  }
  const files = fileLevels(repo, viewer)
  const read = (path: string) => {
    if (!files(path)) return false
    if (!readsDeciders(path)) return true
    return decider()(targetsOfPath(path, () => null) ?? ['workspace'])
  }
  return Object.assign(read, { records: (record: string) => recordsReadable(repo, files, record) })
}

/** Whether the records of `record`'s registry (`<registry>:<id>`, as a record op names one) are read by a viewer `files`
 *  answers for: by the registry's file. A registry no file holds (unknown, the store's) is not judged here. */
function recordsReadable(repo: string, files: (path: string) => boolean, record: string): boolean {
  const at = record.indexOf(':')
  const name = at < 0 ? record : record.slice(0, at)
  let path: string
  try { path = registryFile(repo, name, at < 0 ? undefined : record.slice(at + 1)) } catch { return true }
  return files(path)
}

/** 0.7.2: whether `viewer` may read the records of registry `name` from git, by its file (the `files` section). */
export function mayReadRecordsOf(repo: string, viewer: Viewer, name: string): boolean {
  return recordsReadable(repo, fileLevels(repo, viewer), name)
}

/** 0.7.2 round 3: the `files` level that holds registry `name`'s file, said as text so two can be compared: `open` when there
 *  is no section, the file is outside it, or no file holds the registry. */
export function registryFileLevel(repo: string, name: string): string {
  const files = readFilesConfig(repo)
  if (files === null) return 'open'
  let path: string
  try { path = registryFile(repo, name) } catch { return 'open' }
  return JSON.stringify(fileLevel(files, path) ?? 'open')
}

/** The viewers request.ts made for the person at the machine (`byGit`). A `files` level never gates them: they read what
 *  git holds, as fileReader's `all` says. A preview (`?as`) is a new viewer, so it is judged as the viewer it previews. */
const MACHINE = new WeakSet<object>()
/** Marks `viewer` as the person at the machine's (request.ts `byGit`), and returns it. */
export function atTheMachine<V extends Viewer>(viewer: V): V { MACHINE.add(viewer); return viewer }

/**
 * 0.7.2: whether `viewer` may read a path whole by data/visibility.yaml's `files` section (lib/visibility.mjs `fileLevel`):
 * every path when the section is absent (opt-in) or does not govern it (outside data/); else when the path's level admits
 * them (`role:<Role>` against `viewer.roles`, which hold a signed-in person's Roles-table Roles). The section is read once
 * per reader. It judges a viewer only; who is gated at all is the caller's (fileReader: the person at the machine is not).
 */
export function fileLevels(repo: string, viewer: Viewer): (path: string) => boolean {
  if (MACHINE.has(viewer)) return () => true
  const files = readFilesConfig(repo)
  if (files === null) return () => true
  return path => {
    const level = fileLevel(files, path)
    return level === null || fileAdmits(level, viewer)
  }
}

/** A sample path a row's pattern names: `memory/**` → `memory/x`, `data/*.yaml` → `data/x.yaml`. */
export const samplePath = (pattern: string): string => pattern.replace('**', 'x').replace('*', 'x')

/** A file op as one who may not read its path is shown it (PR7-R97, M1): `{ op: 'file', withheld: true }`, nothing of the
 *  file — not its path, its text, its base, nor whether it deletes. */
export function withheldOp<T extends { op: string }>(_op: T): T {
  return { op: 'file', withheld: true } as unknown as T
}

/** The ops of a list as `may` lets them be read: each `file` op on a path it refuses, withheld. */
function readableOps(ops: unknown, may: FileReader): unknown {
  return Array.isArray(ops) ? ops.map(op => (refused(op, may) ? withheldOp(op as { op: string }) : op)) : ops
}

/** Whether a list of ops, or any event's, holds a `file` op on a path `may` refuses. */
function holdsUnread(entry: { ops?: unknown; events?: unknown }, may: FileReader): boolean {
  const unread = (ops: unknown) => Array.isArray(ops) && ops.some(op => refused(op, may))
  return unread(entry.ops) || (Array.isArray(entry.events) && entry.events.some(e => isObj(e) && unread(e.ops)))
}

/** A ledger entry (or any record carrying `ops` and `events[].ops`) as `may` lets it be read: the revise and replay events'
 *  ops too (C3; revise.ts, branch.ts write them), as private/proposals.ts `shownTo` treats a placeholder. */
export function readableEntry<E extends object>(entry: E, may: FileReader): E {
  if (may.all) return entry
  const e = entry as E & { ops?: unknown; events?: unknown }
  if (!holdsUnread(e, may)) return entry
  return {
    ...entry,
    ...('ops' in e ? { ops: readableOps(e.ops, may) } : {}),
    ...(Array.isArray(e.events) ? { events: e.events.map(ev => (isObj(ev) && Array.isArray(ev.ops) ? { ...ev, ops: readableOps(ev.ops, may) } : ev)) } : {}),
  }
}

/** The ledger's file (data/proposals.yaml). */
export const LEDGER_PATH = 'data/proposals.yaml'

/** Whether the ledger holds a `file` op on a path `may` refuses, anywhere in it: an entry's ops or any event's (C2). It is
 *  read here as YAML, not through proposals/ledger.ts, whose imports reach back to this module. A ledger that cannot be
 *  read as YAML is judged by its text: one that names a path of the agent layer is held to hold such an op. */
export function ledgerHoldsUnread(repo: string, may: FileReader): boolean {
  if (may.all) return false
  const path = join(repo, LEDGER_PATH)
  if (!existsSync(path)) return false
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return false }
  let values: unknown[]
  try {
    const docs = parseAllDocuments(text)
    if (!Array.isArray(docs) || docs.some(d => d.errors.length > 0)) throw new Error('unreadable')
    values = docs.map(d => d.toJS())
  } catch {
    return /(?:^|[\s"'/])(?:memory\/|MEMORY\.md|HEARTBEAT\.md|docs\/plans\/|docs\/agent-plans\/)/m.test(text)
  }
  const walk = (x: unknown): boolean => {
    if (Array.isArray(x)) return x.some(walk)
    if (!isObj(x)) return false
    if (refused(x, may) && ('op' in x)) return true
    return Object.values(x).some(walk)
  }
  return values.some(walk)
}

/** Whether `may` lets the viewer read the file at `path` whole: a path it refuses, or the ledger while it holds an op on
 *  one (C2: its text is never filtered, so its base still matches the file). */
export function mayReadWhole(repo: string, may: FileReader, path: string): boolean {
  if (!may(path)) return false
  return path !== LEDGER_PATH || !ledgerHoldsUnread(repo, may)
}

/** The 422 a write that names a path the asker may not read is refused with (I1): the words of a path no rule governs,
 *  one per path, as staging says them (files.ts `heldFileErrors`). */
export function unreadRefusal(paths: readonly string[]): HttpError & { errors: { record: string; field: string; message: string }[] } {
  return Object.assign(new HttpError(422, 'Not governed.'), {
    errors: [...new Set(paths)].map(path => ({ record: path, field: 'path', message: `${path} is not a governed file, so it has no editor here. Nothing was staged.` })),
  })
}

/** The paths of `ops`' `file` ops that `may` refuses. */
export const unreadPaths = (ops: readonly unknown[], may: FileReader): string[] =>
  may.all ? [] : ops.flatMap(op => (isFileOn(op) && !may(op.path) ? [op.path] : isRecordOp(op) && refused(op, may) ? [op.record] : []))

/** Each path a section of a `git diff` names: its header's, its `---`/`+++` lines', a rename's or a copy's. */
function pathsOf(section: string): string[] {
  const out: string[] = []
  const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, '$1') : p)
  const lines = section.split('\n')
  const head = /^diff --git (.+)$/.exec(lines[0] ?? '')?.[1]
  if (head !== undefined) {
    // `a/<p> b/<p>`: for a path with no rename both halves are one path.
    const half = (head.length - 1) / 2
    const a = head.slice(0, half)
    const b = head.slice(half + 1)
    if (Number.isInteger(half) && a.replace(/^"?a\//, '') === b.replace(/^"?b\//, '')) out.push(unquote(a).replace(/^a\//, ''))
  }
  for (const line of lines) {
    const m = /^(?:--- a\/|\+\+\+ b\/|rename from |rename to |copy from |copy to )(.+)$/.exec(line)
    if (m) out.push(unquote(m[1]!))
    const q = /^(?:--- |\+\+\+ )"[ab]\/(.+)"$/.exec(line)
    if (q) out.push(q[1]!.replace(/\\(.)/g, '$1'))
  }
  return out
}

/** `diff` without the files whose path `may` refuses (PR7-R94): a section naming any such path, or none it can read, goes. */
export function diffFor(diff: string, may: FileReader): string {
  if (may.all) return diff
  const sections = diff.split(/(?=^diff --git )/m)
  return sections.filter(s => {
    if (!s.startsWith('diff --git ')) return true
    const paths = pathsOf(s)
    return paths.length > 0 && paths.every(may)
  }).join('')
}

/** Whether `may` refuses an op: a file op on a path it refuses, or a record op on a registry whose file it refuses (0.7.2). */
function refused(op: unknown, may: FileReader): boolean {
  if (isFileOn(op)) return !may(op.path)
  return may.records !== undefined && isRecordOp(op) && !may.records(op.record)
}
function isRecordOp(op: unknown): op is { op: string; record: string } {
  return typeof op === 'object' && op !== null && typeof (op as { record?: unknown }).record === 'string'
}

function isFileOn(op: unknown): op is { op: 'file'; path: string } {
  return typeof op === 'object' && op !== null && (op as { op?: unknown }).op === 'file' && typeof (op as { path?: unknown }).path === 'string'
}
function isObj(x: unknown): x is Record<string, unknown> { return typeof x === 'object' && x !== null && !Array.isArray(x) }

/**
 * A proposal's view (its list row, its page, the answer of an act on it) as `may` lets the viewer read it (PR7-R94, fix
 * round 1): each `file` op on a path they may not read is withheld, in `ops` and in every event's `ops` (C3); the `diff`
 * loses that file's sections; a `compare` or `current` at that op's position (they count the git ops) is null, and the
 * position leaves `stale` (M1). Everything else is kept.
 */
export function readableView<V extends object>(view: V, may: FileReader): V {
  if (may.all) return view
  const v = view as V & { ops?: unknown; events?: unknown; diff?: unknown; compare?: unknown; current?: unknown; stale?: unknown }
  if (!Array.isArray(v.ops)) return view
  if (!holdsUnread(v, may) && typeof v.diff !== 'string') return view
  const unread = (op: unknown) => refused(op, may)
  const git = gitOpsOf(v.ops as unknown[])
  const hidden = (list: unknown) => (Array.isArray(list) ? list.map((x, i) => (unread(git[i]) ? null : x)) : list)
  return {
    ...readableEntry(view, may),
    ...(typeof v.diff === 'string' ? { diff: diffFor(v.diff, may) } : {}),
    ...('compare' in v ? { compare: hidden(v.compare) } : {}),
    ...('current' in v ? { current: hidden(v.current) } : {}),
    ...(Array.isArray(v.stale) ? { stale: v.stale.filter(i => typeof i !== 'number' || !unread(git[i])) } : {}),
  }
}
