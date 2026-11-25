import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { Hono } from 'hono'
import { makeFixtureRepo } from '../fixtures.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { ATPROTO_ENV, FLOW_COOKIE, PURPOSES, clientMetadata, mountAtproto, publicJwks, readAtprotoConfig, type AtprotoConfig } from '../../server/session/atproto.ts'
import { INSTANCE_WRITES } from '../../server/hosted/instance-writes.ts'
import { PUBLIC_READS } from '../../server/visibility/gate.ts'
import type { AtprotoIdentity } from '../../server/session/atproto.ts'

// The Hub's AT Proto OAuth client (refi-dao-os network app spec §5.1, Q12; plan task B2): sign-in with a Bluesky or
// Certified account, identity only. No network in these tests: every refusal happens before the client calls out.

const cleanup: string[] = []
const open: PrivateStore[] = []
afterEach(() => {
  for (const s of open.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const store = async () => {
  const r = makeFixtureRepo(); cleanup.push(r)
  const dir = mkdtempSync(join(tmpdir(), 'atproto-store-')); cleanup.push(dir)
  const s = await openPrivateStore(r, { dir }); open.push(s); return s
}

const ORIGIN = 'https://steward.example.org'
function es256Jwk(kid = 'k1'): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid })
}
const hostedConfig = (jwk = es256Jwk()): AtprotoConfig => {
  const read = readAtprotoConfig({ HOUSE_ATPROTO_PRIVATE_JWK: jwk }, { hosted: true, origin: ORIGIN })
  if (!('config' in read) || !read.config) throw new Error('expected a config')
  return read.config
}
async function app(config: AtprotoConfig, s: PrivateStore) {
  const a = new Hono()
  mountAtproto(a, { config, store: s, hosted: true, personOf: () => null })
  return a
}

describe('the configuration', () => {
  it('names its one variable', () => expect(ATPROTO_ENV).toEqual(['HOUSE_ATPROTO_PRIVATE_JWK']))

  it('hosted without the key: not offered, and the server starts', () =>
    expect(readAtprotoConfig({}, { hosted: true, origin: ORIGIN })).toEqual({ config: null }))

  it('hosted with a key that is not an ES256 private JWK: refused, naming the variable, never the value', () => {
    for (const bad of ['nope', '{"kty":"OKP","crv":"Ed25519","d":"SECRETVALUE","x":"x"}', JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' })]) {
      const read = readAtprotoConfig({ HOUSE_ATPROTO_PRIVATE_JWK: bad }, { hosted: true, origin: ORIGIN })
      expect(read).toHaveProperty('refuse')
      const text = (read as { refuse: string }).refuse
      expect(text).toMatch(/HOUSE_ATPROTO_PRIVATE_JWK/)
      expect(text).not.toMatch(/SECRETVALUE/)
    }
  })

  it('hosted needs an https origin for a confidential client', () =>
    expect(readAtprotoConfig({ HOUSE_ATPROTO_PRIVATE_JWK: es256Jwk() }, { hosted: true, origin: 'http://hub.example.org' })).toHaveProperty('refuse'))

  it('hosted with a key: a confidential client whose id is the metadata on the Hub\'s own address', () => {
    const c = hostedConfig()
    expect(c.kind).toBe('confidential')
    expect(c.clientId).toBe(`${ORIGIN}/oauth/client-metadata.json`)
  })

  it('local on http: a loopback client, no key needed, redirecting to 127.0.0.1 on the same port', () => {
    const read = readAtprotoConfig({}, { hosted: false, origin: 'http://localhost:4419' })
    expect(read).toHaveProperty('config')
    const c = (read as { config: AtprotoConfig }).config
    expect(c.kind).toBe('loopback')
    expect(c.redirectUri).toBe('http://127.0.0.1:4419/api/session/atproto/callback')
    expect(c.clientId).toBe(`http://localhost?redirect_uri=${encodeURIComponent('http://127.0.0.1:4419/api/session/atproto/callback')}&scope=atproto`)
  })
})

describe('the client metadata and keys', () => {
  it('asks for identity only: scope exactly atproto, private_key_jwt, the Hub\'s own callback and keys', () => {
    const m = clientMetadata(hostedConfig()) as Record<string, unknown>
    expect(m.scope).toBe('atproto')
    expect(String(m.scope)).not.toMatch(/transition|include:|repo:|blob:/)
    expect(m).toMatchObject({
      client_id: `${ORIGIN}/oauth/client-metadata.json`, client_uri: ORIGIN, application_type: 'web',
      redirect_uris: [`${ORIGIN}/api/session/atproto/callback`], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_signing_alg: 'ES256',
      jwks_uri: `${ORIGIN}/oauth/jwks.json`, dpop_bound_access_tokens: true,
    })
  })

  it('the published keys are public: no private part', () => {
    const jwks = publicJwks(hostedConfig()) as { keys: Record<string, unknown>[] }
    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'k1', alg: 'ES256', use: 'sig' })
    expect(jwks.keys[0]).not.toHaveProperty('d')
  })

  it('the private key never appears in any answer', async () => {
    const jwk = es256Jwk()
    const d = JSON.parse(jwk).d as string
    const s = await store()
    const a = await app(hostedConfig(jwk), s)
    const answers = [
      await a.request('/oauth/client-metadata.json'), await a.request('/oauth/jwks.json'),
      await a.request('/api/session/atproto/start', { method: 'POST', body: JSON.stringify({ purpose: 'nope' }), headers: { 'content-type': 'application/json' } }),
      await a.request('/api/session/atproto/callback?state=unknown&code=x&iss=https%3A%2F%2Fx.example'),
    ]
    for (const r of answers) expect(await r.text()).not.toContain(d)
    expect((await a.request('/oauth/client-metadata.json')).headers.get('content-type')).toMatch(/application\/json/)
  })
})

describe('the routes', () => {
  it('start refuses an unknown purpose', async () => {
    const a = await app(hostedConfig(), await store())
    const r = await a.request('/api/session/atproto/start', { method: 'POST', body: JSON.stringify({ purpose: 'write-posts' }), headers: { 'content-type': 'application/json' } })
    expect(r.status).toBe(400)
    expect(PURPOSES).toEqual(['sign-in', 'link', 'add-node', 'withdraw-node'])
  })

  it('start refuses add-node and withdraw-node without a node id', async () => {
    const a = await app(hostedConfig(), await store())
    for (const purpose of ['add-node', 'withdraw-node']) {
      const r = await a.request('/api/session/atproto/start', { method: 'POST', body: JSON.stringify({ purpose }), headers: { 'content-type': 'application/json' } })
      expect(r.status).toBe(400)
    }
  })

  it('start refuses link for someone not signed in as a person', async () => {
    const a = await app(hostedConfig(), await store())
    const r = await a.request('/api/session/atproto/start', { method: 'POST', body: JSON.stringify({ purpose: 'link' }), headers: { 'content-type': 'application/json' } })
    expect(r.status).toBe(401)
  })

  it('the callback refuses a state it did not issue, and signs nobody in', async () => {
    const a = await app(hostedConfig(), await store())
    const r = await a.request('/api/session/atproto/callback?state=never-issued&code=x&iss=https%3A%2F%2Fx.example')
    expect(r.status).toBe(400)
    // The only cookie it sets is the round-trip's own, cleared: no sign-in cookie of any kind.
    const set = r.headers.getSetCookie()
    expect(set).toHaveLength(1)
    expect(set[0]).toMatch(new RegExp(`^${FLOW_COOKIE}=; .*Max-Age=0`))
  })

  it('the callback refuses a state started in another browser (no flow cookie, or another one), and spends it', async () => {
    const s = await store()
    const a = await app(hostedConfig(), s)
    const flow = 'flow-nonce-of-the-starting-browser'
    const appState = JSON.stringify({ purpose: 'link', flow: createHash('sha256').update(flow).digest('base64url'), by: 'org:person:a' })
    const { stateStore } = s.oauthStores()
    for (const cookie of [undefined, `${FLOW_COOKIE}=someone-elses`]) {
      await stateStore.set('st-1', { iss: 'https://x.example', appState, verifier: 'v', authMethod: { method: 'none' }, dpopJwk: {} } as never)
      const r = await a.request('/api/session/atproto/callback?state=st-1&code=x&iss=https%3A%2F%2Fx.example', cookie ? { headers: { cookie } } : {})
      expect(r.status).toBe(400)
      expect(await stateStore.get('st-1')).toBe(undefined)
    }
  })

  it('the client metadata and keys are not served for a loopback client', async () => {
    const read = readAtprotoConfig({}, { hosted: false, origin: 'http://localhost:4419' }) as { config: AtprotoConfig }
    const a = new Hono()
    mountAtproto(a, { config: read.config, store: await store(), hosted: false, personOf: () => null })
    expect((await a.request('/oauth/client-metadata.json')).status).toBe(404)
  })

  it('not configured (hosted without the key): the routes are there and say it is not offered', async () => {
    const a = new Hono()
    mountAtproto(a, { config: null, store: await store(), hosted: true, personOf: () => null })
    const r = await a.request('/api/session/atproto/start', { method: 'POST', body: JSON.stringify({ purpose: 'sign-in' }), headers: { 'content-type': 'application/json' } })
    expect(r.status).toBe(404)
    expect((await r.json()).error).toMatch(/not offered/)
    expect((await a.request('/api/session/atproto/callback?state=x')).status).toBe(404)
    expect((await a.request('/oauth/client-metadata.json')).status).toBe(404)
  })

  it('the one new write route is named in INSTANCE_WRITES, as a session write', () => {
    expect(INSTANCE_WRITES).toContainEqual({ method: 'POST', path: '/api/session/atproto/start', class: 'session' })
  })
})

// B8, after the final review: every round-trip starts from a Hub page by a click (POST, Origin-guarded); a link
// from another site cannot start one. The browser comes back to where it started (the I6 return rule).
describe('starting a round-trip, and coming back', () => {
  const NET = 'https://network.example.org/refi-x/'
  async function seamApp(o: { onIdentity?: (who: AtprotoIdentity) => void } = {}) {
    const s = await store()
    const started: { input: string; state: Record<string, unknown> }[] = []
    const a = new Hono()
    mountAtproto(a, {
      config: hostedConfig(), store: s, hosted: true, personOf: () => null, returnDomain: 'example.org',
      oauth: {
        authorize: async (input, appState) => { started.push({ input, state: JSON.parse(appState) as Record<string, unknown> }); return new URL('https://auth.example.net/authorize?x=1') },
        callback: async () => ({ did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', scope: 'atproto', handle: 'refi-x.org' }),
      },
      onIdentity: { 'add-node': (c, who) => { o.onIdentity?.(who); return c.text('ok') } },
    })
    const start = (body: Record<string, unknown>) => a.request('/api/session/atproto/start', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    return { a, s, started, start }
  }

  it('there is no GET start: a link from another page cannot start a round-trip', async () => {
    const { a, started } = await seamApp()
    for (const q of ['purpose=withdraw-node&node=refi-x', 'purpose=sign-in&handle=x.bsky.social']) {
      expect((await a.request(`/api/session/atproto/go?${q}`)).status, q).toBe(404)
    }
    expect(started).toEqual([])
  })

  it('a handle must be a handle (an @handle or a profile link is read as one); an address is refused, never followed', async () => {
    const { start, started } = await seamApp()
    for (const handle of ['https://evil.example', 'evil.example/path', 'http://x.bsky.social', 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'not a handle']) {
      expect((await start({ purpose: 'sign-in', handle })).status, handle).toBe(400)
    }
    expect(started).toEqual([])
    await start({ purpose: 'sign-in', handle: '@X.bsky.social' })
    await start({ purpose: 'sign-in', handle: 'https://bsky.app/profile/y.bsky.social' })
    expect(started.map(s => s.input)).toEqual(['x.bsky.social', 'y.bsky.social'])
  })

  it('the start keeps a return on the org\'s domain; one off it is the Hub\'s root (never an open redirect)', async () => {
    const { start, started } = await seamApp()
    await start({ purpose: 'withdraw-node', node: 'refi-x', return: NET })
    await start({ purpose: 'sign-in', return: 'https://evil.example.com/' })
    expect(started[0]).toMatchObject({ input: 'https://certified.one', state: { purpose: 'withdraw-node', node: 'refi-x', by: null, return: NET } })
    expect(started[1]?.state).toMatchObject({ purpose: 'sign-in', return: `${ORIGIN}/` })
  })

  it('the callback hands the return on to what the purpose does', async () => {
    let seen: AtprotoIdentity | null = null
    const { a, s, started, start } = await seamApp({ onIdentity: who => { seen = who } })
    const go = await start({ purpose: 'add-node', node: 'refi-x', return: NET })
    const flow = /^atproto_flow=([^;]+)/.exec(go.headers.getSetCookie()[0]!)![1]!
    // What the client keeps under the state key it sent to the authorization server (the seam stands in for both).
    await s.oauthStores().stateStore.set('st-1', { appState: JSON.stringify(started[0]!.state) } as never)
    const r = await a.request('/api/session/atproto/callback?state=st-1&code=c&iss=https%3A%2F%2Fauth.example.net', { headers: { cookie: `${FLOW_COOKIE}=${flow}` } })
    expect(await r.text()).toBe('ok')
    expect(seen).toMatchObject({ did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'refi-x.org', purpose: 'add-node', node: 'refi-x', return: NET })
  })

  it('the callback is a public read (a signed-out browser lands on it); no GET start is', () => {
    expect(PUBLIC_READS).toContain('/api/session/atproto/callback')
    expect(PUBLIC_READS).not.toContain('/api/session/atproto/go')
  })
})
