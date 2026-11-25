// The real fetch's pure pieces (network N2 Task 2, fix round 1): the connect-time lookup and the response shim. No sockets.
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { connectLookup, httpsFetch, networkFetch } from '../../server/net.ts'
import { guardedJson } from '../../server/federation/remote.ts'

const answering = (...addresses: string[]) => (_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
  cb(null, addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })))
const run = (resolve: ReturnType<typeof answering>, options: { all?: boolean } = { all: true }) =>
  new Promise<{ err: Error | null; result: unknown[] }>(done => connectLookup(resolve)('hub.example.org', options, (err: Error | null, ...result: unknown[]) => done({ err, result })))

describe('connectLookup (the connection is pinned to a checked address)', () => {
  it('refuses a private answer, and a mixed one', async () => {
    for (const set of [['10.0.0.1'], ['::1'], ['93.184.216.34', '192.168.1.1'], ['169.254.169.254']]) {
      const { err } = await run(answering(...set))
      expect(err?.message, set.join()).toBe('hub.example.org resolves to a non-public address')
      expect((err as NodeJS.ErrnoException).code).toBe('ENONPUBLIC')
    }
    expect((await run(answering())).err).toBeTruthy()
  })
  it('accepts public answers, in the shape the caller asked for', async () => {
    expect(await run(answering('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'))).toMatchObject({ err: null })
    expect((await run(answering('93.184.216.34'), { all: true })).result).toEqual([[{ address: '93.184.216.34', family: 4 }]])
    expect((await run(answering('93.184.216.34'), {})).result).toEqual(['93.184.216.34', 4])
  })
  it('passes a resolver error on', async () => {
    const failing = (_h: string, _o: unknown, cb: (e: Error, a: never[]) => void) => cb(new Error('ENOTFOUND'), [])
    expect((await run(failing as never)).err?.message).toBe('ENOTFOUND')
  })
})

/** A stand-in for https.request: records what was sent and answers as told. */
function stubRequest(reply: { status: number; headers?: Record<string, string>; body?: string }) {
  const seen: { url?: string; options?: any; written: string[]; ended: boolean } = { written: [], ended: false }
  const request = ((url: URL, options: any, cb: (res: any) => void) => {
    seen.url = url.href; seen.options = options
    const req = new EventEmitter() as any
    req.write = (c: string) => { seen.written.push(String(c)); return true }
    req.end = () => {
      seen.ended = true
      const res = new PassThrough() as any
      res.statusCode = reply.status; res.headers = reply.headers ?? {}
      cb(res)
      res.end(reply.body ?? '')
    }
    return req
  }) as any
  return { request, seen }
}
const init = (extra: object = {}) => ({ method: 'GET' as const, headers: { accept: 'application/json' }, redirect: 'error' as const, signal: new AbortController().signal, ...extra })

describe('httpsFetch response shim', () => {
  it('answers status, ok, headers, text and json; sends method, headers, body and the pinned lookup', async () => {
    const { request, seen } = stubRequest({ status: 200, headers: { 'content-length': '8', 'x-k': 'v' }, body: '{"a":1}' })
    const res = await httpsFetch(request, connectLookup(answering('93.184.216.34')))('https://pds.example.org/xrpc/x?y=1', init({ method: 'POST', body: '{"q":1}' }))
    expect(res).toMatchObject({ ok: true, status: 200 })
    expect(res.headers!.get('Content-Length')).toBe('8')
    expect(res.headers!.get('missing')).toBeNull()
    expect(await res.json()).toEqual({ a: 1 })
    expect(seen.url).toBe('https://pds.example.org/xrpc/x?y=1')
    expect(seen.options).toMatchObject({ method: 'POST', headers: { accept: 'application/json' } })
    expect(typeof seen.options.lookup).toBe('function')
    expect(seen.written).toEqual(['{"q":1}'])
  })
  it('returns a redirect as it is (not ok, status kept), and guardedJson refuses it', async () => {
    const { request } = stubRequest({ status: 302, headers: { location: 'https://elsewhere.example.org/' } })
    const fetch = httpsFetch(request)
    const res = await fetch('https://hub.example.org/x', init())
    expect(res).toMatchObject({ ok: false, status: 302 })
    expect(await guardedJson('https://hub.example.org/x', { fetch, lookup: async () => ['93.184.216.34'] }, { maxBytes: 1000 })).toEqual({ problem: 'Not read: hub.example.org answered 302.' })
  })
  it('sends a User-Agent unless the caller set one (any case), and the body length', async () => {
    const lookup = connectLookup(answering('93.184.216.34'))
    const a = stubRequest({ status: 200 })
    await httpsFetch(a.request, lookup)('https://api.example.org/x', init())
    expect(a.seen.options.headers).toMatchObject({ accept: 'application/json', 'user-agent': 'org-os-admin' })
    expect(a.seen.options.headers).not.toHaveProperty('content-length')
    const b = stubRequest({ status: 200 })
    await httpsFetch(b.request, lookup)('https://api.example.org/x', init({ headers: { 'User-Agent': 'mine/1' }, method: 'POST', body: 'héllo' }))
    expect(b.seen.options.headers['User-Agent']).toBe('mine/1')
    expect(b.seen.options.headers).not.toHaveProperty('user-agent')
    expect(b.seen.options.headers['content-length']).toBe('6')
  })
  it('refuses http, and an aborted signal', async () => {
    const { request } = stubRequest({ status: 200 })
    await expect(httpsFetch(request)('http://hub.example.org/', init())).rejects.toThrow(/only https/)
    const ac = new AbortController(); ac.abort()
    await expect(httpsFetch(request)('https://hub.example.org/', init({ signal: ac.signal }))).rejects.toThrow()
  })
  it('networkFetch still refuses under a test run', async () => {
    await expect(networkFetch('https://hub.example.org/', init())).rejects.toThrow(/no network in tests/)
  })
})
