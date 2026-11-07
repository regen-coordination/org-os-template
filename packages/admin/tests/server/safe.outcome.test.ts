import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { safe, SAFE_REQUEST_GAP_MS } from '../../server/systems/safe.ts'
import { guardedFetch, type FetchLike, type DriverContext, type SystemRef } from '../../server/systems/driver.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { safeTxHash, dataHash, chainIdOf, ZERO_ADDRESS } from '../../lib/safe-tx.mjs'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { resolveRoles } from '../../lib/rules.mjs'

// The Safe driver's `prepare` and `outcome` (0.6 P2 spec §3.11, M6, LOW-6). No test touches the network: the Safe
// Transaction Service is a fake that answers the JSON recorded in fixtures/safe-outcome (the shape of the service's
// own answers, as tests/systems/fixtures/safe-celo recorded them; the Safe, its owners and its transactions are
// synthetic). Each fixture's `safeTxHash` is the hash of its own fields.

const DIR = new URL('./fixtures/safe-outcome/', import.meta.url)
const load = (file: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
const ADDR = '0x5afe000000000000000000000000000000005afe'
const API = 'https://api.safe.global/tx-service/celo/api'
const INFO = `${API}/v1/safes/${ADDR}/`
const txUrl = (hash: string) => `${API}/v1/multisig-transactions/${hash}/`
const SYSTEM = { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: ADDR, driver: 'safe' }
const NOW = new Date('2026-10-19T10:00:00Z')
const OPENED = '2026-10-18T12:00:00Z'
const TX = { to: '0x00000000000000000000000000000000000a11ce', value: '250000000000000000', data: '0x', operation: 0 as const }
const HASH = '0xb654430c2746c667a0b73282191427a86062e8a20e2e6724371fd853abc52008'
const REF: SystemRef = {
  system: 'treasury-safe', id: HASH,
  payload: { to: TX.to, value: TX.value, data_hash: dataHash('0x'), operation: 0, nonce: 8 },
}

/** The service as the fixtures recorded it; any other address is a 404. Every request is kept, with its method. */
function service(routes: Record<string, unknown>) {
  const calls: { url: string; method: string }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method })
    const body = routes[url]
    return body === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => body }
  }
  return { calls, fetch }
}
const ctxWith = (fetch: FetchLike, over: Partial<DriverContext> = {}): DriverContext =>
  ({ fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => NOW, members: [], sleep: async () => {}, ...over })
const outcomeOf = (fetch: FetchLike, ref: SystemRef = REF, opened = OPENED, over: Partial<DriverContext> = {}) =>
  safe.outcome!(SYSTEM, ref, { ...ctxWith(fetch, over), opened })
const prepareOf = (fetch: FetchLike, input: { classes?: string[]; tx?: Record<string, unknown> } = {}) =>
  safe.prepare!(SYSTEM, { proposal: { classes: input.classes ?? ['treasury'] }, tx: (input.tx ?? TX) as never }, ctxWith(fetch))

describe('the Safe transaction hash (lib/safe-tx.mjs, on lib/keccak.mjs)', () => {
  // Published example: safe-eth-py, the Safe team's Python library, test `test_hash_safe_multisig_tx_1_3`,
  // https://github.com/safe-global/safe-eth-py/blob/70f60381e681298aa0f39f4fbd9dc5ec9baa5d3a/safe_eth/safe/tests/test_safe_tx.py#L405-L437
  // (a Safe 1.3.0 on Rinkeby, chain id 4). Every input and the resulting safeTxHash are copied from it as written.
  const PUBLISHED = {
    chainId: 4, safe: '0x2B0b9cBDA3D7b0F760187c52A8FFB18C48E5d96A',
    to: '0x79613FD49472C3C7a32188e45ff00e7bdC8a897d', value: '2', data: '0x1212', operation: 0,
    safeTxGas: '0', baseGas: '0', gasPrice: '0',
    gasToken: '0xFA995c7a0d32A4e7497508a5C380369BE8dB49Db', refundReceiver: '0x6b92f5E5360bfCa8F5d3FcE65D87382967847983', nonce: 17,
  }

  it('gives the safeTxHash safe-eth-py publishes for a Safe 1.3.0 transaction', () => {
    expect(safeTxHash(PUBLISHED)).toBe('0x01d42a801ac44d3ebd43592be980dea0756d7f7b27d718d3016a42ea7ce85587')
  })

  it('is the same from the data or from its Keccak-256 hash, and changes with the chain, the Safe, the nonce or the data', () => {
    const { data, ...rest } = PUBLISHED
    expect(safeTxHash({ ...rest, dataHash: dataHash(data) })).toBe(safeTxHash(PUBLISHED))
    const base = safeTxHash(PUBLISHED)
    expect(safeTxHash({ ...PUBLISHED, chainId: 1 })).not.toBe(base)
    expect(safeTxHash({ ...PUBLISHED, safe: ADDR })).not.toBe(base)
    expect(safeTxHash({ ...PUBLISHED, nonce: 18 })).not.toBe(base)
    expect(safeTxHash({ ...PUBLISHED, data: '0x1213' })).not.toBe(base)
  })

  it('the hash of empty data is Keccak-256 of nothing; a CAIP-2 eip155 chain gives its chain id', () => {
    expect(dataHash('0x')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
    expect(dataHash(null)).toBe(dataHash('0x'))
    expect(chainIdOf('eip155:42220')).toBe(42220)
    expect(chainIdOf('cosmos:hub')).toBeNull()
  })

  it('refuses inputs that are not a transaction, in words', () => {
    expect(() => safeTxHash({ ...PUBLISHED, to: '0x1234' })).toThrow(/"0x1234" is not an address/)
    expect(() => safeTxHash({ ...PUBLISHED, value: '-1' })).toThrow(/value/)
    expect(() => safeTxHash({ ...PUBLISHED, data: '0x123' })).toThrow(/data/)
    expect(() => safeTxHash({ ...PUBLISHED, operation: 2 })).toThrow(/operation/)
  })
})

describe('prepare (class treasury)', () => {
  it('yields the payload, the hash computed from it with the nonce the Safe reports, and the Safe app link; it only GETs the Safe', async () => {
    const { calls, fetch } = service({ [INFO]: load('safe.json') })
    const prepared = await prepareOf(fetch)
    expect(prepared).toEqual({
      ok: true,
      payload: { ...TX, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: ZERO_ADDRESS, refundReceiver: ZERO_ADDRESS, nonce: 8 },
      ref: REF,
      link: `https://app.safe.global/home?safe=celo:${ADDR}`,
    })
    // the hash is the one lib/safe-tx.mjs gives for that payload, from the system record's chain and address
    if (!prepared.ok) throw new Error('unreachable')
    expect(prepared.ref.id).toBe(safeTxHash({ chainId: 42220, safe: ADDR, ...prepared.payload }))
    // posts nothing: one GET, of the Safe itself
    expect(calls).toEqual([{ url: INFO, method: 'GET' }])
  })

  it('a Safe older than 1.3.0 is answered in words and gets no hash', async () => {
    const { fetch } = service({ [INFO]: { ...load('safe.json'), version: '1.2.0' } })
    const prepared = await prepareOf(fetch)
    expect(prepared).toEqual({ ok: false, error: expect.stringContaining('older than 1.3.0') })
    expect(prepared).not.toHaveProperty('ref')
  })

  it('a Safe whose version the service does not say is answered in words', async () => {
    const { fetch } = service({ [INFO]: { ...load('safe.json'), version: null } })
    expect(await prepareOf(fetch)).toEqual({ ok: false, error: expect.stringContaining('version') })
  })

  it('refuses, before any request, a proposal that is not of class treasury and a transaction that is not one', async () => {
    const { calls, fetch } = service({ [INFO]: load('safe.json') })
    expect(await prepareOf(fetch, { classes: ['records'] })).toEqual({ ok: false, error: expect.stringContaining('treasury') })
    expect(await prepareOf(fetch, { tx: { ...TX, to: 'alice' } })).toEqual({ ok: false, error: expect.stringContaining('"alice" is not an address') })
    expect(calls).toEqual([])
  })
})

describe('outcome(ref)', () => {
  const routes = (tx: string, info: Record<string, unknown> = load('safe.json'), hash = HASH) => ({ [txUrl(hash)]: load(tx), [INFO]: info })

  it('an unexecuted transaction with 1 of 2 confirmations is pending, with that detail', async () => {
    expect(await outcomeOf(service(routes('tx-pending.json')).fetch))
      .toEqual({ ok: true, outcome: 'pending', confirmations: 1, required: 2, detail: '1 of 2 signatures' })
  })

  it('executed and successful is executed; executed and failed is failed', async () => {
    expect(await outcomeOf(service(routes('tx-executed.json')).fetch))
      .toEqual({ ok: true, outcome: 'executed', confirmations: 2, required: 2, detail: 'executed on 2026-10-19T09:12:40Z' })
    expect(await outcomeOf(service(routes('tx-failed.json')).fetch))
      .toEqual({ ok: true, outcome: 'failed', confirmations: 2, required: 2, detail: 'executed on 2026-10-19T09:12:40Z, and the transaction failed' })
  })

  it('reads only the declared host, by GET, the Safe after the transaction and a request gap apart', async () => {
    const { calls, fetch } = service(routes('tx-pending.json'))
    const waits: number[] = []
    await outcomeOf(fetch, REF, OPENED, { sleep: async ms => { waits.push(ms) } })
    expect(calls).toEqual([{ url: txUrl(HASH), method: 'GET' }, { url: INFO, method: 'GET' }])
    expect(waits).toEqual([SAFE_REQUEST_GAP_MS])
  })

  it('a 404 is a sentence: the transaction is not in the Safe yet', async () => {
    const { fetch } = service({ [INFO]: load('safe.json') })
    expect(await outcomeOf(fetch)).toEqual({
      ok: true, outcome: 'pending', submitted: false,
      detail: `transaction ${HASH} is not in the Safe Transaction Service yet: a signer adds it in the Safe app, with the payload the proposal prepared`,
    })
  })

  describe('M6: the transaction read must be the one the proposal prepared', () => {
    const NOT = 'this transaction is not the one the proposal prepared'
    const answering = (over: Record<string, unknown>) => service({ [txUrl(HASH)]: { ...load('tx-executed.json'), ...over }, [INFO]: load('safe.json') }).fetch

    it('a safeTxHash that differs from the attached one is a mismatch', async () => {
      const other = `0x${'ab'.repeat(32)}`
      expect(await outcomeOf(answering({ safeTxHash: other })))
        .toEqual({ ok: true, outcome: 'mismatch', detail: `${NOT}: the Safe answered for ${other}, and the proposal attached ${HASH}` })
    })

    it('a `to`, `value` or `data` that differs from the attached payload is a mismatch, even executed', async () => {
      expect(await outcomeOf(answering({ to: '0x000000000000000000000000000000000000beef' }))).toEqual({ ok: true, outcome: 'mismatch', detail: `${NOT}: its to differs` })
      expect(await outcomeOf(answering({ value: '1' }))).toEqual({ ok: true, outcome: 'mismatch', detail: `${NOT}: its value differs` })
      expect(await outcomeOf(answering({ data: '0x00' }))).toEqual({ ok: true, outcome: 'mismatch', detail: `${NOT}: its data differs` })
    })

    it('the hash is recomputed from the fields the Safe describes: a safeTxHash field that matches does not make a transaction whose fields hash otherwise the one prepared', async () => {
      const forged = load('tx-forged.json')
      expect(forged.safeTxHash).toBe(HASH) // the service names the attached hash
      const own = safeTxHash({
        chainId: 42220, safe: ADDR, to: String(forged.to), value: String(forged.value), data: forged.data as null, operation: 0,
        safeTxGas: String(forged.safeTxGas), baseGas: String(forged.baseGas), gasPrice: String(forged.gasPrice),
        gasToken: String(forged.gasToken), refundReceiver: String(forged.refundReceiver), nonce: Number(forged.nonce),
      })
      expect(own).not.toBe(HASH)
      expect(await outcomeOf(service({ [txUrl(HASH)]: forged, [INFO]: load('safe.json') }).fetch))
        .toEqual({ ok: true, outcome: 'mismatch', detail: `${NOT}: the transaction the Safe describes hashes to ${own}, not to the attached ${HASH}` })
      // and an answer whose fields cannot be hashed is not the one prepared either
      expect(await outcomeOf(answering({ operation: 7 }))).toMatchObject({ ok: true, outcome: 'mismatch', detail: expect.stringContaining(`${NOT}: the Safe's answer cannot be hashed`) })
    })

    it('an address in another case is the same address', async () => {
      expect(await outcomeOf(answering({ to: TX.to.toUpperCase().replace('0X', '0x') }))).toMatchObject({ outcome: 'executed' })
    })

    it('LOW-6: a transaction put in the Safe before the proposal opened is refused with its sentence', async () => {
      const reading = await outcomeOf(answering({ submissionDate: '2026-10-18T11:59:59Z' }))
      expect(reading).toEqual({
        ok: true, outcome: 'mismatch',
        detail: `${NOT}: it was put in the Safe on 2026-10-18T11:59:59Z, before the proposal opened on ${OPENED}. Withdraw the proposal and propose again, or revise it to prepare a new transaction.`,
      })
    })

    it('an executed, unrelated old transaction attached to a new proposal stays pending (the first review\'s case)', async () => {
      const old = load('tx-old-executed.json')
      const ref: SystemRef = {
        system: 'treasury-safe', id: String(old.safeTxHash),
        payload: { to: String(old.to), value: String(old.value), data_hash: dataHash(String(old.data)), operation: 0, nonce: 3 },
      }
      // the attach would pass: its id is the hash of its payload
      expect(ref.id).toBe(safeTxHash({ chainId: 42220, safe: ADDR, to: ref.payload.to, value: ref.payload.value, dataHash: ref.payload.data_hash, operation: 0, nonce: 3 }))
      const reading = await outcomeOf(service({ [txUrl(ref.id)]: old, [INFO]: load('safe.json') }).fetch, ref)
      expect(reading).toMatchObject({ ok: true, outcome: 'mismatch' })
      // and the evaluator, reading that event, keeps the proposal pending
      const rule = { id: 'treasury', applies_to: ['treasury'], propose: 'member', decide: { by: 'system', method: 'system', system: 'treasury-safe' } }
      const proposal = {
        author: 'ana', opened: OPENED, rev: 'r1', rules: [rule],
        events: [
          // both of the current rev, as the server writes them (an attach and a reading of another rev do not count: D156)
          { id: 'e-1', at: '2026-10-18T12:01:00Z', by: 'ana', kind: 'attach', rev: 'r1', ref },
          { id: 'e-2', at: '2026-10-18T12:02:00Z', by: 'system:treasury-safe', kind: 'system', rev: 'r1', ref, outcome: (reading as { outcome: string }).outcome },
        ],
      }
      const evaluation = evaluateAll({ proposal: proposal as never, book: resolveRoles({ roles: {} }, []), now: NOW })
      expect(evaluation.state).toBe('pending')
      expect(evaluation.missing).toBe(NOT)
    })

    it('LOW-6: a Safe nonce that moved past the prepared one reads mismatch, before and after the transaction is in the Safe', async () => {
      const moved = { ...load('safe.json'), nonce: '9' }
      const sentence = "the Safe's nonce changed; revise the proposal to prepare again"
      expect(await outcomeOf(service(routes('tx-pending.json', moved)).fetch)).toEqual({ ok: true, outcome: 'mismatch', detail: sentence })
      expect(await outcomeOf(service({ [INFO]: moved }).fetch)).toEqual({ ok: true, outcome: 'mismatch', detail: sentence })
    })
  })

  describe('through the reader: a failure is an answer, never a throw', () => {
    it('a timeout is a failed reading', async () => {
      const silent: FetchLike = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
      const reader = new SystemReader({ repo: '/nonexistent', fetch: silent, timeoutMs: 50, now: () => NOW })
      await expect(reader.outcome(SYSTEM, REF, OPENED)).resolves.toEqual({ ok: false, error: 'no answer within 0.05 s' })
    })

    it('an undeclared host is refused before any request', async () => {
      const { calls, fetch } = service(routes('tx-pending.json'))
      const elsewhere = { ...safe, hosts: ['elsewhere.example'] }
      const reader = new SystemReader({ repo: '/nonexistent', fetch, drivers: [elsewhere], now: () => NOW })
      const reading = await reader.outcome(SYSTEM, REF, OPENED)
      expect(reading).toEqual({ ok: false, error: expect.stringMatching(/^refused: the safe driver declared elsewhere\.example, not https:\/\/api\.safe\.global/) })
      expect(calls).toEqual([])
    })

    it('a reader with no network, and a driver that reads no outcomes, say so', async () => {
      expect(await new SystemReader({ repo: '/nonexistent' }).outcome(SYSTEM, REF, OPENED)).toEqual({ ok: false, error: 'this reader was given no network access' })
      const { fetch } = service({})
      expect(await new SystemReader({ repo: '/nonexistent', fetch }).outcome({ ...SYSTEM, driver: 'link' }, REF, OPENED))
        .toEqual({ ok: false, error: 'the link driver reads no outcomes' })
    })

    it('a good reading comes back as the driver gave it', async () => {
      // no pacing between reads here (the driver's own gap between its two requests still runs)
      const reader = new SystemReader({ repo: '/nonexistent', fetch: service(routes('tx-pending.json')).fetch, drivers: [{ ...safe, minGapMs: 0 }], now: () => NOW })
      expect(await reader.outcome(SYSTEM, REF, OPENED)).toEqual({ ok: true, outcome: 'pending', confirmations: 1, required: 2, detail: '1 of 2 signatures' })
    })

    it('a good reading is kept for the outcome TTL; a failed one is not', async () => {
      let now = NOW
      const { calls, fetch } = service(routes('tx-pending.json'))
      const reader = new SystemReader({ repo: '/nonexistent', fetch, drivers: [{ ...safe, minGapMs: 0 }], now: () => now, outcomeTtlMs: 30_000 })
      await reader.outcome(SYSTEM, REF, OPENED)
      await reader.outcome(SYSTEM, REF, OPENED)
      expect(calls).toHaveLength(2) // one reading: the transaction, then the Safe
      now = new Date(NOW.getTime() + 30_000)
      await reader.outcome(SYSTEM, REF, OPENED)
      expect(calls).toHaveLength(4)
      // a failed reading (the Safe itself answers 404) is not kept: the next ask goes to the service again
      const empty = service({})
      const failing = new SystemReader({ repo: '/nonexistent', fetch: empty.fetch, drivers: [{ ...safe, minGapMs: 0 }], now: () => NOW, outcomeTtlMs: 30_000 })
      expect((await failing.outcome(SYSTEM, REF, OPENED)).ok).toBe(false)
      expect((await failing.outcome(SYSTEM, REF, OPENED)).ok).toBe(false)
      expect(empty.calls).toHaveLength(4)
    }, 15_000)
  })
})
