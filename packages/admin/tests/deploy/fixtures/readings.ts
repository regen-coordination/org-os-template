// packages/admin/tests/deploy/fixtures/readings.ts
//
// Recorded node answers for the deployment of an invented composition (`Test DAO`: one Safe, one Hats tree with two hats,
// one Hats Signer Gate), one set per stage of its deployment, and the ChainState each set reads as. The answers are built
// with the repository's own encoders and ABI code, so that they are consistent with what the planner prepares:
// the predicted Safe is safeProxyAddress's, the predicted gate zodiacModuleAddress's, the hat ids childHatId's.
// No network: `nodeFetch` is a fake JSON-RPC node that answers from these records.
//
// What a node answers for things that are not there, as the real contracts do (and so not recorded one by one):
//   - eth_call to an address with no code answers "0x";
//   - Hats v1 `viewHat` of a hat that does not exist answers the empty hat (maxSupply 0), `isWearerOfHat` false
//     (https://github.com/Hats-Protocol/hats-protocol/blob/v1/src/Hats.sol: hats live in a mapping; maxSupply 0 is
//     "does not exist");
//   - any other call not recorded reverts, so that a read the fixture did not expect shows up.
//
// proxyCreationCode() is SafeProxyFactory 1.4.1's answer on Sepolia (eth_call 0x53e5d935 on
// https://ethereum-sepolia-rpc.publicnode.com), the same bytes tests/lib/create2.test.ts pins against a real Safe.
// Placeholders only: owners 0x…a1, 0x…a2, 0x…a3; someone else 0x…a9.
import { compositionOf, type Composition } from '../../../lib/compose.mjs'
import { encodeArgs, encodeCall } from '../../../lib/abi.mjs'
import { addressOf, checksumAddress } from '../../../lib/caip.mjs'
import { safeProxyAddress, zodiacModuleAddress } from '../../../lib/create2.mjs'
import { DEPLOYMENTS } from '../../../lib/deployments.mjs'
import { gateInitializer, safeInitializer } from '../../../lib/deploy/encode.mjs'
import { HATS_SIGNATURES, VIEW_HAT_TYPES, childHatId, hatRef, topHatId } from '../../../lib/hats.mjs'
import { ENS_SIGNATURES, TEXT_INTERFACE, dnsEncode, namehash } from '../../../lib/ens.mjs'
import { CHAINS } from '../../../server/systems/chains.ts'
import type { FetchLike } from '../../../server/systems/driver.ts'
import { FALLBACK_HANDLER_SLOT, GUARD_SLOT, MODULES_PAGE } from '../../../server/systems/safe-rpc.ts'
import type { ChainState } from '../../../server/deploy/state.ts'

export const SEPOLIA = 'eip155:11155111'
export const RPC_HOST = CHAINS[SEPOLIA]!.rpc!
const D = DEPLOYMENTS[SEPOLIA]!
const ZERO = '0x0000000000000000000000000000000000000000'

export const A1 = '0x00000000000000000000000000000000000000a1'
export const A2 = '0x00000000000000000000000000000000000000a2'
export const A3 = '0x00000000000000000000000000000000000000a3'
export const A9 = '0x00000000000000000000000000000000000000a9'
const acct = (a: string) => `${SEPOLIA}:${a}`
export const OWNERS = [acct(A1), acct(A2), acct(A3)]

/** The composed records, as spec §4.1 writes them (invented names). */
export const SYSTEMS: Record<string, unknown>[] = [
  {
    id: 'test-dao-safe', kind: 'safe', driver: 'safe', name: 'Test DAO Safe', chain: SEPOLIA, order: 1,
    deployment: { status: 'composed', owners: OWNERS, threshold: 2, salt: '1' },
    signer_gate: { hats: ['test-dao-roles/council'], threshold: { type: 'absolute', min: 2, target: 2 }, claimable_for: true, address: null },
  },
  {
    id: 'test-dao-roles', kind: 'hats-tree', driver: 'hats-tree', name: 'Test DAO roles', chain: SEPOLIA, order: 2,
    deployment: { status: 'composed', top: { details: 'Test DAO', image: '', worn_by: 'test-dao-safe' } },
    hats: [
      // Listed child first on purpose: the batch creates an admin before its children, whatever the order written.
      { key: 'treasurer', details: 'Treasurer', admin: 'council', max_supply: 1, mutable: true, wearers: [acct(A1)], role: 'acts', hat: null },
      { key: 'council', details: 'Council', admin: 'top', max_supply: 5, mutable: true, wearers: OWNERS, role: 'decides', hat: null },
    ],
  },
]

/** A composed Snapshot space electing the council (L7 Task 13), as the DAO shelf's template writes it. */
export const SPACE_RECORD = {
  id: 'test-dao-votes', kind: 'snapshot-space', driver: 'snapshot-space', name: 'Test DAO votes',
  url: 'https://testnet.snapshot.box/#/s:test-dao.eth', space: 'test-dao.eth', order: 5,
  relates: [{ to: 'test-dao-roles/council', label: 'elects' }],
  deployment: {
    status: 'composed', network: SEPOLIA,
    settings: {
      name: 'Test DAO', symbol: 'VOTE',
      strategies: [{ name: 'erc1155-balance-of', params: { symbol: 'VOTE', tokenIds: ['${hat.test-dao-roles/council}'] } as Record<string, unknown> }],
      voting: { delay: 0, period: 259200, quorum: 0 },
    },
  },
}
/** A composed daoURI registration by the ENS name's text record (L7 Task 14). */
export const REGISTRATION_RECORD = {
  id: 'test-dao-registration', kind: 'daouri-registration', driver: 'daouri-registration', name: 'Test DAO daoURI',
  ens: 'test-dao.eth', order: 9, deployment: { status: 'composed' },
}

export const composition = (systems: Record<string, unknown>[] = SYSTEMS): Composition => compositionOf(structuredClone(systems))!

/** The records with the tree's top hat recorded (`deployment.top.hat`), as the read-back writes it. */
export function recordedSystems(hatId: string): Record<string, unknown>[] {
  const systems = structuredClone(SYSTEMS)
  const d = (systems[1] as { deployment: { top: Record<string, unknown> } }).deployment
  d.top.hat = hatRef(SEPOLIA, hatId)
  return systems
}

export const PROXY_CODE = '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564'

/** Hats v1's lastTopHatId() before the Test DAO's top hat is minted. */
export const LAST_TOP = 0x123
export const TOP = topHatId(LAST_TOP + 1)
export const COUNCIL = childHatId(TOP, 1)
export const TREASURER = childHatId(COUNCIL, 1)

/** The Safe's address, predicted (CREATE2) from the composed owners, threshold and salt. */
export const SAFE = safeProxyAddress({
  factory: D.safe.proxyFactory, singleton: D.safe.singletonL2, proxyCreationCode: PROXY_CODE, saltNonce: '1',
  initializer: safeInitializer(OWNERS, 2, D.safe.fallbackHandler),
})

/** The gate's address for a given top hat (its owner hat; the council hat is the child under it). */
export function gateFor(top: string): string {
  return zodiacModuleAddress({
    factory: D.hsg.moduleProxyFactory, masterCopy: D.hsg.implementation, saltNonce: '1',
    initializer: gateInitializer({ ownerHat: top, signerHats: [childHatId(top, 1)], safe: SAFE, threshold: { type: 'absolute', min: 2, target: 2 }, locked: false, claimableFor: true }),
  })
}
export const GATE = gateFor(TOP)

/** A node's records: code by address, eth_call answers by `<to> <data>` (both lowercase). */
export interface Readings { block: number; code: Record<string, string>; calls: Record<string, string>; errors: string[] }
const key = (to: string, data: string) => `${to.toLowerCase()} ${data.toLowerCase()}`
const CODE = '0x6080604052'
const hat = (details: string, maxSupply: number, supply: number, eligibility: string, toggle: string, lastHatId: number) =>
  encodeArgs(VIEW_HAT_TYPES, [details, maxSupply, supply, eligibility, toggle, '', lastHatId, true, true])
const viewHat = (id: string) => encodeCall(HATS_SIGNATURES.viewHat, [BigInt(id)])
const wears = (who: string, id: string) => encodeCall(HATS_SIGNATURES.isWearerOfHat, [who, BigInt(id)])
const TRUE = encodeArgs(['bool'], [true])
const FALSE = encodeArgs(['bool'], [false])
const word = (address: string | null) => encodeArgs(['bytes'], [`0x${'0'.repeat(24)}${(address ?? ZERO).slice(2).toLowerCase()}`])

/** How far the deployment has gone. */
export interface Stage {
  safe?: boolean; nonce?: number; lastTop?: number
  /** the Test DAO's top hat (TOP) is minted to the Safe */ top?: boolean
  hats?: boolean; wearers?: boolean; gate?: boolean
  /** the gate is the Safe's module / guard */ module?: boolean; guard?: boolean
  claimed?: boolean
  /** someone else's top hat at `takenAt`, not worn by the Safe */ takenAt?: string
  /** a second top hat, TOP_AGAIN, minted to the Safe with the same details (step 2 sent twice) */ twice?: boolean
  /** recorded calls the node answers with a JSON-RPC error (a rate limit inside a batch, say) */ errors?: string[]
}

/** The second top hat of the `twice` stage. */
export const TOP_AGAIN = topHatId(LAST_TOP + 2)
/** How many top hat ids readChainState looks among (server/deploy/state.ts TOP_HAT_FIRST / TOP_HAT_SEARCH). */
export const FIRST = 50
export const SEARCH = 200

export function readings(o: Stage, block: number): Readings {
  const code: Record<string, string> = {}
  const calls: Record<string, string> = {}
  const put = (to: string, data: string, result: string) => { calls[key(to, data)] = result }
  put(D.safe.proxyFactory, encodeCall('proxyCreationCode()', []), encodeArgs(['bytes'], [PROXY_CODE]))
  put(D.hats.address, encodeCall(HATS_SIGNATURES.lastTopHatId, []), encodeArgs(['uint32'], [o.lastTop ?? LAST_TOP]))
  if (o.safe) {
    code[SAFE.toLowerCase()] = CODE
    const modules = o.module ? [GATE] : []
    put(SAFE, encodeCall('getOwners()', []), encodeArgs(['address[]'], [[A1, A2, A3]]))
    put(SAFE, encodeCall('getThreshold()', []), encodeArgs(['uint256'], [2n]))
    put(SAFE, encodeCall('nonce()', []), encodeArgs(['uint256'], [BigInt(o.nonce ?? 0)]))
    put(SAFE, encodeCall('VERSION()', []), encodeArgs(['string'], ['1.4.1']))
    put(SAFE, encodeCall('getModulesPaginated(address,uint256)', ['0x0000000000000000000000000000000000000001', BigInt(MODULES_PAGE)]),
      encodeArgs(['address[]', 'address'], [modules, '0x0000000000000000000000000000000000000001']))
    put(SAFE, encodeCall('getStorageAt(uint256,uint256)', [BigInt(GUARD_SLOT), 1n]), word(o.guard ? GATE : null))
    put(SAFE, encodeCall('getStorageAt(uint256,uint256)', [BigInt(FALLBACK_HANDLER_SLOT), 1n]), word(D.safe.fallbackHandler))
    put(SAFE, encodeCall('getStorageAt(uint256,uint256)', [0n, 1n]), word(D.safe.singletonL2))
  }
  if (o.top) {
    put(D.hats.address, viewHat(TOP), hat('Test DAO', 1, 1, ZERO, ZERO, o.hats ? 1 : 0))
    put(D.hats.address, wears(SAFE, TOP), TRUE)
  }
  if (o.takenAt) {
    put(D.hats.address, viewHat(o.takenAt), hat('Someone else', 1, 1, ZERO, ZERO, 0))
    put(D.hats.address, wears(SAFE, o.takenAt), FALSE)
  }
  if (o.twice) {
    put(D.hats.address, viewHat(TOP_AGAIN), hat('Test DAO', 1, 1, ZERO, ZERO, 0))
    put(D.hats.address, wears(SAFE, TOP_AGAIN), TRUE)
  }
  if (o.hats) {
    put(D.hats.address, viewHat(COUNCIL), hat('Council', 5, o.wearers ? 3 : 0, SAFE, SAFE, 1))
    put(D.hats.address, viewHat(TREASURER), hat('Treasurer', 1, o.wearers ? 1 : 0, SAFE, SAFE, 0))
  }
  if (o.wearers) {
    for (const a of [A1, A2, A3]) put(D.hats.address, wears(a, COUNCIL), TRUE)
    put(D.hats.address, wears(A1, TREASURER), TRUE)
  }
  if (o.gate) {
    code[GATE.toLowerCase()] = CODE
    put(GATE, encodeCall('ownerHat()', []), encodeArgs(['uint256'], [BigInt(TOP)]))
    put(GATE, encodeCall('isValidSignerHat(uint256)', [BigInt(COUNCIL)]), TRUE)
    for (const a of [A1, A2, A3]) put(GATE, encodeCall('isValidSigner(address)', [a]), o.claimed ? TRUE : FALSE)
  }
  return { block, code, calls, errors: (o.errors ?? []).map(e => e.toLowerCase()) }
}

/** The key a recorded call is kept under, for `Stage.errors`. */
export const callKey = (to: string, data: string) => key(to, data)

/** The placeholder resolver of `test-dao.eth` on Sepolia (L7 Task 14). */
export const RESOLVER = '0x00000000000000000000000000000000000000e5'
/** `r` with the ENS answers for `test-dao.eth` recorded (L7 Task 14): the Universal Resolver's findResolver (the
 *  resolver, the name's node, offset 0 unless `offset`), the resolver's supportsInterface(0x59d1d43c), and resolve of
 *  the `daouri` text (`text`, '' when none). With `resolver: null`, findResolver answers the zero address; `node`, another
 *  node than the name's namehash in findResolver's answer; `textAnswer`, resolve's raw answer in place of the text's. */
export function withEns(r: Readings, o: { resolver?: string | null; text?: string; takesText?: boolean; offset?: number; node?: string; textAnswer?: string } = {}): Readings {
  const ur = D.ens.universalResolver
  const name = dnsEncode('test-dao.eth')
  const node = namehash('test-dao.eth')
  const resolver = o.resolver === undefined ? RESOLVER : o.resolver
  const calls = { ...r.calls }
  const code = { ...r.code, [ur.toLowerCase()]: CODE }
  calls[key(ur, encodeCall(ENS_SIGNATURES.findResolver, [name]))] = encodeArgs(['address', 'bytes32', 'uint256'], [resolver ?? ZERO, o.node ?? node, BigInt(o.offset ?? 0)])
  if (resolver) {
    code[resolver.toLowerCase()] = CODE
    calls[key(resolver, encodeCall(ENS_SIGNATURES.supportsInterface, [TEXT_INTERFACE]))] = encodeArgs(['bool'], [o.takesText !== false])
    calls[key(ur, encodeCall(ENS_SIGNATURES.resolve, [name, encodeCall(ENS_SIGNATURES.text, [node, 'daouri'])]))] =
      o.textAnswer ?? encodeArgs(['bytes', 'address'], [encodeArgs(['string'], [o.text ?? '']), resolver])
  }
  return { ...r, code, calls }
}
/** viewHat(id) on Hats v1, as recorded. */
export const viewHatCall = (id: string) => callKey(D.hats.address, viewHat(id))

type Rpc = { jsonrpc: string; id: number; method: string; params: unknown[] }

/** A fake node answering from `r`; every request's JSON-RPC methods are logged in `methods`, each eth_call's
 *  `<to> <data>` in `calls`. */
export function nodeFetch(r: Readings, methods: string[] = [], calls: string[] = []): FetchLike {
  const hats = D.hats.address.toLowerCase()
  const contracts = new Set([hats, D.safe.proxyFactory.toLowerCase(), ...Object.keys(r.code)])
  const answer = (q: Rpc) => {
    methods.push(q.method)
    if (q.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: q.id, result: `0x${r.block.toString(16)}` }
    if (q.method === 'eth_getCode') return { jsonrpc: '2.0', id: q.id, result: r.code[String(q.params[0]).toLowerCase()] ?? '0x' }
    if (q.method !== 'eth_call') return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'method not found' } }
    const { to, data } = q.params[0] as { to: string; data: string }
    const t = to.toLowerCase()
    calls.push(key(t, data))
    if (r.errors.includes(key(t, data))) return { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'too many requests from https://rpc.example.org/v3/0123456789abcdef' } }
    const recorded = r.calls[key(t, data)]
    if (recorded !== undefined) return { jsonrpc: '2.0', id: q.id, result: recorded }
    if (!contracts.has(t)) return { jsonrpc: '2.0', id: q.id, result: '0x' }
    if (t === hats && data.startsWith(encodeCall(HATS_SIGNATURES.viewHat, [0n]).slice(0, 10))) return { jsonrpc: '2.0', id: q.id, result: hat('', 0, 0, ZERO, ZERO, 0) }
    if (t === hats && data.startsWith(encodeCall(HATS_SIGNATURES.isWearerOfHat, [ZERO, 0n]).slice(0, 10))) return { jsonrpc: '2.0', id: q.id, result: FALSE }
    return { jsonrpc: '2.0', id: q.id, error: { code: 3, message: 'execution reverted' } }
  }
  return async (_url, init) => {
    const body = JSON.parse(init.body ?? 'null') as Rpc | Rpc[]
    const out = Array.isArray(body) ? body.map(answer) : answer(body)
    return { ok: true, status: 200, json: async () => out }
  }
}

// ---- the ChainState each stage reads as ----

const BLOCK = 0x6b1a2c
const safeRead = (o: Stage, block: number) => ({
  chain: SEPOLIA, address: SAFE, owners: [A1, A2, A3].map(addressOf), threshold: 2, nonce: o.nonce ?? 0, version: '1.4.1',
  modules: o.module ? [GATE] : [], guard: o.guard ? GATE : null, fallbackHandler: checksumAddress(D.safe.fallbackHandler),
  singleton: checksumAddress(D.safe.singletonL2), block,
})

export function expectedState(o: Stage, block: number): ChainState {
  const lastTop = o.lastTop ?? LAST_TOP
  const predictedTop = topHatId(lastTop + 1)
  const searched = Math.min(lastTop + 1, o.safe ? SEARCH : FIRST)
  // The Safe's top hat is found when it is among the ids looked at; with a second one, the one with child hats stays.
  const top = o.top && lastTop + 1 - (LAST_TOP + 1) < searched ? TOP : o.twice ? TOP_AGAIN : null
  const base = top ?? predictedTop
  const council = childHatId(base, 1)
  const treasurer = childHatId(council, 1)
  const gate = gateFor(base)
  // The recorded hats are under TOP: read under another top hat, nothing is there.
  const here = base === TOP
  const hats = !!o.hats && here
  const worn = !!o.wearers && here
  return {
    block, proxyCreationCode: PROXY_CODE, lastTopHatId: lastTop,
    safes: { 'test-dao-safe': { predicted: SAFE, code: !!o.safe, read: o.safe ? safeRead(o, block) : null } },
    trees: {
      'test-dao-roles': {
        topHat: top, predictedTop, lastHatId: top === TOP && o.hats ? 1 : 0,
        predictedTopTaken: o.takenAt === predictedTop ? { wearer: null } : null,
        otherTops: o.twice && top === TOP ? [TOP_AGAIN] : [], topHatsSearched: searched, recordedTop: null,
        children: {
          treasurer: { id: treasurer, details: hats ? 'Treasurer' : null, maxSupply: hats ? 1 : 0, wearers: { [acct(A1)]: worn } },
          council: {
            id: council, details: hats ? 'Council' : null, maxSupply: hats ? 5 : 0,
            wearers: Object.fromEntries(OWNERS.map(w => [w, worn])),
          },
        },
      },
    },
    gates: {
      'test-dao-safe': {
        predicted: gate, code: !!o.gate, ownerHat: o.gate ? TOP : null, signerHats: o.gate ? [COUNCIL] : [],
        module: !!o.module, guard: !!o.guard, signers: Object.fromEntries(OWNERS.map(w => [w, !!o.claimed])), signerHatWearers: {},
        ownerHatWorn: !!o.top && base === TOP,
      },
    },
  }
}

const stage = (o: Stage, n: number) => ({ stage: o, readings: readings(o, BLOCK + n), state: expectedState(o, BLOCK + n) })

/** The deployment, stage by stage, and the out-of-order and front-run cases. */
export const STAGES = {
  nothing: stage({}, 0),
  safe: stage({ safe: true }, 1),
  top: stage({ safe: true, top: true, lastTop: LAST_TOP + 1 }, 2),
  hats: stage({ safe: true, nonce: 2, top: true, lastTop: LAST_TOP + 1, hats: true, wearers: true }, 3),
  gate: stage({ safe: true, nonce: 2, top: true, lastTop: LAST_TOP + 1, hats: true, wearers: true, gate: true }, 4),
  wired: stage({ safe: true, nonce: 3, top: true, lastTop: LAST_TOP + 1, hats: true, wearers: true, gate: true, module: true, guard: true }, 5),
  all: stage({ safe: true, nonce: 3, top: true, lastTop: LAST_TOP + 1, hats: true, wearers: true, gate: true, module: true, guard: true, claimed: true }, 6),
  /** Review Focus 3: the gate was deployed (by anyone: its address is a prediction) before the child hats exist. */
  gateBeforeHats: stage({ safe: true, top: true, lastTop: LAST_TOP + 1, gate: true }, 7),
  /** Someone else minted the next top hat before the Safe's: the Safe wears none, and the next id is one further on. */
  frontRun: stage({ safe: true, lastTop: LAST_TOP + 1, takenAt: TOP }, 8),
  /** A top hat appeared at the predicted id between the read of lastTopHatId and the read of that id, not the Safe's. */
  taken: stage({ safe: true, takenAt: TOP }, 9),
  /** Step 2 sent twice after the hats were made (mintTopHat never reverts): the Safe wears two top hats, same details. */
  twice: stage({ safe: true, nonce: 2, top: true, lastTop: LAST_TOP + 2, hats: true, wearers: true, twice: true }, 11),
  /** The Safe's top hat is just beyond the search and nothing is recorded; the Safe has sent 2 transactions. */
  lostTop: stage({ safe: true, nonce: 2, top: true, lastTop: LAST_TOP + SEARCH, hats: true, wearers: true }, 12),
  /** Half-wired: the gate is the Safe's module but not its guard. */
  halfWired: stage({ safe: true, nonce: 3, top: true, lastTop: LAST_TOP + 1, hats: true, wearers: true, gate: true, module: true }, 10),
}
