// packages/admin/server/deploy/private-flip.ts
//
// The read-back's flip beside the private store (L7 gap A, PF-R226; closes PF-R191 and PF-R221). The flip is made on
// the whole: git's records through the actor's change, the fields the store holds for them, the records it keeps
// private, and what the actor already staged there (`wholeReader`); its ops then go through `splitOps` as every write
// does (server/deploy/routes.ts). What the split cannot carry is said here: a value kept above members the flip would
// copy elsewhere (`keptOf`, read by `flipOps`), and a field the store holds that the split would write to git beneath it
// (`heldOutsideSplit`: the store's value wins on every read, so the flip would not show). Nothing here writes.
import { throughChange } from '../library/preview.ts'
import { chainHeldErrors, project } from '../changes/stage.ts'
import { registriesOf } from '../registries.ts'
import { isRecordOp } from '../workspace/files.ts'
import type { Op, RecordError, RecordOp, StageOp } from '../changes/types.ts'
import type { Entity } from '../registry.ts'
import { CHAIN_FIELDS, Levels } from '../visibility/gate.ts'
import { admits, fullLevel, gitAllows, type ParsedLevel, type Viewer, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { levelOfToken, strictPrivateReads } from '../private/reads.ts'
import type { PrivateAccess } from '../private/ops.ts'
import type { StagedPrivateOp } from '../private/ops.ts'
import type { ReadBack } from './readback.ts'
import type { DeployPlan, DeployStep } from './prepare.ts'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `entries` with the actor's staged private ops on `registry` laid over them, as the apply would leave them. */
function overlay(registry: string, entries: Entity[], staged: readonly StagedPrivateOp[]): Entity[] {
  let out = entries
  const at = (id: string) => out.findIndex(e => String(e.id) === id)
  for (const op of staged) {
    if (op.op === 'put-field' || op.op === 'delete-field') {
      const f = op.op === 'put-field' ? op.field : op
      if (f.registry !== registry) continue
      const i = at(f.record)
      if (i < 0) continue
      const next = { ...out[i]! }
      if (op.op === 'put-field') next[op.field.field] = op.field.value
      else delete next[op.field]
      out = out.map((e, j) => (j === i ? next : e))
      continue
    }
    if (op.op === 'clear-fields' || op.op === 'move-to-git' || op.collection !== registry) continue
    const i = at(op.id)
    if (op.op === 'delete-record') { if (i >= 0) out = out.filter((_, j) => j !== i); continue }
    if (op.op === 'create-record') { if (i < 0) out = [...out, { ...op.value, id: op.id }]; continue }
    if (i < 0) continue
    const next = op.op === 'replace-record' ? { ...op.value, id: op.id } : { ...out[i]!, ...op.set }
    out = out.map((e, j) => (j === i ? next : e))
  }
  return out
}

/**
 * Every registry as someone admitted to all of it would read it: git's records through `gitOps` (the actor's change),
 * each with the fields the store holds for it, then the records the store keeps private (their level left out: a body
 * as git would hold it), then the actor's staged private ops laid over. Never answered to anyone: the flip is made on
 * it (with `readable` limiting what it reads to the viewer's), and the membership tree and the lockout are judged on it.
 */
export function wholeReader(repo: string, lv: Levels, gitOps: readonly Op[], staged: readonly StagedPrivateOp[]): (registry: string) => Entity[] {
  const through = throughChange(repo, gitOps as StageOp[])
  const withFields = (registry: string, e: Entity): Entity => {
    if (e.id === undefined || e.id === null) return e
    const out: Entity = { ...e }
    for (const f of lv.priv.fields(registry, String(e.id))) if (f.field !== 'id' && f.field !== 'visibility') out[f.field] = f.value
    return out
  }
  return registry => {
    const git = through(registry).map(e => withFields(registry, e))
    const kept = lv.priv.records(registry).map(r => withFields(registry, { ...r.body, id: r.id }))
    return overlay(registry, [...git, ...kept], staged)
  }
}

/** Each error once (by record and field), in order. */
const once = (errors: RecordError[]): RecordError[] => {
  const seen = new Set<string>()
  return errors.filter(e => { const k = `${e.record}\u0000${e.field}`; if (seen.has(k)) return false; seen.add(k); return true })
}
const touchesSystems = (op: RecordOp): boolean => op.record.startsWith('systems:')

/** L7 gap B1 beside the store (after gap A; the gaps review's I-1 and M-3): the fields the chain holds of a deployed
 *  System, judged on the whole as `wholeReader` reads it, so a field the store keeps (a restricted field, a System kept
 *  private whole, its `deployment` held there while the rest is in git) is judged as one in git. `incoming`: the record
 *  ops a write brings, laid over the actor's change (`gitOps`, `staged`); each Systems record they touch is judged
 *  against the whole before the change (the trunk's) and against the whole as the change already leaves it, so a System
 *  the change's own read-back made deployed is not then hand-edited where the chain holds it (M-3). [] when none
 *  changes what the chain holds. */
export function wholeChainHeldErrors(repo: string, lv: Levels, gitOps: readonly Op[], staged: readonly StagedPrivateOp[],
  incoming: readonly RecordOp[]): RecordError[] {
  const mine = incoming.filter(touchesSystems)
  if (mine.length === 0) return []
  const withChange = wholeReader(repo, lv, gitOps, staged)
  const projected = project(withChange, mine as StageOp[], registriesOf(repo))
  const records = mine.map(op => op.record)
  return once([
    ...chainHeldErrors(repo, records, projected, wholeReader(repo, lv, [], [])),
    ...chainHeldErrors(repo, records, projected, withChange),
  ])
}

/** The Systems records a change's git ops (`gitOps`) and private ops (`staged`) touch, each once. */
export function systemsTouched(gitOps: readonly StageOp[], staged: readonly StagedPrivateOp[]): string[] {
  return [...new Set([
    ...gitOps.filter(isRecordOp).filter(touchesSystems),
    ...stagedAsOps(staged).filter(touchesSystems),
  ].map(op => op.record))]
}

/** The gaps review's I-1 (closes PF-R232's carry): Apply judges what the chain holds again, on the whole as it is when
 *  the change is applied, for every Systems record the change's git ops (`gitOps`) and private ops (`staged`) touch: a
 *  System another change made deployed since this one was staged is judged then. [] when nothing touches a System. */
export function appliedChainHeldErrors(repo: string, lv: Levels, gitOps: readonly StageOp[], staged: readonly StagedPrivateOp[]): RecordError[] {
  const records = systemsTouched(gitOps, staged)
  if (records.length === 0) return []
  const after = new Map([['systems', wholeReader(repo, lv, gitOps as Op[], staged)('systems')]])
  return once(chainHeldErrors(repo, records, after, wholeReader(repo, lv, [], [])))
}

/** The levels a System's field is read at: the policy's for it (with the System's own level, a private one's
 *  included), and the level the store holds it at, if it does. */
function levelsOf(lv: Levels): (system: string, field: string) => ParsedLevel[] {
  const kept = new Map(lv.priv.records('systems').map(r => [r.id, r]))
  return (system, field) => {
    const r = kept.get(system)
    const record = r ? { visibility: r.visibility } : lv.records('systems').find(e => isObj(e) && String(e.id) === system) ?? null
    const held = lv.priv.fields('systems', system).find(f => f.field === field)
    return [fullLevel(lv.config, 'systems', record, field), ...(held ? [levelOfToken(held.visibility)] : [])]
  }
}

/** Walk fix wave 2 (Rule 4; PF-R250): the one sentence a chain-held refusal is said in to a writer not admitted to what
 *  it rests on. Every such refusal names its record and field, and so says the System is deployed; told to someone who may
 *  not read the System's deployment status (or the field), it says neither which nor why. It still says that something
 *  this change writes is decided by what they may not read, as PART_HIDDEN says part of a composition is not theirs. */
export const CHAIN_HELD_HIDDEN = 'Part of what this change writes is decided by something kept at a level you are not admitted to, so it ' +
  'cannot be written as it stands: someone admitted to it can make this change. Nothing was written.'

/** The chain-held refusals `errors` as `viewer` is told them (PF-R250): as they are when the viewer may read, for each
 *  System they name, its deployment status and the field; otherwise CHAIN_HELD_HIDDEN alone, for all of them (a named
 *  refusal beside it would say which System the hidden one is not). */
export function shownChainHeld(lv: Levels, viewer: Viewer, errors: RecordError[]): RecordError[] {
  if (errors.length === 0) return errors
  const of = levelsOf(lv)
  const reads = (system: string, field: string) => of(system, field).every(l => admits(l, viewer))
  const hidden = errors.some(e => {
    const system = e.record.startsWith('systems:') ? e.record.slice('systems:'.length) : e.record
    const field = e.field.startsWith('deployment') ? 'deployment' : e.field
    return !reads(system, 'deployment') || (field !== '' && !reads(system, field))
  })
  return hidden ? [{ record: '', field: '', message: CHAIN_HELD_HIDDEN }] : errors
}

/** Whether a System's field is kept above members (PF-R226): the System kept private at such a level, the policy's
 *  level for the field, or the level the store holds the field at. */
export function keptOf(lv: Levels): (system: string, field: string) => boolean {
  const of = levelsOf(lv)
  return (system, field) => of(system, field).some(l => !gitAllows(l))
}

/** The chain fields of each System kept from `viewer` (PF-R226, I-4): a field whose level (the policy's, the System's own
 *  when it is kept private, the store's) does not admit them. The public is admitted to none. */
export function keptFrom(lv: Levels, viewer: Viewer): (system: string) => ReadonlySet<string> {
  const of = levelsOf(lv)
  const memo = new Map<string, ReadonlySet<string>>()
  return system => {
    let out = memo.get(system)
    if (!out) {
      out = new Set(CHAIN_FIELDS.filter(f => viewer.kind === 'public' || !of(system, f).every(l => admits(l, viewer))))
      memo.set(system, out)
    }
    return out
  }
}

/** Walk fix wave 4 (Rule 4; PF-R256): the chain fields of each System kept from `viewer` (`keptFrom`, on the policy and the
 *  store's levels, the store read strictly), for what a driver read of the chain is told through: a Resource's
 *  `facts.driver` and the attention drawn from it, the Sources page, the cached reads the from mark draws, the tree read's
 *  hat names. A viewer from whom any is kept is told no read of that System (its facts, sections and link, `composed`
 *  among them), nor the kept fields' own facts. The public is admitted to none; while the store cannot answer, or the
 *  levels cannot be read, every chain field of every System is kept from everyone. */
export function chainKept(repo: string, config: VisibilityPolicy, access: PrivateAccess, viewer: Viewer): (system: string) => ReadonlySet<string> {
  const all: ReadonlySet<string> = new Set(CHAIN_FIELDS)
  if (viewer.kind !== 'member') return () => all
  let kept: (system: string) => ReadonlySet<string>
  try { kept = keptFrom(new Levels(repo, config, undefined, strictPrivateReads(access)), viewer) } catch { return () => all }
  return system => { try { return kept(system) } catch { return all } }
}

/** The System field each of a read-back's `found` values is written to by the flip (readback.ts `flipOps`). */
const FOUND_FIELD: Record<string, string> = { address: 'address', tree: 'address', gate: 'signer_gate', top: 'deployment', space: 'space' }
const foundField = (key: string): string => (key.startsWith('hats.') ? 'hats' : FOUND_FIELD[key] ?? 'deployment')

/** `rb` as `viewer` may be told it (invisible means absent, PF-R226; the gaps review's I-4): each `found` value whose field
 *  they may not read left out, and every one of a System whose `address` they may not read (a tree's top hat and hats
 *  carry its number; a gate names its Safe on the chain); a System with any chain field kept from them says no `differs`
 *  (their sentences name owners, modules, hat ids). Its id and status stay. A viewer who reads the whole composition reads
 *  every field it holds; a field it does not hold yet (an address before the flip writes it) may still be kept by the
 *  policy at a level they are not admitted to. */
export function readBackFor(rb: ReadBack, lv: Levels, viewer: Viewer): ReadBack {
  const kept = keptFrom(lv, viewer)
  return {
    systems: rb.systems.map(x => {
      const k = kept(x.id)
      const found = Object.fromEntries(Object.entries(x.found).filter(([key]) => !k.has('address') && !k.has(foundField(key))))
      return { ...x, found, differs: k.size > 0 ? [] : x.differs }
    }),
  }
}

/** What MISMATCH says of each System that mismatches, from `shown` (readBackFor's): its `differs`, or, when they are kept
 *  from the viewer, a sentence naming nothing the chain shows. */
export function mismatchSentence(shown: ReadBack): string {
  const off = shown.systems.filter(x => x.status === 'mismatch')
  return `Not staged: ${off.map(x => `${x.id}: ${x.differs.length > 0 ? x.differs.join('; ') : 'the chain shows something other than what was composed'}`).join('. ')}.`
}

/** The hex digits of every address or hat id in `text`, lower case (an address is 40, a hat id 64). */
const hexesOf = (text: string): string[] => [...text.matchAll(/0x([0-9a-fA-F]{40,64})/g)].map(m => m[1]!.toLowerCase())

/** The plan as `viewer` may be told it (the gaps review's I-4, PF-R239). A step of a System with a chain field kept from
 *  them, or signed by a Safe whose address is kept from them, shows as a step with its status and no values: no
 *  `predicts`, prepared `step` (its call, the Safe's account and transaction), `link`, `differs` or `draft`. So does any
 *  other step whose values name one a hidden step predicts (a call minting to a hidden Safe), and a `waits` or problem
 *  naming one is left out. A viewer who may read every chain field of the composition is told the plan as it is. */
export function planFor(plan: DeployPlan, lv: Levels, viewer: Viewer): DeployPlan {
  const kept = keptFrom(lv, viewer)
  const hiddenBy = (st: DeployStep) => kept(String(st.system)).size > 0
    || (st.signer?.kind === 'safe' && kept(String(st.signer.system)).has('address'))
  const hidden = new Set<number>()
  const values = new Set<string>()
  const hide = (i: number) => {
    hidden.add(i)
    for (const p of plan.steps[i]!.predicts) for (const h of hexesOf(`${p.value} ${p.on ?? ''}`)) values.add(h)
  }
  plan.steps.forEach((st, i) => { if (hiddenBy(st)) hide(i) })
  if (hidden.size === 0) return plan
  const names = (v: unknown) => { const t = JSON.stringify(v ?? '').toLowerCase(); return [...values].some(h => t.includes(h)) }
  for (let grew = true; grew;) {
    grew = false
    plan.steps.forEach((st, i) => {
      if (hidden.has(i) || !names({ p: st.predicts, s: st.step, l: st.link, d: st.differs, r: st.draft })) return
      hide(i)
      grew = true
    })
  }
  const steps = plan.steps.map((st, i): DeployStep => {
    if (!hidden.has(i)) return names(st.waits) ? (({ waits: _w, ...rest }) => rest)(st) : st
    const { step: _s, link: _l, differs: _d, draft: _r, waits, ...rest } = st
    return { ...rest, predicts: [], ...(typeof waits === 'string' && !names(waits) && hexesOf(waits).length === 0 ? { waits } : {}) }
  })
  return { ...plan, steps, problems: plan.problems.filter(p => !names(p)) }
}

/** The actor's staged private ops as the git ops they stand for, so that `clashOf` reads them as it reads git's: a
 *  record's delta as its update, a field's value (or its removal) as an update of that field. */
export function stagedAsOps(staged: readonly StagedPrivateOp[]): RecordOp[] {
  return staged.flatMap((op): RecordOp[] => {
    if (op.op === 'put-field') return [{ op: 'update', record: `${op.field.registry}:${op.field.record}`, set: { [op.field.field]: op.field.value } }]
    if (op.op === 'delete-field') return [{ op: 'update', record: `${op.registry}:${op.record}`, set: { [op.field]: null } }]
    if (op.op === 'clear-fields' || op.op === 'move-to-git') return []
    const record = `${op.collection}:${op.id}`
    if (op.op === 'delete-record') return [{ op: 'delete', record }]
    if (op.op === 'update-record') return [{ op: 'update', record, set: op.set }]
    return [{ op: 'replace', record, value: op.value }]
  })
}

/** Whether the flip `ops` set a field the store holds for a git System that the split does not write to the store (`priv`,
 *  its private part): the split follows the policy only (L5 §10.3), so it would write the field to git while the store's
 *  value still wins on every read, and the System would read as it was. A System kept private whole takes its fields in
 *  its record, so a field row held beside it is not written either. */
export function heldOutsideSplit(lv: Levels, ops: readonly RecordOp[], priv: readonly StagedPrivateOp[]): boolean {
  const written = new Set(priv.flatMap(op => (op.op === 'put-field' ? [`${op.field.registry}:${op.field.record}/${op.field.field}`] : [])))
  return ops.some(op => {
    if (op.op !== 'update' || !op.record.startsWith('systems:')) return false
    const id = op.record.slice('systems:'.length)
    return lv.priv.fields('systems', id).some(f => Object.hasOwn(op.set, f.field) && !written.has(`systems:${id}/${f.field}`))
  })
}
