// The Hub's AT Proto OAuth client (refi-dao-os network app spec docs/specs/2026-11-24-refi-dao-network-app-design.md
// §5.1, §5.7, Q12; plan task B2): a second way into the ReFi DAO sign-in, with a Bluesky or Certified account. It asks
// for identity only (scope `atproto`), reads the account's DID, and signs the OAuth session out again at once: nothing
// is ever written to anyone's account, and no token is kept.
//
// Hosted it is a confidential client (`private_key_jwt`, an ES256 key in HOUSE_ATPROTO_PRIVATE_JWK), whose id is its
// metadata at https://<hub>/oauth/client-metadata.json, so returning people skip the consent screen. Locally, on http,
// it is a loopback client (no key; the authorization server shows consent every time). Its state and sessions live in
// the private store (schema 4). Each round-trip is bound to the browser that started it by a short-lived cookie, so a
// round-trip started by one person cannot be finished by another (a link made in someone else's name).
import { createHash, createPrivateKey, createPublicKey, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { JoseKey, NodeOAuthClient, requestLocalLock } from '@atproto/oauth-client-node'
import type { PrivateStore } from '../private/store.ts'
import { safeReturn } from '../../lib/return-url.mjs'

/** Every variable the AT Proto sign-in reads. */
export const ATPROTO_ENV = ['HOUSE_ATPROTO_PRIVATE_JWK'] as const
/** Why a round-trip is made (§5.1 sign-in, §5.3 link, §5.4 and §5.7 a node adding or withdrawing its account). */
export const PURPOSES = ['sign-in', 'link', 'add-node', 'withdraw-node'] as const
export type Purpose = typeof PURPOSES[number]
/** The cookie that binds a round-trip to the browser that started it. */
export const FLOW_COOKIE = 'atproto_flow'
/** Where a sign-in starts when no handle is given: Certified's sign-in (email code), per docs.hypercerts.org's entryway. */
export const CERTIFIED_ENTRYWAY = 'https://certified.one'

const CALLBACK_PATH = '/api/session/atproto/callback'
/** B8: the same start by a plain link, for the network site (the Hub answers no other site's script). Never `link`. */
const GO_PATH = '/api/session/atproto/go'
const METADATA_PATH = '/oauth/client-metadata.json'
const JWKS_PATH = '/oauth/jwks.json'
const FLOW_MS = 60 * 60 * 1000
const NODE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/
const JWK_REFUSAL = 'HOUSE_ATPROTO_PRIVATE_JWK is not an ES256 private key as a JWK (kty EC, crv P-256, d, x and y). Make one with node -e "const {privateKey}=require(\'crypto\').generateKeyPairSync(\'ec\',{namedCurve:\'P-256\'});console.log(JSON.stringify({...privateKey.export({format:\'jwk\'}),kid:\'house-1\'}))".'

export type AtprotoConfig =
  | { kind: 'confidential'; origin: string; clientId: string; redirectUri: string; privateJwk: JsonWebKey & { kid: string }; publicJwk: JsonWebKey & { kid: string } }
  | { kind: 'loopback'; origin: string; clientId: string; redirectUri: string }

function es256Pair(text: string): { privateJwk: JsonWebKey & { kid: string }; publicJwk: JsonWebKey & { kid: string } } | null {
  let jwk: JsonWebKey & { kid?: unknown }
  try { jwk = JSON.parse(text) as JsonWebKey & { kid?: unknown } } catch { return null }
  if (jwk === null || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') return null
  try {
    const priv = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y } as never, format: 'jwk' })
    const pub = createPublicKey(priv).export({ format: 'jwk' })
    if (pub.x !== jwk.x || pub.y !== jwk.y) return null
    const kid = typeof jwk.kid === 'string' && jwk.kid !== '' ? jwk.kid : 'house-1'
    return { privateJwk: { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y, kid }, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid } }
  } catch { return null }
}

/** What the AT Proto sign-in needs, or the sentence that stops the start (naming the variable, never its value).
 *  Hosted: without the key it is not offered; with it, a confidential client on the Hub's https origin. Local on http: a
 *  loopback client on 127.0.0.1 and the server's port. */
export function readAtprotoConfig(env: Record<string, string | undefined>, o: { hosted: boolean; origin: string }): { config: AtprotoConfig | null } | { refuse: string } {
  const origin = o.origin.replace(/\/$/, '')
  const url = new URL(origin)
  const text = env.HOUSE_ATPROTO_PRIVATE_JWK?.trim()
  if (!o.hosted && url.protocol === 'http:') {
    const redirectUri = `http://127.0.0.1${url.port ? `:${url.port}` : ''}${CALLBACK_PATH}`
    return { config: { kind: 'loopback', origin, redirectUri, clientId: `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=atproto` } }
  }
  if (!text) return { config: null }
  if (url.protocol !== 'https:') return { refuse: 'HOUSE_ATPROTO_PRIVATE_JWK is set, but the Hub\'s address is not https: a confidential client\'s metadata must be at a public https address.' }
  const pair = es256Pair(text)
  if (!pair) return { refuse: JWK_REFUSAL }
  return { config: { kind: 'confidential', origin, clientId: `${origin}${METADATA_PATH}`, redirectUri: `${origin}${CALLBACK_PATH}`, ...pair } }
}

/** The client's metadata (served at its client_id when confidential). Identity only: scope exactly `atproto`. */
export function clientMetadata(config: AtprotoConfig): Record<string, unknown> {
  const common = { client_id: config.clientId, redirect_uris: [config.redirectUri], scope: 'atproto', grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], dpop_bound_access_tokens: true }
  if (config.kind === 'loopback') return { ...common, application_type: 'native', token_endpoint_auth_method: 'none' }
  return { ...common, client_name: 'ReFi DAO Hub', client_uri: config.origin, application_type: 'web', token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256', jwks_uri: `${config.origin}${JWKS_PATH}` }
}

/** The client's public key set: never the private part. */
export function publicJwks(config: AtprotoConfig): { keys: Record<string, unknown>[] } {
  if (config.kind !== 'confidential') return { keys: [] }
  return { keys: [{ ...config.publicJwk, alg: 'ES256', use: 'sig' }] }
}

/** Who completed a round-trip, as the client read it: the account's DID, its handle as the two-way check gives it
 *  (the handle resolves to the DID and the DID document names it back; `handle.invalid` otherwise), and what the
 *  round-trip was for. */
export interface AtprotoIdentity {
  did: string; handle: string; scope: string; purpose: Purpose; node: string | null; by: string | null
  /** Where the browser goes back to (B8), as the I6 return rule judged it at the start; null: none was given. */
  return: string | null
}
/** AT Proto's handle for an account whose handle does not check out both ways. */
export const HANDLE_INVALID = 'handle.invalid'
export type IdentityHandler = (c: Context, who: AtprotoIdentity) => Promise<Response> | Response

export interface AtprotoDeps {
  /** null: not offered (hosted without the key). The routes are still there, so the route tables never depend on it. */
  config: AtprotoConfig | null
  store: PrivateStore
  hosted: boolean
  /** The signed-in person's id, or null (a Guest, or nobody): who is linking, or who is adding a node. */
  personOf: (c: Context) => string | null
  /** What each purpose does once the account is proven (B3 sign-in, B4 link, B5 add/withdraw); unset: not offered yet. */
  onIdentity?: Partial<Record<Purpose, IdentityHandler>>
  fetch?: typeof fetch
  /** The org's cookie domain (the emailed link's): a return may be an https address on it (I6). Null: Hub paths only. */
  returnDomain?: string | null
  /** The client's two calls out, for tests; default the OAuth client itself. */
  oauth?: AtprotoCalls
}

/** What the round-trip asks of the OAuth client: where to send the browser, and who came back. */
export interface AtprotoCalls {
  authorize(input: string, appState: string): Promise<URL>
  callback(params: URLSearchParams): Promise<{ did: string; scope: string; handle: string }>
}

const hash = (s: string) => createHash('sha256').update(s).digest('base64url')
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** The OAuth client's routes: its metadata and keys (confidential only), `POST /api/session/atproto/start` and
 *  `GET /api/session/atproto/callback`. */
export function mountAtproto(app: Hono, d: AtprotoDeps): void {
  const { config } = d
  if (config === null) {
    const notOffered = (c: Context) => c.json({ error: 'Sign-in with a Bluesky or Certified account is not offered on this Hub.' }, 404)
    app.post('/api/session/atproto/start', notOffered)
    app.get(GO_PATH, notOffered)
    app.get(CALLBACK_PATH, notOffered)
    return
  }
  const secure = d.hosted || config.origin.startsWith('https:')
  const flowCookie = (value: string, maxAgeS: number) =>
    `${FLOW_COOKIE}=${value}; Path=/api/session/atproto; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`
  let client: Promise<NodeOAuthClient> | null = null
  const clientOf = () => (client ??= (async () => {
    const { stateStore, sessionStore } = d.store.oauthStores()
    return new NodeOAuthClient({
      clientMetadata: clientMetadata(config) as never,
      ...(config.kind === 'confidential' ? { keyset: [await JoseKey.fromImportable(config.privateJwk as never, config.privateJwk.kid)] } : {}),
      stateStore: stateStore as never, sessionStore: sessionStore as never, requestLock: requestLocalLock,
      ...(d.fetch ? { fetch: d.fetch } : {}),
    })
  })())

  const calls: AtprotoCalls = d.oauth ?? {
    authorize: async (input, appState) => (await clientOf()).authorize(input, { scope: 'atproto', state: appState }),
    callback: async params => {
      const oauth = await clientOf()
      const { session } = await oauth.callback(params)
      const did = session.did
      const scope = (await session.getTokenInfo(false)).scope
      // Identity only: nothing is kept, nothing can be written. The tokens are revoked and the session row goes.
      await session.signOut().catch(() => {})
      // The handle, checked both ways by the client's own resolver (`handle.invalid` when it does not check out).
      const handle = await oauth.identityResolver.resolve(did).then(i => i.handle ?? HANDLE_INVALID, () => HANDLE_INVALID)
      return { did, scope, handle }
    },
  }

  /** The start, from a JSON body (POST) or a link's query (GET): the account's sign-in page, and the flow cookie. */
  type Begun = { url: string; cookie: string } | { status: 400 | 401; error: string }
  const begin = async (c: Context, f: { purpose?: unknown; node?: unknown; handle?: unknown; return?: unknown }, via: 'post' | 'get'): Promise<Begun> => {
    const { purpose, node } = f
    if (typeof purpose !== 'string' || !(PURPOSES as readonly string[]).includes(purpose)) {
      return { status: 400, error: `Send { purpose }: one of ${PURPOSES.join(', ')}.` }
    }
    if (via === 'get' && purpose === 'link') return { status: 400, error: 'Linking your account starts from your page in the Hub, not from a link.' }
    if ((purpose === 'add-node' || purpose === 'withdraw-node') && (typeof node !== 'string' || !NODE_ID.test(node))) {
      return { status: 400, error: 'Send { node }: the id of the node whose account this is.' }
    }
    const by = d.personOf(c)
    if (purpose === 'link' && !by) return { status: 401, error: 'Sign in with your emailed link first, then link your account from your page in the Hub.' }
    const given = f.handle
    if (given !== undefined && (typeof given !== 'string' || given.trim() === '' || given.length > 253)) {
      return { status: 400, error: 'Send { handle } as the account\'s handle (such as you.bsky.social), or leave it out to sign in with Certified.' }
    }
    const back = typeof f.return === 'string' && f.return !== '' ? safeReturn(f.return, config.origin, d.returnDomain ?? null) : null
    const input = typeof given === 'string' ? given.trim().replace(/^@/, '') : CERTIFIED_ENTRYWAY
    const flow = randomBytes(32).toString('base64url')
    const appState = JSON.stringify({ purpose, node: typeof node === 'string' ? node : null, by, flow: hash(flow), return: back })
    let url: URL
    try {
      url = await calls.authorize(input, appState)
    } catch {
      return { status: 400, error: typeof given === 'string' ? `No Bluesky or Certified account answers to ${input}. Check the handle and try again.` : 'Certified\'s sign-in could not be reached just now. Try again in a minute.' }
    }
    return { url: url.href, cookie: flowCookie(flow, FLOW_MS / 1000) }
  }

  if (config.kind === 'confidential') {
    app.get(METADATA_PATH, c => c.json(clientMetadata(config), 200, { 'cache-control': 'public, max-age=300' }))
    app.get(JWKS_PATH, c => c.json(publicJwks(config), 200, { 'cache-control': 'public, max-age=300' }))
  }

  app.post('/api/session/atproto/start', async c => {
    let body: Record<string, unknown> | null = null
    try { const b: unknown = await c.req.json(); body = b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : null } catch { body = null }
    const begun = await begin(c, body ?? {}, 'post')
    if ('error' in begun) return c.json({ error: begun.error }, begun.status)
    c.header('set-cookie', begun.cookie)
    return c.json({ url: begun.url })
  })

  // B8: the same start by a link (sign-in, add-node, withdraw-node), answered by leaving for the account's sign-in.
  app.get(GO_PATH, async c => {
    const q = c.req.query()
    const begun = await begin(c, { purpose: q.purpose, node: q.node, handle: q.handle, return: q.return }, 'get')
    if ('error' in begun) return c.text(begun.error, begun.status)
    c.header('set-cookie', begun.cookie)
    return c.redirect(begun.url, 303)
  })

  app.get(CALLBACK_PATH, async c => {
    c.header('set-cookie', flowCookie('', 0))
    const refuse = (text: string) => c.text(text, 400)
    const params = new URL(c.req.url).searchParams
    const state = params.get('state')
    if (!state) return refuse('This sign-in did not come back with its state. Start again from the Hub.')
    const { stateStore } = d.store.oauthStores()
    const saved = await stateStore.get(state) as { appState?: string } | undefined
    if (!saved) return refuse('This sign-in was not started here, or it was started more than an hour ago. Start again from the Hub.')
    let app: { purpose?: unknown; node?: unknown; by?: unknown; flow?: unknown; return?: unknown }
    try { app = JSON.parse(saved.appState ?? '') as typeof app } catch { app = {} }
    const flow = cookieValue(c.req.header('cookie'), FLOW_COOKIE)
    if (typeof app.flow !== 'string' || !flow || !sameHash(hash(flow), app.flow)) {
      await stateStore.del(state)
      return refuse('This sign-in was started in another browser. Start again from the Hub, in this browser.')
    }
    const purpose = app.purpose as Purpose
    if (!(PURPOSES as readonly string[]).includes(purpose)) { await stateStore.del(state); return refuse('This sign-in was started for nothing the Hub knows. Start again.') }
    let did: string, scope: string, handle: string
    try {
      ({ did, scope, handle } = await calls.callback(params))
    } catch {
      return refuse('The sign-in did not complete (it was cancelled, or the account\'s server refused it). Start again from the Hub.')
    }
    const handler = d.onIdentity?.[purpose]
    if (!handler) return c.text('This part of the Hub is not open yet.', 501)
    return handler(c, { did, handle, scope, purpose, node: typeof app.node === 'string' ? app.node : null, by: typeof app.by === 'string' ? app.by : null,
      return: typeof app.return === 'string' ? app.return : null })
  })
}
