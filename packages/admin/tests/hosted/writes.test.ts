import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { createSession } from '../../server/session/sessions.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { layoutFile, stateDir, writeLayout } from '../../server/state.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { checksumAddress } from '../../lib/caip.mjs'
import type { FetchLike } from '../../server/systems/driver.ts'
import { encodeArgs, selector } from '../../lib/abi.mjs'
import { HATS_SIGNATURES, VIEW_HAT_TYPES, childHatId, hatRef, topHatId } from '../../lib/hats.mjs'
import {
  actorKey, hostedWrites, HOSTED_WRITES, HOSTED_OFF, ONE_WRITER, CLAIM_HOSTED, HOSTED_UNLISTED, type HostedWrite,
} from '../../server/hosted/writes.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterAll(restoreEnv) // startServer hosted sets the Hub's ident in process.env (L9 §5.5)

// L9 spec §5.4 (carry 1, Q-L9-4): every write route is classified when hosted. A hosted server (startServer on a free port,
// a fresh repository under the temp directory, a private store and the admin state in temp folders of their own, a fake
// fetch standing in for the Celo node and its explorer: no network, S13). Two members sign in (sessions made as a sign-in
// that passed makes them); both wear Ops, a hat of the tree that no governance role is sourced from (P3: a member wearing
// a hat who holds no governance role for the act).

const CELO = 'eip155:42220'
const TOP_ID = topHatId(13)
const COUNCIL_ID = childHatId(TOP_ID, 1)
const OPS_ID = childHatId(TOP_ID, 2)
const COUNCIL = hatRef(CELO, COUNCIL_ID)
/** A session's account as sign-in keeps it: CAIP-10, the address in EIP-55 form. */
const account = (last: string) => `${CELO}:${checksumAddress(`0x${'0'.repeat(38)}${last}`)}`
const A1 = account('a1'), A2 = account('a2'), A3 = account('a3')
const A4 = account('a4') // wears Council: opens the proposal the P3 test acts on

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: council, method: direct } }
    - { id: people, applies_to: [members], propose: council, decide: { by: council, method: approve, count: 2 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const VISIBILITY = 'visibility:\n  collections:\n    projects: { default: public }\n'

// ── the Celo node and its explorer, faked (as tests/visibility/never-in-git.test.ts fakes them) ──

const word64 = (hex: string) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const address = (account: string) => account.split(':')[2]!.toLowerCase()

/** The fixture tree: Top, with Council and Ops under it. `wearers` maps a hat id to the (lowercase) addresses that wear it. */
function fakeChain(wearers: Record<string, string[]>): FetchLike {
  const children: Record<string, number> = { [word64(TOP_ID)]: 2, [word64(COUNCIL_ID)]: 0, [word64(OPS_ID)]: 0 }
  const worn = (hat: string) => Object.entries(wearers).find(([id]) => word64(id) === hat)?.[1] ?? []
  const VIEW = selector(HATS_SIGNATURES.viewHat), WEARER = selector(HATS_SIGNATURES.isWearerOfHat)
  const ZERO = '0x0000000000000000000000000000000000000000'
  const call = (data: string): string => {
    const at = (n: number) => data.slice(10 + 64 * n, 10 + 64 * (n + 1))
    if (data.startsWith(VIEW)) {
      const hat = at(0)
      if (!(hat in children)) return encodeArgs(VIEW_HAT_TYPES, ['', 0, 0, ZERO, ZERO, '', 0, true, true])
      return encodeArgs(VIEW_HAT_TYPES, ['a hat of the fixture tree', 10, worn(hat).length, ZERO, ZERO, '', children[hat], true, true])
    }
    if (data.startsWith(WEARER)) return encodeArgs(['bool'], [worn(at(1)).includes(`0x${at(0).slice(24)}`)])
    throw new Error(`the fake node was asked an eth_call it does not know: ${data.slice(0, 10)}`)
  }
  return async (url, init) => {
    if (init.method === 'GET') {
      const m = /\/instances\/(\d+)\/holders$/.exec(url)
      if (!m) return { ok: false, status: 404, json: async () => ({}) }
      const items = worn(word64(BigInt(m[1]!).toString(16))).map(hash => ({ address: { hash } }))
      return { ok: true, status: 200, json: async () => ({ items, next_page_params: null }) }
    }
    const body = JSON.parse(init.body!)
    const answer = (Array.isArray(body) ? body : [body]).map((r: { id: number; method: string; params: [{ data: string }] }) => {
      const result = r.method === 'eth_blockNumber' ? '0x64' : r.method === 'eth_chainId' ? '0xa4ec' : r.method === 'eth_getCode' ? '0x' : call(r.params[0].data)
      return { jsonrpc: '2.0', id: r.id, result }
    })
    return { ok: true, status: 200, json: async () => (Array.isArray(body) ? answer : answer[0]) }
  }
}

// ── the hosted house, over HTTP ──

let repo: string
let server: Running
let home: string
let privateDir: string
const cookies: Record<'a1' | 'a2' | 'a3' | 'a4', string> = { a1: '', a2: '', a3: '', a4: '' }
const ids: Record<'a1' | 'a2', string> = { a1: '', a2: '' }

async function http(method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  const res = await fetch(`http://localhost:${server.port}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(o.body ?? {}) })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json }
}
const head = () => git(repo, 'rev-parse HEAD').trim()
const storeStrings = () => [...server.privateStore!.allStrings()].sort()
/** The Org-Actor of every commit after `since`. */
const actorsSince = (since: string) => git(repo, `rev-list ${since}..HEAD`).split('\n').filter(Boolean)
  .map(sha => parseTrailers(git(repo, `log -1 --format=%B ${sha}`)).actor)

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4), not this test's matter
  repo = makeFixtureRepo()
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, the rules and the policy"')
  home = mkdtempSync(join(tmpdir(), 'hosted-writes-home-'))
  privateDir = mkdtempSync(join(tmpdir(), 'hosted-writes-private-'))
  vi.stubEnv('ORG_OS_ADMIN_HOME', home)
  vi.stubEnv('ORG_OS_PRIVATE_DIR', privateDir)
  const fetch = fakeChain({ [TOP_ID]: [], [COUNCIL_ID]: [address(A4)], [OPS_ID]: [address(A1), address(A2), address(A3)] })
  // The hosted write paths as they are once writes are turned on (Lane 3 Task 11's switch; hosted, it is off by default).
  server = await startServer({ repo, port: 0, hosted: true, fetch, instanceWrites: 'on' })
  const now = () => new Date()
  for (const [who, account] of [['a1', A1], ['a2', A2], ['a3', A3], ['a4', A4]] as const) {
    cookies[who] = `house_session=${(await createSession(server.privateStore!, account, now)).token}`
  }
  ids.a1 = ((await http('GET', '/api/actor', { cookie: cookies.a1 })).json as { id: string }).id
  ids.a2 = ((await http('GET', '/api/actor', { cookie: cookies.a2 })).json as { id: string }).id
})
afterAll(async () => {
  await server.close()
  removeFixtureRepo(repo)
  rmSync(home, { recursive: true, force: true })
  rmSync(privateDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('every write route is classified when hosted (L9 §5.4)', () => {
  it('every non-GET route the app registers is in HOSTED_WRITES, and every entry is a route', () => {
    const routes = server.app.routes.filter(r => r.path.startsWith('/api'))
    const writes = [...new Set(routes.filter(r => r.method !== 'GET' && r.method !== 'ALL').map(r => `${r.method} ${r.path}`))]
    expect(writes.length).toBeGreaterThan(30)
    const listed = new Set(HOSTED_WRITES.map(w => `${w.method} ${w.path}`))
    expect(writes.filter(w => !listed.has(w))).toEqual([]) // names a route the table is missing
    expect([...listed].filter(w => !writes.includes(w))).toEqual([]) // no stale entry
    // A handler registered for every method would escape both lists: only the middleware and the 404 are.
    expect([...new Set(routes.filter(r => r.method === 'ALL').map(r => r.path))].sort()).toEqual(['/api', '/api/*'])
  })

  it('the classes are the spec\'s, and each off route carries its code and sentence', () => {
    const cls = (method: string, path: string) => HOSTED_WRITES.find(w => w.method === method && w.path === path)
    expect(cls('POST', '/api/operations/:op/plan')).toEqual({ method: 'POST', path: '/api/operations/:op/plan', class: 'off', code: 'HOSTED_OFF', sentence: HOSTED_OFF })
    expect(cls('POST', '/api/jobs')).toMatchObject({ class: 'off', code: 'HOSTED_OFF' })
    expect(cls('DELETE', '/api/jobs/:id')).toMatchObject({ class: 'off', code: 'HOSTED_OFF' })
    expect(cls('POST', '/api/sync')).toMatchObject({ class: 'off', code: 'ONE_WRITER', sentence: ONE_WRITER })
    expect(cls('POST', '/api/bootstrap/claim/plan')).toMatchObject({ class: 'off', code: 'CLAIM_HOSTED', sentence: CLAIM_HOSTED })
    expect(cls('POST', '/api/bootstrap/claim/confirm')).toMatchObject({ class: 'off', code: 'CLAIM_HOSTED' })
    for (const m of ['PUT', 'DELETE']) {
      expect(cls(m, '/api/wizards/:id/draft')?.class).toBe('per-member')
      expect(cls(m, '/api/layout/:board')?.class).toBe('per-member')
    }
    expect(cls('POST', '/api/session')?.class).toBe('session')
    expect(cls('POST', '/api/session/nonce')?.class).toBe('session')
    expect(cls('DELETE', '/api/session')?.class).toBe('session')
    for (const w of HOSTED_WRITES) if (w.class !== 'off') expect([w.path, w.code, w.sentence]).toEqual([w.path, undefined, undefined])
  })

  it('the sentences are §10\'s, verbatim', () => {
    expect(HOSTED_OFF).toBe('This runs a command on the server, which a hosted Hub does not do for anyone. Run it from a maintainer\'s clone of the repository.')
    expect(ONE_WRITER).toBe('The Hub is the only writer to this repository, so there is nothing to sync. Its commits reach the remote by themselves.')
    expect(CLAIM_HOSTED).toBe('A claim ties this machine\'s git identity to a member, and a hosted Hub has none. Members sign in with their wallet.')
    expect(HOSTED_UNLISTED).toBe('This change cannot be made on a hosted Hub yet. Nothing was written.')
  })

  it('the actor key is the first 16 hex digits of the SHA-256 of the actor id', () => {
    expect(actorKey('steward-a')).toMatch(/^[0-9a-f]{16}$/)
    expect(actorKey('steward-a')).not.toBe(actorKey('steward-b'))
    // sha256("abc"), the FIPS 180-2 test vector, known apart from the code under test.
    expect(actorKey('abc')).toBe('ba7816bf8f01cfea')
  })
})

describe('commands, sync and the claim are off when hosted (Q-L9-4)', () => {
  it('each answers its code and sentence verbatim to a signed-in member, and nothing is spawned', async () => {
    const submit = vi.spyOn(LocalExecutor.prototype, 'submit')
    const before = head()
    const asked: [string, string, unknown][] = [
      ['POST', '/api/operations/fetch/plan', { resource: 'home' }],
      ['POST', '/api/jobs', { op: 'fetch', resource: 'home' }],
      ['POST', '/api/jobs', { nonce: 'x' }],
      ['DELETE', '/api/jobs/abc-123', undefined],
      ['POST', '/api/sync', { nonce: 'x' }],
      ['POST', '/api/bootstrap/claim/plan', { member: 'steward-a' }],
      ['POST', '/api/bootstrap/claim/confirm', { nonce: 'x' }],
    ]
    const answers = []
    for (const [method, path, body] of asked) answers.push([method, path, await http(method, path, { body, cookie: cookies.a1 })])
    expect(answers).toEqual([
      ['POST', '/api/operations/fetch/plan', { status: 403, json: { error: HOSTED_OFF, code: 'HOSTED_OFF' } }],
      ['POST', '/api/jobs', { status: 403, json: { error: HOSTED_OFF, code: 'HOSTED_OFF' } }],
      ['POST', '/api/jobs', { status: 403, json: { error: HOSTED_OFF, code: 'HOSTED_OFF' } }],
      ['DELETE', '/api/jobs/abc-123', { status: 403, json: { error: HOSTED_OFF, code: 'HOSTED_OFF' } }],
      ['POST', '/api/sync', { status: 409, json: { error: ONE_WRITER, code: 'ONE_WRITER' } }],
      ['POST', '/api/bootstrap/claim/plan', { status: 403, json: { error: CLAIM_HOSTED, code: 'CLAIM_HOSTED' } }],
      ['POST', '/api/bootstrap/claim/confirm', { status: 403, json: { error: CLAIM_HOSTED, code: 'CLAIM_HOSTED' } }],
    ])
    expect(submit).not.toHaveBeenCalled()
    expect(head()).toBe(before)
    submit.mockRestore()
  })

  it('GET /api/operations is [] when hosted, with or without a resource', async () => {
    expect(await http('GET', '/api/operations', { cookie: cookies.a1 })).toEqual({ status: 200, json: [] })
    expect(await http('GET', '/api/operations?resource=home', { cookie: cookies.a1 })).toEqual({ status: 200, json: [] })
  })

  it('a write with no session is still refused first, 401 (L5)', async () => {
    expect((await http('POST', '/api/sync', { body: {} })).status).toBe(401)
  })
})

describe('wizard drafts are per member when hosted (Q-L9-4)', () => {
  const DRAFT = '/api/wizards/claim-handle/draft'
  it('two members\' drafts do not see each other; DELETE removes only the caller\'s', async () => {
    const put = await http('PUT', DRAFT, { body: { index: 1, answers: { who: 'SENTINEL-draft-1' } }, cookie: cookies.a1 })
    expect(put.status).toBe(200)
    expect(existsSync(join(stateDir(repo), 'wizards', `claim-handle-${actorKey(ids.a1)}.json`))).toBe(true)
    expect(existsSync(join(stateDir(repo), 'wizards', 'claim-handle-1.json'))).toBe(false)
    expect(await http('GET', DRAFT, { cookie: cookies.a2 })).toEqual({ status: 200, json: null })
    expect((await http('GET', DRAFT, { cookie: cookies.a1 })).json).toMatchObject({ index: 1, answers: { who: 'SENTINEL-draft-1' } })

    expect((await http('PUT', DRAFT, { body: { index: 2, answers: { who: 'SENTINEL-draft-2' } }, cookie: cookies.a2 })).status).toBe(200)
    expect((await http('GET', DRAFT, { cookie: cookies.a1 })).json).toMatchObject({ answers: { who: 'SENTINEL-draft-1' } })
    expect((await http('DELETE', DRAFT, { cookie: cookies.a2 })).status).toBe(200)
    expect(await http('GET', DRAFT, { cookie: cookies.a2 })).toEqual({ status: 200, json: null })
    expect((await http('GET', DRAFT, { cookie: cookies.a1 })).json).toMatchObject({ answers: { who: 'SENTINEL-draft-1' } })
    expect((await http('DELETE', DRAFT, { cookie: cookies.a1 })).status).toBe(200)
    expect(await http('GET', DRAFT, { cookie: cookies.a1 })).toEqual({ status: 200, json: null })
  })
})

describe('layouts are per member when hosted (Q-L9-4)', () => {
  const LAYOUT = '/api/layout/organization'
  it('a PUT keeps only ids the writer sees; two members\' layouts are separate; the public reads the shared file', async () => {
    const cards = ((await http('GET', '/api/resources?board=organization', { cookie: cookies.a1 })).json as { id: string }[]).map(n => n.id)
    const publicCards = ((await http('GET', '/api/resources?board=organization')).json as { id: string }[]).map(n => n.id)
    const card = publicCards[0]!
    const other = cards.find(id => id !== card)!
    expect([card, other].every(Boolean)).toBe(true)
    const shared = { [card]: { x: 1, y: 1 } }
    writeLayout(repo, 'organization', shared)

    // The writer's own file holds only the cards they see: a card they do not see (here, none at all) is dropped.
    const put = await http('PUT', LAYOUT, { body: { [card]: { x: 10, y: 10 }, 'project:SENTINEL-unseen-1': { x: 5, y: 5 } }, cookie: cookies.a1 })
    expect(put).toEqual({ status: 200, json: { [card]: { x: 10, y: 10 } } })
    expect(existsSync(layoutFile(repo, 'organization', actorKey(ids.a1)))).toBe(true)
    expect(await http('GET', LAYOUT, { cookie: cookies.a1 })).toEqual({ status: 200, json: { [card]: { x: 10, y: 10 } } })
    // Another member, with no file of their own, reads the shared one; the public too.
    expect(await http('GET', LAYOUT, { cookie: cookies.a2 })).toEqual({ status: 200, json: shared })
    expect(await http('GET', LAYOUT)).toEqual({ status: 200, json: shared })

    expect((await http('PUT', LAYOUT, { body: { [other]: { x: 20, y: 20 } }, cookie: cookies.a2 })).status).toBe(200)
    expect(await http('GET', LAYOUT, { cookie: cookies.a2 })).toEqual({ status: 200, json: { [other]: { x: 20, y: 20 } } })
    expect(await http('GET', LAYOUT, { cookie: cookies.a1 })).toEqual({ status: 200, json: { [card]: { x: 10, y: 10 } } })
    expect(await http('GET', LAYOUT)).toEqual({ status: 200, json: shared }) // no member's write reaches the shared file

    // DELETE clears only the caller's own; then they read the shared file again.
    expect(await http('DELETE', LAYOUT, { cookie: cookies.a2 })).toEqual({ status: 200, json: { cleared: true } })
    expect(await http('GET', LAYOUT, { cookie: cookies.a1 })).toEqual({ status: 200, json: { [card]: { x: 10, y: 10 } } })
    expect(await http('GET', LAYOUT, { cookie: cookies.a2 })).toEqual({ status: 200, json: shared })
    expect(existsSync(layoutFile(repo, 'organization'))).toBe(true)
  })
})

describe('every actor route refuses, or writes as, a member who holds no role (P3)', () => {
  it('never a 500; a refusal leaves the trunk and the store as they were; a write is the member\'s', async () => {
    const PROJECT = 'proj-001'
    /** A minimal body per route, kept here; `:id` of a proposal is filled from the one opened, if any. */
    const BODIES: Record<string, { path: string; body?: unknown }> = {
      'PUT /api/registries/:name/:id': { path: `/api/registries/projects/${PROJECT}`, body: { id: PROJECT, title: 'Renamed', status: 'execute', type: 'program' } },
      'POST /api/registries/:name': { path: '/api/registries/ideas', body: { id: 'idea-new', title: 'New', status: 'open' } },
      'DELETE /api/registries/:name/:id': { path: `/api/registries/projects/${PROJECT}` },
      'POST /api/changes/ops': { path: '/api/changes/ops', body: { ops: [{ op: 'update', record: `projects:${PROJECT}`, set: { status: 'develop' } }] } },
      'POST /api/changes/ops/:n/rebase': { path: '/api/changes/ops/0/rebase', body: { keep: 'mine' } },
      'POST /api/changes/rule': { path: '/api/changes/rule', body: { ops: [{ op: 'update', record: `projects:${PROJECT}`, set: { status: 'develop' } }] } },
      'POST /api/changes/apply': { path: '/api/changes/apply', body: {} },
      'POST /api/proposals': { path: '/api/proposals', body: { title: 'A proposal' } },
      'POST /api/proposals/:id/revise': { path: '/api/proposals/:id/revise', body: { ops: [] } },
      'POST /api/proposals/:id/load': { path: '/api/proposals/:id/load', body: {} },
      'POST /api/proposals/:id/replay': { path: '/api/proposals/:id/replay', body: {} },
      'POST /api/proposals/:id/prepare': { path: '/api/proposals/:id/prepare', body: { system: 'hats-main', action: 'none' } },
      'POST /api/proposals/:id/events': { path: '/api/proposals/:id/events', body: { kind: 'comment', text: 'A comment.' } },
      'POST /api/proposals/:id/check': { path: '/api/proposals/:id/check', body: {} },
      'POST /api/proposals/:id/ratify': { path: '/api/proposals/:id/ratify', body: {} },
      'POST /api/proposals/:id/close': { path: '/api/proposals/:id/close', body: { outcome: 'withdrawn' } },
      'POST /api/library/:id/add': { path: '/api/library/rules:solo/add', body: {} },
      'POST /api/library/receipts/:id/remove': { path: '/api/library/receipts/none/remove', body: {} },
      'POST /api/visibility/narrow': { path: '/api/visibility/narrow', body: { target: { registry: 'projects', id: PROJECT }, level: `hat:${COUNCIL}` } },
      'DELETE /api/changes/ops/:n': { path: '/api/changes/ops/0' },
      'DELETE /api/changes': { path: '/api/changes' },
      'POST /api/push/retry': { path: '/api/push/retry', body: {} },
    }
    const actorRoutes = HOSTED_WRITES.filter(w => w.class === 'actor').map(w => `${w.method} ${w.path}`)
    // Every actor route has a body here (a route added later is driven too), and no body is for a route that is gone.
    expect(Object.keys(BODIES).sort()).toEqual([...actorRoutes].sort())

    // A proposal for the member to act on, opened by a Council wearer: a change to a member, which two Council
    // approvals decide, so it stays open.
    const staged = await http('POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'members:steward-a', set: { role: 'Core Contributor' } }] }, cookie: cookies.a4 })
    expect(staged.status).toBe(200)
    const opened = await http('POST', '/api/proposals', { body: { title: 'A change to a member' }, cookie: cookies.a4 })
    expect([opened.status, opened.json]).toEqual([201, expect.objectContaining({ id: expect.any(String) })])
    const proposal = String((opened.json as { id: string }).id)

    const seen: { route: string; status: number; code?: unknown; commits: number }[] = []
    for (const [route, { path, body }] of Object.entries(BODIES)) {
      const method = route.split(' ')[0]!
      const trunk = head()
      const store = storeStrings()
      const res = await http(method, path.replace(':id', proposal), { body, cookie: cookies.a3 })
      const code = (res.json as { code?: unknown } | null)?.code
      seen.push({ route, status: res.status, code, commits: actorsSince(trunk).length })
      expect([route, res.status < 500, res.json]).toEqual([route, true, res.json])
      expect([route, code]).not.toEqual([route, 'HOSTED_UNLISTED']) // the route ran: the table let it through
      if (res.status >= 400) {
        expect([route, head(), storeStrings()]).toEqual([route, trunk, store])
      } else {
        const a3 = ((await http('GET', '/api/actor', { cookie: cookies.a3 })).json as { id: string }).id
        expect([route, actorsSince(trunk).filter(a => a !== a3)]).toEqual([route, []])
      }
    }
    // The member holds no role: Apply is refused by the rule (the route's own 403), withdraw by the machine (409); a
    // comment, which any member may make, is written, as theirs.
    const of = (route: string) => seen.find(s => s.route === route)
    expect(of('POST /api/changes/apply')).toMatchObject({ status: 403, commits: 0 })
    expect(of('POST /api/proposals/:id/close')).toMatchObject({ status: 409, code: 'REFUSED', commits: 0 })
    expect(of('POST /api/proposals/:id/events')).toMatchObject({ status: 200, commits: 1 })
  })
})

describe('the middleware, alone (P2: the matched route\'s pattern)', () => {
  const table: readonly HostedWrite[] = [
    { method: 'POST', path: '/api/things/:id', class: 'off', code: 'HOSTED_OFF', sentence: HOSTED_OFF },
    { method: 'POST', path: '/api/kept/:rest{.+}', class: 'actor' },
  ]
  /** An app shaped as the server's: the middleware first, then the routes, then the 404 for /api/* and a static catch-all. */
  const app = () => {
    const a = new Hono()
    a.use('/api/*', hostedWrites(table))
    a.post('/api/things/:id', c => c.json({ ran: 'things' }))
    a.post('/api/kept/:rest{.+}', c => c.json({ ran: 'kept' }))
    a.post('/api/unlisted', c => c.json({ ran: 'unlisted' }))
    a.get('/api/things/:id', c => c.json({ ran: 'read' }))
    a.all('/api/*', c => c.json({ error: 'no such address' }, 404))
    a.use('/*', async (_c, next) => { await next() })
    return a
  }
  it('classifies by the matched route\'s pattern, not the middleware\'s path, the request\'s path or a later catch-all', async () => {
    const a = app()
    expect(await (await a.request('/api/things/abc', { method: 'POST' })).json()).toEqual({ error: HOSTED_OFF, code: 'HOSTED_OFF' })
    expect((await a.request('/api/things/abc', { method: 'POST' })).status).toBe(403)
    expect(await (await a.request('/api/kept/a/b/c', { method: 'POST' })).json()).toEqual({ ran: 'kept' })
    expect(await (await a.request('/api/things/abc')).json()).toEqual({ ran: 'read' }) // a read is not the table's
  })
  it('an unlisted write route, or a write no route answers, is 403 HOSTED_UNLISTED and its handler does not run', async () => {
    const a = app()
    for (const path of ['/api/unlisted', '/api/nowhere']) {
      const res = await a.request(path, { method: 'POST' })
      expect([path, res.status, await res.json()]).toEqual([path, 403, { error: HOSTED_UNLISTED, code: 'HOSTED_UNLISTED' }])
    }
  })
})

describe('createApp mounts the table only when hosted', () => {
  let local: string
  afterEach(() => { if (local) removeFixtureRepo(local) })
  it('a write route added outside the table is refused hosted, and runs locally', async () => {
    local = makeFixtureRepo()
    const ran = vi.fn()
    const make = (hosted: boolean) => createApp(local, a => { a.post('/api/test-only', c => { ran(); return c.json({ ok: true }) }) },
      { hosted, request: withRequest({ repo: local, hosted: false, membership: null }) })
    const ask = (app: Hono) => app.request('http://localhost:4680/api/test-only', { method: 'POST', headers: { host: 'localhost:4680', 'content-type': 'application/json' }, body: '{}' })
    const hosted = await ask(make(true))
    expect([hosted.status, await hosted.json()]).toEqual([403, { error: HOSTED_UNLISTED, code: 'HOSTED_UNLISTED' }])
    expect(ran).not.toHaveBeenCalled()
    const res = await ask(make(false))
    expect([res.status, await res.json()]).toEqual([200, { ok: true }])
    expect(ran).toHaveBeenCalledTimes(1)
  })
})
