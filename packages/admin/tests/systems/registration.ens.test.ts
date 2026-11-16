// DAO-OS L7 Task 14 (L7-D13, spec §8.5): a daoURI registration on Sepolia is the ENS text record `daouri` of the DAO's
// Sepolia ENS name. The daouri-registration driver reads it with one eth_call: the Universal Resolver's
// `resolve(bytes name, bytes data)` with `data = text(bytes32 node, "daouri")` (ens-contracts IUniversalResolver at
// ebe0b84852134c6236727defc0704471215c23c0; on Sepolia the proxy https://docs.ens.domains/learn/deployments names,
// lib/deployments.mjs). The answer is recorded: `(bytes result, address resolver)`, `result` the ABI string. No network.
import { describe, it, expect } from 'vitest'
import { daoUriRegistration } from '../../server/systems/registration.ts'
import { guardedFetch, guardedPost, READ_RPC_METHODS, type DriverContext, type FetchLike } from '../../server/systems/driver.ts'
import { CHAINS } from '../../server/systems/chains.ts'
import { decodeResult, encodeArgs, encodeCall } from '../../lib/abi.mjs'
import { DEPLOYMENTS } from '../../lib/deployments.mjs'
import { ENS_SIGNATURES, dnsEncode, namehash } from '../../lib/ens.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'
import { contractsDoc, registrationProblems } from '../../lib/standards/contracts.mjs'

const SEPOLIA = 'eip155:11155111'
const UR = DEPLOYMENTS[SEPOLIA]!.ens.universalResolver
const RESOLVER = '0x00000000000000000000000000000000000000e5'
const SYSTEM = { id: 'test-dao-registration', kind: 'daouri-registration', driver: 'daouri-registration', name: 'Test DAO daoURI', chain: SEPOLIA, ens: 'test-dao.eth' }
const URI = 'https://dao.example.org/.well-known/dao.json'
const NOW = new Date('2026-11-06T12:00:00Z')
const resolved = (text: string) => encodeArgs(['bytes', 'address'], [encodeArgs(['string'], [text]), RESOLVER])

function world(answer: (r: any) => unknown) {
  const seen: { method: string; url: string; body?: any }[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined
    seen.push({ method: init.method, url, body })
    const out = body.map((r: any) => r.method === 'eth_blockNumber' ? { jsonrpc: '2.0', id: r.id, result: '0x10' } : { jsonrpc: '2.0', id: r.id, ...(answer(r) as object) })
    return { ok: true, status: 200, json: async () => out }
  }
  const ctx = (): DriverContext => ({
    fetchJson: guardedFetch(daoUriRegistration, fetch, new AbortController().signal),
    postJson: guardedPost(daoUriRegistration, fetch, new AbortController().signal),
    rpcUrl: chain => (CHAINS[chain]?.rpc ? `https://${CHAINS[chain].rpc}/` : null),
    now: () => NOW, members: [],
  })
  return { seen, ctx }
}

describe('the daouri-registration driver, by ENS text (L7 Task 14)', () => {
  it('sends one eth_call, resolve(name, text(node, "daouri")) on the Universal Resolver, and reads facts.daoURI', async () => {
    const w = world(() => ({ result: resolved(URI) }))
    const read = await daoUriRegistration.read(SYSTEM, w.ctx())
    expect(w.seen).toHaveLength(1)
    expect(w.seen[0]!.url).toBe(`https://${CHAINS[SEPOLIA]!.rpc}/`)
    const calls = w.seen[0]!.body.filter((r: any) => r.method === 'eth_call')
    expect(calls).toHaveLength(1)
    expect(calls[0].params[0].to.toLowerCase()).toBe(UR.toLowerCase())
    expect(calls[0].params[0].data).toBe(encodeCall(ENS_SIGNATURES.resolve, [dnsEncode('test-dao.eth'), encodeCall(ENS_SIGNATURES.text, [namehash('test-dao.eth'), 'daouri'])]))
    for (const r of w.seen[0]!.body) expect(READ_RPC_METHODS).toContain(r.method)
    expect(read.ok).toBe(true)
    expect(read.facts).toEqual({ chain: SEPOLIA, ens: 'test-dao.eth', resolver: `${SEPOLIA}:0x00000000000000000000000000000000000000E5`, daoURI: URI })
    expect(read.sections[0]!.rows[0]!.cells).toEqual(['daoURI', URI])
    expect(read.open).toEqual({ url: 'https://sepolia.app.ens.domains/test-dao.eth', embeddable: false })
  })

  it('an empty text record reads no daoURI, said as a warning', async () => {
    const read = await daoUriRegistration.read(SYSTEM, world(() => ({ result: resolved('') })).ctx())
    expect(read.facts.daoURI).toBeNull()
    expect(read.sections[0]!.rows[0]).toMatchObject({ cells: ['daoURI', 'no daouri text record on test-dao.eth'], attention: 'warn' })
  })

  it('a resolve the Universal Resolver refuses (no resolver, say) is a failed read in words', async () => {
    await expect(daoUriRegistration.read(SYSTEM, world(() => ({ error: { code: 3, message: 'execution reverted' } })).ctx()))
      .rejects.toThrow('the Universal Resolver did not resolve test-dao.eth (execution reverted)')
  })

  it('is read on Sepolia only: the Universal Resolver this Hub cites is Sepolia\'s', async () => {
    await expect(daoUriRegistration.read({ ...SYSTEM, chain: 'eip155:1' }, world(() => ({ result: resolved(URI) })).ctx()))
      .rejects.toThrow('a daoURI registration by ENS text is read on Sepolia (eip155:11155111) only')
  })

  it('the recorded answer is what decodeResult reads back', () => {
    const [bytes, resolver] = decodeResult(['bytes', 'address'], resolved(URI)) as [string, string]
    expect(decodeResult(['string'], bytes)).toEqual([URI])
    expect(resolver.toLowerCase()).toBe(RESOLVER)
  })
})

describe('the standards read an ENS registration', () => {
  const pub = (read: unknown) => ({ identity: { name: 'Test DAO', type: 'DAO', daoURI: URI }, systems: [{ ...SYSTEM, visibility: 'public' }], reads: { [SYSTEM.id]: read } } as never)
  it('a different text is the L8 warn under dao.json', () => {
    expect(registrationProblems(pub({ ok: true, facts: { daoURI: 'https://elsewhere.example.org/dao.json' } }))).toEqual([{
      level: 'warn', file: 'dao.json', text: `system test-dao-registration registers daoURI https://elsewhere.example.org/dao.json, but this organisation's daoURI is ${URI}`,
    }])
    expect(registrationProblems(pub({ ok: true, facts: { daoURI: URI } }))).toEqual([])
  })
  it('is a text record, not a contract: contracts.json neither lists it nor warns about its address', () => {
    expect(contractsDoc(pub(null))).toEqual({ doc: { '@context': 'https://www.daostar.org/schemas', contracts: [] }, problems: [] })
  })
})

describe('the schema: a registration names an ENS name instead of an address', () => {
  const errs = (e: unknown) => validateEntry('systems', e).filter((p: { level: string }) => p.level === 'error')
  it('deployed with `ens` and `chain` it validates; with neither `ens` nor `address` it is refused', () => {
    expect(errs({ ...SYSTEM, deployment: { status: 'deployed', read_back: '2026-11-06' } })).toEqual([])
    const { ens: _e, ...bare } = SYSTEM
    expect(errs(bare).some((p: { message: string }) => /address|ens/.test(p.message))).toBe(true)
  })
  it('an `ens` that is not a .eth name is refused', () => {
    expect(errs({ ...SYSTEM, ens: 'test-dao.com' }).length).toBeGreaterThan(0)
  })
  it('composed, it needs neither chain nor address', () => {
    const { chain: _c, ...composed } = SYSTEM
    expect(errs({ ...composed, deployment: { status: 'composed' } })).toEqual([])
  })
})
