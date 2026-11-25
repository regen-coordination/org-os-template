import { describe, it, expect } from 'vitest'
import { normalizeHandle, resolveHandle, fetchDidDoc, checkAccount, type CheckDeps } from '../../server/network/check.ts'

// The two-way handle check (refi-dao-os network app spec §5.4; plan task B5): a TypeScript port of refi-dao-os
// scripts/nodes/check-network.mjs `checkEntry` (Dec 9 spec §5.4), whose tests these follow. An account passes only when
// its handle resolves to its DID and the DID document names the handle back; it also reads which apps hold a profile.
// Synthetic values only.

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const HANDLE = 'refi-example.certified.one'
const PDS = 'https://pds.example.org'
const doc = (handle = HANDLE) => ({ id: DID, alsoKnownAs: [`at://${handle}`], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] })

/** A fake network: routes map a URL to a JSON or text body; anything else is a 404. TXT records by name. */
function net({ txt = {}, routes = {}, junk = false }: { txt?: Record<string, string[][]>; routes?: Record<string, unknown>; junk?: boolean } = {}): CheckDeps & { calls: string[] } {
  const calls: string[] = []
  const fetchImpl = async (url: string) => {
    calls.push(url)
    if (junk) return new Response('<html>not json</html>', { status: 200 })
    if (!(url in routes)) return new Response('', { status: 404 })
    const body = routes[url]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
  }
  const resolveTxt = async (name: string) => { if (name in txt) return txt[name]!; throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }) }
  return { fetchImpl, resolveTxt, calls }
}
const plc = (d: unknown = doc()) => ({ [`https://plc.directory/${DID}`]: d })
const repo = (collections: string[]) => ({ [`${PDS}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(DID)}`]: { did: DID, collections } })
const TXT = { [`_atproto.${HANDLE}`]: [[`did=${DID}`]] }

describe('normalizeHandle', () => {
  it('takes a bare handle, an @handle, at://, or a Bluesky or Certified profile link by handle', () => {
    expect(normalizeHandle('@X.bsky.social')).toBe('x.bsky.social')
    expect(normalizeHandle('https://bsky.app/profile/x.bsky.social/')).toBe('x.bsky.social')
    expect(normalizeHandle('  example.org  ')).toBe('example.org')
    expect(normalizeHandle('at://x.bsky.social')).toBe('x.bsky.social')
    expect(normalizeHandle('https://www.bsky.app/profile/X.bsky.social')).toBe('x.bsky.social')
    expect(normalizeHandle('certified.app/profile/refi-example.certified.one/')).toBe('refi-example.certified.one')
  })
  it('anything else, a DID included, is null', () => {
    expect(normalizeHandle('hello world')).toBe(null)
    expect(normalizeHandle('')).toBe(null)
    expect(normalizeHandle(undefined)).toBe(null)
    expect(normalizeHandle(`https://certified.app/profile/${DID}`)).toBe(null)
  })
})

describe('resolveHandle', () => {
  it('tries DNS, then .well-known, then the public AppView', async () => {
    const viaDns = net({ txt: TXT })
    expect(await resolveHandle(HANDLE, viaDns)).toBe(DID)
    expect(viaDns.calls).toEqual([])
    expect(await resolveHandle(HANDLE, net({ routes: { [`https://${HANDLE}/.well-known/atproto-did`]: `${DID}\n` } }))).toBe(DID)
    expect(await resolveHandle(HANDLE, net({ routes: { [`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`]: { did: DID } } }))).toBe(DID)
    expect(await resolveHandle(HANDLE, net())).toBe(null)
  })
  it('a junk answer or a fetch that throws is null, never a throw', async () => {
    expect(await resolveHandle(HANDLE, net({ junk: true }))).toBe(null)
    expect(await resolveHandle(HANDLE, { fetchImpl: async () => { throw new Error('down') }, resolveTxt: async () => { throw new Error('down') } })).toBe(null)
  })
})

describe('fetchDidDoc', () => {
  it('reads plc.directory for did:plc and /.well-known/did.json for did:web', async () => {
    expect(await fetchDidDoc(DID, net({ routes: plc() }))).toEqual(doc())
    const web = { id: 'did:web:example.org' }
    expect(await fetchDidDoc('did:web:example.org', net({ routes: { 'https://example.org/.well-known/did.json': web } }))).toEqual(web)
    expect(await fetchDidDoc(DID, net())).toBe(null)
    expect(await fetchDidDoc('did:key:zzz', net())).toBe(null)
  })
})

describe('checkAccount (check-network.mjs checkEntry)', () => {
  it('passes two-way and reads which apps hold a profile', async () => {
    const deps = net({ txt: TXT, routes: { ...plc(), ...repo(['app.certified.actor.profile', 'org.hypercerts.context.attachment']) } })
    expect(await checkAccount({ handle: HANDLE }, deps)).toEqual({ check: 'pass', did: DID, handle: HANDLE, on: ['certified'], reason: null })
    const both = net({ txt: TXT, routes: { ...plc(), ...repo(['app.bsky.actor.profile', 'app.certified.actor.organization']) } })
    expect((await checkAccount({ handle: HANDLE, did: DID }, both)).on).toEqual(['bluesky', 'certified'])
  })

  it('passes with on: [] when the account holds neither profile record', async () => {
    const r = await checkAccount({ handle: HANDLE }, net({ txt: TXT, routes: { ...plc(), ...repo(['app.bsky.feed.post']) } }))
    expect(r.check).toBe('pass')
    expect(r.on).toEqual([])
  })

  it('fails, with the reason, when either direction does not hold', async () => {
    expect(await checkAccount({ handle: HANDLE, did: OTHER }, net({ txt: TXT, routes: { ...plc(), ...repo([]) } })))
      .toEqual({ check: 'fail', did: OTHER, handle: HANDLE, on: [], reason: 'handle resolves to another DID' })
    expect((await checkAccount({ handle: HANDLE }, net({ txt: TXT, routes: { ...plc(doc('someone.else.org')), ...repo([]) } }))).reason)
      .toBe('DID document does not name the handle')
    expect((await checkAccount({ handle: HANDLE }, net())).reason).toBe('handle does not resolve')
    expect((await checkAccount({ handle: HANDLE }, net({ txt: TXT }))).reason).toBe('DID document not found')
    expect((await checkAccount({ handle: HANDLE }, net({ txt: TXT, routes: plc() }))).reason).toBe('the account\'s host did not answer')
  })

  it('a handle that is not a handle (handle.invalid, junk) fails without a network call', async () => {
    const deps = net({ txt: TXT })
    expect((await checkAccount({ handle: 'handle.invalid', did: DID }, deps))).toMatchObject({ check: 'fail', reason: 'the account has no checked handle' })
    expect((await checkAccount({ handle: 'not a handle', did: DID }, deps)).check).toBe('fail')
    expect(deps.calls).toEqual([])
  })

  it('a PDS that is not https is not asked', async () => {
    const http = { ...doc(), service: [{ id: '#atproto_pds', serviceEndpoint: 'http://pds.example.org' }] }
    const deps = net({ txt: TXT, routes: plc(http) })
    expect((await checkAccount({ handle: HANDLE }, deps)).reason).toBe('the account\'s host did not answer')
    expect(deps.calls.some(u => u.startsWith('http://'))).toBe(false)
  })
})
