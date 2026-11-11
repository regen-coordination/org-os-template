// packages/admin/server/deploy/state.ts
//
// The chain state a composition's deployment is planned on (L7 spec §8.2, §9): for each composed Safe, Hats tree and
// Hats Signer Gate, what is at the places lib/deploy/plan.mjs predicts. Reads only: eth_call and eth_getCode, each batch
// led by eth_blockNumber, through the context's guarded POST (READ_RPC_METHODS); nothing is signed or sent, nothing is
// written. A read that fails is `{ ok: false, error }`, naming the node's host only (I1).
import { decodeResult, encodeCall } from '../../lib/abi.mjs'
import { addressOf, caip10, checksumAddress } from '../../lib/caip.mjs'
import type { Composition } from '../../lib/compose.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { deployedTop, predictions, topsOf } from '../../lib/deploy/plan.mjs'
import { HATS_SIGNATURES, VIEW_HAT_TYPES, normalHatId, parseHatRef, topHatId } from '../../lib/hats.mjs'
import type { DriverContext } from '../systems/driver.ts'
import { MODULES_PAGE, isSafeRead, readSafeOnChain, type SafeOnChainRead } from '../systems/safe-rpc.ts'
import { RPC_BATCH_LIMIT, ethCalls, graphql, type CallResult, type EthCall } from '../systems/wire.ts'
import { hubFor } from '../systems/snapshot.ts'
import { DAOURI_KEY, ENS_SIGNATURES, TEXT_INTERFACE, dnsEncode, namehash } from '../../lib/ens.mjs'

export interface ChainState {
  /** The block the first batch was read at. */
  block: number
  /** SafeProxyFactory 1.4.1's proxyCreationCode(), which the Safe's CREATE2 prediction needs. */
  proxyCreationCode: string
  /** Hats v1 lastTopHatId(): the next top hat is (lastTopHatId + 1) << 224. */
  lastTopHatId: number
  /** By System id: the Safe's address (predicted, or a deployed one's), whether code is there, and the Safe read there. */
  safes: Record<string, { predicted: string; code: boolean; read: SafeOnChainRead | null }>
  /** By System id. Hat ids are full lowercase hex. */
  trees: Record<string, {
    /** The top hat the Safe wears with the composed details (the one with child hats, else the first minted), else null. */
    topHat: string | null
    /** (lastTopHatId + 1) << 224, recomputed on every read: a front-run id moves it on. */
    predictedTop: string
    /** The top hat's lastHatId (how many children it has had); 0 with no top hat. */
    lastHatId: number
    /** A top hat already at `predictedTop` that the Safe does not wear (minted between two reads); its wearer when known. */
    predictedTopTaken: { wearer: string | null } | null
    /** Other top hats the Safe wears with the composed details (step 2 sent twice, or minted by someone else). */
    otherTops: string[]
    /** How many top hat ids the Safe's own was looked for among (0: not looked for, or found by its recorded id). */
    topHatsSearched: number
    /** The top hat id the tree records (`deployment.top.hat`), as read: whether the Safe wears it, its details (null:
     *  no hat there). null when nothing is recorded. */
    recordedTop: { id: string; worn: boolean; details: string | null } | null
    /** By hat key, at the id the plan predicts. `details` null: no hat there (maxSupply 0). `wearers` by composed account. */
    children: Record<string, { id: string; details: string | null; maxSupply: number; wearers: Record<string, boolean> }>
  }>
  /** By the Safe's System id. `ownerHat`, `signerHats` and `signers` are read only when code is at the prediction.
   *  `signerHatWearers`, by hat id: for a signer hat of a deployed tree whose record lists no wearers, the Safe's owners
   *  (CAIP-10) who wear it, and its supply (every wearer is known when they are as many). */
  gates: Record<string, {
    predicted: string; code: boolean; ownerHat: string | null; signerHats: string[]; module: boolean; guard: boolean; signers: Record<string, boolean>
    signerHatWearers: Record<string, { supply: number; wearers: string[] }>
    /** Whether the gated Safe wears the gate's owner hat (isWearerOfHat), for a deployed tree too (fix I4). */
    ownerHatWorn: boolean
  }>
  /** By the space's System id, present when the composition has a Snapshot space (L7 Task 13): the space as the testnet
   *  hub returns it (null: no such space), or `error`, the hub's failure (then nothing is proven of it). */
  spaces?: Record<string, { found: FoundSpace | null; error?: string }>
  /** By the registration's System id, present when the composition has a daoURI registration (L7 Task 14): the ENS
   *  name's node, the resolver the Universal Resolver finds (null: none), whether it is the name's own (offset 0), whether
   *  it takes text records (supportsInterface 0x59d1d43c; null: not answered), the `daouri` text (null: none or not
   *  read), or `error` (then nothing is proven of it). */
  registrations?: Record<string, { node: string; resolver: string | null; own: boolean; takesText: boolean | null; text: string | null; error?: string }>
}
/** A Snapshot space as the hub's `space` query returns it, the fields spec §9 matches on. */
export interface FoundSpace {
  name: string; network: string; strategies: { name: string; network?: string; params: Record<string, unknown> }[]; filters?: { minScore?: number; onlyMembers?: boolean }
  /** Final L7 review M-1: compared where the draft sets them (`spaceDiffers`). */
  admins?: string[]; voting?: { delay?: number | null; period?: number | null; type?: string | null; quorum?: number | null }
}
export type ChainStateFailure = { ok: false; error: string }
export const isChainState = (r: ChainState | ChainStateFailure): r is ChainState => !('ok' in r)

/** The Safe's top hat is found first by the id the tree records (`deployment.top.hat`, written by the read-back once
 *  "Mint the top hat" reads done): two calls, no search. Without a recorded id it is looked for among the top hat ids
 *  from lastTopHatId + 1 back: TOP_HAT_FIRST of them while the Safe has no code (a top hat minted to its predicted
 *  address before it exists), TOP_HAT_SEARCH once it has. The wear checks go in RPC_BATCH_LIMIT batches; details are read
 *  only for the ids the Safe wears.
 *  The limit: with no recorded id, a top hat minted for the Safe and followed by more than TOP_HAT_SEARCH other top hats
 *  on the chain before its read-back is not found, and the plan offers "Mint the top hat" again (with the warning that
 *  the Safe has sent transactions, when it has). Reading back after each wave records the id and closes it. */
export const TOP_HAT_FIRST = RPC_BATCH_LIMIT
export const TOP_HAT_SEARCH = 4 * RPC_BATCH_LIMIT

const SEPOLIA_ONLY = 'Deploying is built for Sepolia (eip155:11155111) only.'
const HSG = { ownerHat: 'ownerHat()', isValidSignerHat: 'isValidSignerHat(uint256)', isValidSigner: 'isValidSigner(address)' } as const

type RpcAnswer = { id?: unknown; result?: unknown; error?: unknown }

/** Whether code is at each address: one batch of eth_getCode. */
async function codeAt(ctx: DriverContext, chain: string, addresses: string[]): Promise<boolean[]> {
  if (addresses.length === 0) return []
  const url = ctx.rpcUrl?.(chain) ?? null
  if (!url) throw new Error(`no RPC host is known for chain ${chain}`)
  if (!ctx.postJson) throw new Error('this reader was given no network access')
  const host = new URL(url).host
  const answer = await ctx.postJson(url, addresses.map((a, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getCode', params: [addressOf(a), 'latest'] })))
  if (!Array.isArray(answer)) throw new Error(`${host} did not answer a JSON-RPC batch`)
  const byId = new Map<unknown, RpcAnswer>()
  for (const a of answer as RpcAnswer[]) if (a && typeof a === 'object') byId.set(a.id, a)
  return addresses.map((_, i) => {
    const r = byId.get(i)?.result
    if (typeof r !== 'string' || !/^0x[0-9a-fA-F]*$/.test(r)) throw new Error(`${host} gave no answer for the code at an address`)
    return !/^0x0*$/.test(r)
  })
}

/** Decoders for one node's answers. Hats v1 and HSG v2's views never revert for the calls read here, so a call the node
 *  answered with an error (a rate limit inside a batch, say) fails the whole read, naming the host only: it is never
 *  taken for "nothing there". "0x" (no code at the address) is null. */
function answersOf(host: string) {
  const decoded = (r: CallResult | undefined, types: string[], what: string): unknown[] | null => {
    if (!r || !r.ok) throw new Error(`${host} answered an error for ${what}`)
    if (r.data === '0x') return null
    try { return decodeResult(types, r.data) } catch { throw new Error(`${host} answered ${what} in a shape the Hub does not read`) }
  }
  /** A Hats viewHat answer: null details for a hat that does not exist (maxSupply 0); `supply`, how many wear it. */
  const hatView = (r: CallResult | undefined): { details: string | null; maxSupply: number; supply: number; lastHatId: number } => {
    const v = decoded(r, VIEW_HAT_TYPES, 'a hat (viewHat)')
    if (!v || Number(v[1]) === 0) return { details: null, maxSupply: 0, supply: 0, lastHatId: 0 }
    return { details: String(v[0]), maxSupply: Number(v[1]), supply: Number(v[2]), lastHatId: Number(v[6]) }
  }
  const isTrue = (r: CallResult | undefined, what: string): boolean => decoded(r, ['bool'], what)?.[0] === true
  return { decoded, hatView, isTrue }
}

/** Collects eth_calls and hands each its result after one ethCalls round. */
function round() {
  const calls: EthCall[] = []
  const add = (to: string, data: string): number => calls.push({ to, data }) - 1
  return { calls, add }
}

/**
 * Read the chain at every place the plan of `c` predicts: the Safes' addresses, the trees' top hats and child hats, the
 * gates' addresses and wiring. Reads only (eth_call, eth_getCode, eth_blockNumber).
 */
export async function readChainState(c: Composition, ctx: DriverContext): Promise<ChainState | ChainStateFailure> {
  if (!Object.hasOwn(DEPLOYMENTS, c.chain)) return { ok: false, error: SEPOLIA_ONLY }
  try {
    return await read(c, ctx)
  } catch (err) {
    // The node's own failures name its host only (ethCalls, readSafeOnChain and the guarded POST say them so).
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function read(c: Composition, ctx: DriverContext): Promise<ChainState> {
  const chain = c.chain
  const D = DEPLOYMENTS[chain]!
  const hats = D.hats.address
  const url = ctx.rpcUrl?.(chain) ?? null
  if (!url) throw new Error(`no RPC host is known for chain ${chain}`)
  const { decoded, hatView, isTrue } = answersOf(new URL(url).host)

  // Round 1: what the predictions need.
  const first = await ethCalls(ctx, chain, [
    { to: D.safe.proxyFactory, data: encodeCall('proxyCreationCode()', []) },
    { to: hats, data: encodeCall(HATS_SIGNATURES.lastTopHatId, []) },
  ])
  const code = decoded(first.results[0], ['bytes'], 'proxyCreationCode()')?.[0]
  const last = decoded(first.results[1], ['uint32'], 'lastTopHatId()')?.[0]
  if (typeof code !== 'string' || code === '0x') throw new Error('SafeProxyFactory 1.4.1 gave no proxyCreationCode()')
  if (typeof last !== 'string') throw new Error('Hats v1 gave no lastTopHatId()')
  const lastTopHatId = Number(last)
  const predictedTop = topHatId(lastTopHatId + 1)
  const safeAddrs = predictions(c, { proxyCreationCode: code, tops: {} }).safes

  // Round 2: each Safe, read where it is predicted.
  const safes: ChainState['safes'] = {}
  for (const safe of c.safes) {
    const at = safeAddrs[safe.id]
    if (!at) continue
    const r = await readSafeOnChain(ctx, chain, at)
    // A planned Safe's modules and guard decide the wiring: not known is never "none" (fix I1). The plan makes a 1.4.1
    // Safe, which answers both views; one that does not (or holds more modules than the one page read) is not planned on.
    if (!safe.deployed && isSafeRead(r) && r.unknown?.some(f => f === 'modules' || f === 'guard')) {
      throw new Error(`the modules and guard of the Safe ${safe.id} could not be read in full (more than ${MODULES_PAGE} modules, or views it does not answer), so nothing is planned on them.`)
    }
    safes[safe.id] = { predicted: checksumAddress(at), code: isSafeRead(r) || !r.missing, read: isSafeRead(r) ? r : null }
  }

  // Round 3: the top hats each tree's Safe wears, among the last TOP_HAT_FIRST / TOP_HAT_SEARCH ids (exactly that many,
  // or down to id 1), with the hat at predictedTop read whoever wears it.
  const r3 = round()
  const looked: Record<string, { ids: string[]; wears: number[]; atPredicted: number }> = {}
  const recorded: Record<string, { id: string; wears: number; view: number }> = {}
  for (const tree of c.trees) {
    if (tree.deployed) continue
    const safe = c.safes.find(x => x.id === tree.top.wornBy)
    const at = safeAddrs[tree.top.wornBy]
    if (!safe || !at) continue
    const ref = parseHatRef(tree.top.hat)
    if (ref) {
      recorded[tree.id] = {
        id: ref.hatId,
        wears: r3.add(hats, encodeCall(HATS_SIGNATURES.isWearerOfHat, [at, BigInt(ref.hatId)])),
        view: r3.add(hats, encodeCall(HATS_SIGNATURES.viewHat, [BigInt(ref.hatId)])),
      }
      continue
    }
    const n = Math.min(lastTopHatId + 1, safes[safe.id]?.code ? TOP_HAT_SEARCH : TOP_HAT_FIRST)
    const ids = Array.from({ length: n }, (_, i) => topHatId(lastTopHatId + 1 - i))
    looked[tree.id] = {
      ids,
      wears: ids.map(id => r3.add(hats, encodeCall(HATS_SIGNATURES.isWearerOfHat, [at, BigInt(id)]))),
      atPredicted: r3.add(hats, encodeCall(HATS_SIGNATURES.viewHat, [BigInt(predictedTop)])),
    }
  }
  const third = r3.calls.length > 0 ? (await ethCalls(ctx, chain, r3.calls)).results : []
  // Round 3b: the details of each top hat the Safe wears.
  const r3b = round()
  const worn: Record<string, { id: string; view: number }[]> = {}
  for (const [treeId, l] of Object.entries(looked)) {
    worn[treeId] = l.ids.filter((_, i) => isTrue(third[l.wears[i]!], 'a top hat\'s wearer (isWearerOfHat)'))
      .map(id => ({ id, view: r3b.add(hats, encodeCall(HATS_SIGNATURES.viewHat, [BigInt(id)])) }))
  }
  const views = r3b.calls.length > 0 ? (await ethCalls(ctx, chain, r3b.calls)).results : []

  const treeTop: Record<string, Pick<ChainState['trees'][string], 'topHat' | 'lastHatId' | 'predictedTopTaken' | 'otherTops' | 'topHatsSearched' | 'recordedTop'>> = {}
  for (const tree of c.trees) {
    if (tree.deployed) {
      const top = deployedTop(tree)
      treeTop[tree.id] = { topHat: top, lastHatId: 0, predictedTopTaken: null, otherTops: [], topHatsSearched: 0, recordedTop: null }
      continue
    }
    const rec = recorded[tree.id]
    if (rec) {
      // A recorded id is definitive: it is the tree's top hat, or the plan says what the chain shows there instead.
      const v = hatView(third[rec.view])
      const worn = isTrue(third[rec.wears], 'the recorded top hat\'s wearer (isWearerOfHat)')
      const mine = worn && v.details === tree.top.details
      treeTop[tree.id] = {
        topHat: mine ? rec.id : null, lastHatId: mine ? v.lastHatId : 0, predictedTopTaken: null, otherTops: [], topHatsSearched: 0,
        recordedTop: { id: rec.id, worn, details: v.details },
      }
      continue
    }
    const l = looked[tree.id]
    // The Safe's top hats with the composed details. More than one: mintTopHat never reverts, so step 2 sent twice (or a
    // top hat minted to the Safe by anyone) makes another. The plan stays on the one that has child hats, else the first
    // minted (lowest id), so that it never moves to a fresh tree the owners would be asked to sign again.
    const matching = (worn[tree.id] ?? []).map(w => ({ id: w.id, ...hatView(views[w.view]) })).filter(w => w.details === tree.top.details)
      .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    const mine = matching.find(m => m.lastHatId > 0) ?? matching[0]
    const wornIds = (worn[tree.id] ?? []).map(w => w.id)
    const taken = !mine && l && !wornIds.includes(predictedTop) && hatView(third[l.atPredicted]).details !== null
    treeTop[tree.id] = {
      topHat: mine ? mine.id : null, lastHatId: mine ? mine.lastHatId : 0, predictedTopTaken: taken ? { wearer: null } : null,
      otherTops: matching.filter(m => m !== mine).map(m => m.id), topHatsSearched: l ? l.ids.length : 0, recordedTop: null,
    }
  }
  // The places read are the ones the plan predicts: the same function gives both their top hats (fix I2).
  const tops = topsOf(c, Object.fromEntries(Object.entries(treeTop).map(([id, t]) => [id, { topHat: t.topHat, predictedTop }])))
  const p = predictions(c, { proxyCreationCode: code, tops })

  // Round 4: the child hats and their wearers at the predicted ids; whether code is at each gate's prediction.
  const r4 = round()
  const kids: Record<string, Record<string, { id: string; view: number; wearers: Record<string, number> }>> = {}
  for (const tree of c.trees) {
    const ids = p.hats[tree.id] ?? {}
    kids[tree.id] = {}
    for (const h of tree.hats) {
      const id = ids[h.key]
      if (!id) continue
      const wearers: Record<string, number> = {}
      for (const w of h.wearers) wearers[w] = r4.add(hats, encodeCall(HATS_SIGNATURES.isWearerOfHat, [addressOf(w), BigInt(id)]))
      kids[tree.id]![h.key] = { id, view: r4.add(hats, encodeCall(HATS_SIGNATURES.viewHat, [BigInt(id)])), wearers }
    }
  }
  // Whether each gated Safe wears its gate's owner hat (fix I4): the gate's owner can change its signer hats.
  const ownerWorn: Record<string, number> = {}
  for (const safe of c.safes) {
    const g = p.gates[safe.id]
    const at = p.safes[safe.id]
    if (g && at) ownerWorn[safe.id] = r4.add(hats, encodeCall(HATS_SIGNATURES.isWearerOfHat, [addressOf(at), BigInt(g.ownerHat)]))
  }
  // A deployed tree's signer hat whose record lists no wearers (fix I3): which of the Safe's owners wear it. Hats v1 has
  // no view of a hat's wearers; with its supply (round 4's viewHat), they are all known when as many wear it.
  const chainWearers: Record<string, Record<string, { tree: string; key: string; asked: Record<string, number> }>> = {}
  for (const safe of c.safes) {
    const owners = safes[safe.id]?.read?.owners
    if (!p.gates[safe.id] || !owners) continue
    for (const ref of safe.gate?.hats ?? []) {
      const [treeId, key] = [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)]
      const tree = c.trees.find(t => t.id === treeId)
      const id = p.hats[treeId]?.[key]
      if (!tree?.deployed || !id || (tree.hats.find(h => h.key === key)?.wearers.length ?? 0) > 0 || !kids[treeId]?.[key]) continue
      const asked: Record<string, number> = {}
      for (const o of owners) asked[caip10(chain, o)] = r4.add(hats, encodeCall(HATS_SIGNATURES.isWearerOfHat, [addressOf(o), BigInt(id)]))
      ;(chainWearers[safe.id] ??= {})[id] = { tree: treeId, key, asked }
    }
  }
  const fourth = r4.calls.length > 0 ? (await ethCalls(ctx, chain, r4.calls)).results : []
  const signerHatWearers: Record<string, ChainState['gates'][string]['signerHatWearers']> = {}
  for (const [safeId, byHat] of Object.entries(chainWearers)) {
    signerHatWearers[safeId] = Object.fromEntries(Object.entries(byHat).map(([id, w]) => [id, {
      supply: hatView(fourth[kids[w.tree]![w.key]!.view]).supply,
      wearers: Object.entries(w.asked).filter(([, i]) => isTrue(fourth[i], 'a signer hat\'s wearer (isWearerOfHat)')).map(([a]) => a),
    }]))
  }
  /** The accounts a gate registers: its hats' wearers as composed, and those read from the chain. */
  const accountsOf = (id: string): string[] => {
    const safe = c.safes.find(s => s.id === id)!
    const out: string[] = []
    for (const ref of safe.gate?.hats ?? []) {
      const [treeId, key] = [ref.slice(0, ref.indexOf('/')), ref.slice(ref.indexOf('/') + 1)]
      for (const w of c.trees.find(t => t.id === treeId)?.hats.find(h => h.key === key)?.wearers ?? []) if (!out.includes(w)) out.push(w)
    }
    for (const w of Object.values(signerHatWearers[id] ?? {}).flatMap(x => x.wearers)) if (!out.includes(w)) out.push(w)
    return out
  }
  const gateIds = c.safes.filter(s => p.gates[s.id]).map(s => s.id)
  const gateCode = await codeAt(ctx, chain, gateIds.map(id => p.gates[id]!.predicted))

  const trees: ChainState['trees'] = {}
  for (const tree of c.trees) {
    const children: ChainState['trees'][string]['children'] = {}
    for (const [key, k] of Object.entries(kids[tree.id] ?? {})) {
      const v = hatView(fourth[k.view])
      children[key] = {
        id: k.id, details: v.details, maxSupply: v.maxSupply,
        wearers: Object.fromEntries(Object.entries(k.wearers).map(([w, i]) => [w, isTrue(fourth[i], 'a wearer (isWearerOfHat)')])),
      }
    }
    trees[tree.id] = { ...treeTop[tree.id]!, predictedTop, children }
  }

  // Round 5: a gate with code: its owner hat, which of the composed hats it takes as signer hats, who is registered.
  const r5 = round()
  const asked: Record<string, { owner: number; hats: { id: string; at: number }[]; signers: Record<string, number> }> = {}
  gateIds.forEach((id, i) => {
    if (!gateCode[i]) return
    const g = p.gates[id]!
    const signers: Record<string, number> = {}
    for (const w of accountsOf(id)) signers[w] = r5.add(g.predicted, encodeCall(HSG.isValidSigner, [addressOf(w)]))
    asked[id] = {
      owner: r5.add(g.predicted, encodeCall(HSG.ownerHat, [])),
      hats: g.signerHats.map(h => ({ id: h, at: r5.add(g.predicted, encodeCall(HSG.isValidSignerHat, [BigInt(h)])) })),
      signers,
    }
  })
  const fifth = r5.calls.length > 0 ? (await ethCalls(ctx, chain, r5.calls)).results : []

  const gates: ChainState['gates'] = {}
  gateIds.forEach((id, i) => {
    const g = p.gates[id]!
    const a = asked[id]
    const owner = a ? decoded(fifth[a.owner], ['uint256'], 'the gate\'s ownerHat()')?.[0] : undefined
    const safeRead = safes[id]?.read ?? null
    const same = (x: string | null | undefined) => !!x && x.toLowerCase() === g.predicted.toLowerCase()
    const signers: Record<string, boolean> = {}
    for (const w of accountsOf(id)) signers[w] = a ? isTrue(fifth[a.signers[w]!], 'a signer (isValidSigner)') : false
    gates[id] = {
      predicted: checksumAddress(g.predicted), code: !!gateCode[i],
      ownerHat: typeof owner === 'string' ? normalHatId(owner) : null,
      signerHats: a ? a.hats.filter(h => isTrue(fifth[h.at], 'a signer hat (isValidSignerHat)')).map(h => h.id) : [],
      module: !!safeRead?.modules?.some(m => same(m)), guard: same(safeRead?.guard), signers,
      signerHatWearers: signerHatWearers[id] ?? {},
      ownerHatWorn: ownerWorn[id] !== undefined && isTrue(fourth[ownerWorn[id]!], 'the gate\'s owner hat\'s wearer (isWearerOfHat)'),
    }
  })

  const out: ChainState = { block: first.block, proxyCreationCode: code, lastTopHatId, safes, trees, gates }
  if (c.spaces.length > 0) out.spaces = await readSpaces(c, ctx)
  if (c.registrations.length > 0) out.registrations = await readRegistrations(c, ctx, decoded)
  return out
}

/** Each composed registration's ENS name as the chain answers it (L7 Task 14; lib/ens.mjs cites the interfaces): the
 *  Universal Resolver's findResolver, then on a resolver found its supportsInterface(0x59d1d43c) and the `daouri` text
 *  through the Universal Resolver's resolve. eth_call only. A name the Hub does not read, or a findResolver the node
 *  refuses, is that registration's `error` (its step waits); a refused supportsInterface or resolve is "not answered". */
async function readRegistrations(c: Composition, ctx: DriverContext, decoded: ReturnType<typeof answersOf>['decoded']): Promise<NonNullable<ChainState['registrations']>> {
  const out: NonNullable<ChainState['registrations']> = {}
  const ur = DEPLOYMENTS[c.chain]!.ens.universalResolver
  const named: { id: string; name: string; dns: string; node: string; find: number }[] = []
  const r1 = round()
  for (const reg of c.registrations) {
    let dns: string, node: string
    try { dns = dnsEncode(reg.ens); node = namehash(reg.ens) } catch (err) {
      out[reg.id] = { node: '', resolver: null, own: false, takesText: null, text: null, error: err instanceof Error ? err.message : String(err) }
      continue
    }
    named.push({ id: reg.id, name: reg.ens, dns, node, find: r1.add(ur, encodeCall(ENS_SIGNATURES.findResolver, [dns])) })
  }
  if (named.length === 0) return out
  const first = (await ethCalls(ctx, c.chain, r1.calls)).results
  const r2 = round()
  const asked: Record<string, { supports: number; text: number }> = {}
  for (const n of named) {
    const r = first[n.find]
    if (!r || !r.ok) { out[n.id] = { node: n.node, resolver: null, own: false, takesText: null, text: null, error: `the Universal Resolver did not answer for ${n.name}${r && !r.ok ? ` (${r.error})` : ''}` }; continue }
    const v = decoded(r, ['address', 'bytes32', 'uint256'], `${n.name}'s resolver (findResolver)`)
    if (!v) { out[n.id] = { node: n.node, resolver: null, own: false, takesText: null, text: null, error: 'no Universal Resolver answered at its cited address' }; continue }
    // fix M-1: the node it answers is the name's namehash, or the resolver it names is not proven to be this name's
    const answered = String(v[1]).toLowerCase()
    if (answered !== n.node.toLowerCase()) {
      out[n.id] = { node: n.node, resolver: null, own: false, takesText: null, text: null, error: `the Universal Resolver answered the node ${answered} for ${n.name}, not its namehash ${n.node}` }
      continue
    }
    const resolver = /^0x0{40}$/i.test(String(v[0])) ? null : checksumAddress(String(v[0]))
    out[n.id] = { node: n.node, resolver, own: BigInt(String(v[2])) === 0n, takesText: null, text: null }
    if (resolver) {
      asked[n.id] = {
        supports: r2.add(resolver, encodeCall(ENS_SIGNATURES.supportsInterface, [TEXT_INTERFACE])),
        text: r2.add(ur, encodeCall(ENS_SIGNATURES.resolve, [n.dns, encodeCall(ENS_SIGNATURES.text, [n.node, DAOURI_KEY])])),
      }
    }
  }
  const second = r2.calls.length > 0 ? (await ethCalls(ctx, c.chain, r2.calls)).results : []
  for (const [id, a] of Object.entries(asked)) {
    const sup = second[a.supports]
    const txt = second[a.text]
    let takesText: boolean | null = null
    if (sup?.ok && sup.data !== '0x') { try { takesText = decodeResult(['bool'], sup.data)[0] === true } catch { takesText = null } }
    let text: string | null = null
    if (txt?.ok && txt.data !== '0x') {
      try {
        const [bytes] = decodeResult(['bytes', 'address'], txt.data) as [string, string]
        const [t] = decodeResult(['string'], bytes) as [string]
        text = t !== '' ? t : null
      } catch {
        // final L7 review M-2: an answer that cannot be decoded is no reading, never "no text" (step 9 waits on it)
        const name = c.registrations.find(r => r.id === id)?.ens ?? id
        out[id] = { ...out[id]!, takesText, text: null, error: `the daouri text record of ${name} could not be decoded` }
        continue
      }
    }
    out[id] = { ...out[id]!, takesText, text }
  }
  return out
}

const SPACE_QUERY = 'query S($s: String!) { space(id: $s) { id name network symbol admins strategies { name network params } filters { minScore onlyMembers } voting { delay period type quorum } } }'

/** Each composed Sepolia space as the testnet hub returns it (L7 Task 13): one GraphQL query each, never a mutation;
 *  nothing is posted. A hub that fails is that space's `error` (its step waits), never the whole read's. A space on
 *  another network is not read (its step says Sepolia only). */
async function readSpaces(c: Composition, ctx: DriverContext): Promise<NonNullable<ChainState['spaces']>> {
  const out: NonNullable<ChainState['spaces']> = {}
  for (const space of c.spaces) {
    if (space.network !== 'eip155:11155111' || !space.space) continue
    try {
      const data = await graphql<{ space: Record<string, unknown> | null }>(ctx, hubFor({ deployment: { network: space.network } }), SPACE_QUERY, { s: space.space })
      const f = data.space
      out[space.id] = {
        found: f ? {
          name: typeof f.name === 'string' ? f.name : '',
          network: typeof f.network === 'string' ? f.network : String(f.network ?? ''),
          strategies: (Array.isArray(f.strategies) ? f.strategies : []).filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).map(x => ({
            name: String(x.name ?? ''), ...(typeof x.network === 'string' ? { network: x.network } : {}),
            params: typeof x.params === 'object' && x.params !== null && !Array.isArray(x.params) ? x.params as Record<string, unknown> : {},
          })),
          ...(typeof f.filters === 'object' && f.filters !== null ? { filters: f.filters as FoundSpace['filters'] } : {}),
          ...(Array.isArray(f.admins) ? { admins: f.admins.map(String) } : {}),
          ...(typeof f.voting === 'object' && f.voting !== null ? { voting: f.voting as FoundSpace['voting'] } : {}),
        } : null,
      }
    } catch (err) {
      out[space.id] = { found: null, error: err instanceof Error ? err.message : String(err) }
    }
  }
  return out
}
