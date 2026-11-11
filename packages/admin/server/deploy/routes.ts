// packages/admin/server/deploy/routes.ts
//
// The deploy routes (DAO-OS L7 spec §8, §9). GET /api/deploy answers the plan of the committed composition, every ready
// step prepared for its signer (prepare.ts); it writes nothing, takes no lock and never sends. POST /api/deploy/read-back
// reads the chain again and stages what it finds deployed as live Systems in the actor's change (readback.ts), judged by
// the org's rules like any change: never applied here. Invisible means absent (PF-R172, PF-R184): both are made from
// the Systems the viewer may read, as /compose draws them, and a composition the viewer may not read at all answers as
// nothing composed. A composition the viewer may read only part of is neither planned nor read back (fix wave I1, PF-R184): 409
// PART_HIDDEN, in a sentence naming nothing hidden, before the chain is read; someone who may read all of it does it.
// The flip goes through the split every write goes through (L7 gap A, PF-R226): what the policy restricts or the private
// store keeps is staged in the store, never in git, and the change is applied with one Apply as any other.
import type { Context, Hono } from 'hono'
import { isKnown } from '../actor.ts'
import { knownActorOf, readerOf, viewerOf } from '../request.ts'
import { HttpError } from '../errors.ts'
import { ChangeStore, newChangeId } from '../changes/store.ts'
import { changeView, currentEntries, project, stage, validateChange } from '../changes/stage.ts'
import type { Change, RecordOp as StageOp } from '../changes/types.ts'
import { StageError } from '../changes/records.ts'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import { changePrivateTargets } from '../private/targets.ts'
import { registriesOf } from '../registries.ts'
import { gateRegistryEntries, Levels } from '../visibility/gate.ts'
import { noStore, reach, refuseHeldByMove, splitOps, stagedPrivate, stagedView, stagePrivate, unavailable, type PrivateAccess, type StagedPrivateOp } from '../private/ops.ts'
import { privateReads, strictPrivateReads } from '../private/reads.ts'
import { compositionOf, type Composition } from '../../lib/compose.mjs'
import type { PseudoDriver, SystemReader } from '../systems/reader.ts'
import { DEPLOY_DRIVER, NOTHING_COMPOSED, STAGED_ONLY, daoUriOf, deployHooks, isRefusal, prepareDeployment, readDeployment, type DeployRefusal } from './prepare.ts'
import { FlipRefusal, KeptRefusal, clashOf, flip, readBack, type Ran } from './readback.ts'
import { heldOutsideSplit, keptOf, mismatchSentence, planFor, readBackFor, stagedAsOps, wholeReader } from './private-flip.ts'

export interface DeployRoutesDeps {
  repo: string
  /** The one System reader (serve.ts): the deploy reads go through its pacing and its network. */
  systems: SystemReader
  /** The repository's one write lock (app.ts), for the read-back's stage into the actor's change. */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Told after the read-back changes the actor's change. */
  notify: (msg: { type: 'changes' }) => void
  /** The private store, through which a member reads the Systems kept private (L5 §10). Absent: none. */
  privateStore?: PrivateAccess
  /** The pseudo-driver the deploy reads run as. Absent: DEPLOY_DRIVER (tests run it unpaced). */
  driver?: PseudoDriver
  /** The read-back's clock (its `read_back` date). Absent: the wall clock. */
  now?: () => Date
}

const RAN = 'The body must be {} or {"ran": [{"step", "system"?, "predicts": [{"kind", "value"}]}]}: the steps run, with what each was prepared to predict.'
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The `ran` of POST /api/deploy/read-back (L7 ruling P2); an empty body runs nothing. Anything else is a 400. */
function readRan(text: string): Ran[] {
  if (text.trim() === '') return []
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new HttpError(400, RAN) }
  if (!isObj(body)) throw new HttpError(400, RAN)
  if (body.ran === undefined) return []
  const ok = Array.isArray(body.ran) && body.ran.every(r => isObj(r) && typeof r.step === 'string' && (r.system === undefined || typeof r.system === 'string')
    && Array.isArray(r.predicts) && r.predicts.every(p => isObj(p) && typeof p.kind === 'string' && typeof p.value === 'string'))
  if (!ok) throw new HttpError(400, RAN)
  return (body.ran as Record<string, unknown>[]).map(r => ({
    step: r.step as string, ...(typeof r.system === 'string' ? { system: r.system } : {}),
    predicts: (r.predicts as { kind: string; value: string }[]).map(p => ({ kind: p.kind, value: p.value })),
  }))
}

const STATUS: Record<DeployRefusal['code'], 409 | 502> = { NOTHING_COMPOSED: 409, STAGED_ONLY: 409, PART_HIDDEN: 409, READ_FAILED: 502 }

export const PART_HIDDEN = 'Part of this composition is not yours to read: someone who can read all of it reads it back.'
export const PART_HIDDEN_PLAN = 'Part of this composition is not yours to read: someone who can read all of it prepares it.'
/** What the split cannot carry (L7 gap A, PF-R226), said naming no field or System. A value kept above members that the
 *  flip would copy into what git holds: a governance placeholder read from a kept hat or address, a tree's `roles`
 *  keyed by hats kept above members while its roles are not. */
export const KEPT_PRIVATE = 'This read-back would copy a value kept outside the repository into what the repository holds, and the repository keeps nothing stricter than members. Nothing was staged.'
/** A field of a composition System the store holds with no level in data/visibility.yaml, which the flip writes: the
 *  split would write it to git while the store's value still wins on every read (PF-R226). */
export const KEPT_PRIVATE_FIELD = 'Part of a System of this composition is held outside the repository with no level in data/visibility.yaml, so its read-back has nowhere to be written: give it its level there first. Nothing was staged.'
/** The flip writes a field the policy keeps at a level the actor is not admitted to (the split's write rule, L5 §10.3):
 *  said naming no field (PF-R226). */
export const NOT_ADMITTED_FLIP = 'Part of what this read-back writes is kept at a level you are not admitted to, so you cannot write it: someone admitted to it reads it back. Nothing was staged.'
const CHANGE_EDITS = (record: string) => `Your changes already edit ${record}: apply, propose or discard them, then read back.`

/** Every System of `c` by id: its Safes, trees, spaces, registrations and links, the deployed Systems they name included. */
const idsOf = (c: Composition): string[] => [...c.safes, ...c.trees, ...c.spaces, ...c.registrations].map(x => x.id).concat(c.links).sort()

/** The committed Systems as someone admitted to all of them reads them: git's, with the fields the private store keeps
 *  for them, and those kept private (L5 §10). Read only to say whether the viewer's are all of them; never answered. */
function wholeSystems(lv: Levels): Record<string, unknown>[] {
  const withFields = (record: Record<string, unknown>, id: string) => {
    const out = { ...record }
    for (const f of lv.priv.fields('systems', id)) if (f.field !== 'id' && f.field !== 'visibility') out[f.field] = f.value
    return out
  }
  const git = lv.records('systems').filter(isObj).map(e => withFields(e, String(e.id)))
  return [...git, ...lv.priv.records('systems').map(r => withFields({ ...r.body, id: r.id }, r.id))]
}

/** Whether the viewer, who reads `visible`, reads every System of the whole composition, each with none of its fields
 *  withheld (fix wave I1 (a)). */
function readsWhole(visible: Record<string, unknown>[], lv: Levels): boolean {
  const whole = compositionOf(wholeSystems(lv))
  const mine = compositionOf(visible)
  if (!whole || !mine) return !whole && !mine
  const all = idsOf(whole)
  if (all.join('\n') !== idsOf(mine).join('\n')) return false
  return all.every(id => { const r = visible.find(x => String(x.id) === id); return !!r && r.restricted === undefined })
}

export function mountDeploy(app: Hono, { repo, systems, withLock, notify, privateStore = noStore, driver = DEPLOY_DRIVER, now = () => new Date() }: DeployRoutesDeps): void {
  const changes = new ChangeStore(repo)
  const levels = () => new Levels(repo, undefined, undefined, privateReads(privateStore))
  /** The levels the judgments read (the walk review's G2 c, N1): whether the viewer reads the whole composition, the whole
   *  the flip is made on, what is kept from them. A store configured but down is its 503 here, never read as holding
   *  nothing, so neither a plan nor a read-back is made of git's part alone. */
  const judging = () => new Levels(repo, undefined, undefined, strictPrivateReads(privateStore))

  /** The committed Systems the viewer may read, as `lv` reads them. */
  const visible = (c: Context, lv: Levels = levels()): Record<string, unknown>[] => gateRegistryEntries(viewerOf(c), 'systems', lv)

  /** With nothing the viewer may read composed on the trunk: STAGED_ONLY when the actor's own change composes (as the
   *  viewer may read it), else NOTHING_COMPOSED. */
  const whyNone = (c: Context): DeployRefusal => {
    const actor = readerOf(c)
    const change = isKnown(actor) ? changes.load(actor.id) : null
    if (change && change.ops.length > 0) {
      let staged: Record<string, unknown>[] | undefined
      try { staged = project(r => currentEntries(repo, r), change.ops, registriesOf(repo)).get('systems') } catch { staged = undefined }
      if (staged && compositionOf(gateRegistryEntries(viewerOf(c), 'systems', levels(), staged))) return { code: 'STAGED_ONLY', error: STAGED_ONLY }
    }
    return { code: 'NOTHING_COMPOSED', error: NOTHING_COMPOSED }
  }

  app.get('/api/deploy', async c => {
    const records = visible(c)
    if (!compositionOf(records)) {
      const none = whyNone(c)
      return c.json(none, STATUS[none.code])
    }
    const lv = judging()
    if (!readsWhole(records, lv)) return c.json({ code: 'PART_HIDDEN', error: PART_HIDDEN_PLAN }, 409)
    const plan = await prepareDeployment(repo, systems, { records, driver })
    if (isRefusal(plan)) return c.json(plan, STATUS[plan.code])
    // What the viewer may be told of it: a step's values for a field kept from them are left out (the gaps review's I-4).
    return c.json(planFor(plan, lv, viewerOf(c)))
  })

  // Spec §9: 200 { readBack, staged } (staged [] when the chain shows nothing new); 409 MISMATCH { readBack } when any
  // System mismatches, a `ran` prediction included (nothing staged); 422 { errors, readBack } when the change engine
  // refuses the flip (the lockout's §7.6 sentence among them), the actor's change as it was. The flip is split as
  // /api/changes/ops splits (L7 gap A, PF-R226): 409 KEPT_PRIVATE { readBack } for what the split cannot carry, 409
  // NOT_ADMITTED { readBack } for a field the actor may not write, the store's 503 when its part cannot be staged.
  app.post('/api/deploy/read-back', async c => {
    const ran = readRan(await c.req.text())
    knownActorOf(c) // the flip is staged in the actor's change: 401/403 before the chain is read
    const records = visible(c)
    const composition = compositionOf(records)
    if (!composition) {
      const none = whyNone(c)
      return c.json(none, STATUS[none.code])
    }
    const lv = judging()
    if (!readsWhole(records, lv)) return c.json({ code: 'PART_HIDDEN', error: PART_HIDDEN }, 409)
    const read = await readDeployment(composition, systems, driver)
    if (!read.ok) return c.json({ code: 'READ_FAILED', error: read.error }, 502)
    const rb = readBack(composition, read.state, ran, deployHooks({ daoURI: daoUriOf(repo) }))
    // What the viewer is told of it: a value found for a field the policy keeps from them is left out, every value of a
    // System whose address is kept from them, and the differs of one with any chain field kept (PF-R226, the gaps
    // review's I-4). The flip is made from `rb`; every answer carries `shown`, MISMATCH's sentence included.
    const shown = readBackFor(rb, lv, viewerOf(c))
    // MISMATCH says what `shown` says (I-4): a System whose differs are kept from the viewer is named, nothing it shows.
    if (rb.systems.some(x => x.status === 'mismatch')) return c.json({ code: 'MISMATCH', error: mismatchSentence(shown), readBack: shown }, 409)
    const readable = new Set(records.map(r => String(r.id)))
    const refused = (code: string, error: string) => c.json({ code, error, readBack: shown }, 409)
    // Inside the lock with no `await` between the load and the save but the store's own staging, as /api/changes/ops.
    // The flip is made there, through the actor's change as it is then (fix wave I2, M1), its private part included:
    // what they staged is kept, or the read-back is refused when the two would set one field differently.
    return withLock(async () => {
      const actor = knownActorOf(c)
      const viewer = viewerOf(c)
      const at = new Date().toISOString()
      const change: Change = changes.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: at, updated: at, ops: [] }
      try {
        // The actor's staged private part, as the store holds it (a placeholder it lost is PRIVATE_LOST, 409).
        let staged: StagedPrivateOp[] = []
        if ((change.private?.length ?? 0) > 0) {
          const { store, why } = reach(privateStore)
          if (!store) throw unavailable(why)
          staged = stagedPrivate(store, change)
        }
        let ops: StageOp[]
        // G4: a governance that holds an on_deploy role or rule otherwise keeps it in the Safe's record; the flip says so.
        let note: string | null
        try {
          ({ ops, note } = flip(repo, composition, rb, { entriesOf: wholeReader(repo, lv, change.ops, staged), readable, now: now(), kept: keptOf(lv) }))
        } catch (err) {
          if (err instanceof KeptRefusal) return refused('KEPT_PRIVATE', KEPT_PRIVATE)
          if (err instanceof FlipRefusal) return c.json({ errors: [{ record: err.record, field: '', message: err.message }], readBack: shown }, 422)
          if (err instanceof StageError) return c.json({ errors: [{ record: '', field: err.field, message: err.message }], readBack: shown }, 422)
          throw err
        }
        if (ops.length === 0) return c.json({ readBack: shown, staged: [] })
        const clash = clashOf([...change.ops, ...stagedAsOps(staged)], ops)
        if (clash) return c.json({ code: 'CHANGE_EDITS', error: CHANGE_EDITS(clash), readBack: shown }, 409)
        // The lockout and the records, judged on the whole (git and the store), the flip unsplit beside the actor's
        // change; the git part is judged again by stage() on what git holds. The membership tree is git's alone (the Hub
        // reads it from git, PF-R228): judged by stage(), never counting a tree the store keeps, so no answer says how
        // many trees the viewer does not read (the gaps review's I-3).
        const whole = validateChange(repo, [...change.ops, ...ops], ops.map(o => o.record), wholeReader(repo, lv, [], staged), wholeReader(repo, lv, [], []), { membership: false })
        if (whole.length > 0) return c.json({ errors: whole, readBack: shown }, 422)
        // The split every write goes through (L5 §10.3, as /api/changes/ops): a field the actor may not write is said
        // naming none; the store's 503 when its part cannot be staged.
        let split: ReturnType<typeof splitOps>
        try { split = splitOps(repo, ops, privateStore, viewer) } catch (err) {
          if (err instanceof StageRefusal) return refused('NOT_ADMITTED', NOT_ADMITTED_FLIP)
          throw err
        }
        if (heldOutsideSplit(lv, ops, split.private)) return refused('KEPT_PRIVATE', KEPT_PRIVATE_FIELD)
        refuseHeldByMove(split.store, split.private)
        const { ops: next, errors } = split.git.length > 0 ? stage(repo, change.ops, split.git) : { ops: change.ops, errors: [] }
        if (errors.length > 0) return c.json({ errors, readBack: shown }, 422)
        const placeholders = split.private.length > 0 ? await stagePrivate(split.store!, change, actor.id, split.private) : change.private
        const { private: _was, ...rest } = change
        const saved: Change = { ...rest, ...(placeholders?.length ? { private: placeholders } : {}), ops: next, updated: new Date().toISOString() }
        changes.save(saved)
        notify({ type: 'changes' })
        return c.json({ readBack: shown, staged: ops, change: changeView(repo, actor, saved, stagedView(privateStore, saved), changePrivateTargets(repo, privateStore, saved)),
          ...(note ? { note } : {}) })
      } catch (err) {
        if (err instanceof StageRefusal) return c.json({ errors: err.errors, readBack: shown }, 422)
        if (err instanceof Refusal) return c.json(err.body, err.status)
        throw err
      }
    })
  })
}
