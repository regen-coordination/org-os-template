// DAO-OS L7 §6 (ruling P8): a change that touches a composed System is checked as the composition it leaves, before it
// stages. Only what the records state is judged: a composition the canvas has not finished (a Safe with no owners yet,
// a hat with no max_supply, a System with no chain) is incomplete, not wrong, and GET /api/deploy says so later. A
// problem the composition already had before the change is not refused again.
import { compositionOf, compositionProblems, isComposed } from '../../lib/compose.mjs'
import { parseRecord, StageError } from './records.ts'
import type { RecordError, RecordOp } from './types.ts'
import type { Entity } from '../registry.ts'

type Problem = { system: string; field: string; message: string }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const stated = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

/** Whether the fields a problem is about are stated in the System's record, so the problem is a wrong value and not a
 *  missing one: a threshold is judged once there are owners; a hat's wearers once it has a max_supply; a chain, a
 *  network or a space once written. */
function judged(system: Entity | undefined, p: Problem): boolean {
  if (!system) return false
  const d = isObject(system.deployment) ? system.deployment : {}
  if (p.field === 'chain') return stated(system.chain)
  if (p.field === 'deployment.network') return stated(d.network) || stated(system.chain)
  if (p.field === 'space') return stated(system.space)
  if (p.field === 'deployment.threshold') return stated(d.threshold) && Array.isArray(d.owners) && d.owners.length > 0
  const wearers = /^hats\.(.+)\.wearers$/.exec(p.field)
  if (wearers) {
    const hat = (Array.isArray(system.hats) ? system.hats : []).find(h => isObject(h) && h.key === wearers[1])
    return isObject(hat) && stated(hat.max_supply)
  }
  return true
}

const key = (p: Problem) => `${p.system}\u0000${p.field}\u0000${p.message}`

/** The composition problems a change brings: computed when one of `ops` writes a `systems` record that is composed
 *  before or after it, over the Systems as `projected` holds them, less those the Systems had `before` the change and
 *  those about a field the record does not state yet. One RecordError each, on `systems:<id>`. */
export function compositionErrors(ops: RecordOp[], projected: Map<string, Entity[]>, before: (registry: string) => Entity[]): RecordError[] {
  const touched = ops.flatMap(op => {
    try { const at = parseRecord(op.record); return at.registry === 'systems' ? [at.id] : [] } catch (err) { if (err instanceof StageError) return []; throw err }
  })
  if (touched.length === 0) return []
  let was: Entity[]
  try { was = before('systems') } catch { return [] } // an unreadable systems file is its own check's to say
  const now = projected.get('systems') ?? was
  const composedId = (list: Entity[], id: string) => list.some(s => String(s.id) === id && isComposed(s))
  if (!touched.some(id => composedId(was, id) || composedId(now, id))) return []
  const after = compositionOf(now)
  if (!after) return []
  const prior = compositionOf(was)
  const had = new Set(prior ? compositionProblems(prior).map(key) : [])
  return compositionProblems(after)
    .filter(p => !had.has(key(p)) && judged(now.find(s => String(s.id) === p.system), p))
    .map(p => ({ record: `systems:${p.system}`, field: p.field, message: p.message }))
}
