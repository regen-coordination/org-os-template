// atproto resolution (network N2 Task 3): DID → DID document → its own PDS, and handle ↔ DID both ways, under the same
// guards as every other network read. Every call goes to the fake network on two hosts; none touches the network.
import { describe, it, expect } from 'vitest'
import { didDocUrl, resolveDid, resolveHandle, normalHandle, DID_DOC_MAX_BYTES } from '../../server/federation/atproto/resolve.ts'
import { makeFakeNetwork, plcDid } from '../fake-pds.ts'

const ALICE = plcDid('alice')
const BOB = plcDid('bob')
const WEB = 'did:web:org.example.io'
const network = () => makeFakeNetwork({
  hosts: {
    'https://pds-one.example.com': { accounts: { [ALICE]: { handle: 'alice.example.org', password: 'pw-alice' } } },
    'https://pds-two.example.net': { accounts: { [BOB]: { handle: 'bob.example.net', password: 'pw-bob' }, [WEB]: { handle: 'org.example.io', password: 'pw-web' } } },
  },
})
const hostOf = (url: string) => new URL(url).host

describe('didDocUrl', () => {
  it('did:plc goes to plc.directory, did:web to its host; a path, a port and any other method are null', () => {
    expect(didDocUrl(ALICE)).toBe(`https://plc.directory/${ALICE}`)
    expect(didDocUrl('did:web:org.example.io')).toBe('https://org.example.io/.well-known/did.json')
    expect(didDocUrl('did:web:Org.Example.IO')).toBe('https://org.example.io/.well-known/did.json')
    for (const bad of ['did:web:org.example.io:user:alice', 'did:web:org.example.io%3A8443', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      'did:plc:short', 'did:plc:ABCDEFGHIJKLMNOPQRSTUVWX', `${ALICE}/x`, 'did:web:localhost', 'did:web:10.0.0.1', 'did:web:intranet', 'did:web:', 'alice.example.org', '', 42]) {
      expect(didDocUrl(bad as string), String(bad)).toBeNull()
    }
  })
})

describe('resolveDid', () => {
  it('finds the PDS of two accounts on two different hosts (one PDS per DID, not one for all)', async () => {
    const net = network()
    expect(await resolveDid(ALICE, net)).toEqual({ pds: 'https://pds-one.example.com', handle: 'alice.example.org' })
    expect(await resolveDid(BOB, net)).toEqual({ pds: 'https://pds-two.example.net', handle: 'bob.example.net' })
    expect(net.requests.map(r => r.url)).toEqual([`https://plc.directory/${ALICE}`, `https://plc.directory/${BOB}`])
  })

  it('reads a did:web document from its own host', async () => {
    const net = network()
    expect(await resolveDid(WEB, net)).toEqual({ pds: 'https://pds-two.example.net', handle: 'org.example.io' })
    expect(net.requests.map(r => r.url)).toEqual(['https://org.example.io/.well-known/did.json'])
  })

  it('the handle is the first at:// entry of alsoKnownAs, and null when there is none', async () => {
    const net = network()
    net.editDidDoc(ALICE, doc => ({ ...doc, alsoKnownAs: ['https://alice.example.org', 'at://First.Example.org', 'at://second.example.org'] }))
    expect(await resolveDid(ALICE, net)).toEqual({ pds: 'https://pds-one.example.com', handle: 'first.example.org' })
    net.editDidDoc(ALICE, doc => ({ ...doc, alsoKnownAs: undefined }))
    expect(await resolveDid(ALICE, net)).toEqual({ pds: 'https://pds-one.example.com', handle: null })
  })

  it('refuses a document for another DID, or with no usable PDS entry', async () => {
    const cases: [string, (doc: Record<string, any>) => unknown, RegExp][] = [
      ['id is another DID', doc => ({ ...doc, id: BOB }), /is for another DID/],
      ['PDS on a private address', doc => ({ ...doc, service: [{ ...doc.service[0], serviceEndpoint: 'https://10.0.0.1' }] }), /not a public https address/],
      ['PDS over http', doc => ({ ...doc, service: [{ ...doc.service[0], serviceEndpoint: 'http://pds-one.example.com' }] }), /not a public https address/],
      ['PDS on localhost', doc => ({ ...doc, service: [{ ...doc.service[0], serviceEndpoint: 'https://localhost:2583' }] }), /not a public https address/],
      ['PDS with a query', doc => ({ ...doc, service: [{ ...doc.service[0], serviceEndpoint: 'https://pds-one.example.com/?x=1' }] }), /not a public https address/],
      ['no PDS entry', doc => ({ ...doc, service: [] }), /names no PDS/],
      ['the wrong type', doc => ({ ...doc, service: [{ ...doc.service[0], type: 'BskyFeedGenerator' }] }), /names no PDS/],
      ['the wrong id', doc => ({ ...doc, service: [{ ...doc.service[0], id: '#bsky_fg' }] }), /names no PDS/],
      ['not an object', () => ['a list'], /is not a DID document/],
    ]
    for (const [what, edit, problem] of cases) {
      const net = network()
      net.editDidDoc(ALICE, edit)
      const got = await resolveDid(ALICE, net)
      expect(got, what).toHaveProperty('problem')
      expect((got as { problem: string }).problem, what).toMatch(problem)
    }
  })

  it('accepts a full-DID service id, and an endpoint with a trailing slash', async () => {
    const net = network()
    net.editDidDoc(ALICE, doc => ({ ...doc, service: [{ id: `${ALICE}#atproto_pds`, type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds-one.example.com/' }] }))
    expect(await resolveDid(ALICE, net)).toEqual({ pds: 'https://pds-one.example.com', handle: 'alice.example.org' })
  })

  it('reads the document under the guards: a private resolution, a redirect, an oversized or missing answer', async () => {
    const priv = network(); priv.resolveTo('plc.directory', ['10.0.0.1'])
    expect(await resolveDid(ALICE, priv)).toEqual({ problem: 'Not read: plc.directory does not resolve to a public address.' })
    expect(priv.requests).toHaveLength(0)
    const redirect = network(); redirect.misbehave('plc.directory', 'redirect')
    expect(await resolveDid(ALICE, redirect)).toEqual({ problem: 'Not read: plc.directory answered 302.' })
    const big = network(); big.editDidDoc(ALICE, doc => ({ ...doc, pad: 'x'.repeat(DID_DOC_MAX_BYTES) }))
    expect(await resolveDid(ALICE, big)).toEqual({ problem: 'Not read: plc.directory sent more than 64 KB.' })
    const down = network(); down.setDown('plc.directory')
    expect(await resolveDid(ALICE, down)).toEqual({ problem: 'Not read: plc.directory could not be reached.' })
    expect(await resolveDid(plcDid('nobody'), network())).toEqual({ problem: 'Not read: plc.directory answered 404.' })
    expect(await resolveDid('did:key:z6Mk', network())).toEqual({ problem: 'Not read: "did:key:z6Mk" is not a did:plc or did:web identifier this can resolve.' })
  })

  it('passes the job signal on: a cancelled check fetches nothing', async () => {
    const net = network()
    const ac = new AbortController(); ac.abort()
    expect(await resolveDid(ALICE, { ...net, signal: ac.signal })).toEqual({ problem: 'Not read: it was cancelled.' })
    expect(net.requests).toHaveLength(0)
  })
})

describe('resolveHandle', () => {
  it('reads the handle host first, then checks that the DID names the handle back', async () => {
    const net = network()
    expect(await resolveHandle('alice.example.org', net)).toEqual({ did: ALICE })
    expect(net.requests.map(r => r.url)).toEqual(['https://alice.example.org/.well-known/atproto-did', `https://plc.directory/${ALICE}`])
    expect(await resolveHandle('@Bob.Example.NET', net)).toEqual({ did: BOB })
  })

  it('falls back to the DNS TXT record _atproto.<handle> when the handle host does not answer', async () => {
    const net = network()
    net.setDown('alice.example.org')
    const asked: string[] = []
    const resolveTxt = async (name: string) => { asked.push(name); return net.resolveTxt(name) }
    expect(await resolveHandle('alice.example.org', { ...net, resolveTxt })).toEqual({ did: ALICE })
    expect(asked).toEqual(['_atproto.alice.example.org'])
    // A handle host that resolves to a private address is never fetched; DNS still answers.
    const priv = network(); priv.resolveTo('alice.example.org', ['192.168.1.10'])
    expect(await resolveHandle('alice.example.org', priv)).toEqual({ did: ALICE })
    expect(priv.requests.map(r => hostOf(r.url))).toEqual(['plc.directory'])
  })

  it('a handle is accepted only when its DID names it back', async () => {
    // Alice's DID document lists another handle: the handle that points at it is refused.
    const renamed = network()
    renamed.editDidDoc(ALICE, doc => ({ ...doc, alsoKnownAs: ['at://someone-else.example.org'] }))
    expect(await resolveHandle('alice.example.org', renamed)).toEqual({ problem: `Not read: ${ALICE} does not name alice.example.org back.` })
    // A stranger's handle that claims Alice's DID (over DNS) is refused: her document names her own handle.
    const forged = network()
    forged.setTxt('_atproto.mallory.example.org', [[`did=${ALICE}`]])
    expect(await resolveHandle('mallory.example.org', forged)).toEqual({ problem: `Not read: ${ALICE} does not name mallory.example.org back.` })
    // A document with no handle names nobody back.
    const none = network()
    none.editDidDoc(ALICE, doc => ({ ...doc, alsoKnownAs: [] }))
    expect(await resolveHandle('alice.example.org', none)).toHaveProperty('problem')
    // And the DID's own resolution must pass its guards too.
    const priv = network()
    priv.editDidDoc(ALICE, doc => ({ ...doc, service: [{ ...doc.service[0], serviceEndpoint: 'https://10.0.0.1' }] }))
    expect(await resolveHandle('alice.example.org', priv)).toHaveProperty('problem')
  })

  it('refuses an answer that is not one DID', async () => {
    const two = network()
    two.setDown('alice.example.org')
    two.setTxt('_atproto.alice.example.org', [[`did=${ALICE}`], [`did=${BOB}`]])
    expect(await resolveHandle('alice.example.org', two)).toEqual({ problem: 'Not read: alice.example.org names more than one DID.' })
    const junk = network()
    junk.setDown('alice.example.org')
    junk.setTxt('_atproto.alice.example.org', [['v=spf1 -all'], ['did=not-a-did']])
    expect(await resolveHandle('alice.example.org', junk)).toEqual({ problem: 'Not read: alice.example.org does not name a DID.' })
    const nothing = network()
    nothing.setDown('alice.example.org')
    nothing.setTxt('_atproto.alice.example.org', [])
    expect(await resolveHandle('alice.example.org', nothing)).toEqual({ problem: 'Not read: alice.example.org does not name a DID.' })
  })

  it('refuses a name that is not a handle, before anything is asked', async () => {
    const net = network()
    for (const bad of ['alice', 'alice..example.org', '-alice.example.org', 'alice.example.org/x', 'http://alice.example.org', '10.0.0.1', 'host.local', 'box.internal', 'a.localhost', '', 'x'.repeat(260) + '.org']) {
      expect(await resolveHandle(bad, net), bad).toEqual({ problem: `Not read: "${bad}" is not a handle.` })
    }
    expect(net.requests).toHaveLength(0)
    expect(normalHandle(' @Alice.Example.org. ')).toBe('alice.example.org')
    expect(normalHandle('alice')).toBeNull()
  })

  it('the default DNS reader refuses under a test run', async () => {
    const net = network()
    net.setDown('alice.example.org')
    await expect(resolveHandle('alice.example.org', { fetch: net.fetch, lookup: net.lookup })).rejects.toThrow(/no network in tests/)
  })
})
