// packages/admin/server/private/guard.ts
//
// What git may hold (L5 spec §10.5, house spec §11 rule 4): nothing stricter than members, down to one field. Every git
// write passes `assertGitSafe` over the texts it is about to commit, before the commit: no record whose own `visibility`
// is stricter than members, no value of a field data/visibility.yaml restricts, no new wallet link of a member at
// `defaults.contact` (R-L5-18.7), no op of a proposal, open or closed, writing any of these (only a placeholder,
// `op: private`). The same reading as validate:data's (lib/data-validate.mjs, R-L5-10.5), so the server never commits
// what the validator would report, but for a wallet link git already held: it stays until narrowed, as an e-mail does.
// A refusal names the file, the record and the field, never the value.

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { REGISTRIES } from '../registries.ts'
import { entriesFromText } from '../registry.ts'
import { defaultLinkLevel, formatLevel, restrictedFields, WALLET_LINK, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { Refusal } from '../changes/apply.ts'

export interface GitFile { path: string; text: string }
/** One thing a text holds that git may not: the file, the record, the field (`visibility` for the record's own level),
 *  and the sentence. */
export interface GitSafetyProblem { path: string; record: string; field: string; message: string }

const COLLECTIONS = new Set(REGISTRIES.filter(r => r.kind === 'collection').map(r => r.name))
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const held = (v: unknown) => v !== undefined && v !== null
const STRICT = /^\s*(hat|role)\s*:/i
/** A record's own `visibility` that git may not hold, as validate:data reads it: a hat or role level however written. */
const tooStrict = (v: unknown): v is string => typeof v === 'string' && STRICT.test(v)
const idOf = (e: Record<string, unknown>, i: number) => (e.id === undefined || e.id === null ? `#${i + 1}` : String(e.id))
const NOTHING = 'Nothing was written.'

/** The members whose wallet link git holds now (data/members.yaml as it is on disk, before the write): theirs stays until
 *  the field is narrowed (R-L5-18.7, as e-mail does under R-L5-14.4). */
function linksHeld(repo: string): Set<string> {
  const file = join(repo, 'data', `${WALLET_LINK.registry}.yaml`)
  if (!existsSync(file)) return new Set()
  let entries: Record<string, unknown>[]
  // A file that cannot be read holds no link we can count: every link written is then a new one.
  try { entries = entriesFromText(readFileSync(file, 'utf8'), WALLET_LINK.registry) } catch { return new Set() }
  return new Set(entries.filter(e => isObj(e) && held(e[WALLET_LINK.field]) && e.id !== undefined && e.id !== null).map(e => String(e.id)))
}
const newLink = (path: string, record: string, level: string) =>
  `${path} would hold a new wallet link for ${record}, which is kept at ${level} (data/visibility.yaml's defaults.contact); it belongs in the private store`

/** What `files` hold that git may not, in their order. */
export function gitSafetyProblems(repo: string, files: readonly GitFile[], config: VisibilityPolicy): GitSafetyProblem[] {
  const out: GitSafetyProblem[] = []
  const link = defaultLinkLevel(config, WALLET_LINK.registry)
  const kept = link ? linksHeld(repo) : new Set<string>()
  for (const file of files) {
    const path = (isAbsolute(file.path) ? relative(repo, file.path) : file.path).split(sep).join('/')
    const name = /^data\/([^/]+)\.ya?ml$/.exec(path)?.[1]
    if (!name || !COLLECTIONS.has(name)) continue
    const entries = entriesFromText(file.text, name)
    if (name === 'proposals') { out.push(...ledgerProblems(path, entries, config, link ? { level: formatLevel(link), kept } : null)); continue }
    const restricted = restrictedFields(config, name)
    entries.forEach((entry, i) => {
      if (!isObj(entry)) return
      const record = idOf(entry, i)
      if (tooStrict(entry.visibility)) {
        out.push({ path, record, field: 'visibility',
          message: `${path} would hold ${record}, whose visibility is ${entry.visibility.trim()}, stricter than members; it belongs in the private store` })
      }
      for (const [field, level] of Object.entries(restricted)) {
        if (!held(entry[field])) continue
        out.push({ path, record, field,
          message: `${path} would hold the ${field} of ${record}, which data/visibility.yaml restricts to ${formatLevel(level)}; it belongs in the private store` })
      }
      if (link && name === WALLET_LINK.registry && held(entry[WALLET_LINK.field]) && !kept.has(record)) {
        out.push({ path, record, field: WALLET_LINK.field, message: newLink(path, record, formatLevel(link)) })
      }
    })
  }
  return out
}

/** A proposal's ops, open or closed, hold private data only as placeholders (§9.6, §10.5; as validate:data reads it since
 *  the Task 10 fix round), and so do the ops each of its `revise` events recorded (final review MF-2): an event's op is
 *  named by the event's id, so what an appended event adds never shifts what an earlier one holds. */
function ledgerProblems(path: string, entries: Record<string, unknown>[], config: VisibilityPolicy, link: { level: string; kept: Set<string> } | null): GitSafetyProblem[] {
  const out: GitSafetyProblem[] = []
  entries.forEach((p, i) => {
    if (!isObj(p)) return
    const proposal = idOf(p, i)
    const lists: { ops: unknown[]; of: string }[] = Array.isArray(p.ops) ? [{ ops: p.ops, of: `proposal ${proposal}` }] : []
    if (Array.isArray(p.events)) {
      p.events.forEach((e: unknown, k: number) => {
        if (isObj(e) && e.kind === 'revise' && Array.isArray(e.ops)) lists.push({ ops: e.ops, of: `revise event ${idOf(e, k)} of proposal ${proposal}` })
      })
    }
    for (const { ops, of } of lists) {
      ops.forEach((op: unknown, n: number) => {
        if (!isObj(op) || op.op === 'private' || typeof op.record !== 'string') return
        const registry = op.record.slice(0, Math.max(0, op.record.indexOf(':')))
        const written = isObj(op.set) ? op.set : isObj(op.value) ? op.value : {}
        const placeholder = 'an op on private data is held in git only as a placeholder'
        if (tooStrict(written.visibility)) {
          out.push({ path, record: proposal, field: 'visibility',
            message: `${path} would hold op ${n + 1} of ${of}, which makes ${op.record} ${written.visibility.trim()}, stricter than members; ${placeholder}` })
        }
        for (const [field, level] of Object.entries(restrictedFields(config, registry))) {
          if (!held(written[field])) continue
          out.push({ path, record: proposal, field,
            message: `${path} would hold op ${n + 1} of ${of}, which writes ${field}, restricted to ${formatLevel(level)} by data/visibility.yaml; ${placeholder}` })
        }
        const id = op.record.slice(op.record.indexOf(':') + 1)
        if (link && registry === WALLET_LINK.registry && held(written[WALLET_LINK.field]) && !link.kept.has(id)) {
          out.push({ path, record: proposal, field: WALLET_LINK.field,
            message: `${path} would hold op ${n + 1} of ${of}, which writes a new wallet link for ${op.record}, kept at ${link.level} (defaults.contact); ${placeholder}` })
        }
      })
    }
  })
  return out
}

/** A git op that writes a value of a field data/visibility.yaml restricts now: narrowed after the op was staged or
 *  proposed (R-L5-16.10). */
export interface NarrowedOp { record: string; field: string; level: string }

/** The first git op of `ops` that writes a value of a field `config` restricts beyond members, or null (placeholders and
 *  deletes write none). Apply, Propose, Update proposal and Ratify ask it first, so such an op is told what to do (409
 *  `NARROWED`) rather than refused as a bug (`assertGitSafe`'s 500). */
export function narrowedOps(ops: readonly unknown[], config: VisibilityPolicy): NarrowedOp | null {
  for (const op of ops) {
    if (!isObj(op) || op.op === 'private' || op.op === 'delete' || typeof op.record !== 'string') continue
    const at = op.record.indexOf(':')
    if (at <= 0) continue
    const written = isObj(op.set) ? op.set : isObj(op.value) ? op.value : {}
    for (const [field, level] of Object.entries(restrictedFields(config, op.record.slice(0, at)))) {
      if (Object.hasOwn(written, field) && held(written[field])) return { record: op.record, field, level: formatLevel(level) }
    }
  }
  return null
}

/** §14: what a staged op narrowed since is told, at Apply (`Not applied`), Propose (`Not proposed`), Update proposal (`Not revised`). */
export const narrowedSinceStaged = (verb: string, n: NarrowedOp) =>
  `${verb}: ${n.field} of ${n.record} was narrowed to ${n.level} after it was staged, so it cannot go to the repository. ` +
  'Discard that op from your tray and stage it again: it then goes to the private store. Nothing was written.'
/** §14: what a ratify of a proposal whose git op writes a field narrowed since it was proposed is told. */
export const narrowedSinceProposed = (id: string, n: NarrowedOp) =>
  `Not ratified: proposal ${id} writes ${n.field} of ${n.record}, which was narrowed to ${n.level} after it was proposed. ` +
  'Revise the proposal and stage that value again: it then goes to the private store. Nothing was written.'

/** Refuses (409 `NARROWED`) ops that write a field narrowed since they were staged, with what to do. */
export function refuseNarrowed(ops: readonly unknown[], config: VisibilityPolicy, verb: string): void {
  const n = narrowedOps(ops, config)
  if (n) throw new Refusal(409, { code: 'NARROWED', error: narrowedSinceStaged(verb, n) })
}

/** One problem as `newProblems` compares them: its path, record, field and sentence. */
const problemKey = (p: GitSafetyProblem) => JSON.stringify([p.path, p.record, p.field, p.message])

/**
 * Throws, before any commit, when `files` (paths relative to `repo`, or absolute under it, with the texts about to be
 * committed) hold anything stricter than members: a `Refusal` 500 `{ error, code: 'RESTRICTED_IN_GIT', problems }`
 * naming the path, the record and the field of each, never a value. A server that reaches it has a bug upstream (the
 * split, a narrowing) or a file edited by hand. With `before`, a problem those texts already hold is not refused.
 */
export function assertGitSafe(repo: string, files: readonly GitFile[], config: VisibilityPolicy, before?: readonly GitFile[]): void {
  // With `before` (the same files as they are now), only what the write adds is refused, as ratify and close judge only the
  // problems they add (`newProblems`): re-committing a value already in git protects nothing (R-L5-15.10).
  const known = new Set(before ? gitSafetyProblems(repo, before, config).map(problemKey) : [])
  const problems = gitSafetyProblems(repo, files, config).filter(p => !known.has(problemKey(p)))
  if (problems.length === 0) return
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''
  throw new Refusal(500, {
    code: 'RESTRICTED_IN_GIT',
    problems: problems.map(({ path, record, field }) => ({ path, record, field })),
    error: `Not saved: ${problems[0]!.message}${more}, and git holds nothing stricter than members. ${NOTHING}`,
  })
}
