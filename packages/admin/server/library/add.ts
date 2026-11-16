import { RECEIPTS, receiptIdFor } from '../../lib/receipts.mjs'
import { compositionOf, compositionProblems, withAccountsOnChain } from '../../lib/compose.mjs'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import { baseOf } from '../changes/canonical.ts'
import { currentEntries, currentOf, project } from '../changes/stage.ts'
import { parseRecord } from '../changes/records.ts'
import type { RecordError, RecordOp as StageOp } from '../changes/types.ts'
import type { Entity } from '../registry.ts'
import { resolveInstalls } from './config.ts'
import { cannotAdd, mergedGovernance, takenRefusal } from './preview.ts'
import { receiptEntries } from './remove.ts'
import type { LibraryEntry } from './types.ts'

/** An id an add may write: what the entry schema's record pattern allows once its placeholders are filled. */
const RECORD_ID = /^[a-z0-9][a-z0-9-]*$/

/** The receipt ids already used: those in data/library.yaml (installed or removed) and those the actor's change stages. */
function receiptIds(repo: string, staged: StageOp[]): Set<string> {
  const ids = receiptEntries(repo).map(e => String(e.id))
  const prefix = `${RECEIPTS}:`
  for (const op of staged) if (op.record.startsWith(prefix)) ids.push(op.record.slice(prefix.length))
  return new Set(ids)
}

/** The org's registries as the actor's change and then `ops` would leave them. */
function through(repo: string, ops: StageOp[]): (registry: string) => Entity[] {
  const projected = ops.length > 0 ? project(r => currentEntries(repo, r, true), ops) : new Map<string, Entity[]>()
  return registry => projected.get(registry) ?? currentEntries(repo, registry, true)
}

/** The composition the add leaves, checked as a whole (L7 §6), every field: one error per problem of a System the add
 *  creates, the record and field named. A canvas edit is checked on the fields it holds (stage's own check); an add
 *  writes the whole of what it creates, so it is checked whole. */
function addCompositionErrors(repo: string, staged: StageOp[], ops: StageOp[]): RecordError[] {
  const made = new Set(ops.filter(op => op.op === 'create' && op.record.startsWith('systems:')).map(op => parseRecord(op.record).id))
  if (made.size === 0) return []
  const composition = compositionOf(through(repo, [...staged, ...ops])('systems'))
  if (!composition) return []
  return compositionProblems(composition).filter(p => made.has(p.system))
    .map(p => ({ record: `systems:${p.system}`, field: p.field, message: p.message }))
}

/** The next free value of an entry's config `id` when its records are named from it (`<id>-safe`, `<id>-roles`, walk
 *  I12): `<id>-2`, `-3`… (from the id without a trailing number), the first under which no record the add creates is
 *  taken through the actor's change. `fallback` (the taken record's own next id) when the entry has no config id, its
 *  records are not named from it, or nothing free is found in a few tries. */
function nextFreeConfigId(repo: string, entry: LibraryEntry, config: unknown, staged: StageOp[], fallback: string): string {
  const props = entry.config?.properties ?? {}
  if (!Object.hasOwn(props, 'id')) return fallback
  const given = config !== null && typeof config === 'object' ? (config as Record<string, unknown>).id : undefined
  const id = typeof given === 'string' ? given : typeof props.id?.default === 'string' ? props.id.default : ''
  const base = id.replace(/-\d+$/, '')
  if (!RECORD_ID.test(base)) return fallback
  for (let n = 2; n < 50; n++) {
    const candidate = `${base}-${n}`
    const { ops, errors } = resolveInstalls(entry, { ...(config as Record<string, unknown>), id: candidate })
    if (errors.length > 0 || !ops.some(op => op.op === 'create' && op.record.includes(candidate))) return fallback
    if (takenRefusal(repo, ops, staged) === null) return candidate
  }
  return fallback
}

/** The ops an add stages: the entry's resolved creates and updates, in its order (a rule set's rules merged into the
 *  org's, L7 §5.3), then its receipt (by/at/decision, every `created[].base` and `modified[].after` null; the seal fills
 *  them where the change is applied or proposed). `modified[].base` is the record's hash as the org has it now, the
 *  engine's base (L7-D11). Everything else is read through `staged`, the actor's own change. Throws Refusal 409
 *  { code: 'NOT_ADDABLE', error } with cannotAdd's sentence, Refusal 409 { code: 'TAKEN', error, nextFreeId } for an
 *  id that is taken, or StageRefusal (422 { errors }) for config and for a composition with problems. `receipt` is the
 *  receipt's id. */
export function addOps(repo: string, entry: LibraryEntry, config: unknown, staged: StageOp[]): { ops: StageOp[]; receipt: string } {
  const blocked = cannotAdd(repo, entry, staged)
  if (blocked !== null) {
    // cannotAdd's last reason is a taken id the person cannot change; it is answered as TAKEN, with the next free id.
    const taken = takenRefusal(repo, resolveInstalls(entry, {}, { lenient: true }).ops, staged)
    if (taken && taken.sentence === blocked) throw new Refusal(409, { code: 'TAKEN', error: taken.sentence, nextFreeId: taken.nextFreeId })
    throw new Refusal(409, { code: 'NOT_ADDABLE', error: blocked })
  }
  const { ops: resolved, errors } = resolveInstalls(entry, config)
  if (errors.length > 0) throw new StageRefusal(errors)
  // An id may be made of placeholders (`${config.id}-safe`): the id they make must be one the engine can address.
  const badIds = resolved.flatMap((op): RecordError[] => {
    const id = op.record.slice(op.record.indexOf(':') + 1)
    return RECORD_ID.test(id) ? [] : [{ record: entry.id, field: 'config', message: `${op.record} is not a record this entry can add: an id is lowercase letters, digits and hyphens, starting with a letter or a digit.` }]
  })
  if (badIds.length > 0) throw new StageRefusal(badIds)
  // An id the person chose (or left at its default) that is taken.
  const taken = takenRefusal(repo, resolved, staged)
  if (taken) throw new Refusal(409, { code: 'TAKEN', error: taken.sentence, nextFreeId: nextFreeConfigId(repo, entry, config, staged, taken.nextFreeId) })

  // cannotAdd has refused every op but create and update.
  const entriesOf = through(repo, staged)
  const ops: StageOp[] = resolved.map((op): StageOp => {
    // A composed System's owners and wearers are written CAIP-10 on its chain, checksummed (spec §4.1; PF-R152's carry).
    if (op.op === 'create') return { op: 'create', record: op.record, value: op.record.startsWith('systems:') ? withAccountsOnChain(op.value ?? {}) : op.value ?? {} }
    const merged = mergedGovernance(repo, op, entriesOf)
    if (merged.refusal) throw new Refusal(409, { code: 'NOT_ADDABLE', error: merged.refusal })
    return { op: 'update', record: op.record, set: merged.op.set ?? {} }
  })
  const composed = addCompositionErrors(repo, staged, ops)
  if (composed.length > 0) throw new StageRefusal(composed)

  const id = receiptIdFor(entry.id, receiptIds(repo, staged))
  const modified = ops.filter(op => op.op === 'update').map(op => ({ record: op.record, base: baseOf(currentOf(repo, op.record)), after: null }))
  const receipt: StageOp = {
    op: 'create',
    record: `${RECEIPTS}:${id}`,
    value: {
      id, entry: entry.id, version: entry.version, shelf: entry.source,
      created: ops.filter(op => op.op === 'create').map(op => ({ record: op.record, base: null })),
      ...(modified.length > 0 ? { modified } : {}),
      status: 'installed', by: null, at: null, decision: null, removed: null,
    },
  }
  return { ops: [...ops, receipt], receipt: id }
}
