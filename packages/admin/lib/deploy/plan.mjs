// packages/admin/lib/deploy/plan.mjs
//
// The deployment planner (L7 spec §8.2, L7-D4): from a Composition and the ChainState read for it, the steps that deploy
// it, each `ready` (prepared now), `waits` (its inputs are a prediction of a step not read back yet, and it says which),
// `done` (its prediction is on chain, whatever the order it got there) or `mismatch` (the chain shows something else at
// the predicted place). Steps are prepared in waves: a step is ready only once what it depends on is read back, except
// the first wearers, which go in the same wave as the child hats (consecutive Safe nonces, L2-R8).
// The predictions (the Safe's and the gate's CREATE2 addresses, the child hat ids) are exported, so that the state read
// (server/deploy/state.ts) reads exactly the places the plan predicts. Pure: no network, no clock; nothing is signed or
// sent. Imports only sibling lib modules.
import { addressOf, caip10, checksumAddress, sameAccount } from '../caip.mjs'
import { compositionProblems, isAccountProblem } from '../compose.mjs'
import { safeProxyAddress, zodiacModuleAddress } from '../create2.mjs'
import { DEPLOYMENTS, deploymentsOn } from '../deployments.mjs'
import { childHatId, hatRef, parseHatRef, prettyHatId, topHatId, treeIdOf, treeRef } from '../hats.mjs'
import {
  claimSignersCall, createHatsCall, createSafeCall, deployGateCall, gateInitializer, mintHatsCall, mintTopHatCall, safeInitializer, wireGateCall,
} from './encode.mjs'

/** @typedef {import('../compose.mjs').Composition} Composition */
/** @typedef {Composition['safes'][number]} ComposedSafe */
/** @typedef {Composition['trees'][number]} ComposedTree */
/** @typedef {import('../compose.mjs').ComposedHat} ComposedHat */
/** @typedef {{ owners: string[], threshold: number, nonce: number, version: string, modules: string[] | null, guard: string | null, unknown?: string[] }} SafeReadShape */
/** The chain state the plan is made on (server/deploy/state.ts reads it; its interface is the binding one).
 * @typedef {{
 *   block: number, proxyCreationCode: string, lastTopHatId: number,
 *   safes: Record<string, { predicted: string, code: boolean, read: SafeReadShape | null }>,
 *   trees: Record<string, { topHat: string | null, predictedTop: string, lastHatId: number, predictedTopTaken: { wearer: string | null } | null,
 *     otherTops: string[], topHatsSearched: number, recordedTop: { id: string, worn: boolean, details: string | null } | null,
 *     children: Record<string, { id: string, details: string | null, maxSupply: number, wearers: Record<string, boolean> }> }>,
 *   gates: Record<string, { predicted: string, code: boolean, ownerHat: string | null, signerHats: string[], module: boolean, guard: boolean, signers: Record<string, boolean>,
 *     signerHatWearers: Record<string, { supply: number, wearers: string[] }>, ownerHatWorn: boolean }>,
 *   spaces?: Record<string, { found: { name?: unknown, network?: unknown, strategies?: unknown } | null, error?: string }>,
 *   registrations?: Record<string, { node: string, resolver: string | null, own: boolean, takesText: boolean | null, text: string | null, error?: string }>,
 * }} ChainState */
/** @typedef {{ kind: string, value: string, on?: string }} Prediction */
/** @typedef {{
 *   id: string, system: string, title: string, status: 'ready' | 'waits' | 'done' | 'mismatch', waits?: string,
 *   signer: { kind: 'account' } | { kind: 'safe', system: string },
 *   call?: { to: string, value: string, data: string, operation: 0 | 1, summary: string },
 *   predicts: Prediction[], differs?: string[], draft?: import('./space.mjs').SpaceSettingsDraft }} PlannedStep */
/** @typedef {{ space?: (c: Composition, s: ChainState) => PlannedStep[], registration?: (c: Composition, s: ChainState) => PlannedStep[] }} PlanHooks */

/** Spec §8.2's titles, exact. */
export const STEP_TITLES = {
  'safe:create': 'Create the Safe',
  'tree:top': 'Mint the top hat to the Safe',
  'tree:hats': 'Create the child hats',
  'tree:wearers': 'Give the hats to their first wearers',
  'gate:deploy': 'Deploy the Hats Signer Gate',
  'gate:wire': 'Wire the gate to the Safe',
  'gate:claim': 'Register the signers',
}

/** What a step waits for, in words. */
export const WAITS = {
  safe: 'Waits for the Safe to be read back.',
  top: 'Waits for the top hat to be read back.',
  hats: 'Waits for the child hats to be read back.',
  wearers: 'Waits for the first wearers to be read back.',
  gate: 'Waits for the Hats Signer Gate to be read back.',
  wire: 'Waits for the gate to be read back as the Safe\'s module and guard.',
  wiring: 'Waits for the Safe\'s modules and guard to be read.',
  signers: 'Waits for the gate\'s signers to be known.',
  owner: 'Waits for the gate\'s owner hat to be read as the Safe\'s.',
  again: 'The reading was made for another composition: read again.',
}

const SEPOLIA_ONLY = 'Deploying is built for Sepolia (eip155:11155111) only.'
/** Said on a ready wiring (fix M1): from it until the claim no owner is a registered signer (HatsSignerGate v2.0.0
 *  removeSigner refuses only a valid signer; _countValidSignatures counts only valid signers; claimSignersFor adds a
 *  signer as an owner again when it is not one). */
const WINDOW = 'Between this step and "Register the signers", every founding owner is unregistered: anyone may remove any of them (HatsSignerGate.removeSigner) until the claim adds them back, and the Safe cannot sign in that window.'

/** The hats of a tree in the order a batch creates them: each admin before its children, else as written. Hats whose
 *  admin is not a hat of the tree, or that admin each other in a ring, are left out (`unplaced`).
 * @param {ComposedTree} tree @returns {{ order: ComposedHat[], unplaced: ComposedHat[] }} */
export function hatOrder(tree) {
  /** @type {ComposedHat[]} */
  const order = []
  const placed = new Set()
  let left = [...tree.hats]
  for (let progress = true; progress && left.length > 0;) {
    progress = false
    const next = []
    for (const h of left) {
      if (h.admin === 'top' || placed.has(h.admin)) { order.push(h); placed.add(h.key); progress = true } else next.push(h)
    }
    left = next
  }
  return { order, unplaced: left }
}

/** The ids the composed hats get when one batch creates them under the top hat `topId`, the top hat having no child yet
 *  (Hats v1 getNextId: the admin's lastHatId + 1, per admin, in batch order). A deployed tree's hats keep their refs.
 * @param {ComposedTree} tree @param {string | null} topId @returns {Record<string, string>} key → full hex id */
export function childHatIds(tree, topId) {
  /** @type {Record<string, string>} */
  const ids = {}
  if (tree.deployed) {
    for (const h of tree.hats) { const ref = parseHatRef(h.hat); if (ref) ids[h.key] = ref.hatId }
    return ids
  }
  if (!topId) return ids
  /** @type {Map<string, number>} */
  const next = new Map()
  for (const h of hatOrder(tree).order) {
    const admin = h.admin === 'top' ? topId : ids[h.admin]
    if (!admin) continue
    const n = (next.get(admin) ?? 0) + 1
    next.set(admin, n)
    ids[h.key] = childHatId(admin, n)
  }
  return ids
}

/** The Safe's address: a deployed Safe's own, else its CREATE2 prediction from the composed owners, threshold and salt
 *  through SafeProxyFactory 1.4.1 (SafeL2 singleton, the cited fallback handler). null when it cannot be predicted.
 * @param {string} chain @param {ComposedSafe} safe @param {string} proxyCreationCode @returns {string | null} */
export function safeAddress(chain, safe, proxyCreationCode) {
  if (safe.deployed) return safe.address ? addressOf(safe.address) : null
  try {
    const { safe: d } = deploymentsOn(chain)
    return safeProxyAddress({
      factory: d.proxyFactory, singleton: d.singletonL2, proxyCreationCode, saltNonce: safe.salt,
      initializer: safeInitializer(safe.owners, safe.threshold, d.fallbackHandler),
    })
  } catch {
    return null
  }
}

/** A deployed tree's top hat id from its record's address; null for a composed one.
 * @param {ComposedTree} tree @returns {string | null} */
export function deployedTop(tree) {
  if (!tree.deployed) return null
  const t = treeIdOf(tree.address)
  return t === null ? null : topHatId(t)
}

/** `<tree id>/<hat key>` split. @param {string} ref */
const splitRef = ref => { const i = ref.indexOf('/'); return i > 0 ? { tree: ref.slice(0, i), key: ref.slice(i + 1) } : null }

/** The accounts the gate registers (each wearer of each of its hats, once, with the first of its hats they wear), and
 *  whether they are all known (fix I3): a composed tree's hats' wearers as
 *  composed; a deployed tree's as its record still lists them, else as the state read them from the chain (the Safe's
 *  owners who wear the hat, known in full only when they are as many as its supply).
 * @param {Composition} c @param {ChainState} s @param {ComposedSafe} safe
 * @returns {{ signers: { ref: string, tree: string, key: string, account: string }[], known: boolean }} */
function gateSigners(c, s, safe) {
  /** @type {{ ref: string, tree: string, key: string, account: string }[]} */
  const signers = []
  let known = true
  for (const ref of safe.gate?.hats ?? []) {
    const r = splitRef(ref)
    const tree = r ? c.trees.find(t => t.id === r.tree) : undefined
    const hat = tree?.hats.find(h => h.key === r?.key)
    if (!r || !tree || !hat) continue
    let accounts = hat.wearers
    if (tree.deployed && accounts.length === 0) {
      const id = parseHatRef(hat.hat)?.hatId
      const read = id ? s.gates[safe.id]?.signerHatWearers?.[id] : undefined
      if (!read || read.wearers.length !== read.supply) { known = false; continue }
      accounts = read.wearers
    }
    for (const account of accounts) if (!signers.some(o => sameAccount(o.account, account))) signers.push({ ref, tree: r.tree, key: r.key, account })
  }
  return { signers, known }
}

/** The gate's setUp and address: owner hat the top hat of the tree its first signer hat is in (the Safe wears it), the
 *  signer hats' ids, the Safe, the composed threshold, unlocked, claimable for others as composed, salted with the Safe's
 *  salt; deployed by the Zodiac ModuleProxyFactory from the HSG v2.0.0 master copy. null when it cannot be predicted.
 * @param {Composition} c @param {ComposedSafe} safe @param {string | null} safeAddr
 * @param {Record<string, string | null>} tops tree id → its top hat id (worn, else predicted)
 * @returns {{ ownerHat: string, signerHats: string[], initializer: string, predicted: string } | null} */
export function gateSetup(c, safe, safeAddr, tops) {
  if (!safe.gate || safe.gate.hats.length === 0 || !safeAddr) return null
  const refs = safe.gate.hats.map(splitRef)
  const first = refs[0]
  const ownerHat = first ? tops[first.tree] ?? null : null
  if (!ownerHat) return null
  /** @type {string[]} */
  const signerHats = []
  for (const r of refs) {
    const tree = r ? c.trees.find(t => t.id === r.tree) : undefined
    const id = tree && r ? childHatIds(tree, tops[tree.id] ?? null)[r.key] : undefined
    if (!id) return null
    signerHats.push(id)
  }
  try {
    const { hsg } = deploymentsOn(c.chain)
    const initializer = gateInitializer({ ownerHat, signerHats, safe: safeAddr, threshold: safe.gate.threshold, locked: false, claimableFor: safe.gate.claimableFor }, c.chain)
    const predicted = zodiacModuleAddress({ factory: hsg.moduleProxyFactory, masterCopy: hsg.implementation, initializer, saltNonce: safe.salt })
    return { ownerHat, signerHats, initializer, predicted }
  } catch {
    return null
  }
}

/** The top hat each tree is planned on, one function for the plan and the state read alike (fix I2): a deployed tree's
 *  from its record's address (null when it names none), else the one the Safe wears (`topHat`), else the next id.
 * @param {Composition} c @param {Record<string, { topHat: string | null, predictedTop: string } | undefined>} trees
 * @returns {Record<string, string | null>} */
export function topsOf(c, trees) {
  /** @type {Record<string, string | null>} */
  const tops = {}
  for (const tree of c.trees) tops[tree.id] = tree.deployed ? deployedTop(tree) : trees[tree.id]?.topHat ?? trees[tree.id]?.predictedTop ?? null
  return tops
}

/** Every prediction the plan rests on, from the top hat each tree has (worn) or would get (predicted).
 * @param {Composition} c @param {{ proxyCreationCode: string, tops: Record<string, string | null> }} at */
export function predictions(c, at) {
  /** @type {Record<string, string | null>} */
  const safes = {}
  for (const safe of c.safes) safes[safe.id] = safeAddress(c.chain, safe, at.proxyCreationCode)
  /** @type {Record<string, Record<string, string>>} */
  const hats = {}
  for (const tree of c.trees) hats[tree.id] = childHatIds(tree, at.tops[tree.id] ?? null)
  /** @type {Record<string, ReturnType<typeof gateSetup>>} */
  const gates = {}
  for (const safe of c.safes) if (safe.gate) gates[safe.id] = gateSetup(c, safe, safes[safe.id] ?? null, at.tops)
  return { safes, hats, gates }
}

/** @param {import('./encode.mjs').DeployCall} call @param {string} summary */
const withSummary = (call, summary) => ({ to: call.to, value: call.value, data: call.data, operation: call.operation, summary })
/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * The deployment of `c` on the chain as `s` reads it: the steps, in order (spec §8.2), and what is wrong in words.
 * `hooks.space` and `hooks.registration` add steps 8 and 9 (Tasks 13, 14); each is called only when given.
 * @param {Composition} c @param {ChainState} s @param {PlanHooks} [hooks]
 * @returns {{ steps: PlannedStep[], problems: string[] }}
 */
export function planDeployment(c, s, hooks = {}) {
  if (!Object.hasOwn(DEPLOYMENTS, c.chain)) return { steps: [], problems: [SEPOLIA_ONLY] }
  const chain = c.chain
  const D = deploymentsOn(chain)
  /** @type {string[]} */
  const problems = []
  const problem = (/** @type {string} */ p) => { if (!problems.includes(p)) problems.push(p) }
  const found = compositionProblems(c)
  for (const p of found) problem(p.message === SEPOLIA_ONLY ? SEPOLIA_ONLY : `${p.system}: ${p.message}`)
  // an owner or a wearer that is no account on the chain cannot be encoded (addressOf throws): nothing is planned (M1)
  if (found.some(isAccountProblem)) return { steps: [], problems }

  const tops = topsOf(c, s.trees)
  const p = predictions(c, { proxyCreationCode: s.proxyCreationCode, tops })

  // The reading answers this composition only where it read the places this plan predicts (fix I2): a Safe, a top hat,
  // a child hat or a gate read elsewhere (the composition changed since) leaves nothing done, ready or a mismatch on
  // that System; its steps wait for a reading made for it. A tree whose Safe is so is too; a gate whose Safe or trees are.
  /** @param {string | null | undefined} a @param {string | null | undefined} b */
  const same = (a, b) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
  /** @type {Set<string>} */
  const stale = new Set()
  /** @type {Set<string>} */
  const staleGates = new Set()
  for (const safe of c.safes) if (!same(p.safes[safe.id], s.safes[safe.id]?.predicted)) stale.add(safe.id)
  for (const tree of c.trees) {
    const t = s.trees[tree.id]
    const kids = p.hats[tree.id] ?? {}
    const recorded = parseHatRef(tree.top.hat)?.hatId ?? null
    if (!t
      || (tree.deployed ? !same(t.topHat, tops[tree.id]) : !same(recorded, t.recordedTop?.id ?? null))
      || Object.entries(kids).some(([key, id]) => !same(t.children[key]?.id, id))
      || Object.keys(t.children).some(key => !Object.hasOwn(kids, key))
      || (!tree.deployed && stale.has(tree.top.wornBy))) stale.add(tree.id)
  }
  for (const safe of c.safes) {
    if (!safe.gate) continue
    if (stale.has(safe.id) || !same(p.gates[safe.id]?.predicted, s.gates[safe.id]?.predicted)
      || safe.gate.hats.some(r => stale.has(splitRef(r)?.tree ?? ''))) staleGates.add(safe.id)
  }
  if (stale.size > 0 || staleGates.size > 0) problem(WAITS.again)

  /** @type {PlannedStep[]} */
  const steps = []
  /** @type {Map<string, PlannedStep['status']>} `<step id> <system>` → status */
  const status = new Map()
  /** @param {string} id @param {string} system */
  const statusOf = (id, system) => status.get(`${id} ${system}`)
  /** @param {keyof typeof STEP_TITLES} id @param {string} system @param {PlannedStep['signer']} signer
   *  @param {{ status: PlannedStep['status'], waits?: string, call?: PlannedStep['call'], predicts?: Prediction[], differs?: string[] }} o */
  const add = (id, system, signer, o) => {
    if (stale.has(system) || (id.startsWith('gate:') && staleGates.has(system))) o = { status: 'waits', waits: WAITS.again }
    /** @type {PlannedStep} */
    const st = { id, system, title: STEP_TITLES[id], status: o.status, signer, predicts: o.status === 'waits' ? [] : (o.predicts ?? []) }
    if (o.status === 'waits') st.waits = o.waits
    if (o.status === 'ready' && o.call) st.call = o.call
    if (o.status === 'mismatch') st.differs = o.differs ?? []
    else if (o.status !== 'waits' && o.differs && o.differs.length > 0) st.differs = o.differs
    steps.push(st)
    status.set(`${id} ${system}`, o.status)
  }
  const ACCOUNT = /** @type {const} */ ({ kind: 'account' })
  /** @param {string} id @returns {PlannedStep['signer']} */
  const bySafe = id => ({ kind: 'safe', system: id })
  /** A Safe that can sign: code at its address, read back as a Safe. @param {string} id */
  const safeLive = id => !!s.safes[id]?.code && !!s.safes[id]?.read

  // 1. Create the Safe.
  for (const safe of c.safes) {
    if (safe.deployed) continue
    const predicted = p.safes[safe.id]
    if (!predicted) continue // compositionProblems says why (owners, threshold)
    const predicts = [{ kind: 'address', value: caip10(chain, predicted) }]
    if (s.safes[safe.id]?.code && !s.safes[safe.id]?.read) {
      add('safe:create', safe.id, ACCOUNT, { status: 'mismatch', predicts, differs: ['the predicted address holds a contract that is not a Safe the Hub can read'] })
    } else if (s.safes[safe.id]?.code) add('safe:create', safe.id, ACCOUNT, { status: 'done', predicts })
    else {
      const call = withSummary(createSafeCall(chain, safe.owners, safe.threshold, safe.salt),
        `Create the Safe ${safe.id} at ${predicted}: ${count(safe.owners.length, 'owner', 'owners')}, ${safe.threshold} to sign, salt ${safe.salt}.`)
      add('safe:create', safe.id, ACCOUNT, { status: 'ready', call, predicts })
    }
  }

  // 2–4. The tree: its top hat, its child hats, their first wearers.
  for (const tree of c.trees) {
    if (tree.deployed) continue
    const safe = c.safes.find(x => x.id === tree.top.wornBy && x.chain === tree.chain)
    const safeAddr = safe ? p.safes[safe.id] : null
    if (!safe || !safeAddr) continue // compositionProblems names a top hat worn by no composed Safe
    const ts = s.trees[tree.id]
    const prettyTop = ts?.topHat ? prettyHatId(ts.topHat) : ts ? prettyHatId(ts.predictedTop) : ''

    // 2. Mint the top hat to the Safe.
    if (ts?.topHat) {
      // mintTopHat never reverts: the Safe may wear more top hats with these details; the state chose one, said here.
      const why = ts.lastHatId > 0 ? 'it has the child hats' : 'it was minted first'
      const differs = (ts.otherTops ?? []).map(o => `the Safe also wears the top hat at ${prettyHatId(o)} with the same details; the plan stays on ${prettyTop} (${why})`)
      add('tree:top', tree.id, ACCOUNT, { status: 'done', differs, predicts: [{ kind: 'hat', value: hatRef(chain, ts.topHat) }, { kind: 'tree', value: treeRef(chain, String(BigInt(ts.topHat) >> 224n)) }] })
    } else if (ts?.recordedTop) {
      // The tree records its top hat (the read-back wrote it): that id is definitive, and it is not the Safe's as composed.
      const r = ts.recordedTop
      const pretty = prettyHatId(r.id)
      const differs = r.details === null ? [`no top hat exists at the recorded id ${pretty}`]
        : [...(r.worn ? [] : [`the recorded top hat ${pretty} is not worn by the Safe`]),
          ...(r.details === tree.top.details ? [] : [`the recorded top hat ${pretty} reads "${r.details}", not "${tree.top.details}"`])]
      add('tree:top', tree.id, ACCOUNT, { status: 'mismatch', predicts: [{ kind: 'hat', value: hatRef(chain, r.id) }], differs })
    } else if (!ts || !s.safes[safe.id]?.code) {
      add('tree:top', tree.id, ACCOUNT, { status: 'waits', waits: WAITS.safe })
    } else {
      const predicts = [{ kind: 'hat', value: hatRef(chain, ts.predictedTop) }, { kind: 'tree', value: treeRef(chain, String(BigInt(ts.predictedTop) >> 224n)) }]
      if (ts.predictedTopTaken) {
        const who = ts.predictedTopTaken.wearer ? addressOf(ts.predictedTopTaken.wearer) : 'another account'
        add('tree:top', tree.id, ACCOUNT, { status: 'mismatch', predicts, differs: [`the top hat at ${prettyTop} is worn by ${who}, not the Safe`] })
      } else {
        const call = withSummary(mintTopHatCall(chain, safeAddr, tree.top.details, tree.top.image),
          `Mint the top hat ${prettyTop} ("${tree.top.details}") to the Safe ${safeAddr}.`)
        // No recorded id and none found: the Safe may still have a top hat further back than was searched.
        const sent = s.safes[safe.id]?.read?.nonce ?? 0
        const differs = sent > 0 ? [`The Safe has sent ${count(sent, 'transaction', 'transactions')}. If a top hat was already minted for it, read back first; preparing this again makes a second tree.`] : []
        add('tree:top', tree.id, ACCOUNT, { status: 'ready', call, predicts, differs })
      }
    }

    // 3. Create the child hats (the Safe signs; eligibility and toggle are the Safe).
    const { order, unplaced } = hatOrder(tree)
    for (const h of unplaced) if (tree.hats.some(x => x.key === h.admin)) problem(`${tree.id}: hat ${h.key} is in a ring of admins; no batch can create it.`)
    if (order.length === 0) continue
    const ids = p.hats[tree.id] ?? {}
    const kids = order.map(h => ({ h, id: ids[h.key] ?? '', read: ts?.children[h.key] ?? null }))
    /** @param {(typeof kids)[number]} k */
    const exists = k => !!k.read && k.read.details !== null
    /** @param {(typeof kids)[number]} k */
    const matches = k => exists(k) && k.read?.details === k.h.details && k.read?.maxSupply === k.h.max_supply
    const hatPredicts = kids.map(k => ({ kind: 'hat', value: hatRef(chain, k.id) }))
    const hatsDone = ts?.topHat != null && kids.every(matches)
    if (hatsDone) add('tree:hats', tree.id, bySafe(safe.id), { status: 'done', predicts: hatPredicts })
    else if (!ts?.topHat) add('tree:hats', tree.id, bySafe(safe.id), { status: 'waits', waits: WAITS.top })
    else if (!safeLive(safe.id)) add('tree:hats', tree.id, bySafe(safe.id), { status: 'waits', waits: WAITS.safe })
    else if (kids.some(exists) || ts.lastHatId > 0) {
      /** @type {string[]} */
      const differs = []
      for (const k of kids) {
        if (exists(k) && !matches(k)) differs.push(`the hat at ${prettyHatId(k.id)} reads "${k.read?.details}" with room for ${k.read?.maxSupply}, not "${k.h.details}" with room for ${k.h.max_supply}`)
      }
      if (differs.length === 0 && !kids.some(exists)) {
        differs.push(`the top hat at ${prettyTop} already has ${count(ts.lastHatId, 'child hat', 'child hats')} made outside this deployment, so the composed hats would not get these ids`)
      }
      for (const k of kids) if (!exists(k) && kids.some(exists)) differs.push(`no hat at ${prettyHatId(k.id)}`)
      add('tree:hats', tree.id, bySafe(safe.id), { status: 'mismatch', predicts: hatPredicts, differs })
    } else {
      const top = /** @type {string} */ (ts.topHat)
      const call = withSummary(createHatsCall(chain, kids.map(k => ({
        admin: k.h.admin === 'top' ? top : ids[k.h.admin] ?? '', details: k.h.details, maxSupply: k.h.max_supply,
        eligibility: safeAddr, toggle: safeAddr, mutable: k.h.mutable, image: k.h.image ?? '',
      }))), `Create ${count(kids.length, 'hat', 'hats')} under the top hat ${prettyHatId(top)}: ${kids.map(k => `${k.h.details} (${prettyHatId(k.id)})`).join(', ')}.`)
      add('tree:hats', tree.id, bySafe(safe.id), { status: 'ready', call, predicts: hatPredicts })
    }

    // 4. Give the hats to their first wearers: the same wave as the child hats, on the next Safe nonce.
    const mints = kids.flatMap(k => k.h.wearers.map(w => ({ k, w, worn: !!k.read?.wearers[w] })))
    if (mints.length === 0) continue
    const wearerPredicts = mints.map(m => ({ kind: 'wearer', value: caip10(chain, addressOf(m.w)), on: hatRef(chain, m.k.id) }))
    const hats = statusOf('tree:hats', tree.id)
    if (hatsDone && mints.every(m => m.worn)) add('tree:wearers', tree.id, bySafe(safe.id), { status: 'done', predicts: wearerPredicts })
    else if (hats === 'waits') add('tree:wearers', tree.id, bySafe(safe.id), { status: 'waits', waits: steps[steps.length - 1]?.waits ?? WAITS.hats })
    else if (hats === 'mismatch') add('tree:wearers', tree.id, bySafe(safe.id), { status: 'waits', waits: WAITS.hats })
    else {
      const todo = mints.filter(m => !m.worn)
      const call = withSummary(mintHatsCall(chain, todo.map(m => ({ hat: m.k.id, wearer: m.w }))),
        `Give ${count(todo.length, 'hat', 'hats')} to ${todo.map(m => `${addressOf(m.w)} (${m.k.h.details})`).join(', ')}.`)
      add('tree:wearers', tree.id, bySafe(safe.id), { status: 'ready', call, predicts: wearerPredicts })
    }
  }

  // 5–7. The Hats Signer Gate: deploy it, wire it to the Safe, register the signers.
  for (const safe of c.safes) {
    if (safe.deployed || !safe.gate) continue
    const g = p.gates[safe.id]
    const safeAddr = p.safes[safe.id]
    if (!g || !safeAddr) continue
    const gs = s.gates[safe.id]
    const gateAccount = caip10(chain, g.predicted)
    const trees = [...new Set(safe.gate.hats.map(r => splitRef(r)?.tree ?? ''))]
    /** Whether a tree's step is done; a deployed tree has none to wait for, and a step not planned is not done. @param {string} id */
    const treeDone = id => trees.every(t => c.trees.find(x => x.id === t)?.deployed || statusOf(id, t) === 'done')
    const { signers, known } = gateSigners(c, s, safe)
    if (!safe.gate.claimableFor) problem(`the signer gate of ${safe.id} is not claimable for others (claimable_for: false), so "Register the signers" would revert; set claimable_for: true.`)
    // HSG v2.0.0 keeps the founding owners (see tests/lib/deploy.plan.test.ts for the cited lines): one who wears none of
    // the gate's hats is said here, never removed by a step. Every founding owner is unregistered between the wiring and
    // the claim (removeSigner refuses only a valid signer), which the wiring says (fix M1).
    for (const owner of known ? safe.owners : []) {
      if (!signers.some(x => sameAccount(x.account, owner))) {
        problem(`${addressOf(owner)} owns ${safe.id} but wears none of its gate's signer hats: from the wiring on its signature counts for nothing and anyone may remove it (HatsSignerGate.removeSigner); "Register the signers" does not add it back.`)
      }
    }

    // 5. Deploy the Hats Signer Gate (its setUp names the child hats, so they and their wearers come first).
    //    The gate's owner hat (the top hat of its first hat's tree) holds the gate: the Safe wears it, read so (fix I4).
    const gatePredicts = [{ kind: 'address', value: gateAccount }]
    const ownerWorn = gs?.ownerHatWorn
    const ownerTree = splitRef(safe.gate.hats[0] ?? '')?.tree ?? ''
    const ownerTopDone = !!c.trees.find(x => x.id === ownerTree)?.deployed || statusOf('tree:top', ownerTree) === 'done'
    const notOwner = { status: /** @type {const} */ ('mismatch'), predicts: gatePredicts, differs: ['The Safe does not wear the gate\'s owner hat.'] }
    if (gs?.code) {
      if (ownerWorn === true) add('gate:deploy', safe.id, ACCOUNT, { status: 'done', predicts: gatePredicts })
      else if (ownerWorn === false && ownerTopDone) add('gate:deploy', safe.id, ACCOUNT, notOwner)
      else add('gate:deploy', safe.id, ACCOUNT, { status: 'waits', waits: ownerWorn === false ? WAITS.top : WAITS.owner })
    } else if (!treeDone('tree:hats')) add('gate:deploy', safe.id, ACCOUNT, { status: 'waits', waits: WAITS.hats })
    else if (!treeDone('tree:wearers')) add('gate:deploy', safe.id, ACCOUNT, { status: 'waits', waits: WAITS.wearers })
    else if (ownerWorn === false) add('gate:deploy', safe.id, ACCOUNT, notOwner)
    else if (ownerWorn !== true) add('gate:deploy', safe.id, ACCOUNT, { status: 'waits', waits: WAITS.owner })
    else {
      const call = withSummary(deployGateCall(chain, g.initializer, safe.salt),
        `Deploy the Hats Signer Gate for the Safe ${safeAddr} at ${g.predicted}: signer hats ${g.signerHats.map(prettyHatId).join(', ')}, owner hat ${prettyHatId(g.ownerHat)}.`)
      add('gate:deploy', safe.id, ACCOUNT, { status: 'ready', call, predicts: gatePredicts })
    }

    // 6. Wire the gate to the Safe: enableModule + setGuard in one Safe transaction (MultiSendCallOnly, operation 1).
    //    Once the guard is set, only registered signers sign; so every Safe-signed step comes before it.
    const safeAccount = caip10(chain, safeAddr)
    const wirePredicts = [{ kind: 'module', value: gateAccount, on: safeAccount }, { kind: 'guard', value: gateAccount, on: safeAccount }]
    const read = s.safes[safe.id]?.read ?? null
    // Not read is never "none" (fix I1): a Safe whose modules or guard the read could not take waits.
    const wiringKnown = !!read && Array.isArray(read.modules) && !(read.unknown ?? []).some(f => f === 'modules' || f === 'guard')
    if (gs?.module && gs.guard && wiringKnown) add('gate:wire', safe.id, bySafe(safe.id), { status: 'done', predicts: wirePredicts })
    else if (!safeLive(safe.id)) add('gate:wire', safe.id, bySafe(safe.id), { status: 'waits', waits: WAITS.safe })
    else if (!wiringKnown) add('gate:wire', safe.id, bySafe(safe.id), { status: 'waits', waits: WAITS.wiring })
    else if (!treeDone('tree:hats')) add('gate:wire', safe.id, bySafe(safe.id), { status: 'waits', waits: WAITS.hats })
    else if (!treeDone('tree:wearers')) add('gate:wire', safe.id, bySafe(safe.id), { status: 'waits', waits: WAITS.wearers })
    else if (!gs?.code || statusOf('gate:deploy', safe.id) !== 'done') add('gate:wire', safe.id, bySafe(safe.id), { status: 'waits', waits: WAITS.gate })
    else {
      /** @type {string[]} */
      const differs = []
      if (gs.module && !gs.guard) differs.push('the gate is the Safe\'s module but not its guard')
      if (gs.guard && !gs.module) differs.push('the gate is the Safe\'s guard but not its module')
      for (const m of read?.modules ?? []) if (!sameAccount(m, g.predicted)) differs.push(`the Safe has another module, ${checksumAddress(m)}`)
      if (read?.guard && !sameAccount(read.guard, g.predicted)) differs.push(`the Safe's guard is ${checksumAddress(read.guard)}, not the gate`)
      if (differs.length > 0) add('gate:wire', safe.id, bySafe(safe.id), { status: 'mismatch', predicts: wirePredicts, differs })
      else {
        const call = withSummary(wireGateCall(chain, safeAddr, g.predicted),
          `Enable the Hats Signer Gate ${g.predicted} as the Safe's module and set it as its guard, in one Safe transaction (MultiSendCallOnly ${D.safe.multiSendCallOnly}).`)
        add('gate:wire', safe.id, bySafe(safe.id), { status: 'ready', call, predicts: wirePredicts, differs: [WINDOW] })
      }
    }

    // 7. Register the signers: claimSignersFor, which anyone may send when the gate is claimable for others. Never
    //    dropped (fix I3): while the gate is not claimed the step stays, and it waits while its signers are not known.
    const ids = Object.fromEntries(trees.map(t => [t, p.hats[t] ?? {}]))
    const claimPredicts = signers.map(x => ({ kind: 'signer', value: caip10(chain, addressOf(x.account)), on: gateAccount }))
    if (known && signers.length > 0 && signers.every(x => gs?.signers[x.account])) add('gate:claim', safe.id, ACCOUNT, { status: 'done', predicts: claimPredicts })
    else if (statusOf('gate:wire', safe.id) !== 'done') add('gate:claim', safe.id, ACCOUNT, { status: 'waits', waits: safeLive(safe.id) && !wiringKnown ? WAITS.wiring : WAITS.wire })
    else if (statusOf('gate:deploy', safe.id) !== 'done') add('gate:claim', safe.id, ACCOUNT, { status: 'waits', waits: WAITS.gate })
    else if (!known || signers.length === 0) add('gate:claim', safe.id, ACCOUNT, { status: 'waits', waits: WAITS.signers })
    else {
      const todo = signers.filter(x => !gs?.signers[x.account])
      const call = withSummary(claimSignersCall(chain, g.predicted, todo.map(x => ids[x.tree]?.[x.key] ?? ''), todo.map(x => x.account)),
        `Register ${count(todo.length, 'signer', 'signers')} on the Hats Signer Gate ${g.predicted}: ${todo.map(x => addressOf(x.account)).join(', ')}.`)
      add('gate:claim', safe.id, ACCOUNT, { status: 'ready', call, predicts: claimPredicts })
    }
  }

  // 8–9. The Snapshot space and the daoURI registration (Tasks 13, 14).
  if (hooks.space) steps.push(...hooks.space(c, s))
  if (hooks.registration) steps.push(...hooks.registration(c, s))
  return { steps, problems }
}
