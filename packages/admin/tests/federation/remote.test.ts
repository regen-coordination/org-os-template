// Reading another instance's federation.json, guarded (network N2 Task 2): the one guarded reader every network read uses.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { wellKnownUrlOf, guardedJson, fetchFederationJson, remoteCache, checkLinks, isPublicAddress } from '../../server/federation/remote.ts'
import { networkFetch, networkLookup } from '../../server/net.ts'
import { CATALOGUE, opById, needsConfirm, type InProcess } from '../../server/operations/catalogue.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { Resource, AdapterContext, Graph } from '../../server/resources/types.ts'
import type { FetchLike } from '../../server/systems/driver.ts'

const GOOD = { spec: 'org-os/federation/1', name: 'Hub', type: 'DAO', did: 'did:plc:hubhubhubhubhubhubhub', networks: [], peers: [] }
const PUBLIC = async () => ['93.184.216.34']

type Answer = { ok?: boolean; status?: number; body?: string; length?: string; text?: () => Promise<string> }
function fakeFetch(answer: Answer | ((url: string, init: any) => Answer | Promise<Answer>)) {
  const calls: { url: string; init: any }[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const a = typeof answer === 'function' ? await answer(url, init) : answer
    const body = a.body ?? ''
    return { ok: a.ok ?? true, status: a.status ?? 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? a.length ?? null : null) },
      json: async () => JSON.parse(body), text: a.text ?? (async () => body) }
  }
  return { fetch, calls }
}

describe('wellKnownUrlOf', () => {
  it('maps a host, a well-known url and a github repo; anything else is null', () => {
    expect(wellKnownUrlOf('https://hub.example.org')).toBe('https://hub.example.org/.well-known/federation.json')
    expect(wellKnownUrlOf('https://hub.example.org/')).toBe('https://hub.example.org/.well-known/federation.json')
    expect(wellKnownUrlOf('https://hub.example.org/.well-known/federation.json')).toBe('https://hub.example.org/.well-known/federation.json')
    expect(wellKnownUrlOf('https://github.com/Some/Repo')).toBe('https://raw.githubusercontent.com/Some/Repo/HEAD/.well-known/federation.json')
    expect(wellKnownUrlOf('https://github.com/Some/Repo.git')).toBe('https://raw.githubusercontent.com/Some/Repo/HEAD/.well-known/federation.json')
    for (const bad of ['http://hub.example.org', 'https://localhost', 'https://10.0.0.1', 'https://hub.example.org/a/b?x=1', 'ftp://x.example.org', 'not a url', '', 'https://github.com/only-owner']) {
      expect(wellKnownUrlOf(bad), bad).toBeNull()
    }
  })
})

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local, CGNAT and unique-local, v4 and v6', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'not-an-ip']) {
      expect(isPublicAddress(a), a).toBe(false)
    }
    for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946']) expect(isPublicAddress(a), a).toBe(true)
  })
})

describe('guardedJson', () => {
  const url = 'https://hub.example.org/.well-known/federation.json'
  const opts = { maxBytes: 256 * 1024 }

  it('reads JSON, with a GET, no redirects and the job signal passed on', async () => {
    const { fetch, calls } = fakeFetch({ body: JSON.stringify(GOOD) })
    const ac = new AbortController()
    expect(await guardedJson(url, { fetch, lookup: PUBLIC }, { ...opts, accept: 'application/json', signal: ac.signal })).toEqual({ json: GOOD })
    expect(calls).toHaveLength(1)
    expect(calls[0].init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(calls[0].init.headers.accept).toBe('application/json')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it('text mode returns the body unparsed, so a caller can read a DID or handle answer', async () => {
    const { fetch } = fakeFetch({ body: 'did:plc:abcabcabcabcabcabcabcabc\n' })
    expect(await guardedJson('https://alice.example.org/.well-known/atproto-did', { fetch, lookup: PUBLIC }, { ...opts, as: 'text' })).toEqual({ text: 'did:plc:abcabcabcabcabcabcabcabc\n' })
  })

  it('the host check is on the host, so a query string (an atproto read) is fine', async () => {
    const { fetch, calls } = fakeFetch({ body: '{"records":[]}' })
    expect(await guardedJson('https://pds.example.org/xrpc/com.atproto.repo.listRecords?repo=did%3Aplc%3Aabc&collection=x.y', { fetch, lookup: PUBLIC }, opts)).toEqual({ json: { records: [] } })
    expect(calls).toHaveLength(1)
  })

  it('refuses a private, loopback or mixed resolution before fetch is called', async () => {
    for (const addrs of [['10.0.0.1'], ['::1'], ['93.184.216.34', '192.168.0.5'], ['169.254.169.254'], ['100.64.1.1'], ['fd00::1']]) {
      const { fetch, calls } = fakeFetch({ body: '{}' })
      const got = await guardedJson(url, { fetch, lookup: async () => addrs }, opts)
      expect(got, addrs.join()).toEqual({ problem: 'Not read: hub.example.org does not resolve to a public address.' })
      expect(calls).toHaveLength(0)
    }
  })

  it('refuses http, an address with a login, an IP literal, localhost and a host that does not resolve', async () => {
    const { fetch, calls } = fakeFetch({ body: '{}' })
    for (const bad of ['http://hub.example.org/x', 'https://user:pw@hub.example.org/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://intranet/x', 'nonsense']) {
      expect('problem' in (await guardedJson(bad, { fetch, lookup: PUBLIC }, opts)), bad).toBe(true)
    }
    expect(calls).toHaveLength(0)
    expect(await guardedJson(url, { fetch, lookup: async () => { throw new Error('ENOTFOUND') } }, opts)).toEqual({ problem: 'Not read: hub.example.org could not be found.' })
    expect(await guardedJson(url, { fetch, lookup: async () => [] }, opts)).toEqual({ problem: 'Not read: hub.example.org could not be found.' })
  })

  it('refuses a redirect and a failed request', async () => {
    const redirect: FetchLike = async () => { throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') }) }
    expect(await guardedJson(url, { fetch: redirect, lookup: PUBLIC }, opts)).toEqual({ problem: 'Not read: hub.example.org could not be reached.' })
    const { fetch } = fakeFetch({ ok: false, status: 404 })
    expect(await guardedJson(url, { fetch, lookup: PUBLIC }, opts)).toEqual({ problem: 'Not read: hub.example.org answered 404.' })
  })

  it('refuses a body that never ends, after 10 s', async () => {
    vi.useFakeTimers()
    try {
      const { fetch } = fakeFetch({ text: () => new Promise<string>(() => {}) })
      const pending = guardedJson(url, { fetch, lookup: PUBLIC }, opts)
      await vi.advanceTimersByTimeAsync(10_001)
      expect(await pending).toEqual({ problem: 'Not read: hub.example.org took longer than 10 seconds.' })
    } finally { vi.useRealTimers() }
  })

  it('a fetch that honours the abort is refused the same way', async () => {
    vi.useFakeTimers()
    try {
      const slow: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
      const pending = guardedJson(url, { fetch: slow, lookup: PUBLIC }, opts)
      await vi.advanceTimersByTimeAsync(10_001)
      expect(await pending).toEqual({ problem: 'Not read: hub.example.org took longer than 10 seconds.' })
    } finally { vi.useRealTimers() }
  })

  it('the job signal cancels it, and nothing is fetched when it is already aborted', async () => {
    const { fetch, calls } = fakeFetch({ body: '{}' })
    const ac = new AbortController(); ac.abort()
    expect(await guardedJson(url, { fetch, lookup: PUBLIC }, { ...opts, signal: ac.signal })).toEqual({ problem: 'Not read: it was cancelled.' })
    expect(calls).toHaveLength(0)
    const ac2 = new AbortController()
    const slow: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    const pending = guardedJson(url, { fetch: slow, lookup: PUBLIC }, { ...opts, signal: ac2.signal })
    await new Promise(r => setTimeout(r, 5))
    ac2.abort()
    expect(await pending).toEqual({ problem: 'Not read: it was cancelled.' })
  })

  it('refuses an oversized body, by its length header or by its size, before parsing', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(300 * 1024) })
    expect(await guardedJson(url, fakeDeps({ body: big }), opts)).toEqual({ problem: 'Not read: hub.example.org sent more than 256 KB.' })
    expect(await guardedJson(url, fakeDeps({ body: '{}', length: String(300 * 1024) }), opts)).toEqual({ problem: 'Not read: hub.example.org sent more than 256 KB.' })
    expect(await guardedJson(url, fakeDeps({ body: 'x'.repeat(2000) }), { maxBytes: 1000, as: 'text' })).toEqual({ problem: 'Not read: hub.example.org sent more than 1 KB.' })
  })

  it('refuses a body that is not JSON', async () => {
    expect(await guardedJson(url, fakeDeps({ body: '<html>' }), opts)).toEqual({ problem: 'Not read: hub.example.org did not answer JSON.' })
  })

  it('gives the same sentences to every caller', async () => {
    const deps = { fetch: fakeFetch({ body: '{}' }).fetch, lookup: async () => ['10.0.0.1'] }
    const direct = await guardedJson('https://hub.example.org/.well-known/federation.json', deps, opts)
    const viaFederation = await fetchFederationJson('https://hub.example.org', deps)
    expect(viaFederation).toEqual(direct)
    expect(direct).toEqual({ problem: 'Not read: hub.example.org does not resolve to a public address.' })
  })
})

function fakeDeps(answer: Answer) { return { fetch: fakeFetch(answer).fetch, lookup: PUBLIC } }

describe('fetchFederationJson', () => {
  it('returns the document when it carries the spec', async () => {
    const { fetch, calls } = fakeFetch({ body: JSON.stringify(GOOD) })
    expect(await fetchFederationJson('https://hub.example.org', { fetch, lookup: PUBLIC })).toEqual({ doc: GOOD })
    expect(calls[0].url).toBe('https://hub.example.org/.well-known/federation.json')
  })

  it('refuses a private host before fetch is called, an oversized answer (300 KB), and a wrong spec', async () => {
    const priv = fakeFetch({ body: JSON.stringify(GOOD) })
    expect(await fetchFederationJson('https://hub.example.org', { fetch: priv.fetch, lookup: async () => ['10.0.0.1'] })).toHaveProperty('problem')
    expect(await fetchFederationJson('https://hub.example.org', { fetch: priv.fetch, lookup: async () => ['::1'] })).toHaveProperty('problem')
    expect(priv.calls).toHaveLength(0)
    expect(await fetchFederationJson('https://hub.example.org', fakeDeps({ body: JSON.stringify({ ...GOOD, pad: 'x'.repeat(300 * 1024) }) }))).toEqual({ problem: 'Not read: hub.example.org sent more than 256 KB.' })
    expect(await fetchFederationJson('https://hub.example.org', fakeDeps({ body: JSON.stringify({ spec: 'other/1' }) }))).toEqual({ problem: 'Not read: hub.example.org does not publish org-os/federation/1.' })
    expect(await fetchFederationJson('https://hub.example.org', fakeDeps({ body: '[]' }))).toHaveProperty('problem')
  })

  it('refuses an address it cannot map', async () => {
    expect(await fetchFederationJson('http://hub.example.org', fakeDeps({ body: '{}' }))).toEqual({ problem: 'Not read: "http://hub.example.org" is not a public https address.' })
  })
})

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('remoteCache', () => {
  it('keeps a document by the sha256 of its well-known url, with its fetch date', () => {
    const cache = remoteCache(repo)
    const u = 'https://hub.example.org/.well-known/federation.json'
    expect(cache.get(u)).toBeNull()
    cache.put(u, GOOD, new Date('2026-11-22T10:00:00Z'))
    expect(remoteCache(repo).get(u)).toEqual({ fetched_at: '2026-11-22T10:00:00.000Z', doc: GOOD })
    expect(cache.get('https://other.example.org/.well-known/federation.json')).toBeNull()
  })
})

describe('federation.check-links', () => {
  const op = () => opById('federation.check-links')!
  const self = (): Resource => ({ id: 'instance:fixture-org', kind: 'instance', board: 'systems', name: 'x', status: null, attention: null, changed: null, facts: { self: true }, source: null })

  it('is a confirmed network read, on the self card, with an address param (and, since Task 3, a did or a handle)', () => {
    expect(needsConfirm(op())).toBe(true)
    expect(op()).toMatchObject({ kinds: ['instance'], effect: 'reads', network: true, refreshes: 'fleet' })
    expect(op().params).toEqual({ type: 'object', additionalProperties: false, properties: {
      address: { type: 'string', maxLength: 2048 }, did: { type: 'string', maxLength: 2048 }, handle: { type: 'string', maxLength: 253 },
    } })
    expect(CATALOGUE.filter(needsConfirm).map(o => o.id)).toContain('federation.check-links')
    expect(op().unavailable(self(), repo)).toBeNull()
    expect(op().unavailable({ ...self(), facts: {} }, repo)).toBe("offered on this instance's own card")
  })

  it('under a test run its in-process read goes through networkFetch and fails', async () => {
    const planned = op().plan(self(), { address: 'https://hub.example.org' }, repo) as InProcess
    await expect(planned.inProcess(repo, new AbortController().signal)).rejects.toThrow(/no network in tests/)
    await expect(networkLookup('hub.example.org')).rejects.toThrow(/no network in tests/)
    await expect(networkFetch('https://hub.example.org', { method: 'GET', headers: {}, redirect: 'error', signal: new AbortController().signal })).rejects.toThrow(/no network in tests/)
  })

  it('one address: reads it and writes only the cache', async () => {
    const { fetch } = fakeFetch({ body: JSON.stringify(GOOD) })
    const out = await checkLinks(repo, { address: 'https://hub.example.org' }, { fetch, lookup: PUBLIC }, new AbortController().signal, new Date('2026-11-22T10:00:00Z'))
    expect(out).toContain('Hub')
    expect(remoteCache(repo).get('https://hub.example.org/.well-known/federation.json')?.doc).toEqual(GOOD)
  })

  it('one address that is refused fails the job with the sentence, and caches nothing', async () => {
    const { fetch } = fakeFetch({ body: JSON.stringify(GOOD) })
    await expect(checkLinks(repo, { address: 'https://hub.example.org' }, { fetch, lookup: async () => ['10.0.0.1'] }, new AbortController().signal))
      .rejects.toThrow('Not read: hub.example.org does not resolve to a public address.')
    expect(remoteCache(repo).get('https://hub.example.org/.well-known/federation.json')).toBeNull()
  })

  it('no address: every URL-only peer that is not private; the private ones are only counted', async () => {
    writeFileSync(join(repo, 'federation.yaml'), [
      'identity:', '  name: "Fixture Org"', 'peers:',
      '  - name: Far Hub', '    url: https://far.example.org',
      '  - name: Folder Peer', '    repo: ../folder-peer', '    url: https://folder.example.org',
      '  - name: Quiet One', '    url: https://quiet.example.org', '    visibility: private',
      '  - name: Plain Http', '    url: http://plain.example.org',
      '  - name: Lan Box', '    url: https://hub.local', '',
    ].join('\n'))
    const { fetch, calls } = fakeFetch({ body: JSON.stringify(GOOD) })
    const out = await checkLinks(repo, {}, { fetch, lookup: PUBLIC }, new AbortController().signal)
    expect(calls.map(c => c.url)).toEqual(['https://far.example.org/.well-known/federation.json'])
    expect(out).toContain('Far Hub')
    expect(out).toContain('The federation.json of 3 private peers was not read (private, or without a public https url).')
    expect(out).not.toMatch(/Plain Http|plain\.example|Lan Box|hub\.local/)
    expect(out).not.toContain('Quiet One')
    expect(out).not.toContain('quiet.example.org')
  })
})

describe('the fleet reads the cache for a URL-only peer', () => {
  const ctx = (): AdapterContext => ({ repo, now: () => new Date(2026, 10, 22, 12), run: runCommand, lastOk: () => null })
  const writeFed = () => writeFileSync(join(repo, 'federation.yaml'), [
    'identity:', '  name: "Fixture Org"', '  slug: fixture-org', 'peers:', '  - name: Far Hub', '    url: https://far.example.org', '',
  ].join('\n'))

  it("goes from unknown to claimed, then mutual when their file lists us, with the check date", async () => {
    writeFed()
    let g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:far-hub')?.facts).toMatchObject({ link: 'unknown' })
    remoteCache(repo).put('https://far.example.org/.well-known/federation.json', { ...GOOD, peers: [{ name: 'Someone else', url: 'https://else.example.org' }] }, new Date('2026-11-22T10:00:00Z'))
    g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:far-hub')?.facts).toMatchObject({ link: 'claimed', linkReason: 'checked 2026-11-22T10:00:00.000Z' })
    // They list this instance by its address: the fixture's own folder is not public, so give it a remote.
    const { execSync } = await import('node:child_process')
    execSync('git remote add origin https://github.com/acme/fixture-org', { cwd: repo })
    remoteCache(repo).put('https://far.example.org/.well-known/federation.json', { ...GOOD, peers: [{ name: 'Fixture Org', url: 'https://github.com/acme/fixture-org' }] }, new Date('2026-11-22T11:00:00Z'))
    g = (await fleet.read(ctx())) as Graph
    // A remote file's `repo` or relative path is never read as a folder here.
    remoteCache(repo).put('https://far.example.org/.well-known/federation.json', { ...GOOD, peers: [{ name: 'x', repo: '.' }, { name: 'y', url: '/' }] }, new Date('2026-11-22T12:00:00Z'))
    g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:far-hub')?.facts).toMatchObject({ link: 'claimed' })
    remoteCache(repo).put('https://far.example.org/.well-known/federation.json', { ...GOOD, peers: [{ name: 'Fixture Org', url: 'https://github.com/acme/fixture-org' }] }, new Date('2026-11-22T11:00:00Z'))
    g = (await fleet.read(ctx())) as Graph
    expect(g.nodes.find(n => n.id === 'instance:far-hub')).toMatchObject({ status: 'mutual', facts: expect.objectContaining({ link: 'mutual', linkReason: 'checked 2026-11-22T11:00:00.000Z' }) })
  })
})
