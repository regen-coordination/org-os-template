import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { SystemReader, systemAttention } from '../../server/systems/reader.ts'
import type { Driver, DriverRead, FetchLike } from '../../server/systems/driver.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const NOW = new Date('2026-10-16T09:00:00Z')
const good = (facts: Record<string, unknown> = {}): DriverRead => ({ ok: true, readAt: NOW.toISOString(), facts, sections: [], open: null })
/** A driver that reads one number from a host it declares. */
const probe: Driver = {
  name: 'probe', hosts: ['api.example.org'],
  async read(system, ctx) { return good({ n: ((await ctx.fetchJson(`https://api.example.org/${String(system.id)}`)) as { n: number }).n }) },
}
const SYS = { id: 'box', kind: 'probe', name: 'Box', driver: 'probe' }
const counting = () => {
  const calls: string[] = []
  const fetch: FetchLike = async url => { calls.push(url); return { ok: true, status: 200, json: async () => ({ n: calls.length }) } }
  return { calls, fetch }
}

describe('SystemReader', () => {
  it('reads once within five minutes, and again after', async () => {
    let now = NOW
    const { calls, fetch } = counting()
    const reader = new SystemReader({ repo, fetch, now: () => now, drivers: [probe] })
    expect((await reader.read(SYS)).facts).toEqual({ n: 1 })
    now = new Date(NOW.getTime() + 4 * 60_000)
    expect((await reader.read(SYS)).facts).toEqual({ n: 1 })
    now = new Date(NOW.getTime() + 5 * 60_000)
    expect((await reader.read(SYS)).facts).toEqual({ n: 2 })
    expect(calls).toEqual(['https://api.example.org/box', 'https://api.example.org/box'])
  })

  it('expire() makes the next read fetch fresh, even a few ms inside the TTL', async () => {
    let now = NOW
    const { calls, fetch } = counting()
    const reader = new SystemReader({ repo, fetch, now: () => now, drivers: [probe] })
    await reader.read(SYS)
    now = new Date(NOW.getTime() + 5 * 60_000 - 10)
    expect((await reader.read(SYS)).facts).toEqual({ n: 1 })
    reader.expire()
    expect((await reader.read(SYS)).facts).toEqual({ n: 2 })
    expect(calls).toHaveLength(2)
  })

  it('a read that takes too long fails, and keeps the last good read with its age', async () => {
    let hang = false
    const seen: { aborted: boolean }[] = []
    const fetch: FetchLike = (_url, init) => { seen.push({ aborted: init.signal.aborted }); return (hang
      ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ n: 7 }) })) }
    expect((await new SystemReader({ repo, fetch, now: () => NOW, drivers: [probe] }).read(SYS)).ok).toBe(true)
    hang = true
    // A new reader: the last good read comes from disk, not from memory.
    const read = await new SystemReader({ repo, fetch, now: () => NOW, drivers: [probe], timeoutMs: 30 }).read(SYS)
    expect(read).toMatchObject({ ok: false, error: 'no answer within 0.03 s', facts: { n: 7 }, readAt: NOW.toISOString() })
    expect(systemAttention(read)).toEqual({ level: 'warn', text: 'read failed: no answer within 0.03 s' })
  })

  it('a driver that goes on after the time limit never issues another request', async () => {
    const seen: boolean[] = []
    const fetch: FetchLike = (_url, init) => { seen.push(init.signal.aborted); return new Promise(() => {}) }
    let late: Promise<unknown> | null = null
    const slow: Driver = { name: 'slow', hosts: ['api.example.org'], async read(_s, ctx) {
      void ctx.fetchJson('https://api.example.org/a').catch(() => {})
      await new Promise(r => setTimeout(r, 80))
      late = ctx.fetchJson('https://api.example.org/b')
      await late.catch(() => {})
      return good()
    } }
    const read = await new SystemReader({ repo, fetch, drivers: [slow], timeoutMs: 20 }).read({ ...SYS, driver: 'slow' })
    expect(read.ok).toBe(false)
    await new Promise(r => setTimeout(r, 120))
    expect(seen).toEqual([false]) // the first request was live; the one after the abort never went out
    await expect(late).rejects.toThrow()
  })

  it('refuses a host the driver did not declare, without calling it', async () => {
    const sneaky: Driver = { name: 'sneaky', hosts: ['api.example.org'], async read(_s, ctx) { await ctx.fetchJson('https://elsewhere.example/x'); return good() } }
    const { calls, fetch } = counting()
    const read = await new SystemReader({ repo, fetch, drivers: [sneaky] }).read({ ...SYS, driver: 'sneaky' })
    expect(read).toMatchObject({ ok: false, error: 'refused: the sneaky driver declared api.example.org, not https://elsewhere.example' })
    expect(calls).toEqual([])
  })

  it.each([
    ['another port', 'https://api.example.org:8443/x'],
    ['credentials', 'https://user:pw@api.example.org/x'],
  ])('refuses a declared host with %s', async (_why, url) => {
    const bad: Driver = { name: 'bad', hosts: ['api.example.org'], async read(_s, ctx) { await ctx.fetchJson(url); return good() } }
    const { calls, fetch } = counting()
    expect((await new SystemReader({ repo, fetch, drivers: [bad] }).read({ ...SYS, driver: 'bad' })).error).toMatch(/^refused:/)
    expect(calls).toEqual([])
  })

  it('a host that cannot be reached says why, in the words of the error underneath', async () => {
    const offline: FetchLike = async () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.example.org') }) }
    expect((await new SystemReader({ repo, fetch: offline, drivers: [probe] }).read(SYS)).error)
      .toBe('api.example.org could not be reached (getaddrinfo ENOTFOUND api.example.org)')
    const bare: FetchLike = async () => { throw new TypeError('fetch failed') }
    expect((await new SystemReader({ repo, fetch: bare, drivers: [probe] }).read({ ...SYS, id: 'box-2' })).error)
      .toBe('api.example.org could not be reached (fetch failed)')
  })

  it('refuses plain http, even to a declared host', async () => {
    const plain: Driver = { name: 'plain', hosts: ['api.example.org'], async read(_s, ctx) { await ctx.fetchJson('http://api.example.org/x'); return good() } }
    const { calls, fetch } = counting()
    expect((await new SystemReader({ repo, fetch, drivers: [plain] }).read({ ...SYS, driver: 'plain' })).error).toMatch(/^refused:/)
    expect(calls).toEqual([])
  })

  it('a driver that throws, a driver nobody installed, a reader without network: each a failed read, never an exception', async () => {
    const broken: Driver = { name: 'broken', hosts: [], async read() { throw new Error('boom') } }
    const reader = new SystemReader({ repo, drivers: [broken, probe] })
    expect(await reader.read({ ...SYS, driver: 'broken' })).toEqual({ ok: false, readAt: null, error: 'boom', facts: {}, sections: [], open: null })
    expect((await reader.read({ ...SYS, driver: 'gardens' })).error).toBe('no driver named "gardens" is installed (there are: broken, probe)')
    expect((await reader.read(SYS)).error).toBe('this reader was given no network access')
  })

  it('an edited entry does not show the old entry\'s last good read', async () => {
    const { fetch } = counting()
    await new SystemReader({ repo, fetch, drivers: [probe] }).read(SYS)
    const read = await new SystemReader({ repo, drivers: [probe] }).read({ ...SYS, name: 'Box, renamed' })
    expect(read).toMatchObject({ ok: false, facts: {}, readAt: null })
  })
})

describe('systemAttention', () => {
  const rows = (attention?: 'warn' | 'alert') => [{ cells: ['x'], ...(attention ? { attention } : {}) }]
  it('alert rows first, then warn rows, else nothing', () => {
    expect(systemAttention({ ...good(), sections: [{ title: 'Signers', rows: rows('warn') }, { title: 'Waiting on signers', rows: [...rows('alert'), ...rows('alert')] }] }))
      .toEqual({ level: 'alert', text: 'Waiting on signers: 2' })
    expect(systemAttention({ ...good(), sections: [{ title: 'Signers', rows: rows('warn') }] })).toEqual({ level: 'warn', text: 'Signers: 1' })
    expect(systemAttention({ ...good(), sections: [{ title: 'Balances', rows: rows() }] })).toBeNull()
  })
})

describe('stateOf (the reading machine)', () => {
  const down: Driver = { name: 'probe', hosts: ['api.example.org'], read: async () => ({ ok: false, readAt: null, error: 'down', facts: {}, sections: [], open: null }) }

  it('follows a system from unknown through reading to fresh, then aged past the TTL', async () => {
    let now = NOW
    const { fetch } = counting()
    const reader = new SystemReader({ repo, fetch, now: () => now, drivers: [probe], ttlMs: 1000 })
    expect(reader.stateOf('box')).toBe('unknown')
    const p = reader.read(SYS)
    expect(reader.stateOf('box')).toBe('reading')
    await p
    expect(reader.stateOf('box')).toBe('fresh')
    now = new Date(NOW.getTime() + 1000)
    expect(reader.stateOf('box')).toBe('aged')
    await reader.read(SYS)
    expect(reader.stateOf('box')).toBe('fresh')
  })

  it('a failed read is failed; a cache hit moves nothing', async () => {
    const { fetch } = counting()
    const reader = new SystemReader({ repo, fetch, now: () => NOW, drivers: [down] })
    await reader.read(SYS)
    expect(reader.stateOf('box')).toBe('failed')
    await reader.read(SYS) // within the failed read's minute: served from the cache
    expect(reader.stateOf('box')).toBe('failed')
  })

  it('an overtaken read does not set the state: the newer entry\'s read does (Review Focus 3)', async () => {
    let release!: () => void
    const twoSpeed: Driver = { name: 'probe', hosts: ['api.example.org'], read: system => (system.name === 'Box, renamed'
      ? Promise.resolve(good())
      : new Promise<DriverRead>(r => { release = () => r({ ok: false, readAt: null, error: 'late', facts: {}, sections: [], open: null }) })) }
    const { fetch } = counting()
    const reader = new SystemReader({ repo, fetch, now: () => NOW, drivers: [twoSpeed] })
    const first = reader.read(SYS)
    await reader.read({ ...SYS, name: 'Box, renamed' })
    expect(reader.stateOf('box')).toBe('fresh')
    release()
    await first
    expect(reader.stateOf('box')).toBe('fresh')
  })

  it('expire() leaves a fresh system aged until it is read again', async () => {
    const { fetch } = counting()
    const reader = new SystemReader({ repo, fetch, now: () => NOW, drivers: [probe] })
    await reader.read(SYS)
    reader.expire()
    expect(reader.stateOf('box')).toBe('aged')
  })
})
