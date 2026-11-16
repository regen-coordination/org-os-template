// packages/admin/server/deploy/readback.ts
//
// Read-back and the flip (DAO-OS L7 spec §4.3, §9, Task 12). `readBack` says, for every composed System, whether the
// chain holds it as composed (`deployed`), not yet (`pending`) or something else at its place (`mismatch`), from the
// planner's own statuses (a System is deployed when every step on it reads done) and spec §9's matches (a Safe's owners,
// threshold, singleton and fallback handler; a gate's owner hat and signer hats). `flipOps` turns a read-back into the
// ops of one ordinary change, staged in the actor's change and judged by the org's rules like any change: each deployed
// System written live (`deployment: { status: deployed, read_back }` and its address, never `composed` with an address,
// PF-R165), a tree's top hat recorded as soon as it reads done (the tree stays composed), a tree's wearers kept until its
// gate's "Register the signers" reads done (PF-R145), and, once every on-chain System of the composition is deployed,
// each Safe's `on_deploy` governance added (L7-D8, P1) with its `${hat.…}` and `${system.….address}` resolved. Pure but
// for the records it reads: the trunk's as the actor's change leaves them (the route passes `throughChange`, fix wave
// I2), with what the private store keeps beside them (L7 gap A, `private-flip.ts` `wholeReader`), so the flip is made on
// what the actor already staged; nothing is written here. The route splits the ops as every write is split (PF-R226); a
// value kept above members is never copied into another field or record here (`KeptRefusal`).
import { addressOf, caip10, checksumAddress, sameAccount } from '../../lib/caip.mjs'
import type { Composition } from '../../lib/compose.mjs'
import { deploymentsOn } from '../../lib/deployments.mjs'
import { planDeployment, predictions, topsOf, type PlanHooks } from '../../lib/deploy/plan.mjs'
import { hatRef, parseHatRef, prettyHatId } from '../../lib/hats.mjs'
import { currentEntries } from '../changes/stage.ts'
import { sameValue } from '../changes/canonical.ts'
import type { ChangeView, Op, RecordOp as StageOp } from '../changes/types.ts'
import type { Entity } from '../registry.ts'
import { mergedGovernance } from '../library/preview.ts'
import type { ChainState } from './state.ts'

/** One composed System as read back (spec §9). `found`: what the chain holds of it, by name (`address`, `gate` for a
 *  Safe; `top`, `tree`, `hats.<key>` for a Hats tree), each once its step reads done. */
export interface ReadBackSystem { id: string; status: 'deployed' | 'pending' | 'mismatch'; found: Record<string, string>; differs: string[] }
export interface ReadBack { systems: ReadBackSystem[] }
/** What POST /api/deploy/read-back answers on 200: the read-back, the ops staged (none when the chain shows nothing new),
 *  and the actor's change with them; `note`, when the governance could not take the Safes' on_deploy (ON_DEPLOY_KEPT). */
export interface ReadBackAnswer { readBack: ReadBack; staged: StageOp[]; change?: ChangeView; note?: string }
/** A step the signer ran, with what the plan predicted when it was prepared (L7 ruling P2): a prediction the chain now
 *  gives to someone else is a mismatch, and nothing is staged. */
export interface Ran { step: string; system?: string; predicts: { kind: string; value: string }[] }

/** A flip that cannot be staged as it stands, in words (an on_deploy role or rule the governance already has, a
 *  placeholder the read-back cannot resolve). */
export class FlipRefusal extends Error {
  constructor(readonly record: string, message: string) { super(message) }
}

/** A flip that would copy a value kept above members (a System kept private, or a field the policy or the store keeps
 *  there) into a field or record the repository holds (L7 gap A, PF-R226): the split cannot carry it, so nothing is
 *  staged. It names nothing: the route answers it in its own sentence. */
export class KeptRefusal extends Error {
  constructor() { super('the flip would copy a value kept above members into the repository') }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const list = (xs: string[]) => xs.map(x => addressOf(x)).join(', ')

/** What the Safe reads as against what was composed (spec §9): its owners and threshold, its singleton SafeL2 1.4.1 and
 *  the cited fallback handler. [] when it matches. */
function safeDiffers(c: Composition, s: ChainState, id: string): string[] {
  const safe = c.safes.find(x => x.id === id)!
  const read = s.safes[id]?.read
  if (!read) return []
  const d = deploymentsOn(c.chain).safe
  const out: string[] = []
  const owners = read.owners ?? []
  const sameOwners = owners.length === safe.owners.length && safe.owners.every(o => owners.some(r => sameAccount(r, o)))
  if (!sameOwners) out.push(`the Safe's owners are ${list(owners)}, not the composed ${list(safe.owners)}`)
  if (read.threshold !== safe.threshold) out.push(`the Safe's threshold is ${read.threshold}, not the composed ${safe.threshold}`)
  if (!same(read.singleton, d.singletonL2)) out.push(read.singleton ? `the Safe's singleton is ${addressOf(read.singleton)}, not SafeL2 1.4.1` : 'the Safe\'s singleton could not be read')
  if (!same(read.fallbackHandler, d.fallbackHandler)) {
    out.push(read.fallbackHandler ? `the Safe's fallback handler is ${addressOf(read.fallbackHandler)}, not the cited one (${addressOf(d.fallbackHandler)})` : 'the Safe\'s fallback handler could not be read')
  }
  return out
}

/** The step a `ran` entry names among the plan's, or undefined (its System deployed or flipped since: nothing to judge). */
function ranMismatch(r: Ran, steps: ReturnType<typeof planDeployment>['steps']): { system: string; sentence: string } | null {
  const step = steps.find(st => st.id === r.step && (r.system === undefined || st.system === r.system))
  if (!step || step.status === 'done' || step.status === 'waits') return null
  const key = (p: { kind: string; value: string }) => `${p.kind} ${p.value.toLowerCase()}`
  const now = new Set(step.predicts.map(key))
  const gone = r.predicts.filter(p => !now.has(key(p)))
  if (gone.length === 0) return null
  if (step.id === 'tree:top') {
    const hat = gone.map(p => parseHatRef(p.value)).find(Boolean)
    if (hat) return { system: step.system, sentence: `the Safe wears no top hat at ${prettyHatId(hat.hatId)}; another top hat took it — prepare again` }
  }
  return { system: step.system, sentence: `"${step.title}" was run for ${gone.map(p => p.value).join(', ')}, and the chain gives that place to something else now — prepare again` }
}

/** Whether `problem` names the System `id` (as a word: `test-dao-safe` is not named by `test-dao-safe-2`). */
const names = (problem: string, id: string) => new RegExp(`(^|[^a-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`).test(problem)

/**
 * The read-back of `c` on the chain as `s` reads it (spec §9). `ran`: steps the signer ran, with the predictions they
 * were prepared on (ruling P2). `hooks`: the planner's steps 8 and 9 (prepare.ts `deployHooks`); a Snapshot space is
 * deployed when its step reads done, a daoURI registration when its text record reads identity.daoURI; without the
 * hooks each reads pending; a link is never deployed and is not listed.
 *
 * A System is deployed only when every step expected of it is planned and reads done (fix wave I1): a Safe its
 * `safe:create` and, with a signer gate, `gate:deploy`, `gate:wire` and `gate:claim`; a tree its `tree:top`, with hats
 * `tree:hats`, with wearers `tree:wearers`. An expected step the planner did not plan (a gate whose tree is not in `c`,
 * say) leaves it pending, never deployed, as does a planner problem that names it (one that names no System holds back
 * every one). A Safe's module or guard that is not its composed gate is a mismatch; modules or a guard the read could
 * not take leave it pending (fix wave M2).
 */
export function readBack(c: Composition, s: ChainState, ran: Ran[] = [], hooks: PlanHooks = {}): ReadBack {
  const { steps, problems } = planDeployment(c, s, hooks)
  const p = predictions(c, { proxyCreationCode: s.proxyCreationCode, tops: topsOf(c, s.trees) })
  const ranOut = ran.map(r => ranMismatch(r, steps)).filter((m): m is { system: string; sentence: string } => m !== null)
  const of = (id: string) => steps.filter(st => st.system === id)
  const done = (id: string, step: string) => of(id).some(st => st.id === step && st.status === 'done')
  const ids = [...c.safes, ...c.trees, ...c.spaces, ...c.registrations].map(x => x.id)
  const heldBack = (id: string) => problems.some(pr => names(pr, id) || !ids.some(other => names(pr, other)))
  const judge = (id: string, own: string[], found: Record<string, string>, expected: string[], unproven = false): ReadBackSystem => {
    const mine = of(id)
    const differs = [...new Set([...mine.filter(st => st.status === 'mismatch').flatMap(st => st.differs ?? []), ...own, ...ranOut.filter(m => m.system === id).map(m => m.sentence)])]
    const all = mine.length > 0 && mine.every(st => st.status === 'done') && expected.every(step => done(id, step))
    const status = differs.length > 0 ? 'mismatch' : all && !unproven && !heldBack(id) ? 'deployed' : 'pending'
    return { id, status, found, differs }
  }
  const out: ReadBackSystem[] = []
  for (const safe of c.safes) {
    if (safe.deployed) continue
    const found: Record<string, string> = {}
    const at = p.safes[safe.id]
    const created = done(safe.id, 'safe:create')
    if (at && created) found.address = caip10(c.chain, at)
    const own = created ? safeDiffers(c, s, safe.id) : []
    const g = safe.gate ? p.gates[safe.id] : undefined
    // a gate that cannot be predicted (its tree is not in `c`) leaves the Safe's wiring unjudged: pending, never deployed
    const read = created && (!safe.gate || g) ? s.safes[safe.id]?.read : null
    // what the Safe runs besides the composed gate (fix wave M2): a module the plan's wiring check would not see once
    // the gate is wired, a guard on a Safe composed without one
    for (const m of read?.modules ?? []) if (!g || !sameAccount(m, g.predicted)) own.push(`the Safe has another module, ${checksumAddress(m)}`)
    if (read?.guard && !(g && sameAccount(read.guard, g.predicted))) {
      own.push(g ? `the Safe's guard is ${checksumAddress(read.guard)}, not the gate` : `the Safe's guard is ${checksumAddress(read.guard)}, which was not composed`)
    }
    const unproven = !!read && (read.unknown ?? []).some(f => f === 'modules' || f === 'guard')
    if (g && done(safe.id, 'gate:deploy')) {
      found.gate = caip10(c.chain, g.predicted)
      const gs = s.gates[safe.id]
      if (gs?.ownerHat && !same(gs.ownerHat, g.ownerHat)) own.push(`the gate's owner hat is ${prettyHatId(gs.ownerHat)}, not ${prettyHatId(g.ownerHat)}`)
      for (const h of g.signerHats) if (!(gs?.signerHats ?? []).some(x => same(x, h))) own.push(`the gate does not take ${prettyHatId(h)} as a signer hat`)
    }
    const expected = ['safe:create', ...(safe.gate ? ['gate:deploy', 'gate:wire', 'gate:claim'] : [])]
    out.push(judge(safe.id, own, found, expected, unproven))
  }
  for (const tree of c.trees) {
    if (tree.deployed) continue
    const found: Record<string, string> = {}
    const top = s.trees[tree.id]?.topHat
    if (top && done(tree.id, 'tree:top')) {
      found.top = hatRef(c.chain, top)
      found.tree = String(BigInt(top) >> 224n)
    }
    if (done(tree.id, 'tree:hats')) for (const [key, id] of Object.entries(p.hats[tree.id] ?? {})) found[`hats.${key}`] = hatRef(c.chain, id)
    const expected = ['tree:top', ...(tree.hats.length > 0 ? ['tree:hats'] : []), ...(tree.hats.some(h => h.wearers.length > 0) ? ['tree:wearers'] : [])]
    out.push(judge(tree.id, [], found, expected))
  }
  // A space (Task 13) is deployed when its step reads done: the testnet hub returns it with the composed name, network
  // and strategies; it does not hold the governance back (P1). Without the hook, it reads pending.
  for (const space of c.spaces) {
    const found: Record<string, string> = done(space.id, 'space:settings') ? { space: `https://testnet.snapshot.box/#/s:${space.space}` } : {}
    out.push(judge(space.id, [], found, ['space:settings']))
  }
  // A registration (Task 14) is deployed when its text record reads identity.daoURI; never a mismatch (another text is
  // what its step replaces), and it does not hold the governance back (P1). Without the hook, it reads pending.
  for (const reg of c.registrations) {
    const step = of(reg.id).find(st => st.id === 'registration:daouri')
    const found: Record<string, string> = step?.status === 'done' ? { text: step.predicts.find(pr => pr.kind === 'text')?.value ?? '' } : {}
    out.push(judge(reg.id, [], found, ['registration:daouri']))
  }
  return { systems: out }
}

/** `${hat.<tree>/<key>}` and `${system.<id>.address}` in every string of `value`, resolved by `lookup`; a placeholder it
 *  cannot resolve is a refusal. */
function resolve(value: unknown, lookup: (ph: string) => string | null, record: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{((?:hat|system)\.[^}]+)\}/g, (_, ph: string) => {
      const got = lookup(ph)
      if (got === null) throw new FlipRefusal(record, `on_deploy names \${${ph}}, which the read-back cannot give: nothing deployed answers to it.`)
      return got
    })
  }
  if (Array.isArray(value)) return value.map(v => resolve(v, lookup, record))
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, lookup, record)]))
  return value
}

/** The day a record is dated with: the UTC day, as the Hub dates a receipt's `at` (changes/routes.ts), a proposal's
 *  seal and a decision row (PF-R185). */
export const recordDay = (now: Date): string => now.toISOString().slice(0, 10)

/** What `flipOps` reads. `entriesOf`: the registries as the flip is made against (the route passes the trunk through
 *  the actor's own change, fix wave I2, with what the private store keeps beside it: L7 gap A); absent, the trunk's.
 *  `readable`: the ids of the Systems the viewer may read; only those are read for a record or a placeholder (fix wave
 *  I1 (c), defence in depth: the route reads back only a composition the viewer may read whole). `now`: the read-back's
 *  clock. `kept`: whether a System's field is kept above members (the System kept private, or the field kept by the
 *  policy or the store); such a value is never copied into another field or record (`KeptRefusal`). Absent: none is. */
export interface FlipInput {
  entriesOf?: (registry: string) => Entity[]; readable?: ReadonlySet<string>; now?: Date
  kept?: (system: string, field: string) => boolean
}

/** Said with a flip whose Systems are written live while the governance cannot take their Safes' `on_deploy` as it
 *  stands (the walk's I13, review G4): the cause is the library's sentence for the role or rule it names, which the
 *  governance file (every member reads it) and the Safe's record (the read-back is made only for a viewer who reads the
 *  composition whole) both hold. */
export const ON_DEPLOY_KEPT = (why: string): string =>
  `The Systems are recorded as deployed, but their governance is not added: ${why} It stays in the Safe's record (on_deploy) ` +
  'until the governance can take it; read back again once it can.'

/**
 * The ops that write `rb` as live Systems (spec §4.3), against the records `o.entriesOf` reads; [] when the read-back
 * changes nothing. A role or rule of a Safe's `on_deploy` the governance already holds as it is is not written again;
 * one it holds otherwise keeps the `on_deploy` in the Safe's record and the Systems flip all the same, with `note` saying
 * why (G4). Throws FlipRefusal when two Safes' on_deploy name one role.
 */
export function flipOps(repo: string, c: Composition, rb: ReadBack, o: FlipInput = {}): StageOp[] {
  return flip(repo, c, rb, o).ops
}

/** `flipOps`, with the sentence a flip that keeps its Safes' on_deploy is staged with (ON_DEPLOY_KEPT), or null. */
export function flip(repo: string, c: Composition, rb: ReadBack, o: FlipInput = {}): { ops: StageOp[]; note: string | null } {
  const entriesOf = o.entriesOf ?? ((registry: string) => currentEntries(repo, registry))
  const kept = o.kept ?? (() => false)
  const records = (entriesOf('systems') as Record<string, unknown>[]).filter(r => !o.readable || o.readable.has(String(r.id)))
  const recordOf = (id: string) => records.find(r => String(r.id) === id) ?? null
  const by = new Map(rb.systems.map(x => [x.id, x]))
  const deployed = (id: string) => by.get(id)?.status === 'deployed'
  const date = recordDay(o.now ?? new Date())
  const composedOnChain = [...c.safes, ...c.trees].filter(x => !x.deployed)
  const whole = composedOnChain.length > 0 && composedOnChain.every(x => deployed(x.id))
  /** Whether a gate that registers the wearers of `<tree>/<key>` has yet to read its claim done (PF-R145). */
  const claimPending = (tree: string, key: string) =>
    c.safes.some(safe => !safe.deployed && !deployed(safe.id) && (safe.gate?.hats ?? []).includes(`${tree}/${key}`))
  const ops: StageOp[] = []
  const update = (id: string, set: Record<string, unknown>): Extract<StageOp, { op: 'update' }> => {
    const op = { op: 'update' as const, record: `systems:${id}`, set }
    ops.push(op)
    return op
  }

  // The Safes the governance flip reads: those flipping now and those deployed before with their on_deploy kept (P1).
  // `op`: the Safe's own op, so a governance that cannot take the on_deploy leaves it in the Safe's record (G4).
  const onDeploy: { id: string; value: Record<string, unknown>; op: Extract<StageOp, { op: 'update' }>; now: boolean }[] = []
  for (const safe of c.safes) {
    const rec = recordOf(safe.id)
    const d = isObj(rec?.deployment) ? rec.deployment : null
    if (!rec || !d) continue
    const kept = isObj(d.on_deploy) ? d.on_deploy : null
    if (!safe.deployed && deployed(safe.id)) {
      const found = by.get(safe.id)!.found
      const deployment: Record<string, unknown> = { status: 'deployed', read_back: date, ...(kept && !whole ? { on_deploy: kept } : {}) }
      const set: Record<string, unknown> = { address: addressOf(found.address!), deployment }
      if (isObj(rec.signer_gate)) set.signer_gate = { ...rec.signer_gate, address: found.gate ? addressOf(found.gate) : null }
      const op = update(safe.id, set)
      if (kept) onDeploy.push({ id: safe.id, value: kept, op, now: true })
    } else if (safe.deployed && kept && whole) {
      const { on_deploy: _done, ...rest } = d
      onDeploy.push({ id: safe.id, value: kept, op: update(safe.id, { deployment: rest }), now: false })
    }
  }

  for (const tree of c.trees) {
    const rec = recordOf(tree.id)
    if (!rec) continue
    const hats = Array.isArray(rec.hats) ? rec.hats.filter(isObj) : []
    if (!tree.deployed && deployed(tree.id)) {
      const found = by.get(tree.id)!.found
      const written = hats.map(h => {
        const key = String(h.key)
        const out: Record<string, unknown> = { key, hat: found[`hats.${key}`] ?? null }
        if (h.role === 'decides' || h.role === 'acts') out.role = h.role
        if (Array.isArray(h.wearers) && h.wearers.length > 0 && claimPending(tree.id, key)) out.wearers = h.wearers
        return out
      })
      // the map reads a deployed tree's layers by hat ref (L4c `roles`, PF-R130): the same layers, written there too
      const roles = Object.fromEntries(written.filter(h => typeof h.hat === 'string' && h.role).map(h => [h.hat as string, h.role]))
      // keyed by the hat refs: hats kept above members are never named by roles the repository holds (PF-R226)
      if (Object.keys(roles).length > 0 && kept(tree.id, 'hats') && !kept(tree.id, 'roles')) throw new KeptRefusal()
      update(tree.id, {
        address: found.tree!, deployment: { status: 'deployed', read_back: date }, hats: written,
        ...(Object.keys(roles).length > 0 ? { roles: { ...(isObj(rec.roles) ? rec.roles : {}), ...roles } } : {}),
      })
    } else if (!tree.deployed) {
      // the top hat recorded as soon as it reads done: the tree stays composed, and the plan reads that id first
      const top = by.get(tree.id)?.found.top
      const d = isObj(rec.deployment) ? rec.deployment : null
      const t = d && isObj(d.top) ? d.top : null
      if (top && d && t && t.hat !== top) update(tree.id, { deployment: { ...d, top: { ...t, hat: top } } })
    } else if (hats.some(h => Array.isArray(h.wearers) && h.wearers.length > 0 && !claimPending(tree.id, String(h.key)))) {
      // a deployed tree whose gate has registered its signers: the chain says its wearers now (P9: { key, hat, role })
      update(tree.id, { hats: hats.map(h => {
        if (claimPending(tree.id, String(h.key))) return h
        const { wearers: _w, ...rest } = h
        return rest
      }) })
    }
  }

  // A Snapshot space read back (Task 13): written live, its network kept (the hub it is read on, hubFor).
  for (const space of c.spaces) {
    const rec = recordOf(space.id)
    if (!rec || !deployed(space.id)) continue
    update(space.id, { deployment: { status: 'deployed', read_back: date, network: space.network } })
  }

  // A daoURI registration read back (Task 14): written live; its chain written when the record names none (the schema
  // asks a deployed registration for its chain, and its ENS name or address).
  for (const reg of c.registrations) {
    const rec = recordOf(reg.id)
    if (!rec || !deployed(reg.id)) continue
    update(reg.id, { ...(typeof rec.chain === 'string' && rec.chain !== '' ? {} : { chain: c.chain }), deployment: { status: 'deployed', read_back: date } })
  }

  let note: string | null = null
  if (whole && onDeploy.length > 0) {
    // A placeholder resolved from a value kept above members would carry it into the governance, which git holds
    // (PF-R226): refused, whether the value is read back now or recorded before.
    const hatOf = (ref: string): string | null => {
      const [treeId, key] = [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)]
      if (kept(treeId, 'hats')) throw new KeptRefusal()
      const flipped = by.get(treeId)?.found[`hats.${key}`]
      if (flipped) return flipped
      const h = (recordOf(treeId)?.hats as unknown[] | undefined)?.filter(isObj).find(x => x.key === key)
      return typeof h?.hat === 'string' ? h.hat : null
    }
    const addressOfSystem = (id: string): string | null => {
      if (kept(id, 'address')) throw new KeptRefusal()
      const found = by.get(id)?.found
      if (found?.address) return addressOf(found.address)
      if (found?.tree) return found.tree
      const a = recordOf(id)?.address
      return typeof a === 'string' && a !== '' ? a : null
    }
    const lookup = (ph: string): string | null => {
      if (ph.startsWith('hat.')) return hatOf(ph.slice(4))
      const m = /^system\.(.+)\.address$/.exec(ph)
      return m ? addressOfSystem(m[1]!) : null
    }
    const roles: Record<string, unknown> = {}
    const rules: unknown[] = []
    for (const { id, value } of onDeploy) {
      const r = resolve(value, lookup, `systems:${id}`) as Record<string, unknown>
      if (isObj(r.roles)) {
        for (const [k, v] of Object.entries(r.roles)) {
          if (Object.hasOwn(roles, k)) throw new FlipRefusal(`systems:${id}`, `role ${k} is in the on_deploy of two Safes; it is written once.`)
          roles[k] = v
        }
      }
      if (Array.isArray(r.rules)) rules.push(...r.rules)
    }
    // A role or rule the governance already holds as it is (a read-back applied before, or written by hand alike) is
    // not written again (G4).
    const now = (entriesOf('governance')[0] ?? {}) as Record<string, unknown>
    const hadRoles = isObj(now.roles) ? now.roles : {}
    const hadRules = Array.isArray(now.rules) ? now.rules.filter(isObj) : []
    for (const k of Object.keys(roles)) if (Object.hasOwn(hadRoles, k) && sameValue(hadRoles[k], roles[k])) delete roles[k]
    const newRules = rules.filter(r => !(isObj(r) && hadRules.some(h => String(h.id) === String(r.id) && sameValue(h, r))))
    const set: Record<string, unknown> = {}
    if (Object.keys(roles).length > 0) set.roles = roles
    if (newRules.length > 0) set.rules = newRules
    if (Object.keys(set).length > 0) {
      const merged = mergedGovernance(repo, { op: 'update', record: 'governance:governance', set } as Parameters<typeof mergedGovernance>[1], entriesOf)
      if (merged.refusal) {
        // Held otherwise: the Systems flip all the same, each Safe keeping its on_deploy (written with the flip, or left
        // where it was), and the read-back says why (G4).
        for (const d of onDeploy) {
          const dep = d.op.set.deployment as Record<string, unknown>
          if (d.now) d.op.set = { ...d.op.set, deployment: { ...dep, on_deploy: d.value } }
          else ops.splice(ops.indexOf(d.op), 1)
        }
        note = ON_DEPLOY_KEPT(merged.refusal)
      } else ops.push({ op: 'update', record: 'governance:governance', set: merged.op.set ?? set })
    }
  }
  return { ops, note }
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
/** Whether `next` keeps what `staged` says: equal, a mapping holding each of its keys as kept, or a list it begins. */
function keeps(next: unknown, staged: unknown): boolean {
  if (deepEqual(next, staged)) return true
  if (isObj(next) && isObj(staged)) return Object.entries(staged).every(([k, v]) => Object.hasOwn(next, k) && keeps(next[k], v))
  if (Array.isArray(next) && Array.isArray(staged)) return staged.length <= next.length && staged.every((v, i) => deepEqual(next[i], v))
  return false
}

/** The first record the flip `ops` would write otherwise than the actor's change `staged` already does (a field both
 *  set, the flip's value not keeping the staged one; a record the change deletes), or null (fix wave I2). The flip is
 *  made through the change, so a governance role or rule staged is kept by construction. */
export function clashOf(staged: readonly (Op | StageOp)[], ops: readonly StageOp[]): string | null {
  for (const op of ops) {
    if (op.op !== 'update') continue
    for (const s of staged) {
      if (!('record' in s) || s.record !== op.record) continue
      if (s.op === 'delete') return op.record
      const theirs = s.op === 'update' ? s.set : 'value' in s && isObj(s.value) ? s.value : {}
      if (Object.entries(op.set).some(([k, v]) => Object.hasOwn(theirs, k) && !keeps(v, theirs[k]))) return op.record
    }
  }
  return null
}
