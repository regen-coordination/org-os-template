// packages/admin/tests/deploy/state.test.ts
//
// readChainState: the chain state a composition's deployment is planned on (L7 spec §8.2, §9), read by eth_call and
// eth_getCode only, through the same guarded POST a driver is handed. No network: the node is the fake in
// fixtures/readings.ts, answering recorded encodings.
import { describe, it, expect } from 'vitest'
import { readChainState, isChainState, TOP_HAT_FIRST, TOP_HAT_SEARCH } from '../../server/deploy/state.ts'
import { guardedPost, READ_RPC_METHODS, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { encodeArgs, encodeCall } from '../../lib/abi.mjs'
import { caip10, checksumAddress } from '../../lib/caip.mjs'
import { planDeployment, predictions, topsOf } from '../../lib/deploy/plan.mjs'
import { hatRef } from '../../lib/hats.mjs'
import { GUARD_SLOT, MODULES_PAGE } from '../../server/systems/safe-rpc.ts'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { HATS_SIGNATURES } from '../../lib/hats.mjs'
import { claimSignersCall } from '../../lib/deploy/encode.mjs'
import { VIEW_HAT_TYPES } from '../../lib/hats.mjs'
import {
  A1, A2, A3, A9, COUNCIL, FIRST, GATE, LAST_TOP, RPC_HOST, SAFE, SEARCH, SEPOLIA, STAGES, SYSTEMS, TOP, TOP_AGAIN, TREASURER, callKey, composition, nodeFetch,
  readings, recordedSystems, viewHatCall,
} from './fixtures/readings.ts'

/** The pseudo-driver the deploy reads run as (Task 11): its one host is Sepolia's public RPC. */
const DEPLOY = { name: 'deploy', hosts: [RPC_HOST] }

function ctxWith(fetch: FetchLike, rpc?: Record<string, string>): DriverContext {
  const signal = new AbortController().signal
  return {
    fetchJson: async () => { throw new Error('the deploy reads make no GET') },
    postJson: guardedPost(DEPLOY, fetch, signal, rpc),
    rpcUrl: chain => rpc?.[chain] ?? (CHAINS[chain]?.rpc ? `https://${CHAINS[chain]!.rpc}` : null),
    now: () => new Date('2026-10-30T12:00:00Z'), members: [],
  }
}

describe('readChainState on the recorded stages', () => {
  for (const [name, s] of Object.entries(STAGES)) {
    it(`${name}: reads the expected ChainState`, async () => {
      const methods: string[] = []
      const got = await readChainState(composition(), ctxWith(nodeFetch(s.readings, methods)))
      expect(got).toEqual(s.state)
      expect(methods.length).toBeGreaterThan(0)
    })
  }

  it('makes only reads: eth_call and eth_getCode, and the block number each batch is read at', async () => {
    const methods: string[] = []
    await readChainState(composition(), ctxWith(nodeFetch(STAGES.all.readings, methods)))
    expect(new Set(methods)).toEqual(new Set(['eth_blockNumber', 'eth_call', 'eth_getCode']))
    for (const m of methods) expect(READ_RPC_METHODS).toContain(m)
  })

  // Every place the plan predicts is the one the state read (fix I2, M4): one function (topsOf) gives both their top hats.
  const samePlaces = (c: ReturnType<typeof composition>, got: Parameters<typeof planDeployment>[1]) => {
    const p = predictions(c, { proxyCreationCode: got.proxyCreationCode, tops: topsOf(c, got.trees) })
    for (const safe of c.safes) expect(got.safes[safe.id]?.predicted.toLowerCase()).toBe(p.safes[safe.id]?.toLowerCase())
    for (const [id, g] of Object.entries(p.gates)) expect(got.gates[id]?.predicted.toLowerCase()).toBe(g?.predicted.toLowerCase())
    for (const tree of c.trees) {
      expect(Object.fromEntries(Object.entries(got.trees[tree.id]!.children).map(([k, v]) => [k, v.id]))).toEqual(p.hats[tree.id])
    }
  }
  /** A recorded top hat whose details the composition has since changed (the reviewer's P2). */
  const renamed = () => {
    const systems = recordedSystems(TOP)
    ;(systems[1] as { deployment: { top: { details: string } } }).deployment.top.details = 'Test DAO (renamed)'
    return systems
  }

  it('a read is the answer to its own composition: every place the plan predicts is the one the state read, at every stage (fix I2)', async () => {
    const cases: [Record<string, unknown>[], typeof STAGES.nothing.readings][] = [
      ...Object.values(STAGES).map(s => [SYSTEMS, s.readings] as [Record<string, unknown>[], typeof s.readings]),
      [recordedSystems(TOP), STAGES.all.readings],
      [recordedSystems(TOP), STAGES.frontRun.readings],
      [renamed(), STAGES.all.readings],
    ]
    for (const [systems, r] of cases) {
      const c = composition(systems)
      const got = await readChainState(c, ctxWith(nodeFetch(r)))
      if (!isChainState(got)) throw new Error(got.error)
      samePlaces(c, got)
    }
  })

  it('a recorded top hat whose details were edited since: nothing on the gate is done from the gate at the old tree (fix I2, P2)', async () => {
    const c = composition(renamed())
    const got = await readChainState(c, ctxWith(nodeFetch(STAGES.all.readings)))
    if (!isChainState(got)) throw new Error(got.error)
    const { steps } = planDeployment(c, got)
    expect(steps.find(x => x.id === 'tree:top')!.status).toBe('mismatch')
    expect(steps.filter(x => x.id.startsWith('gate:') && (x.status === 'done' || x.status === 'ready')).map(x => x.id)).toEqual([])
    expect(steps.find(x => x.id === 'gate:deploy')!.predicts).toEqual([])
    expect(hatRef('eip155:11155111', TOP)).toContain(':')
  })
})

describe('the Safe\'s top hat', () => {
  const wearChecks = (calls: string[]) => {
    const prefix = `${DEPLOYMENTS['eip155:11155111']!.hats.address.toLowerCase()} ${encodeCall(HATS_SIGNATURES.isWearerOfHat, [SAFE, 0n]).slice(0, 74).toLowerCase()}`
    return calls.filter(k => k.startsWith(prefix)).length
  }

  it('is looked for among exactly TOP_HAT_FIRST ids before the Safe exists, TOP_HAT_SEARCH once it does', async () => {
    expect([TOP_HAT_FIRST, TOP_HAT_SEARCH]).toEqual([FIRST, SEARCH])
    const before: string[] = []
    await readChainState(composition(), ctxWith(nodeFetch(STAGES.nothing.readings, [], before)))
    // ... and once more, in round 4, for the gate's owner hat (fix I4): the predicted top hat, worn by the Safe or not.
    expect(wearChecks(before)).toBe(TOP_HAT_FIRST + 1)
    const after: string[] = []
    await readChainState(composition(), ctxWith(nodeFetch(STAGES.safe.readings, [], after)))
    expect(wearChecks(after)).toBe(TOP_HAT_SEARCH + 1)
  })

  it('a recorded top hat worn by the Safe with the composed details is the tree\'s: two calls, no search', async () => {
    const calls: string[] = []
    const got = await readChainState(composition(recordedSystems(TOP)), ctxWith(nodeFetch(STAGES.top.readings, [], calls)))
    if (!isChainState(got)) throw new Error(got.error)
    expect(got.trees['test-dao-roles']).toEqual({
      ...STAGES.top.state.trees['test-dao-roles'], topHatsSearched: 0, recordedTop: { id: TOP, worn: true, details: 'Test DAO' },
    })
    expect(wearChecks(calls)).toBe(1 + 1) // the recorded id, then the gate's owner hat (fix I4)
  })

  it('a recorded top hat the Safe does not wear reads as such, with no search', async () => {
    const calls: string[] = []
    const got = await readChainState(composition(recordedSystems(TOP)), ctxWith(nodeFetch(STAGES.frontRun.readings, [], calls)))
    if (!isChainState(got)) throw new Error(got.error)
    expect(got.trees['test-dao-roles']).toMatchObject({ topHat: null, topHatsSearched: 0, recordedTop: { id: TOP, worn: false, details: 'Someone else' } })
    expect(wearChecks(calls)).toBe(1 + 1) // the recorded id, then the gate's owner hat (fix I4)
  })

  it('worn twice with the same details: the one with child hats stays, the other is named', async () => {
    const got = await readChainState(composition(), ctxWith(nodeFetch(STAGES.twice.readings)))
    if (!isChainState(got)) throw new Error(got.error)
    expect(got.trees['test-dao-roles']).toMatchObject({ topHat: TOP, otherTops: [TOP_AGAIN], lastHatId: 1 })
  })

  it('worn twice before any child hat: the first minted (lowest id) stays', async () => {
    const got = await readChainState(composition(), ctxWith(nodeFetch(readings({ safe: true, top: true, twice: true, lastTop: 0x125 }, 1))))
    if (!isChainState(got)) throw new Error(got.error)
    expect(got.trees['test-dao-roles']).toMatchObject({ topHat: TOP, otherTops: [TOP_AGAIN], lastHatId: 0 })
  })
})

describe('failures', () => {
  it('a call the node answers with an error fails the read (never "nothing there"), naming the host only', async () => {
    const r = readings({ safe: true, top: true, lastTop: 0x124, errors: [viewHatCall(TOP)] }, 1)
    const got = await readChainState(composition(), ctxWith(nodeFetch(r)))
    expect(got).toEqual({ ok: false, error: `${RPC_HOST} answered an error for a hat (viewHat)` })
    expect(JSON.stringify(got)).not.toContain('0123456789abcdef')
  })

  // L7 T10 fix I1: the Safe's own batch (readSafeOnChain) throttled inside: its modules and guard are not "none".
  const SENTINEL = '0x0000000000000000000000000000000000000001'
  const modulesData = encodeCall('getModulesPaginated(address,uint256)', [SENTINEL, BigInt(MODULES_PAGE)])
  const guardData = encodeCall('getStorageAt(uint256,uint256)', [BigInt(GUARD_SLOT), 1n])

  it('the Safe batch\'s node error fails the read, naming the host only: the wiring is never planned on it (fix I1, M4)', async () => {
    const r = STAGES.wired.readings
    const got = await readChainState(composition(), ctxWith(nodeFetch({ ...r, errors: [callKey(SAFE, modulesData), callKey(SAFE, guardData)] })))
    expect(got).toEqual({ ok: false, error: `${RPC_HOST} answered an error for getModulesPaginated(address,uint256)` })
    expect(JSON.stringify(got)).not.toContain('0123456789abcdef')
  })

  it('a planned Safe whose modules or guard are not known (views it does not answer) fails the read (fix I1)', async () => {
    for (const data of [modulesData, guardData]) {
      const r = structuredClone(STAGES.gate.readings)
      delete r.calls[callKey(SAFE, data)]
      const got = await readChainState(composition(), ctxWith(nodeFetch(r)))
      expect(got).toEqual({ ok: false, error: `the modules and guard of the Safe test-dao-safe could not be read in full (more than ${MODULES_PAGE} modules, or views it does not answer), so nothing is planned on them.` })
    }
  })

  it('a planned Safe with a full page of modules (more beyond the one page read) fails the read (fix M5)', async () => {
    const r = structuredClone(STAGES.gate.readings)
    const mods = Array.from({ length: MODULES_PAGE }, (_, i) => `0x${'0'.repeat(38)}${(0xb0 + i).toString(16)}`)
    r.calls[callKey(SAFE, modulesData)] = encodeArgs(['address[]', 'address'], [mods, mods[MODULES_PAGE - 1]!])
    const got = await readChainState(composition(), ctxWith(nodeFetch(r)))
    expect(got).toEqual({ ok: false, error: `the modules and guard of the Safe test-dao-safe could not be read in full (more than ${MODULES_PAGE} modules, or views it does not answer), so nothing is planned on them.` })
  })

  it('a Safe with another module: the wiring is the planned mismatch, from the read (fix I1)', async () => {
    const r = structuredClone(STAGES.gate.readings)
    r.calls[callKey(SAFE, modulesData)] = encodeArgs(['address[]', 'address'], [[A9], SENTINEL])
    const c = composition()
    const got = await readChainState(c, ctxWith(nodeFetch(r)))
    if (!isChainState(got)) throw new Error(got.error)
    const wire = planDeployment(c, got).steps.find(x => x.id === 'gate:wire')!
    expect(wire).toMatchObject({ status: 'mismatch', differs: [`the Safe has another module, ${checksumAddress(A9)}`] })
    expect(wire.call).toBeUndefined()
    expect(GATE).not.toBe(A9)
  })

  it('a failed node answer is ok: false, naming the host only (I1)', async () => {
    const keyed = 'https://rpc.example.org/v3/0123456789abcdef'
    const failing: FetchLike = async () => ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) })
    const got = await readChainState(composition(), ctxWith(failing, { 'eip155:11155111': keyed }))
    expect(got).toEqual({ ok: false, error: 'rpc.example.org answered 500' })
    expect(JSON.stringify(got)).not.toContain('0123456789abcdef')
    expect(JSON.stringify(got)).not.toContain('/v3')
  })

  it('a node that cannot be reached is ok: false, naming the host only', async () => {
    const keyed = 'https://rpc.example.org/v3/0123456789abcdef'
    const down: FetchLike = async () => { throw new Error(`connect ECONNREFUSED ${keyed}`) }
    const got = await readChainState(composition(), ctxWith(down, { 'eip155:11155111': keyed }))
    expect(isChainState(got)).toBe(false)
    expect(JSON.stringify(got)).toContain('rpc.example.org')
    expect(JSON.stringify(got)).not.toContain('0123456789abcdef')
  })

  it('a composition on another chain is refused with the Sepolia sentence, and nothing is requested', async () => {
    const methods: string[] = []
    const systems = structuredClone(SYSTEMS).map(s => ({ ...s, chain: 'eip155:1' }))
    const got = await readChainState(composition(systems), ctxWith(nodeFetch(STAGES.nothing.readings, methods)))
    expect(got).toEqual({ ok: false, error: 'Deploying is built for Sepolia (eip155:11155111) only.' })
    expect(methods).toEqual([])
  })
})

// L7 T10 fix I3: once the gate's tree is deployed (flipped, its wearers no longer in the record), "Register the signers"
// stays while the gate is not claimed; its signers come from the chain (the Safe's owners who wear the signer hat, all
// of them when they are as many as the hat's supply), else it waits.
describe('the claim once the gate\'s tree is deployed (fix I3)', () => {
  /** The tree flipped: its record's address is the tree id, each hat keeps {key, hat, role} (wearers dropped). */
  const flipped = () => {
    const systems = structuredClone(SYSTEMS) as Record<string, unknown>[]
    const tree = systems[1] as { deployment: unknown; address?: string; hats: { key: string; role?: string }[] }
    tree.deployment = { status: 'deployed' }
    tree.address = String(LAST_TOP + 1)
    tree.hats = tree.hats.map(h => ({ key: h.key, role: h.role, hat: hatRef(SEPOLIA, h.key === 'council' ? COUNCIL : TREASURER) }))
    return systems
  }
  const planOn = async (systems: Record<string, unknown>[], r: ReturnType<typeof readings>) => {
    const c = composition(systems)
    const got = await readChainState(c, ctxWith(nodeFetch(r)))
    if (!isChainState(got)) throw new Error(got.error)
    return { state: got, ...planDeployment(c, got) }
  }
  const at = (o: Parameters<typeof readings>[0]) => readings({ safe: true, nonce: 3, top: true, lastTop: LAST_TOP + 1, hats: true, wearers: true, ...o }, 1)
  const statusOf = (steps: { id: string; status: string }[]) => Object.fromEntries(steps.map(x => [x.id, x.status]))

  it('the gate deployed, not wired: the claim is planned and waits for the wiring', async () => {
    const { steps } = await planOn(flipped(), at({ gate: true }))
    expect(steps.map(x => x.id)).toEqual(['safe:create', 'gate:deploy', 'gate:wire', 'gate:claim'])
    expect(steps.find(x => x.id === 'gate:claim')).toMatchObject({ status: 'waits', waits: 'Waits for the gate to be read back as the Safe\'s module and guard.' })
  })

  it('wired: the signers are the Safe\'s owners who wear the signer hat, read from the chain, and the claim is ready', async () => {
    const { steps, state, problems } = await planOn(flipped(), at({ gate: true, module: true, guard: true }))
    expect(steps.every(x => x.status === 'done')).toBe(false)
    expect(state.gates['test-dao-safe']!.signerHatWearers).toEqual({ [COUNCIL]: { supply: 3, wearers: [A1, A2, A3].map(a => caip10(SEPOLIA, a)) } })
    const claim = steps.find(x => x.id === 'gate:claim')!
    expect(claim.status).toBe('ready')
    expect(claim.call!.data).toBe(claimSignersCall(SEPOLIA, GATE, [COUNCIL, COUNCIL, COUNCIL], [A1, A2, A3]).data)
    expect(problems).toEqual([])
  })

  it('claimed: the claim is done', async () => {
    const { steps } = await planOn(flipped(), at({ gate: true, module: true, guard: true, claimed: true }))
    expect(statusOf(steps)).toEqual({ 'safe:create': 'done', 'gate:deploy': 'done', 'gate:wire': 'done', 'gate:claim': 'done' })
  })

  it('a wearer the chain cannot name (the hat\'s supply is more than the owners who wear it): the claim waits, saying so', async () => {
    const r = at({ gate: true, module: true, guard: true })
    r.calls[viewHatCall(COUNCIL)] = encodeArgs(VIEW_HAT_TYPES, ['Council', 5, 4, SAFE, SAFE, '', 1, true, true])
    const { steps, problems } = await planOn(flipped(), r)
    expect(steps.find(x => x.id === 'gate:claim')).toMatchObject({ status: 'waits', waits: 'Waits for the gate\'s signers to be known.' })
    expect(steps.filter(x => x.call).map(x => x.id)).toEqual([])
    // Not known is not "wears none": no founding owner is said to wear none of the gate's hats.
    expect(problems).toEqual([])
  })

  it('the record keeps the wearers (the flip keeps them until the claim reads done): those are the signers', async () => {
    const systems = flipped()
    ;(systems[1] as { hats: { key: string; wearers?: string[] }[] }).hats.find(h => h.key === 'council')!.wearers = [A1, A2, A3].map(a => caip10(SEPOLIA, a))
    const { steps, state } = await planOn(systems, at({ gate: true, module: true, guard: true }))
    expect(state.gates['test-dao-safe']!.signerHatWearers).toEqual({})
    expect(steps.find(x => x.id === 'gate:claim')!.status).toBe('ready')
  })
})

// L7 T10 fix I4: the gated Safe must wear the gate's owner hat (the top hat of its first hat's tree). The state reads
// isWearerOfHat(Safe, owner hat), for a deployed tree too; the plan says a mismatch when it reads false.
describe('the gate\'s owner hat (fix I4)', () => {
  it('a deployed tree whose top hat the Safe does not wear: Deploy the gate is a mismatch, and nothing is ready', async () => {
    const systems = structuredClone(SYSTEMS) as Record<string, unknown>[]
    const tree = systems[1] as { deployment: unknown; address?: string; hats: { key: string; hat: string | null }[] }
    tree.deployment = { status: 'deployed' }
    tree.address = String(LAST_TOP + 1)
    for (const h of tree.hats) h.hat = hatRef(SEPOLIA, h.key === 'council' ? COUNCIL : TREASURER)
    const calls: string[] = []
    const c = composition(systems)
    const got = await readChainState(c, ctxWith(nodeFetch(readings({ safe: true, lastTop: LAST_TOP + 1, hats: true, wearers: true }, 1), [], calls)))
    if (!isChainState(got)) throw new Error(got.error)
    expect(got.gates['test-dao-safe']!.ownerHatWorn).toBe(false)
    const wears = encodeCall(HATS_SIGNATURES.isWearerOfHat, [SAFE, BigInt(TOP)]).toLowerCase()
    expect(calls.filter(k => k.endsWith(` ${wears}`))).toHaveLength(1)
    const { steps } = planDeployment(c, got)
    expect(steps.find(x => x.id === 'gate:deploy')).toMatchObject({ status: 'mismatch', differs: ['The Safe does not wear the gate\'s owner hat.'] })
    expect(steps.filter(x => x.status === 'ready').map(x => x.id)).toEqual([])
  })

  it('the Safe wears it (the recorded stages): read true once the top hat is minted to it, false before', async () => {
    for (const [name, s] of Object.entries(STAGES)) {
      const got = await readChainState(composition(), ctxWith(nodeFetch(s.readings)))
      if (!isChainState(got)) throw new Error(got.error)
      expect([name, got.gates['test-dao-safe']!.ownerHatWorn]).toEqual([name, !!s.stage.top && got.trees['test-dao-roles']!.topHat === TOP])
    }
  })
})
