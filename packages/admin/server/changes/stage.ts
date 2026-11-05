import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readRegistry, parseForWrite, type Entity } from '../registry.ts'
import { registryDef } from '../registries.ts'
import { validateEntity, referrers, type Overlay, type Referrer } from '../schema.ts'
import { addressability } from '../../lib/data-validate.mjs'
import { classOf, widens } from '../../lib/change-classes.mjs'
import { readConfig } from '../visibility/config.ts'
import { receiptProblems, judgedOps } from '../../lib/receipts.mjs'
import { readGovernance } from '../../lib/governance-read.mjs'
import { effectiveRules, nobodyCanPropose, resolveRoles } from '../../lib/rules.mjs'
import { actorTrailer, type Actor } from '../actor.ts'
import { effectiveRule, readRuleContext } from '../governance/effective.ts'
import { deriveChangeState } from '../../lib/machines/change.mjs'
import { mergeOp, isStale } from './merge.ts'
import { StageError, parseRecord, recordId, projectOp, notDeleted } from './records.ts'
import type { Change, ChangeView, Op, PrivateEntry, PrivatePlaceholder, RecordError, StageOp } from './types.ts'

/** Whether an entry's id is `id`, as strings (F1's reading: an id of 42 is addressable as "42"). */
export const named = (e: Entity, id: string): boolean => e.id !== undefined && e.id !== null && String(e.id) === id

/** A registry's entries as the file holds them now; [] when there is no file. With `strict`, a file
 *  with YAML errors is refused (409, the writes' own sentence) rather than read in part. */
export function currentEntries(repo: string, registry: string, strict = false): Entity[] {
  const path = join(repo, 'data', `${registry}.yaml`)
  if (!existsSync(path)) return []
  if (strict) parseForWrite(readFileSync(path, 'utf8'), registry, 'saved')
  return readRegistry(repo, registry).entries ?? []
}

/** Reads each registry at most once for one request. */
function reader(repo: string, strict = false) {
  const seen = new Map<string, Entity[]>()
  const entries = (registry: string): Entity[] => {
    let e = seen.get(registry)
    if (!e) { e = currentEntries(repo, registry, strict); seen.set(registry, e) }
    return e
  }
  const current = (record: string): Entity | null => {
    const { registry, id } = parseRecord(record)
    return entries(registry).find(e => named(e, id)) ?? null
  }
  return { entries, current }
}

export const currentOf = (repo: string, record: string): Entity | null => reader(repo).current(record)

/** Every registry the ops touch, as the ops would leave it. */
export function project(entriesOf: (registry: string) => Entity[], ops: StageOp[]): Map<string, Entity[]> {
  const out = new Map<string, Entity[]>()
  for (const op of ops) {
    const { registry } = parseRecord(op.record)
    if (!out.has(registry)) out.set(registry, entriesOf(registry).map(e => ({ ...e })))
  }
  for (const op of ops) projectOp(out, op)
  return out
}

/** Field errors of every entry the ops write: a create's or replace's value as sent, an update's
 *  entry as it would be. References are read through `projected`, the change's own state. */
export function entryErrors(repo: string, ops: StageOp[], projected: Map<string, Entity[]>): RecordError[] {
  const overlay: Overlay = registry => projected.get(registry)
  const errors: RecordError[] = []
  for (const op of ops) {
    if (op.op === 'delete') continue
    const { registry, id } = parseRecord(op.record)
    const entry = op.op === 'update' ? projected.get(registry)?.find(e => named(e, id)) : op.value
    if (!entry) continue
    for (const e of validateEntity(repo, registry, entry, overlay).errors) {
      errors.push({ record: op.record, field: e.field, message: e.message })
    }
  }
  return errors
}

/** The entries that would still name a deleted record, read through `projected`. */
export function deleteRefs(repo: string, op: StageOp, projected: Map<string, Entity[]>): Referrer[] {
  const { registry, id } = parseRecord(op.record)
  return referrers(repo, registry, id, r => projected.get(r))
}

/** Ops that cannot say which entry they mean: no id after the colon, an entry the lists show as
 *  `#<position>` because it has no id, or an id more than one entry in its file uses (the
 *  interfaces file, "Entries the platform can't address"). The id rules are lib's `addressability`. */
export function idErrors(ops: StageOp[], entriesOf: (registry: string) => Entity[]): RecordError[] {
  const errors: RecordError[] = []
  for (const op of ops) {
    let registry: string; let id: string
    try { ({ registry, id } = recordId(op.record)) } catch (err) {
      if (!(err instanceof StageError)) throw err
      errors.push({ record: op.record, field: err.field, message: err.message })
      continue
    }
    const { noId, shared } = addressability(entriesOf(registry))
    const position = /^#(\d+)$/.exec(id)
    if (position && noId.includes(Number(position[1]) - 1)) {
      errors.push({ record: op.record, field: 'id', message: `entry ${id} in \`data/${registry}.yaml\` has no id, so it cannot be changed here; give it one in the file.` })
      continue
    }
    const n = shared.get(id)
    if (n) errors.push({ record: op.record, field: 'id', message: `id \`${id}\` appears ${n} times in \`data/${registry}.yaml\`; fix it in the file.` })
  }
  return errors
}

/** What is said when a change reaches for a ledger registry (`proposals`). */
export const LEDGER_SENTENCE = (registry: string): string =>
  `${registry} are changed by their own routes (Propose, and the buttons on a proposal), not by staging a change here; a hand edit of data/${registry}.yaml is caught by validate:governance.`

/** An op aimed at a ledger registry is refused: the ledger is written only by the proposal routes (spec §3.1).
 *  A record that names no registry is left for the checks that say so. */
export function ledgerErrors(ops: StageOp[]): RecordError[] {
  return ops.flatMap((op): RecordError[] => {
    let registry: string
    try { registry = parseRecord(op.record).registry } catch (err) { if (err instanceof StageError) return []; throw err }
    return registryDef(registry).ledger ? [{ record: op.record, field: '', message: LEDGER_SENTENCE(registry) }] : []
  })
}

/** F1's change classes of the ops the change is judged by, each once, in the order first met. A library receipt rides
 *  along (L1-C5, `judgedOps`): its class counts only in a change that holds nothing else. Stage, the tray's view,
 *  Apply's precheck, Propose and Revise all read the classes here. With `repo` (L5 §9.7), an op that widens what it
 *  writes (`widens`: a record made more public, a wallet link put in git) adds `publication` beside its registry's class;
 *  the record it is judged against is the one it was staged against (`before`), else the one git holds now. */
export function classesOf(ops: StageOp[], repo?: string): string[] {
  const judged = judgedOps(ops)
  const classes = judged.map(op => String(classOf({ registry: parseRecord(op.record).registry })))
  if (repo !== undefined && judged.some(op => widens(op, beforeOf(repo, op), readConfig(repo)))) classes.push('publication')
  return [...new Set(classes)]
}

/** The record an op was staged against (`Op.before`), else the one git holds now (an op that carries none). */
export function beforeOf(repo: string, op: StageOp): Record<string, unknown> | null {
  const before = (op as Partial<Op>).before
  if (before !== undefined) return before
  try { return currentOf(repo, op.record) } catch { return null }
}

/** A change's classes: its git ops' (`classesOf`), then those of its private part (L5 §10.3: the rule judged is the class
 *  of the registry or private collection, as for git), each once. With `repo`, a widening op adds `publication` (§9.7). */
export function changeClasses(change: Pick<Change, 'ops' | 'private'> | null, repo?: string): string[] {
  const priv = change?.private ?? []
  return [...new Set([...classesOf(change?.ops ?? [], repo), ...priv.map(p => p.class), ...(priv.some(p => p.publication) ? ['publication'] : [])])]
}

/** The registries whose entries decide who can propose under the written rules (L5 spec §7.6): the members, and the
 *  systems that name the membership tree a wallet is judged by. */
const WHO_CAN_PROPOSE = ['members', 'systems']

/**
 * L5 spec §7.6 and §8.1 point 4 (F-L3-1): no change leaves a written rule with nobody able to propose under it.
 * data/governance.yaml is never staged (a document registry), so what can lock an org out here is a change to the
 * members or the systems the rules are judged with. Each §7.6 sentence the change's state gives and the state before it
 * did not is refused, on the first op that touches those registries: an org already locked out is not refused again
 * for what the change did not bring.
 */
export function lockoutErrors(repo: string, ops: StageOp[], projected: Map<string, Entity[]>,
  before: (registry: string) => Entity[]): RecordError[] {
  const touching = ops.find(op => WHO_CAN_PROPOSE.includes(parseRecord(op.record).registry))
  if (!touching) return []
  const path = join(repo, 'data', 'governance.yaml')
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return [] }
  const governance = readGovernance(text).governance as Record<string, unknown> | null
  if (!governance) return []
  const { rules, implied } = effectiveRules(governance)
  if (implied) return []
  const said = (members: Entity[], systems: Entity[] | null) => {
    const book = resolveRoles(governance, members)
    return new Set(rules.map(rule => nobodyCanPropose(rule, book, members, governance, systems)).filter((m): m is string => m !== null))
  }
  // A systems file that cannot be read is "no tree known" here: its own checks say what is wrong with it.
  let systems: Entity[] | null
  try { systems = before('systems') } catch { systems = null }
  const was = said(before('members'), systems)
  const now = said(projected.get('members') ?? before('members'), projected.get('systems') ?? systems)
  return [...now].filter(m => !was.has(m)).map(message => ({ record: touching.record, field: '', message }))
}

/** The change as a whole, judged against the state it leaves. Every op in `records` (default: all)
 *  has its written entry validated; and every record in `records` that no longer exists in that
 *  state (deleted, or a create folded away) must not be named by any entry still there. With the
 *  default, the references of every remaining op are checked, which is how removing an op that
 *  others depend on is refused. A library receipt keeps its add or its removal whole, judged over
 *  every op whatever `records` holds (lib/receipts.mjs): stage, unstage, Propose, Revise and
 *  Apply's backstop all see it. `entriesOf` is the current-file reader (default: lenient). A receipt is judged
 *  against the files before the change: `before`, when `entriesOf` reads them as the change leaves them (Apply's
 *  backstop), else `entriesOf`. */
export function validateChange(repo: string, ops: StageOp[], records?: Iterable<string>,
  entriesOf: (registry: string) => Entity[] = r => currentEntries(repo, r),
  before: (registry: string) => Entity[] = entriesOf): RecordError[] {
  const touched = new Set(records ?? ops.map(o => o.record))
  const projected = project(entriesOf, ops)
  const errors = entryErrors(repo, ops.filter(o => touched.has(o.record)), projected)
  for (const record of touched) {
    const { registry, id } = parseRecord(record)
    if ((projected.get(registry) ?? entriesOf(registry)).some(e => named(e, id))) continue
    const refs = deleteRefs(repo, { op: 'delete', record }, projected)
    if (refs.length > 0) errors.push({ record, field: '', message: notDeleted(registry, id, refs) })
  }
  errors.push(...receiptProblems(ops, before))
  errors.push(...lockoutErrors(repo, ops, projected, before))
  return errors
}

/** `incoming` folded into `ops`, then every op it touched validated against the state the whole
 *  change leaves. When anything is refused, `ops` comes back as it was. A registry file with YAML
 *  errors throws the writes' own 409. */
export function stage(repo: string, ops: Op[], incoming: StageOp[]): { ops: Op[]; errors: RecordError[] } {
  const ledgered = ledgerErrors(incoming)
  if (ledgered.length > 0) return { ops, errors: ledgered }
  const read = reader(repo, true)
  const ambiguous = idErrors(incoming, read.entries)
  if (ambiguous.length > 0) return { ops, errors: ambiguous }
  let next = ops
  const errors: RecordError[] = []
  const touched = new Set<string>()
  for (const op of incoming) {
    try {
      next = mergeOp(next, op, read.current(op.record))
      touched.add(op.record)
    } catch (err) {
      if (!(err instanceof StageError)) throw err
      errors.push({ record: op.record, field: err.field, message: err.message })
    }
  }
  if (errors.length === 0) errors.push(...validateChange(repo, next, touched, read.entries))
  return errors.length > 0 ? { ops, errors } : { ops: next, errors }
}

/** The positions of the ops whose record changed since they were staged. */
export function staleOps(repo: string, ops: Op[]): number[] {
  const read = reader(repo)
  return ops.flatMap((op, i) => (isStale(op, read.current(op.record)) ? [i] : []))
}

/** What GET /api/changes answers: the change, its classes, the rule for this actor, which ops are
 *  stale, and each op's record as it is now. Its private part (L5 §10.3) is listed in `private`, each op as the person
 *  who staged it wrote it when `privateOf` can read it from the store (the change file holds placeholders only). */
export function changeView(repo: string, actor: Actor, change: Change | null,
  privateOf: (p: PrivatePlaceholder) => PrivateEntry['op']): ChangeView {
  const read = reader(repo)
  const ops = change?.ops ?? []
  const placeholders = change?.private ?? []
  const current = ops.map(op => read.current(op.record))
  const classes = changeClasses(change, repo)
  const stale = ops.flatMap((op, i) => (isStale(op, current[i] ?? null) ? [i] : []))
  return {
    id: change?.id ?? '',
    actor: actorTrailer(actor),
    created: change?.created ?? '',
    updated: change?.updated ?? '',
    ops,
    classes,
    rule: effectiveRule(readRuleContext(repo, actor), classes),
    stale,
    current,
    state: deriveChangeState({ ops: [...ops, ...placeholders], stale }),
    ...(placeholders.length > 0 ? { private: placeholders.map(p => ({ ref: p.ref, class: p.class, op: privateOf(p) })) } : {}),
    ...(change?.revises !== undefined && ops.length + placeholders.length > 0 ? { revises: change.revises } : {}),
  }
}
