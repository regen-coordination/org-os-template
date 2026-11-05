import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { safe, SAFE_ACTIONS, prepareSafeTx } from '../../server/systems/safe.ts'
import { guardedFetch, READ_TIMEOUT_MS, type Driver, type DriverContext, type FetchLike, type PreparedStep, type SystemRef, type ActionSpec } from '../../server/systems/driver.ts'
import { SystemReader, READ_TIMEOUT_MS as READER_TIMEOUT } from '../../server/systems/reader.ts'
import { readParams } from '../../server/systems/actions.ts'
import { link } from '../../server/systems/link.ts'
import { encodeCall } from '../../lib/abi.mjs'
import { safeTxHash, ZERO_ADDRESS } from '../../lib/safe-tx.mjs'

// Typed actions (DAO-OS L2, Task 5): a Safe's owner and threshold changes, prepared one Safe transaction per chain and
// never signed or sent, and a transaction on any of the Safe's chains. No test touches the network: the Safe Transaction
// Service is a fake answering the synthetic seven-chain fixtures of Task 4 (tests/systems/fixtures/safe-chains/, in the
// service's exact shapes): a 4-of-8 Safe, Optimism with a ninth owner (…a9) and a threshold of 5.
//
// Published: Safe contract OwnerManager signatures,
// https://github.com/safe-global/safe-smart-account/blob/v1.3.0/contracts/base/OwnerManager.sol
// — addOwnerWithThreshold(address,uint256), removeOwner(address,address,uint256), changeThreshold(uint256), and the
// owners list's sentinel SENTINEL_OWNERS = address(0x1). The selectors follow from keccak256 (held to published vectors
// in tests/lib/keccak.test.ts) and are written out here as the Safe's ABI publishes them.

const DIR = new URL('./fixtures/safe-chains/', import.meta.url)
const load = (slug: string) => JSON.parse(readFileSync(new URL(`${slug}.json`, DIR), 'utf8')) as { info: Record<string, unknown> }
// EIP-55 forms, written out (EIP-55 itself is held to its published cases in tests/lib/caip.test.ts).
const ADDR = '0x5aFE00000000000000000000000000000000C0De'
const CHECKSUM_ADDR = ADDR
const NEW = '0x00000000000000000000000000000000000000B1'
const NEW_SHORT = '0x0000…00B1'
const A1 = '0x00000000000000000000000000000000000000A1'
const A2 = '0x00000000000000000000000000000000000000A2'
const A3 = '0x00000000000000000000000000000000000000A3'
const A9 = '0x00000000000000000000000000000000000000A9'
const SENTINEL = '0x0000000000000000000000000000000000000001'
const SLUG_OF: Record<string, string> = {
  'eip155:42220': 'celo', 'eip155:1': 'eth', 'eip155:10': 'oeth', 'eip155:42161': 'arb1', 'eip155:100': 'gno', 'eip155:137': 'pol', 'eip155:8453': 'base',
}
const CHAIN_ID: Record<string, number> = { 'eip155:42220': 42220, 'eip155:1': 1, 'eip155:10': 10, 'eip155:42161': 42161, 'eip155:100': 100, 'eip155:137': 137, 'eip155:8453': 8453 }
const NONCE: Record<string, number> = { 'eip155:42220': 9, 'eip155:1': 14, 'eip155:10': 11, 'eip155:42161': 6, 'eip155:100': 21, 'eip155:137': 3, 'eip155:8453': 5 }
const NOW = new Date('2026-10-29T12:00:00Z')
const OPENED = '2026-10-29T11:00:00Z'

const SAFE7 = { id: 'council', kind: 'safe', name: 'Council', chain: 'eip155:42220', address: ADDR, driver: 'safe',
  chains: ['eip155:1', 'eip155:10', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453'] }
const SAFE2 = { ...SAFE7, chains: ['eip155:1'] }

const api = (slug: string) => `https://api.safe.global/tx-service/${slug}/api`

/** The service: each chain's Safe from its fixture (or `info[slug]`), and `txs` by URL. Every request is kept, with its method. */
function service(over: { info?: Record<string, Record<string, unknown>>; txs?: Record<string, unknown> } = {}) {
  const routes: Record<string, unknown> = { ...over.txs }
  for (const slug of Object.values(SLUG_OF)) routes[`${api(slug)}/v1/safes/${ADDR}/`] = { ...load(slug).info, ...over.info?.[slug] }
  const calls: { url: string; method: string; body?: string }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, ...(init.body !== undefined ? { body: init.body } : {}) })
    const body = routes[url]
    return body === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => body }
  }
  return { calls, fetch, routes }
}
const ctxWith = (fetch: FetchLike): DriverContext => ({ fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: [], sleep: async () => {} })
const readerWith = (fetch: FetchLike, drivers: Driver[] = [{ ...safe, minGapMs: 0 }]) =>
  new SystemReader({ repo: '/nonexistent', fetch, drivers, now: () => NOW, sleep: async () => {} })
let svc = service()
const reader = () => readerWith(svc.fetch)
const governance = { proposal: { classes: ['governance'] } }
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`)
  return r as Extract<T, { ok: true }>
}

describe('the Safe\'s actions', () => {
  it('lists add-owner, remove-owner and change-threshold, of class governance', () => {
    expect(SAFE_ACTIONS.map(a => [a.id, a.class])).toEqual([['add-owner', 'governance'], ['remove-owner', 'governance'], ['change-threshold', 'governance']])
    expect(safe.actions).toBe(SAFE_ACTIONS)
    expect(reader().actionsOf(SAFE7)).toBe(SAFE_ACTIONS)
    expect(reader().actionsOf({ ...SAFE7, driver: 'link' })).toEqual([])
  })

  it('add-owner prepares one Safe transaction per chain, each hashed on its own chain and nonce', async () => {
    svc = service()
    const r = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW.toLowerCase() } }, null))
    expect(r.steps.map(s => s.call.chain)).toEqual(['eip155:42220', ...SAFE7.chains])
    const celo = r.steps[0]!
    expect(celo.call).toMatchObject({ to: `eip155:42220:${CHECKSUM_ADDR}`, value: '0', operation: 0,
      data: encodeCall('addOwnerWithThreshold(address,uint256)', [NEW, 4]), summary: `add owner ${NEW_SHORT}, keep 4 of 9` })
    expect(celo.call.data.slice(0, 10)).toBe('0x0d582f13')
    expect(celo.signer).toEqual({ kind: 'safe', account: `eip155:42220:${CHECKSUM_ADDR}` })
    expect(celo.safe!.payload).toMatchObject({ to: ADDR, value: '0', data: celo.call.data, operation: 0, nonce: 9 })
    expect(celo.safe!.ref.id).toBe(safeTxHash({ chainId: 42220, safe: ADDR, ...celo.safe!.payload }))
    expect(celo.safe!.ref).not.toHaveProperty('chain') // the record's chain
    expect(r.steps[1]!.safe!.ref.chain).toBe('eip155:1')
    // every chain: its own chain id and its own nonce; Optimism keeps its own threshold (5 of 10)
    for (const s of r.steps) {
      expect(s.call.to).toBe(`${s.call.chain}:${ADDR}`)
      expect(s.safe!.payload.nonce).toBe(NONCE[s.call.chain])
      expect(s.safe!.ref.id).toBe(safeTxHash({ chainId: CHAIN_ID[s.call.chain]!, safe: ADDR, ...s.safe!.payload }))
      expect(s.safe!.link).toBe(`https://app.safe.global/home?safe=${SLUG_OF[s.call.chain]}:${ADDR}`)
    }
    expect(r.steps[2]!.call).toMatchObject({ chain: 'eip155:10', data: encodeCall('addOwnerWithThreshold(address,uint256)', [NEW, 5]), summary: `add owner ${NEW_SHORT}, keep 5 of 10` })
    expect(new Set(r.steps.map(s => s.safe!.ref.id)).size).toBe(7)
    expect(r).toMatchObject({ action: 'add-owner', draft: null, link: `https://app.safe.global/home?safe=celo:${ADDR}` })
  })

  it('one attach covers the change on every chain: the first step\'s ref, with the other six in also, each naming its chain', async () => {
    svc = service()
    const r = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW } }, null))
    const [first, ...rest] = r.steps
    expect(r.attach).toEqual({
      ...first!.safe!.ref,
      also: rest.map(s => ({ chain: s.call.chain, id: s.safe!.ref.id, payload: s.safe!.ref.payload })),
    })
    expect((r.attach as SystemRef).also!.map(a => a.chain)).toEqual(SAFE7.chains)
    // one chain: the ref alone, no also
    const one = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW, chains: ['eip155:1'] } }, null))
    expect(one.steps).toHaveLength(1)
    expect(one.attach).toEqual(one.steps[0]!.safe!.ref)
    expect(one.attach).toMatchObject({ chain: 'eip155:1' })
    expect(one.attach).not.toHaveProperty('also')
  })

  it('a threshold given is the threshold on every chosen chain', async () => {
    svc = service()
    const r = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW, threshold: '5', chains: ['eip155:42220', 'eip155:10'] } }, null))
    expect(r.steps.map(s => [s.call.chain, s.call.summary])).toEqual([
      ['eip155:42220', `add owner ${NEW_SHORT}, now 5 of 9`],
      ['eip155:10', `add owner ${NEW_SHORT}, keep 5 of 10`],
    ])
    expect(r.steps[0]!.call.data).toBe(encodeCall('addOwnerWithThreshold(address,uint256)', [NEW, 5]))
  })

  it('remove-owner names the previous owner, or the sentinel for the first', async () => {
    svc = service()
    const first = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'remove-owner', params: { owner: A1, chains: ['eip155:42220'] } }, null))
    expect(first.steps[0]!.call.data).toBe(encodeCall('removeOwner(address,address,uint256)', [SENTINEL, A1, 4]))
    expect(first.steps[0]!.call.data.slice(0, 10)).toBe('0xf8dc5dd9')
    expect(first.steps[0]!.call.summary).toBe('remove owner 0x0000…00A1, keep 4 of 7')
    const third = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'remove-owner', params: { owner: A3.toLowerCase() } }, null))
    expect(third.steps).toHaveLength(7)
    for (const s of third.steps) expect(s.call.data).toBe(encodeCall('removeOwner(address,address,uint256)', [A2, A3, s.call.chain === 'eip155:10' ? 5 : 4]))
  })

  it('remove-owner lowers the threshold only when the owners left are fewer than it', async () => {
    svc = service({ info: { celo: { owners: [A1, A2, A3], threshold: 3 }, eth: { owners: [A1, A2, A3], threshold: 2 } } })
    const r = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'remove-owner', params: { owner: A2, chains: ['eip155:42220', 'eip155:1'] } }, null))
    expect(r.steps.map(s => s.call.data)).toEqual([
      encodeCall('removeOwner(address,address,uint256)', [A1, A2, 2]),
      encodeCall('removeOwner(address,address,uint256)', [A1, A2, 2]),
    ])
    expect(r.steps.map(s => s.call.summary)).toEqual(['remove owner 0x0000…00A2, now 2 of 2', 'remove owner 0x0000…00A2, keep 2 of 2'])
  })

  it('change-threshold changes it where it differs, and skips a chain already there', async () => {
    svc = service()
    const r = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'change-threshold', params: { threshold: 5 } }, null))
    // Optimism is already at 5
    expect(r.steps.map(s => s.call.chain)).toEqual(['eip155:42220', 'eip155:1', 'eip155:42161', 'eip155:100', 'eip155:137', 'eip155:8453'])
    expect(r.steps[0]!.call).toMatchObject({ data: encodeCall('changeThreshold(uint256)', [5]), summary: 'change the threshold from 4 to 5 of 8' })
    expect(r.steps[0]!.call.data.slice(0, 10)).toBe('0x694e80c3')
  })

  it('refuses what cannot run, in words, and prepares nothing', async () => {
    const cases: [string, Record<string, unknown>, RegExp | string][] = [
      ['add-owner', { owner: A1 }, `${A1} is already an owner of this Safe on Celo`],
      ['add-owner', { owner: A9, chains: ['eip155:42220', 'eip155:10'] }, `${A9} is already an owner of this Safe on Optimism`],
      ['remove-owner', { owner: NEW }, `${NEW} is not an owner of this Safe on Celo`],
      ['add-owner', { owner: NEW, threshold: '0' }, 'a threshold of 0 cannot be: on Celo it must be from 1 to 9'],
      ['add-owner', { owner: NEW, threshold: '10' }, 'a threshold of 10 cannot be: on Celo it must be from 1 to 9'],
      ['change-threshold', { threshold: 4, chains: ['eip155:42220', 'eip155:1'] }, 'the threshold is already 4 on every chosen chain'],
      ['change-threshold', { threshold: 9 }, 'a threshold of 9 cannot be: on Celo it must be from 1 to 8'],
    ]
    for (const [action, params, error] of cases) {
      svc = service()
      const r = await reader().prepareAction(SAFE7, { ...governance, action, params }, null)
      expect(r).toEqual({ ok: false, error: typeof error === 'string' ? error : expect.stringMatching(error) })
    }
    // refused before anything is read
    for (const [input, error] of [
      [{ ...governance, action: 'add-owner', params: { owner: NEW, chains: ['eip155:999'] } },
        'eip155:999 is not one of this Safe\'s chains (eip155:42220, eip155:1, eip155:10, eip155:42161, eip155:100, eip155:137, eip155:8453)'],
      [{ proposal: { classes: ['records'] }, action: 'add-owner', params: { owner: NEW } }, '"add-owner" is an action of class governance; this proposal is of class records'],
      [{ ...governance, action: 'add-owners', params: {} }, 'the safe driver has no action "add-owners" (its actions: add-owner, remove-owner, change-threshold)'],
      [{ ...governance, action: 'add-owner', params: { owner: NEW, extra: 1 } }, '"extra" is not a parameter of add-owner (it takes owner, threshold, chains)'],
      [{ ...governance, action: 'add-owner', params: {} }, '"owner" is missing'],
    ] as const) {
      svc = service()
      expect(await reader().prepareAction(SAFE7, input as never, null)).toEqual({ ok: false, error })
      expect(svc.calls).toEqual([])
    }
  })

  it('never posts and never signs: every request is a GET to api.safe.global', async () => {
    svc = service()
    for (const [action, params] of [['add-owner', { owner: NEW }], ['remove-owner', { owner: A3 }], ['change-threshold', { threshold: 3 }]] as const) {
      expect((await reader().prepareAction(SAFE7, { ...governance, action, params }, null)).ok).toBe(true)
    }
    expect(svc.calls.length).toBeGreaterThan(0)
    for (const c of svc.calls) {
      expect(c.method).toBe('GET')
      expect(c.body).toBeUndefined()
      expect(new URL(c.url).host).toBe('api.safe.global')
    }
  })

  it('a chain that cannot be read fails the action as a read, not a refusal', async () => {
    const broken: FetchLike = async (url, init) => (url.includes('/oeth/') ? { ok: false, status: 500, json: async () => ({}) } : service().fetch(url, init))
    const r = await readerWith(broken).prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW } }, null)
    expect(r).toMatchObject({ ok: false, failed: true, error: expect.stringContaining('500') })
  })

  it('a chosen chain where the service has no Safe (404) refuses, naming the chain; nothing is prepared', async () => {
    svc = service()
    delete svc.routes[`${api('oeth')}/v1/safes/${ADDR}/`]
    const r = await reader().prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW } }, null)
    expect(r).toEqual({ ok: false, error: 'no Safe at this address on Optimism' })
  })

  it('removing the only owner is refused', async () => {
    svc = service({ info: { celo: { owners: [A1], threshold: 1 } } })
    const r = await reader().prepareAction(SAFE7, { ...governance, action: 'remove-owner', params: { owner: A1, chains: ['eip155:42220'] } }, null)
    expect(r).toEqual({ ok: false, error: `${A1} is the only owner of this Safe on Celo; a Safe keeps at least one` })
  })

  it('an answer without its threshold or its owners is a failed read in words, never a bare error or an empty owner list', async () => {
    for (const [over, said] of [
      [{ threshold: undefined }, 'the Safe Transaction Service gave no threshold for this Safe on Celo'],
      [{ threshold: 'many' }, 'the Safe Transaction Service gave the threshold "many" for this Safe on Celo, which is not a threshold'],
      [{ owners: undefined }, 'the Safe Transaction Service gave no list of owners for this Safe on Celo'],
    ] as const) {
      svc = service({ info: { celo: over } })
      for (const [action, params] of [['add-owner', { owner: NEW }], ['remove-owner', { owner: A1 }], ['change-threshold', { threshold: 3 }]] as const) {
        const r = await reader().prepareAction(SAFE7, { ...governance, action, params: { ...params, chains: ['eip155:42220'] } }, null)
        expect(r).toEqual({ ok: false, failed: true, error: said })
      }
    }
  })
})

describe('a treasury transaction on another of the Safe\'s chains', () => {
  const TX = { to: '0x00000000000000000000000000000000000a11ce', value: '250000000000000000', data: '0x', operation: 0 as const }

  it('carries that chain in its ref; attach and outcome hash on it', async () => {
    svc = service()
    const p = await safe.prepare!(SAFE2, { proposal: { classes: ['treasury'] }, tx: TX, chain: 'eip155:1' }, ctxWith(svc.fetch))
    if (!p.ok) throw new Error(p.error)
    expect(p.ref.chain).toBe('eip155:1')
    expect(p.payload.nonce).toBe(14)
    expect(p.ref.id).toBe(safeTxHash({ chainId: 1, safe: ADDR, ...p.payload }))
    expect(p.ref.id).not.toBe(safeTxHash({ chainId: 42220, safe: ADDR, ...p.payload }))
    expect(p.link).toBe(`https://app.safe.global/home?safe=eth:${ADDR}`)
    expect(svc.calls.map(c => c.url)).toEqual([`${api('eth')}/v1/safes/${ADDR}/`])
    // the record's chain, as in 0.6: a ref with no chain
    const plain = await safe.prepare!(SAFE2, { proposal: { classes: ['treasury'] }, tx: TX }, ctxWith(svc.fetch))
    if (!plain.ok) throw new Error(plain.error)
    expect(plain.ref).not.toHaveProperty('chain')
    expect(plain.ref.id).toBe(safeTxHash({ chainId: 42220, safe: ADDR, ...plain.payload }))
    // a chain the Safe is not on is refused in words
    expect(await safe.prepare!(SAFE2, { proposal: { classes: ['treasury'] }, tx: TX, chain: 'eip155:10' }, ctxWith(svc.fetch)))
      .toEqual({ ok: false, error: 'eip155:10 is not one of this Safe\'s chains (eip155:42220, eip155:1)' })

    // the outcome reads it on Ethereum
    const answer = { ...txAnswer(p.payload, p.ref.id), isExecuted: true, isSuccessful: true, executionDate: '2026-10-29T13:30:00Z' }
    svc = service({ txs: { [`${api('eth')}/v1/multisig-transactions/${p.ref.id}/`]: answer } })
    expect(await safe.outcome!(SAFE2, p.ref, { ...ctxWith(svc.fetch), opened: OPENED })).toMatchObject({ ok: true, outcome: 'executed' })
    expect(svc.calls.every(c => c.url.startsWith(api('eth')))).toBe(true)
    // the same transaction answered on Celo only: not seen on Ethereum
    svc = service({ txs: { [`${api('celo')}/v1/multisig-transactions/${p.ref.id}/`]: answer } })
    expect(await safe.outcome!(SAFE2, p.ref, { ...ctxWith(svc.fetch), opened: OPENED })).toMatchObject({ ok: true, outcome: 'pending', submitted: false })
    // a ref on a chain that is not one of the Safe's
    await expect(safe.outcome!(SAFE2, { ...p.ref, chain: 'eip155:10' }, { ...ctxWith(svc.fetch), opened: OPENED })).rejects.toThrow('eip155:10 is not one of this Safe\'s chains')
  })
})

/** The service's answer for a transaction made from a prepared payload, as tests/server/fixtures/safe-outcome shapes it. */
function txAnswer(payload: { to: string; value: string; data: string; operation: number; nonce: number }, hash: string) {
  return {
    safe: ADDR, to: payload.to, value: payload.value, data: payload.data === '0x' ? null : payload.data, operation: payload.operation,
    gasToken: ZERO_ADDRESS, safeTxGas: '0', baseGas: '0', gasPrice: '0', refundReceiver: ZERO_ADDRESS, nonce: payload.nonce,
    executionDate: null, submissionDate: '2026-10-29T12:30:00Z', safeTxHash: hash, isExecuted: false, isSuccessful: null,
    confirmationsRequired: 4, confirmations: [{ owner: A1 }],
  }
}

describe('the outcome of one change on several chains', () => {
  async function prepared(): Promise<{ steps: PreparedStep[]; attach: SystemRef }> {
    svc = service()
    const r = ok(await reader().prepareAction(SAFE7, { ...governance, action: 'add-owner', params: { owner: NEW } }, null))
    return { steps: r.steps, attach: r.attach as SystemRef }
  }
  const answers = (steps: PreparedStep[], over: Record<string, Record<string, unknown> | null> = {}) => Object.fromEntries(steps.flatMap(s => {
    const o = over[s.call.chain]
    if (o === null) return []
    return [[`${api(SLUG_OF[s.call.chain]!)}/v1/multisig-transactions/${s.safe!.ref.id}/`, { ...txAnswer(s.safe!.payload, s.safe!.ref.id), ...o }]]
  }))
  const executed = { isExecuted: true, isSuccessful: true, executionDate: '2026-10-29T13:30:00Z' }
  const outcomeOf = (attach: SystemRef, txs: Record<string, unknown>) => {
    svc = service({ txs })
    return safe.outcome!(SAFE7, attach, { ...ctxWith(svc.fetch), opened: OPENED })
  }

  it('all executed is executed', async () => {
    const { steps, attach } = await prepared()
    const all = Object.fromEntries(steps.map(s => [s.call.chain, executed]))
    const r = await outcomeOf(attach, answers(steps, all))
    // L7 §11.2: each chain's own reading rides beside the aggregate (tests/systems/safe.outcome.chains.test.ts).
    expect(r).toMatchObject({ ok: true, outcome: 'executed', detail: 'executed on every chain: Celo, Ethereum, Optimism, Arbitrum, Gnosis, Polygon, Base' })
    expect(Object.keys(r).sort()).toEqual(['chains', 'detail', 'ok', 'outcome'])
    // each step read on its own chain
    for (const s of steps) expect(svc.calls.map(c => c.url)).toContain(`${api(SLUG_OF[s.call.chain]!)}/v1/multisig-transactions/${s.safe!.ref.id}/`)
  })

  it('one still waiting is pending, naming the chains still waiting; nothing of signatures is said', async () => {
    const { steps, attach } = await prepared()
    const all: Record<string, Record<string, unknown> | null> = Object.fromEntries(steps.map(s => [s.call.chain, executed]))
    const r = await outcomeOf(attach, answers(steps, { ...all, 'eip155:10': {}, 'eip155:8453': null }))
    expect(r).toMatchObject({ ok: true, outcome: 'pending', detail: 'waiting on Optimism, Base' })
    expect(Object.keys(r).sort()).toEqual(['chains', 'detail', 'ok', 'outcome']) // nothing of signatures, beside each chain's reading
  })

  it('one failed is failed', async () => {
    const { steps, attach } = await prepared()
    const all = Object.fromEntries(steps.map(s => [s.call.chain, executed]))
    const r = await outcomeOf(attach, answers(steps, { ...all, 'eip155:100': { ...executed, isSuccessful: false } }))
    expect(r).toMatchObject({ ok: true, outcome: 'failed', detail: expect.stringMatching(/^on Gnosis: executed on 2026-10-29T13:30:00Z, and the transaction failed$/) })
  })

  it('a step that is not the one prepared is a mismatch, before anything pending', async () => {
    const { steps, attach } = await prepared()
    const r = await outcomeOf(attach, answers(steps, { 'eip155:137': { value: '1' } }))
    expect(r).toMatchObject({ ok: true, outcome: 'mismatch', detail: 'on Polygon: this transaction is not the one the proposal prepared: its value differs' })
  })

  it('not submitted only when no chain\'s service has seen a step', async () => {
    const { steps, attach } = await prepared()
    expect(await outcomeOf(attach, {})).toMatchObject({ ok: true, outcome: 'pending', submitted: false })
    const one = await outcomeOf(attach, answers(steps, Object.fromEntries(steps.slice(1).map(s => [s.call.chain, null]))))
    expect(one).toMatchObject({ ok: true, outcome: 'pending' })
    expect(one).not.toHaveProperty('submitted')
  })
})

describe('the reader prepares an action and wraps the steps a Safe signs (via)', () => {
  // A stand-in driver whose action is signed by the Safe it is given as `via`: two calls on Celo, one on Ethereum.
  const SPEC: ActionSpec = { id: 'poke', label: 'Poke', class: null, params: [{ name: 'note', label: 'Note', type: 'text', optional: true }] }
  const probe: Driver = {
    name: 'probe', hosts: [], actions: [SPEC],
    async read() { throw new Error('unused') },
    async prepareAction(_system, input) {
      const account = input.via!.account
      const call = (chain: string, n: number) => ({ chain, to: `${chain}:0x00000000000000000000000000000000000000C1`, value: '0', data: `0x0${n}`, operation: 0 as const, summary: `poke ${n}` })
      return { ok: true, action: 'poke', link: null, draft: null, attach: null, steps: [
        { call: call('eip155:42220', 1), signer: { kind: 'safe', account }, safe: null },
        { call: call('eip155:42220', 2), signer: { kind: 'safe', account }, safe: null },
        { call: call('eip155:1', 3), signer: { kind: 'safe', account: `eip155:1:${ADDR}` }, safe: null },
        { call: call('eip155:42220', 4), signer: { kind: 'account', account: `eip155:42220:${A1}` }, safe: null },
      ] }
    },
  }
  const TARGET = { id: 'thing', kind: 'other', name: 'Thing', chain: 'eip155:42220', driver: 'probe' }

  it('wraps each Safe-signed step in a Safe transaction, consecutive nonces per chain; the others stay as they are', async () => {
    svc = service()
    const r = ok(await readerWith(svc.fetch, [probe, { ...safe, minGapMs: 0 }]).prepareAction(TARGET, { proposal: { classes: ['records'] }, action: 'poke', params: {} }, SAFE2))
    expect(r.steps.map(s => s.safe?.payload.nonce ?? null)).toEqual([9, 10, 14, null])
    expect(r.steps[0]!.safe!.payload).toMatchObject({ to: '0x00000000000000000000000000000000000000C1', data: '0x01', operation: 0 })
    expect(r.steps[0]!.safe!.ref).toMatchObject({ system: 'council' })
    expect(r.steps[2]!.safe!.ref.id).toBe(safeTxHash({ chainId: 1, safe: ADDR, ...r.steps[2]!.safe!.payload }))
    // the attach: steps a Safe signs, not all of them, so the driver's null stands
    expect(r.attach).toBeNull()
    expect(svc.calls.every(c => c.method === 'GET')).toBe(true)
  })

  it('reads each chain\'s Safe once: two steps on Celo take n and n+1 even when the nonce moves between reads', async () => {
    svc = service()
    const celoInfo = `${api('celo')}/v1/safes/${ADDR}/`
    let celoReads = 0
    // A service whose Celo nonce moves by one with every read: a second read would give the second step n+2.
    const moving: FetchLike = async (url, init) => {
      if (url !== celoInfo) return svc.fetch(url, init)
      celoReads++
      return { ok: true, status: 200, json: async () => ({ ...load('celo').info, nonce: String(8 + celoReads) }) }
    }
    const r = ok(await readerWith(moving, [probe, { ...safe, minGapMs: 0 }]).prepareAction(TARGET, { proposal: { classes: ['records'] }, action: 'poke', params: {} }, SAFE2))
    expect(celoReads).toBe(1)
    expect(svc.calls.map(c => c.url)).toEqual([`${api('eth')}/v1/safes/${ADDR}/`])
    expect(r.steps.map(s => s.safe?.payload.nonce ?? null)).toEqual([9, 10, 14, null])
  })

  it('a via Safe the service does not have on a step\'s chain refuses, naming the chain', async () => {
    svc = service()
    delete svc.routes[`${api('eth')}/v1/safes/${ADDR}/`]
    const r = await readerWith(svc.fetch, [probe, { ...safe, minGapMs: 0 }]).prepareAction(TARGET, { proposal: { classes: ['records'] }, action: 'poke', params: {} }, SAFE2)
    expect(r).toEqual({ ok: false, error: 'no Safe at this address on Ethereum' })
  })

  it('every step signed by the Safe: the attach is the first step\'s ref with the rest in also', async () => {
    svc = service()
    const only: Driver = { ...probe, async prepareAction(s, input, ctx) {
      const r = await probe.prepareAction!(s, input, ctx)
      return r.ok ? { ...r, steps: r.steps.slice(0, 3) } : r
    } }
    const r = ok(await readerWith(svc.fetch, [only, { ...safe, minGapMs: 0 }]).prepareAction(TARGET, { proposal: { classes: ['records'] }, action: 'poke', params: {} }, SAFE2))
    expect(r.attach).toEqual({ ...r.steps[0]!.safe!.ref, also: r.steps.slice(1).map(s => ({ chain: s.call.chain, id: s.safe!.ref.id, payload: s.safe!.ref.payload })) })
    expect((r.attach as SystemRef).also!.map(a => a.chain)).toEqual(['eip155:42220', 'eip155:1'])
  })

  it('a via that is not a Safe, or not on the target\'s chain, is refused before anything is read', async () => {
    svc = service()
    const rd = readerWith(svc.fetch, [probe, link, { ...safe, minGapMs: 0 }])
    const input = { proposal: { classes: ['records'] }, action: 'poke', params: {} }
    expect(await rd.prepareAction(TARGET, input, { ...SAFE2, driver: 'link' })).toEqual({ ok: false, error: '"council" is not a Safe read by the safe driver, so it cannot sign' })
    expect(await rd.prepareAction({ ...TARGET, chain: 'eip155:10' }, input, SAFE2)).toEqual({ ok: false, error: 'the Safe "council" is not on eip155:10 (its chains: eip155:42220, eip155:1)' })
    expect(await rd.prepareAction({ ...TARGET, driver: 'nope' }, input, null)).toMatchObject({ ok: false, error: expect.stringContaining('no driver named "nope"') })
    expect(await rd.prepareAction({ ...SAFE7, driver: 'link' }, input, null)).toEqual({ ok: false, error: 'the link driver prepares no actions' })
    expect(svc.calls).toEqual([])
  })
})

describe('readParams', () => {
  const spec = (type: ActionSpec['params'][number]['type'], optional = false): ActionSpec =>
    ({ id: 'x', label: 'X', class: null, params: [{ name: 'p', label: 'P', type, ...(optional ? { optional } : {}) }] })
  const read = (type: ActionSpec['params'][number]['type'], value: unknown) => readParams(spec(type), { p: value })

  it('addresses come back checksummed; a bare or CAIP-10 address is accepted; a bad checksum is refused', () => {
    expect(read('address', NEW.toLowerCase())).toEqual({ ok: true, params: { p: NEW } })
    expect(read('address', `eip155:1:${NEW.toLowerCase()}`)).toEqual({ ok: true, params: { p: NEW } })
    expect(read('address', '0x00000000000000000000000000000000000000b1')).toEqual({ ok: true, params: { p: NEW } })
    expect(read('address', '0x5afe00000000000000000000000000000000C0De')).toMatchObject({ ok: false, error: expect.stringContaining('"p"') })
    expect(read('addresses', [A1.toLowerCase(), A2])).toEqual({ ok: true, params: { p: [A1, A2] } })
    expect(read('addresses', [])).toMatchObject({ ok: false })
  })

  it('numbers, text, lists, hats, chains and times', () => {
    expect(read('uint', 7)).toEqual({ ok: true, params: { p: '7' } })
    expect(read('uint', '007')).toEqual({ ok: true, params: { p: '7' } })
    expect(read('uint', -1)).toMatchObject({ ok: false })
    expect(read('uint', '1.5')).toMatchObject({ ok: false })
    expect(read('text', 'a'.repeat(7000))).toMatchObject({ ok: true })
    expect(read('text', 'a'.repeat(7001))).toEqual({ ok: false, error: '"p" is 7001 bytes; at most 7000' })
    expect(read('string', 3)).toMatchObject({ ok: false })
    expect(read('strings', ['a', 'b'])).toEqual({ ok: true, params: { p: ['a', 'b'] } })
    expect(read('strings', ['a', 1])).toMatchObject({ ok: false })
    const HAT = `0x0000000D${'0'.repeat(56)}`
    expect(read('hat', HAT)).toEqual({ ok: true, params: { p: HAT.toLowerCase() } })
    expect(read('hat', '0x0000000d.0001')).toEqual({ ok: true, params: { p: `0x0000000d0001${'0'.repeat(52)}` } })
    expect(read('hat', 'not a hat')).toMatchObject({ ok: false })
    expect(read('chains', ['eip155:1', 'eip155:10'])).toEqual({ ok: true, params: { p: ['eip155:1', 'eip155:10'] } })
    expect(read('chains', ['celo'])).toMatchObject({ ok: false, error: expect.stringContaining('CAIP-2') })
    expect(read('datetime', '2026-11-02T10:00:00Z')).toEqual({ ok: true, params: { p: 1793613600 } })
    expect(read('datetime', '2026-11-02T12:00:00+02:00')).toEqual({ ok: true, params: { p: 1793613600 } })
    expect(read('datetime', '2 November')).toMatchObject({ ok: false })
  })

  it('refuses unknown keys and missing ones by name; an optional one may be absent', () => {
    expect(readParams(spec('uint'), {})).toEqual({ ok: false, error: '"p" is missing' })
    expect(readParams(spec('uint', true), {})).toEqual({ ok: true, params: {} })
    expect(readParams(spec('uint'), { p: 1, q: 2 })).toEqual({ ok: false, error: '"q" is not a parameter of x (it takes p)' })
    expect(readParams(spec('uint'), 'p=1')).toMatchObject({ ok: false })
  })
})

describe('time limits', () => {
  it('the read limit lives with the driver contract, and the reader still exports it', () => {
    expect(READ_TIMEOUT_MS).toBe(8_000)
    expect(READER_TIMEOUT).toBe(READ_TIMEOUT_MS)
  })

  it('prepareSafeTx takes the Safe info it is given, with an offset, and reads nothing', async () => {
    svc = service()
    const p = await prepareSafeTx(SAFE7, 'eip155:10', { to: A1, value: '0', data: '0x', operation: 0 }, ctxWith(svc.fetch), { nonceOffset: 2, info: { nonce: '11', version: '1.3.0' } })
    expect(p).toMatchObject({ ok: true, payload: { nonce: 13 }, ref: { chain: 'eip155:10', system: 'council' } })
    expect(svc.calls).toEqual([])
  })
})
