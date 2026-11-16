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
//     node-lead, network-member: `viewerRoles`), which are not governance roles; so for them the role's own members list
//     is asked too, and a Roles-table Role never stands for the governance role of the same name.
//   - Ruling PR7-R93: the person at the machine (request.ts `byGit`: an actor with no `via`, or `via: 'git'`) reads what
//     git holds, as in 0.6, and is told apart by the actor's `via`; a read previewed `?as=` is judged as the previewed
//     viewer, whoever asks, so View as shows what that viewer would read.
//
//   readsDeciders(path)         → whether a path is read by its deciders only (re-exported from the editors table)
//   fileReader(c, repo)         → (path) => whether the request's viewer may read that path (`all`: every path, ungated)
//   withheldOp(op)              → a file op as one who may not read its path is shown it: its path, never its text
//   diffFor(diff, may)          → a `git diff` without the files whose path `may` refuses, file by file
//   readableView(view, may)     → a proposal's view with both of those applied (its ops, diff, compare, current)

import type { Context } from 'hono'
import { readsDeciders } from '../../lib/workspace/editors.mjs'
import { MAINTAINER, effectiveRules, resolveRoles, workspaceRuleFor } from '../../lib/rules.mjs'
import { targetsOfPath } from '../../lib/workspace/targets.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import { readRuleContext } from '../governance/effective.ts'
// The request's actor and viewer are read from `c.var` (set by request.ts `withRequest`), never by importing request.ts:
// it imports the change engine, which imports this module's importers, and the cycle would leave a class undefined.
import type {} from '../request.ts'
import type { Actor } from '../actor.ts'
import type { Viewer } from '../../lib/visibility.mjs'

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

/** Whether a viewer may read a path; `all` when they read every path git holds (the person at the machine). */
export type FileReader = ((path: string) => boolean) & { all?: true }

/** A reader of paths for the request's viewer. The governance is read once, when the first gated path is asked. */
export function fileReader(c: Context, repo: string): FileReader {
  if (!gated(c)) return Object.assign(() => true, { all: true as const })
  const viewer = viewerOf(c)
  if (viewer.kind === 'public') return path => !readsDeciders(path)
  const actor = actorOf(c)
  const byEmail = actor !== null && 'via' in actor && actor.via === 'email'
  let decides: ((targets: readonly string[]) => boolean) | null = null
  const decider = (): ((targets: readonly string[]) => boolean) => {
    if (decides) return decides
    const rc = readRuleContext(repo, { unknown: '' })
    if (rc.governance === null) return (decides = () => false)
    const rules = effectiveRules(rc.governance).rules
    const book = resolveRoles(rc.governance, rc.members ?? [])
    if (book.agents.has(viewer.id) || book.organizations.has(viewer.id)) return (decides = () => false)
    decides = targets => {
      const by = workspaceRuleFor(rules, targets).decide?.by
      const role = book.roles.get(typeof by === 'string' && by !== '' ? by : MAINTAINER)
      if (!role?.defined || !viewer.roles.includes(role.id)) return false
      return !byEmail || role.members.includes(viewer.id)
    }
    return decides
  }
  return path => {
    if (!readsDeciders(path)) return true
    return decider()(targetsOfPath(path, () => null) ?? ['workspace'])
  }
}

/** A sample path a row's pattern names: `memory/**` → `memory/x`, `data/*.yaml` → `data/x.yaml`. */
export const samplePath = (pattern: string): string => pattern.replace('**', 'x').replace('*', 'x')

/** A file op as one who may not read its path is shown it (PR7-R94): the path, and `withheld`; never its text or base. A
 *  deletion keeps `text: null`, which holds nothing of the file, so the page still says the file goes. */
export function withheldOp<T extends { op: string; path?: unknown; text?: unknown }>(op: T): T {
  return { op: 'file', path: op.path, ...(op.text === null ? { text: null } : {}), withheld: true } as unknown as T
}

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

const isFileOn = (op: unknown): op is { op: 'file'; path: string } =>
  typeof op === 'object' && op !== null && (op as { op?: unknown }).op === 'file' && typeof (op as { path?: unknown }).path === 'string'

/**
 * A proposal's view (its list row, its page, the answer of an act on it) as `may` lets the viewer read it (PR7-R94): each
 * `file` op on a path they may not read keeps its path and is `withheld` (no text, no base); the `diff` loses that file's
 * sections; a `compare` or `current` at that op's position (they count the git ops) is null. Everything else is kept.
 */
export function readableView<V extends object>(view: V, may: FileReader): V {
  if (may.all) return view
  const v = view as V & { ops?: unknown; diff?: unknown; compare?: unknown; current?: unknown }
  if (!Array.isArray(v.ops)) return view
  const unread = (op: unknown) => isFileOn(op) && !may(op.path)
  if (!v.ops.some(unread) && typeof v.diff !== 'string') return view
  const git = gitOpsOf(v.ops as unknown[])
  const hidden = (list: unknown) => (Array.isArray(list) ? list.map((x, i) => (unread(git[i]) ? null : x)) : list)
  return {
    ...view,
    ops: v.ops.map(op => (unread(op) ? withheldOp(op as { op: string; path: string }) : op)),
    ...(typeof v.diff === 'string' ? { diff: diffFor(v.diff, may) } : {}),
    ...('compare' in v ? { compare: hidden(v.compare) } : {}),
    ...('current' in v ? { current: hidden(v.current) } : {}),
  }
}
