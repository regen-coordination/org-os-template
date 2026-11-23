// The hub's side of joining a network (network N2 Task 9): receive a request (a file, or an issue polled through gh),
// apply the hub's own join policy, reply, and only then, through the separate confirmed `federation.publish-links`,
// publish `hasMember`. Every test runs in a fresh temp repository with the fake network and a fake gh runner: nothing
// reaches GitHub, a real PDS or plc.directory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { withFakeGh, type GhReply } from '../gh-shim.ts'
import { createApp } from '../../server/app.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { mountOperations } from '../../server/operations/routes.ts'
import { Plans } from '../../server/operations/plans.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { JobStore, stateDir, type JobRecord } from '../../server/state.ts'
import { runCommand } from '../../server/resources/run.ts'
import { mountFederation } from '../../server/federation/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { writeHubFiles } from '../../server/federation/ledger.ts'
import { federationPollOperation, federationReplyOperation, hubRequests, inboxPut, label, listInbox, SENTENCES } from '../../server/federation/hub.ts'
import { remoteCache, wellKnownUrlOf } from '../../server/federation/remote.ts'
import { atprotoCache, readRepo } from '../../server/federation/atproto/read.ts'
import { planPublish, publishLinksOperation, type PublishDeps } from '../../server/federation/atproto/publish.ts'
import { LINK_NSID, PROFILE_NSID } from '../../lib/federation/links.mjs'
import { buildRequest, hubPeerOf, requestText } from '../../lib/federation/request.mjs'
import { makeInvite } from '../../lib/federation/invite.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'
import { parseTrailers } from '../../lib/trailers.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'
import { checkProposals } from '../../lib/proposals.mjs'
import type { Graph, Resource, Runner } from '../../server/resources/types.ts'
import type { InProcess } from '../../server/operations/catalogue.ts'

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`
/** Identity changes need one maintainer's approval other than the author's: a request is proposed. */
const TWO = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a, bruno] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [identity], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SELF = plcDid('mesh-hub')
const NODE = plcDid('mesa-node')
const NODE_URL = 'https://mesa-node.example.org'
const OTHER_URL = 'https://other-node.example.org'
const ISSUE = 'https://github.com/mesh/hub/issues/12'
const WHERE = 'https://github.com/mesh/hub'
const PASSWORD = 'zq7-UNMISTAKABLE-hub-pass-5521'
const TOKEN = 'tok-UNMISTAKABLE-invite-7713'
/** Near the real now, so a ratify's commit and the ledger's clock agree. */
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000 - 120_000)
const ID_A = '3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e31'
const ID_B = '9b1c7d2e-4a6f-4c3b-9d21-7e5f8a0b1c42'

let repo: string
let app: ReturnType<typeof createApp>
let net: FakeNetwork
let finished: JobRecord[]
let store: ResourceStore
let clock: Date
let gh: Runner

const write = (rel: string, text: string) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text) }
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg) }
const as = (who: string) => git('config', 'user.email', who === 'steward-a' ? 'admin-test@local' : `${who}@example.test`)
const fedText = () => readFileSync(join(repo, 'federation.yaml'), 'utf8')
const peers = () => ((parse(fedText()) as { peers?: Record<string, unknown>[] }).peers ?? [])
const head = () => git('rev-parse', 'HEAD').trim()

type JoinBlock = Record<string, unknown> | null
const FED = (joinBlock: JoinBlock, more = '') => [
  '# the hub\'s federation manifest',
  'identity:', '  name: "Mesh Hub"', '  type: "Network"', '  url: https://mesh-hub.example.org', `  did: "${SELF}"`,
  'networks:', '  - { name: Mesh, role: hub }',
  ...(joinBlock ? [`join: ${JSON.stringify(joinBlock)}`] : []),
  'peers: []', more,
].join('\n')

const request = (o: { id?: string; from?: Partial<{ name: string; type: string; url: string }>; answers?: Record<string, string>; invite?: string; network?: string } = {}) => buildRequest({
  id: o.id ?? ID_A, from: { name: 'Mesa Node', type: 'LocalNode', url: NODE_URL, ...o.from }, hub: { name: 'Mesh Hub', url: 'https://mesh-hub.example.org' },
  network: o.network ?? 'Mesh', answers: o.answers ?? { purpose: 'we work on soil' }, ...(o.invite ? { invite: o.invite } : {}), now: '2026-11-22T10:00:00.000Z',
})

const pdeps = (o: Partial<PublishDeps> = {}): PublishDeps => ({
  fetch: net.fetch, lookup: net.lookup, env: { ATPROTO_APP_PASSWORD: PASSWORD }, now: NOW, allowPlaceholderLexicons: true, run: runCommand, ...o,
})

const build = () => {
  const jobs = new JobStore(repo)
  store = new ResourceStore({ repo, now: () => clock, run: runCommand, lastOk: () => null }, [fleet])
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: j => finished.push(j) })
  const run: Runner = (...a) => gh(...a)
  const catalogue = [federationPollOperation({ run }), federationReplyOperation({ run, now: () => clock }), publishLinksOperation(pdeps())]
  app = createApp(repo, (a, ctx) => {
    mountFederation(a, { repo, withLock: ctx.withLock, now: () => clock, startBranch: 'main' })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock })
    mountOperations(a, { repo, store, jobs, executor, plans: new Plans(), catalogue })
  })
}

/** A hub under `governance` (null: no file, the solo default) with this join block, its kms, and the node's
 *  federation.json in the cache of the last lookup (it carries the node's DID). */
/** What a confirmed `federation.check-links` leaves when `did`'s document names `handle` and the handle names it back. */
const confirm = (did: string, handle: string) => {
  const cache = atprotoCache(repo)
  cache.put(did, { did, pds: 'https://pds-two.example.net', handle, profile: null, links: [], skipped: 0, fetchedAt: NOW.toISOString() }, NOW)
  cache.putHandle(handle, did, NOW)
}

/** `confirmed`: the node's DID was checked and its handle is its url's host, so acceptance may write it (Task 12). */
const setup = (governance: string | null, joinBlock: JoinBlock, confirmed = true) => {
  repo = makeChangeRepo(governance)
  write('data/members.yaml', MEMBERS)
  write('federation.yaml', FED(joinBlock))
  write('kms.yaml', ['adapter: repo-data', 'target: "."', 'atproto:', `  did: "${SELF}"`, '  pds: "https://pds-one.example.com"', '  handle: "mesh-hub.example.org"', '  nsid_authority: "org.meshhub"', ''].join('\n'))
  commit('the hub: identity, members, kms')
  remoteCache(repo).put(wellKnownUrlOf(NODE_URL)!, { spec: 'org-os/federation/1', name: 'Mesa Node', type: 'LocalNode', did: NODE }, NOW)
  if (confirmed) confirm(NODE, 'mesa-node.example.org')
  build()
}

beforeEach(() => {
  finished = []; clock = NOW
  gh = async () => ({ code: 127, stdout: '', stderr: 'no gh in this test', timedOut: false })
  net = makeFakeNetwork({ hosts: {
    'https://pds-one.example.com': { accounts: { [SELF]: { handle: 'mesh-hub.example.org', password: PASSWORD } } },
    'https://pds-two.example.net': { accounts: { [NODE]: { handle: 'mesa-node.example.org', password: 'node-pass' } } },
  } })
})
afterEach(() => removeFixtureRepo(repo))

const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
type Answer = { ref: string | null; outcome: string; sentence: string; proposal?: string }
const importText = async (text: string): Promise<Answer[]> => {
  const res = await post('/api/federation/requests/receive', { text })
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(200)
  return body as Answer[]
}
const drain = async (): Promise<Answer[]> => {
  const res = await post('/api/federation/requests/receive')
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(200)
  return body as Answer[]
}
const records = () => {
  const p = join(repo, 'data', 'federation-requests.yaml')
  return existsSync(p) ? ((parse(readFileSync(p, 'utf8')) as { requests?: Record<string, unknown>[] }).requests ?? []) : []
}
const card = async (): Promise<Resource> => { store.invalidateAdapter('fleet'); return ((await fleet.read({ repo, now: () => clock, run: runCommand, lastOk: () => null })) as Graph).nodes.find(n => n.facts.self === true)! }
const runJob = async (opId: string, params: Record<string, unknown>) => {
  const p = await post(`/api/operations/${opId}/plan`, { resource: (await card()).id, params })
  const plan = await p.json() as { nonce?: string; error?: string }
  expect(p.status, JSON.stringify(plan)).toBe(200)
  const r = await post('/api/jobs', { nonce: plan.nonce })
  const { id } = await r.json() as { id: string }
  await expect.poll(() => finished.find(j => j.id === id)?.status, { interval: 20, timeout: 10_000 }).toBe('ok')
  return finished.find(j => j.id === id)!
}
const fileList = () => git('ls-files').split('\n').filter(Boolean).sort()
/** Whether any file committed at HEAD holds `s` (git grep exits 1 when nothing matches). */
const inTree = (s: string): boolean => { try { git('grep', '-l', '-F', s, 'HEAD'); return true } catch { return false } }
const SCRIPT = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
/** validate:governance --strict over the commits after `base`: what the hub committed must validate clean. */
const governance = (base: string) => {
  const env: Record<string, string | undefined> = { ...process.env, CI: '' }
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete env[k]
  try { return { status: 0, out: execFileSync('node', [SCRIPT, repo, '--strict', '--range', `${base}..HEAD`], { env, stdio: 'pipe' }).toString() } }
  catch (e) { const x = e as { status: number; stdout: Buffer; stderr: Buffer }; return { status: x.status, out: `${x.stdout}${x.stderr}` } }
}
/** No control or format character, one line, at most 100 characters + the sentence around it. */
const shown = (s: string) => { expect(s).not.toMatch(/[\p{Cc}\p{Cf}]/u) }
const reject = async (id: string) => { as('bruno'); const r = await post(`/api/proposals/${id}/close`, { outcome: 'rejected', text: 'no' }); as('steward-a'); return r }
const ownCheck = async () => atprotoCache(repo).put(SELF, await readRepo(SELF, { fetch: net.fetch, lookup: net.lookup, now: NOW }), NOW)
const issueBody = (text: string) => `Join request from Mesa Node for Mesh.\n\n\`\`\`yaml\n${text}\`\`\`\n`

const OPEN = (decision?: string) => ({ policy: 'open', asks: ['purpose'], where: WHERE, ...(decision ? { decision } : {}) })
const APPROVAL = { policy: 'open-with-approval', asks: ['purpose'], where: WHERE }

describe('builds the hub change from fields, never from the file', () => {
  it('a request carrying a change block, or YAML for IDENTITY.md, is refused before anything is written', async () => {
    setup(null, OPEN('LD-2026-040'))
    const before = head()
    const withChange = `${requestText(request())}change:\n  - { op: file, path: IDENTITY.md, text: "# owned" }\n`
    const [a] = await importText(withChange)
    expect(a.outcome).toBe('unreadable')
    expect(a.sentence).toContain('Unknown key "change".')
    const [b] = await importText('IDENTITY.md: |\n  # someone else\npeers:\n  - { name: evil, url: https://evil.example.org }\n')
    expect(b.outcome).toBe('unreadable')
    expect(head()).toBe(before)
    expect(records()).toEqual([])
    expect(fedText()).not.toContain('evil')
  })

  it('a valid one adds exactly one peer, built from the validated fields and the cached did, and touches no other file', async () => {
    setup(null, OPEN('LD-2026-040'))
    const before = parse(fedText()) as Record<string, unknown>
    const [a] = await importText(requestText(request()))
    expect(a).toMatchObject({ ref: `file:${ID_A}`, outcome: 'accepted' })
    expect(a.sentence).toBe('Accepted Mesa Node into Mesh. Publish the link so it shows as mutual on atproto.')
    expect(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim().split('\n').sort()).toEqual(['data/federation-requests.yaml', 'federation.yaml'])
    const after = parse(fedText()) as Record<string, unknown>
    const { peers: p0, ...rest0 } = before
    const { peers: p1, ...rest1 } = after
    expect(rest1).toEqual(rest0)
    expect(p0).toEqual([])
    expect(p1).toEqual([hubPeerOf(request(), 'LD-2026-040', NODE)])
    expect(fedText()).toContain("# the hub's federation manifest")
    expect(parseTrailers(git('log', '-1', '--format=%B'))).toMatchObject({ actor: 'steward-a', decision: 'LD-2026-040' })
    expect(git('log', '-1', '--format=%s').trim()).toBe('federation: accept Mesa Node into Mesh')
  })

  it('the did is written only when a confirmed check tied it to the asker\'s url; a DID its federation.json only claims is not (Task 12)', async () => {
    setup(null, OPEN('LD-2026-040'))
    // the asker's federation.json claims the hub's own DID, whose checked handle is the hub's host, not the asker's
    remoteCache(repo).put(wellKnownUrlOf(NODE_URL)!, { spec: 'org-os/federation/1', name: 'Mesa Node', type: 'LocalNode', did: SELF }, NOW)
    confirm(SELF, 'mesh-hub.example.org')
    const [a] = await importText(requestText(request()))
    expect(a.outcome).toBe('accepted')
    expect(peers()).toEqual([hubPeerOf(request(), 'LD-2026-040')])
    expect(peers()[0].did).toBeUndefined()
  })

  it('a DID its federation.json names but no confirmed check tied to it is not written either (Task 12)', async () => {
    setup(null, OPEN('LD-2026-040'), false)
    const [a] = await importText(requestText(request()))
    expect(a.outcome).toBe('accepted')
    expect(peers()[0].did).toBeUndefined()
  })

  it('untrusted text reaches federation.yaml only as the validated fields', async () => {
    setup(null, OPEN('LD-2026-040'))
    const sneaky = request({ from: { name: 'Mesa: {peers: [evil]}' }, answers: { purpose: 'peers:\n  - { name: evil }', extra: 'IDENTITY.md' } })
    const [a] = await importText(requestText(sneaky))
    expect(a.outcome).toBe('accepted')
    expect(peers()).toHaveLength(1)
    expect(Object.keys(peers()[0]).sort()).toEqual(['decision', 'did', 'name', 'relationship', 'since', 'trust', 'type', 'url'])
    expect(peers()[0].name).toBe('Mesa: {peers: [evil]}')
    expect(fedText()).not.toContain('{ name: evil }')
    expect(fedText()).not.toContain('IDENTITY.md')
    // the record keeps only the answers to the hub's asks
    expect(records()[0].answers).toEqual({ purpose: 'peers:\n  - { name: evil }' })
  })
})

describe('untrusted names are refused at parse, and labelled wherever they are shown', () => {
  it('ESC, RLO, NUL and a 10k-character name are unreadable, write nothing, and the answer shows none of them', async () => {
    setup(null, OPEN('LD-2026-040'))
    const before = head()
    for (const name of ['Mesa\u001b[2J', 'Mesa\u202egnp.exe', 'x'.repeat(10_000)]) {
      const [a] = await importText(requestText(request({ from: { name } })))
      expect(a.outcome).toBe('unreadable')
      shown(a.sentence)
      expect(a.sentence.length).toBeLessThan(140)
    }
    const [n] = await importText(requestText(request()).replace('Mesa Node', 'Mesa\u0000Node'))
    expect(n.outcome).toBe('unreadable')
    expect(head()).toBe(before)
    expect(records()).toEqual([])
  })

  it('label strips control and format characters and the line separators, caps at 100, and never splits a surrogate pair', () => {
    expect(label('Mesa\u001b[31m\u202eNode\u0000')).toBe('Mesa [31m Node')
    expect(label('Mesa\u2028Node\u2029')).toBe('Mesa Node')
    expect(label('y'.repeat(500))).toHaveLength(100)
    const emoji = label('🌱'.repeat(150))
    expect(Array.from(emoji)).toHaveLength(100)
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    expect(Array.from(label('z'.repeat(300), 200))).toHaveLength(200)
  })
})

describe('validate:governance accepts the hub\'s commits under federation/join, and nothing more', () => {
  const invited = () => {
    const { record } = makeInvite({ name: 'Mesa Node', type: 'LocalNode', network: 'Mesh', expires: '2099-12-31', random: n => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256) })
    return { ...record, token_sha256: sha256Hex(TOKEN) }
  }

  it('on a two-maintainer hub: a standing-decision acceptance and a refusal validate clean, with Org-Rule federation/join', async () => {
    setup(TWO, OPEN('LD-2026-040'))
    const base = head()
    expect((await importText(requestText(request())))[0].outcome).toBe('accepted')
    expect(parseTrailers(git('log', '-1', '--format=%B'))).toMatchObject({ actor: 'steward-a', rule: 'federation/join', decision: 'LD-2026-040' })
    expect((await importText(requestText(request({ id: ID_B, from: { url: OTHER_URL }, answers: {} }))))[0].outcome).toBe('refused')
    const v = governance(base)
    expect(v.status, v.out).toBe(0)
  })

  it('on a two-maintainer hub: an invite acceptance validates clean', async () => {
    setup(TWO, { policy: 'invite', asks: ['purpose'] })
    write('data/invites.yaml', `invites:\n  - ${JSON.stringify(invited())}\n`)
    commit('an invite') // before the range judged
    const base = head()
    expect((await importText(requestText(request({ invite: TOKEN }))))[0].outcome).toBe('accepted')
    const v = governance(base)
    expect(v.status, v.out).toBe(0)
  })

  it('a proposed request, its record and the ratify validate clean', async () => {
    setup(TWO, APPROVAL)
    const base = head()
    const [a] = await importText(requestText(request()))
    clock = new Date(NOW.getTime() + 60_000); as('bruno')
    await post(`/api/proposals/${a.proposal}/events`, { kind: 'approve' })
    expect((await post(`/api/proposals/${a.proposal}/ratify`, {})).status).toBe(200)
    as('steward-a')
    const v = governance(base)
    expect(v.status, v.out).toBe(0)
  })

  it('a second peer smuggled into an acceptance is flagged', async () => {
    setup(TWO, OPEN('LD-2026-040'))
    const base = head()
    await importText(requestText(request()))
    // a hand commit dressed as the hub's: one record, and two peers
    const fed = fedText().replace(/^peers:\n/m, `peers:\n  - { name: Smuggled, url: https://smuggled.example.org, trust: read, relationship: node, decision: LD-2026-040 }\n`)
    write('federation.yaml', fed)
    const reqs = readFileSync(join(repo, 'data', 'federation-requests.yaml'), 'utf8')
    write('data/federation-requests.yaml', `${reqs}  - ${JSON.stringify({ ...records()[0], id: ID_B, ref: `file:${ID_B}`, from: { name: 'Other', type: 'LocalNode', url: OTHER_URL } })}\n`)
    git('add', '-A'); git('commit', '-qm', 'federation: accept Other into Mesh', '-m', 'Org-Actor: steward-a\nOrg-Rule: federation/join\nOrg-Decision: LD-2026-040')
    const v = governance(base)
    expect(v.status, v.out).toBe(1)
    expect(v.out).toMatch(/its Org-Rule is federation\/join, and it changes a peer entry other than the requesting instance's/)
  })
})

describe('the same request is received once', () => {
  it('by id and by ref: Already received., nothing created', async () => {
    setup(null, OPEN('LD-2026-040'))
    await importText(requestText(request()))
    const tip = head()
    const [again] = await importText(requestText(request()))
    expect(again).toMatchObject({ outcome: 'already', sentence: SENTENCES.already })
    inboxPut(repo, { transport: 'github', ref: ISSUE, text: requestText(request({ id: ID_B, from: { url: OTHER_URL } })) })
    expect((await drain())[0].outcome).toBe('accepted')
    const tip2 = head()
    inboxPut(repo, { transport: 'github', ref: ISSUE, text: requestText(request({ id: '1d2c3b4a-5e6f-4a1b-8c2d-3e4f5a6b7c8d', from: { url: 'https://third.example.org' } })) })
    const [byRef] = await drain()
    expect(byRef).toMatchObject({ ref: ISSUE, outcome: 'already', sentence: SENTENCES.already })
    expect(head()).toBe(tip2)
    expect(tip2).not.toBe(tip)
    expect(records()).toHaveLength(2)
    expect(listInbox(repo)).toEqual([])
  })
})

describe('one case per outcome', () => {
  it('a closed hub refuses: a refused record, only the ledger changes', async () => {
    setup(null, { policy: 'closed' })
    const [a] = await importText(requestText(request()))
    expect(a).toMatchObject({ outcome: 'refused', sentence: "Refused: This network isn't taking requests." })
    expect(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim()).toBe('data/federation-requests.yaml')
    expect(records()[0]).toMatchObject({ id: ID_A, outcome: 'refused', reason: "This network isn't taking requests.", transport: 'file', ref: `file:${ID_A}`, invite: null })
    expect(peers()).toEqual([])
  })

  it('a network this hub does not list is refused', async () => {
    setup(null, OPEN('LD-2026-040'))
    const [a] = await importText(requestText(request({ network: 'Elsewhere' })))
    expect(a).toMatchObject({ outcome: 'refused', sentence: `Refused: ${SENTENCES.noNetwork}` })
    expect(JSON.stringify(records())).not.toMatch(/reason[^,]*Elsewhere/)
    expect(peers()).toEqual([])
  })

  it('an invite match commits with Org-Decision invite <id>, marks the invite used, and the token is nowhere in the repository', async () => {
    setup(null, { policy: 'invite', asks: ['purpose'] })
    const { record } = makeInvite({ name: 'Mesa Node', type: 'LocalNode', network: 'Mesh', expires: '2099-12-31', random: n => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256) })
    const invite = { ...record, token_sha256: (await import('../../lib/sha256.mjs')).sha256Hex(TOKEN) }
    write('data/invites.yaml', `invites:\n  - ${JSON.stringify(invite)}\n`)
    commit('an invite')
    const [a] = await importText(requestText(request({ invite: TOKEN })))
    expect(a.outcome).toBe('accepted')
    expect(parseTrailers(git('log', '-1', '--format=%B'))).toMatchObject({ decision: `invite ${invite.id}` })
    expect(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim().split('\n').sort()).toEqual(['data/federation-requests.yaml', 'data/invites.yaml', 'federation.yaml'])
    expect((parse(readFileSync(join(repo, 'data', 'invites.yaml'), 'utf8')) as { invites: { used_by: string }[] }).invites[0].used_by).toBe(ID_A)
    expect(records()[0]).toMatchObject({ outcome: 'accepted', invite: invite.id, decision: `invite ${invite.id}` })
    expect(peers()[0].decision).toBe(`invite ${invite.id}`)
    expect(git('log', '-p', '--all')).not.toContain(TOKEN)
    expect(inTree(TOKEN)).toBe(false)
  })

  it('open-with-approval opens a proposal with origin, authored by the importer; ratifying it makes the outcome accepted', async () => {
    setup(TWO, APPROVAL)
    const [a] = await importText(requestText(request()))
    expect(a.outcome).toBe('proposed')
    const [entry] = readLedger(repo).entries
    expect(a.proposal).toBe(entry.id)
    expect(entry).toMatchObject({ state: 'open', author: 'steward-a', title: 'Join request: Mesa Node → Mesh', origin: { kind: 'federation-request', request: ID_A, from: 'Mesa Node' } })
    // R3: the staged edit carries the decision a ratify will make true
    const op = (entry.ops as { path?: string; text?: string }[]).find(o => o.path === 'federation.yaml')!
    expect((parse(op.text!) as { peers: unknown[] }).peers).toEqual([hubPeerOf(request(), `request ${ID_A}`, NODE)])
    expect(records()[0]).toMatchObject({ outcome: 'proposed', proposal: entry.id })
    expect(peers()).toEqual([]) // nothing on the trunk until it is ratified
    expect(hubRequests(repo)[0]).toMatchObject({ outcome: 'proposed', final: false })

    clock = new Date(NOW.getTime() + 60_000); as('bruno')
    expect((await post(`/api/proposals/${entry.id}/events`, { kind: 'approve' })).status).toBe(200)
    const r = await post(`/api/proposals/${entry.id}/ratify`, {})
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200)
    const derived = hubRequests(repo)[0]
    expect(derived).toMatchObject({ outcome: 'accepted', final: true, decision: `request ${ID_A}` })
    expect(derived.sentence).toBe(`Accepted Mesa Node into Mesh (proposal ${entry.id}). Publish the link so it shows as mutual on atproto.`)
    expect(records()[0].outcome).toBe('proposed') // never stored twice
    expect(peers()).toEqual([hubPeerOf(request(), `request ${ID_A}`, NODE)])
  })

  it('two requests drained at once each open their own proposal of one peer; the importer\'s own staged edit rides along in neither', async () => {
    setup(TWO, APPROVAL)
    const mine = { op: 'file', path: 'federation.yaml', text: `${fedText()}\n# my own staged note\n`, base: null }
    const now = new Date().toISOString()
    new ChangeStore(repo).save({ id: 'chg_mine', actor: 'steward-a', created: now, updated: now, ops: [mine as never] })
    remoteCache(repo).put(wellKnownUrlOf(OTHER_URL)!, { spec: 'org-os/federation/1', name: 'Other', did: plcDid('other-node') }, NOW); confirm(plcDid('other-node'), 'other-node.example.org')
    inboxPut(repo, { transport: 'github', ref: ISSUE, text: requestText(request()) })
    inboxPut(repo, { transport: 'github', ref: `${WHERE}/issues/13`, text: requestText(request({ id: ID_B, from: { name: 'Other', url: OTHER_URL } })) })
    const answers = await drain()
    expect(answers.map(a => a.outcome)).toEqual(['proposed', 'proposed'])
    const entries = readLedger(repo).entries
    expect(entries).toHaveLength(2)
    for (const e of entries) {
      const text = (e.ops as { path?: string; text?: string }[]).find(o => o.path === 'federation.yaml')!.text!
      expect((parse(text) as { peers: unknown[] }).peers).toHaveLength(1)
      expect(text).not.toContain('my own staged note')
    }
    expect(new ChangeStore(repo).load('steward-a')?.ops).toEqual([mine])
  })

  it('an instance listed in another role is refused, never merged into', async () => {
    setup(null, OPEN('LD-2026-040'))
    write('federation.yaml', fedText().replace('peers: []', `peers:\n  - { name: Mesa Hub, url: ${NODE_URL}, trust: read, relationship: hub }`)); commit('mesa is our hub')
    const [a] = await importText(requestText(request()))
    expect(a).toMatchObject({ outcome: 'refused', sentence: `Refused: ${SENTENCES.otherRole}` })
    expect(peers()).toEqual([{ name: 'Mesa Hub', url: NODE_URL, trust: 'read', relationship: 'hub' }])
  })

  it('a member asking again under open-with-approval is told so, and no proposal of an unchanged file opens', async () => {
    setup(TWO, APPROVAL)
    write('federation.yaml', fedText().replace('peers: []', `peers:\n  - { name: Mesa Node, url: ${NODE_URL}, trust: read, relationship: node, decision: LD-2026-001 }`)); commit('mesa is a member')
    const [a] = await importText(requestText(request()))
    expect(a).toMatchObject({ outcome: 'refused', sentence: `Refused: ${SENTENCES.alreadyMember}` })
    expect(existsSync(join(repo, 'data', 'proposals.yaml'))).toBe(false)
  })

  it('a proposal whose record never landed gets its record on the next receive, not a second proposal', async () => {
    setup(TWO, APPROVAL)
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ngit diff --cached --name-only | grep -q federation-requests && { echo "not now" >&2; exit 1; }\nexit 0\n', { mode: 0o755 })
    const res = await post('/api/federation/requests/receive', { text: requestText(request()) })
    expect(res.status).toBe(503)
    expect(readLedger(repo).entries).toHaveLength(1)
    expect(records()).toEqual([])
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    // the same id, now claiming another name and network: the record is rebuilt from the proposal, not from this text
    const [a] = await importText(requestText(request({ from: { name: 'Someone Else' }, network: 'Elsewhere' })))
    expect(a).toMatchObject({ outcome: 'proposed', proposal: readLedger(repo).entries[0].id })
    expect(readLedger(repo).entries).toHaveLength(1)
    expect(records()[0]).toMatchObject({ outcome: 'proposed', proposal: readLedger(repo).entries[0].id, from: { name: 'Mesa Node', url: NODE_URL }, network: 'Mesh', answers: {} })
    const v = governance(git('rev-list', '--max-parents=0', 'HEAD').trim().split('\n')[0])
    expect(v.out).not.toContain('federation/join, and')
    const [again] = await importText(requestText(request()))
    expect(again.outcome).toBe('already')
  })

  it('a rejected or withdrawn proposal is a refused outcome', async () => {
    setup(TWO, APPROVAL)
    const [a] = await importText(requestText(request()))
    clock = new Date(NOW.getTime() + 60_000)
    expect((await post(`/api/proposals/${a.proposal}/events`, { kind: 'withdraw' })).status).toBe(200)
    expect(hubRequests(repo)[0]).toMatchObject({ outcome: 'refused', final: true })
  })
})

describe('a solo hub holds the request for its operator', () => {
  it('held, no proposal; decide accept commits with Org-Decision request <id>; refuse needs a reason', async () => {
    setup(null, APPROVAL)
    const [a] = await importText(requestText(request()))
    expect(a.outcome).toBe('held')
    expect(existsSync(join(repo, 'data', 'proposals.yaml'))).toBe(false)
    expect(records()[0]).toMatchObject({ outcome: 'held' })
    expect(peers()).toEqual([])

    const noReason = await post(`/api/federation/requests/${ID_A}/decide`, { accept: false })
    expect(noReason.status).toBe(400)
    expect((await noReason.json() as { error: string }).error).toBe(SENTENCES.reasonNeeded)

    const res = await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })
    const body = await res.json() as { outcome: string; sentence: string }
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.sentence).toBe('Accepted Mesa Node into Mesh. Publish the link so it shows as mutual on atproto.')
    expect(parseTrailers(git('log', '-1', '--format=%B'))).toMatchObject({ actor: 'steward-a', decision: `request ${ID_A}` })
    // the peer is built from the record's validated fields; it is a member since the hub received the request
    expect(peers()).toEqual([{ ...hubPeerOf(request(), `request ${ID_A}`, NODE), since: String(records()[0].received).slice(0, 10) }])
    expect(records()[0]).toMatchObject({ outcome: 'accepted', decision: `request ${ID_A}` })
    // decided once
    expect((await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })).status).toBe(409)
  })

  it('decide refuse records the reason and changes no peer', async () => {
    setup(null, APPROVAL)
    await importText(requestText(request()))
    const res = await post(`/api/federation/requests/${ID_A}/decide`, { accept: false, reason: 'Not this season.' })
    expect(res.status).toBe(200)
    expect(records()[0]).toMatchObject({ outcome: 'refused', reason: 'Not this season.' })
    expect(git('diff', '--name-only', 'HEAD~1', 'HEAD').trim()).toBe('data/federation-requests.yaml')
  })

  it('accept is refused when the hub stopped taking requests, or no longer lists the network', async () => {
    setup(null, APPROVAL)
    await importText(requestText(request()))
    write('federation.yaml', fedText().replace(/^join: .*$/m, 'join: { policy: closed }')); commit('closed')
    const closed = await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })
    expect([closed.status, (await closed.json() as { error: string }).error]).toEqual([409, `Not accepted: ${SENTENCES.notTaking} Nothing was written.`])
    write('federation.yaml', FED(APPROVAL).replace('{ name: Mesh, role: hub }', '{ name: Other, role: hub }')); commit('another network')
    const gone = await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })
    expect([gone.status, (await gone.json() as { error: string }).error]).toEqual([409, `Not accepted: ${SENTENCES.noNetwork} Nothing was written.`])
    expect(peers()).toEqual([])
    expect(records()[0].outcome).toBe('held')
  })

  it('accept is refused when the instance is now listed in another role, or is already a member', async () => {
    setup(null, APPROVAL)
    await importText(requestText(request()))
    write('federation.yaml', fedText().replace('peers: []', `peers:\n  - { name: Mesa, url: ${NODE_URL}, trust: read, relationship: hub }`)); commit('mesa is our hub now')
    const other = await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })
    expect([other.status, (await other.json() as { error: string }).error]).toEqual([409, `Not accepted: ${SENTENCES.otherRole} Nothing was written.`])
    write('federation.yaml', FED(APPROVAL).replace('peers: []', `peers:\n  - { name: Mesa, url: ${NODE_URL}, trust: read, relationship: node, decision: LD-2026-001 }`)); commit('mesa joined another way')
    const member = await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })
    expect([member.status, (await member.json() as { error: string }).error]).toEqual([409, `Not accepted: ${SENTENCES.alreadyMember} Nothing was written.`])
    expect(records()[0].outcome).toBe('held')
  })

  it('a refusal reason is kept to 200 characters', async () => {
    setup(null, APPROVAL)
    await importText(requestText(request()))
    expect((await post(`/api/federation/requests/${ID_A}/decide`, { accept: false, reason: 'r'.repeat(300) })).status).toBe(200)
    expect(Array.from(String(records()[0].reason))).toHaveLength(200)
  })

  it('accept is refused when the rule is no longer direct', async () => {
    setup(null, APPROVAL)
    await importText(requestText(request()))
    write('data/governance.yaml', TWO); commit('governance: two maintainers')
    const res = await post(`/api/federation/requests/${ID_A}/decide`, { accept: true })
    expect(res.status).toBe(409)
    expect(peers()).toEqual([])
  })
})

describe('a second request from a node that is already a member', () => {
  it('keeps the first decision and adds no second peer', async () => {
    setup(null, OPEN('LD-2026-040'))
    await importText(requestText(request()))
    write('federation.yaml', fedText().split('\n').map(l => (l.startsWith('join:') ? l.replace('LD-2026-040', 'LD-2026-077') : l)).join('\n'))
    commit('a new standing decision')
    const [b] = await importText(requestText(request({ id: ID_B })))
    expect(b.outcome).toBe('accepted')
    expect(peers()).toHaveLength(1)
    expect(peers()[0].decision).toBe('LD-2026-040')
    expect(records().map(r => r.decision)).toEqual(['LD-2026-040', 'LD-2026-077'])
  })
})

describe('federation.poll writes only the inbox; receive drains it', () => {
  it('poll leaves the repository as it was; receive with no text records each and empties the inbox', async () => {
    setup(null, OPEN('LD-2026-040'))
    const script: Record<string, GhReply> = {
      '--version': { stdout: 'gh version 2.0' }, 'auth status': {},
      'issue list': { stdout: JSON.stringify([{ url: ISSUE, body: issueBody(requestText(request())) }]) },
    }
    const status = git('status', '--porcelain'); const tip = head()
    const { calls } = await withFakeGh(script, async run => {
      gh = run
      const job = await runJob('federation.poll', {})
      expect(job.status).toBe('ok')
    })
    expect(calls.some(c => c[0] === 'issue' && c[1] === 'list' && c.includes('mesh/hub'))).toBe(true)
    expect(git('status', '--porcelain')).toBe(status)
    expect(head()).toBe(tip)
    expect(listInbox(repo)).toHaveLength(1)
    expect((await card()).facts.inbox).toBe(1)
    const answers = await drain()
    expect(answers).toEqual([expect.objectContaining({ ref: ISSUE, outcome: 'accepted' })])
    expect(records()[0]).toMatchObject({ transport: 'github', ref: ISSUE })
    expect(listInbox(repo)).toEqual([])
    expect((await card()).facts.inbox).toBe(0)
  })

  it('poll is unavailable without join.where', async () => {
    setup(null, { policy: 'open' })
    const op = federationPollOperation({})
    expect(op.unavailable(await card(), repo)).toBe(SENTENCES.noWhere)
  })
})

describe('writeHubFiles', () => {
  it('puts every file back when the commit fails', async () => {
    setup(null, OPEN('LD-2026-040'))
    const fedBefore = fedText()
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "no commits today" >&2\nexit 1\n', { mode: 0o755 })
    const tip = head()
    await expect(writeHubFiles(repo, [
      { rel: 'federation.yaml', text: `${fedBefore}\n# changed\n` },
      { rel: 'data/federation-requests.yaml', text: 'requests: []\n' },
    ], 'federation: test', { actor: 'steward-a' })).rejects.toThrow(/Not saved/)
    expect(head()).toBe(tip)
    expect(fedText()).toBe(fedBefore)
    expect(existsSync(join(repo, 'data', 'federation-requests.yaml'))).toBe(false)
    expect(git('status', '--porcelain')).toBe('')
  })

  it('refuses a data file its schema refuses, writing nothing', async () => {
    setup(null, OPEN('LD-2026-040'))
    const tip = head()
    await expect(writeHubFiles(repo, [{ rel: 'data/federation-requests.yaml', text: 'requests:\n  - { id: x, contact: "a@b.c" }\n' }], 'federation: test', {}))
      .rejects.toThrow(/Not written/)
    expect(head()).toBe(tip)
    expect(existsSync(join(repo, 'data', 'federation-requests.yaml'))).toBe(false)
  })
})

describe('the proposals schema', () => {
  const base = {
    id: 'p-2026-11-22-001-abcd', title: 't', author: 'steward-a', classes: ['identity'], rules: [{ id: 'identity' }], state: 'open',
    opened: '2026-11-22T10:00:00Z', rev: 'abc', ops: [], events: [],
  }
  it('accepts origin, and still refuses other unknown keys', () => {
    expect(validateEntry('proposals', { ...base, origin: { kind: 'federation-request', request: ID_A, from: 'Mesa Node' } }).filter(p => p.level === 'error')).toEqual([])
    expect(validateEntry('proposals', { ...base, origin: { kind: 'federation-request', request: ID_A, from: 'Mesa Node', contact: 'x' } }).filter(p => p.level === 'error')).not.toEqual([])
    expect(validateEntry('proposals', { ...base, somewhere: 1 }).filter(p => p.level === 'error')).not.toEqual([])
  })
  it('checkProposals says in words when origin is not a join request', () => {
    expect(checkProposals([{ ...base, origin: { kind: 'federation-request', request: ID_A, from: 'Mesa Node' } }]).filter(p => p.path === 'origin')).toEqual([])
    expect(checkProposals([{ ...base, origin: { kind: 'email', request: ID_A, from: 'x' } }]).map(p => p.path)).toContain('origin')
  })
})

describe('reply', () => {
  it('calls gh with the exact comment, writes the receipt, and the request leaves toReply', async () => {
    setup(null, OPEN('LD-2026-040'))
    inboxPut(repo, { transport: 'github', ref: ISSUE, text: requestText(request()) })
    await drain()
    const toReply = (await card()).facts.toReply as { id: string; from: string; outcome: string }[]
    expect(toReply).toEqual([{ id: ID_A, from: 'Mesa Node', outcome: 'accepted' }])
    const script: Record<string, GhReply> = { 'issue close': {} }
    const status = git('status', '--porcelain'); const tip = head()
    const { calls } = await withFakeGh(script, async run => {
      gh = run
      await runJob('federation.reply', { id: ID_A })
    })
    expect(calls).toEqual([['issue', 'close', ISSUE, '--comment', 'Accepted: Welcome to Mesh.']])
    expect(JSON.parse(readFileSync(join(stateDir(repo), 'federation', 'replied', `${ID_A}.json`), 'utf8'))).toMatchObject({ ref: ISSUE })
    expect((await card()).facts.toReply).toEqual([])
    expect(git('status', '--porcelain')).toBe(status)
    expect(head()).toBe(tip)
  })

  it('a file request has no reply to send, and a held one is not final', async () => {
    setup(null, APPROVAL)
    await importText(requestText(request()))
    inboxPut(repo, { transport: 'github', ref: ISSUE, text: requestText(request({ id: ID_B, from: { url: OTHER_URL } })) })
    await drain()
    expect((await card()).facts.toReply).toEqual([])
  })
})

describe('nothing reaches atproto until the hub publishes, and only through the confirmed operation', () => {
  const linkWrites = () => net.writes.filter(w => w.nsid === LINK_NSID || w.nsid === PROFILE_NSID)
  const putLinks = () => net.records(SELF, LINK_NSID).map(r => r.value)

  it('acceptance publishes nothing by itself: receive, decide and ratify leave the write log empty', async () => {
    setup(TWO, APPROVAL)
    await ownCheck()
    const [a] = await importText(requestText(request()))
    clock = new Date(NOW.getTime() + 60_000); as('bruno')
    await post(`/api/proposals/${a.proposal}/events`, { kind: 'approve' })
    expect((await post(`/api/proposals/${a.proposal}/ratify`, {})).status).toBe(200)
    as('steward-a')
    // a second request, held then decided, on a solo hub
    write('data/governance.yaml', 'schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  decisions: []\n'); commit('solo now')
    remoteCache(repo).put(wellKnownUrlOf(OTHER_URL)!, { spec: 'org-os/federation/1', name: 'Other', did: plcDid('other-node') }, NOW); confirm(plcDid('other-node'), 'other-node.example.org')
    await importText(requestText(request({ id: ID_B, from: { name: 'Other', url: OTHER_URL } })))
    expect((await post(`/api/federation/requests/${ID_B}/decide`, { accept: true })).status).toBe(200)
    expect(net.writes).toEqual([])
    // the card counts what there is to publish: both members (and the profile, when its networks change)
    const { plan } = await planPublish(repo, pdeps())
    expect(plan.create.map(c => c.record.subject).sort()).toEqual([NODE, plcDid('other-node')].sort())
    expect(plan.create.every(c => c.record.relation === 'hasMember')).toBe(true)
    expect((await card()).facts.toPublish).toBe(plan.create.length + (plan.profile ? 1 : 0))
    expect(net.writes).toEqual([])
  })

  it('after apply the plan holds one hasMember for the node; the confirmed publish writes exactly it and the profile', async () => {
    setup(null, OPEN('LD-2026-040'))
    await ownCheck()
    await importText(requestText(request()))
    expect(net.writes).toEqual([])
    const { plan } = await planPublish(repo, pdeps())
    expect(plan.create.map(c => c.record)).toEqual([expect.objectContaining({ subject: NODE, relation: 'hasMember', network: 'Mesh' })])
    expect(plan.delete).toEqual([])
    const op = publishLinksOperation(pdeps())
    const planned = await op.plan(await card(), {}, repo) as InProcess
    expect(net.writes).toEqual([])
    await planned.inProcess(repo, new AbortController().signal)
    expect(putLinks()).toEqual([expect.objectContaining({ subject: NODE, relation: 'hasMember', network: 'Mesh' })])
    // exactly the link, and the profile's networks: no request id, answer, decision or invite reaches a record
    for (const w of linkWrites()) {
      const record = (w.body.record ?? {}) as Record<string, unknown>
      const allowed = w.nsid === LINK_NSID ? ['$type', 'subject', 'relation', 'network', 'createdAt'] : ['$type', 'networks', 'name', 'createdAt']
      for (const key of Object.keys(record)) expect(allowed).toContain(key)
    }
    const log = JSON.stringify(net.writes)
    for (const secret of [ID_A, 'we work on soil', 'LD-2026-040', `request ${ID_A}`]) expect(log).not.toContain(secret)

    // the hub removes the peer under its rules: the plan withdraws the record
    write('federation.yaml', FED(OPEN('LD-2026-040'))); commit('remove the member')
    await ownCheck()
    const after = await planPublish(repo, pdeps())
    expect(after.plan.create).toEqual([])
    expect(after.plan.delete.map(d => d.value)).toEqual([expect.objectContaining({ subject: NODE, relation: 'hasMember' })])
  })

  const otherNode = plcDid('other-node')
  const otherRequest = () => request({ id: ID_B, from: { name: 'Other', url: OTHER_URL } })
  const cacheOther = () => { remoteCache(repo).put(wellKnownUrlOf(OTHER_URL)!, { spec: 'org-os/federation/1', name: 'Other', did: otherNode }, NOW); confirm(otherNode, 'other-node.example.org') }
  /** The plan resolves (there is a member to publish) and names the refused node nowhere. */
  const planWithout = async () => {
    const { plan, summary } = await planPublish(repo, pdeps())
    expect(plan.create.map(c => c.record.subject)).toEqual([otherNode])
    expect(JSON.stringify({ plan, summary })).not.toContain(NODE)
    expect(net.writes).toEqual([])
  }

  it('a refused request publishes nothing, ever: its node never appears in a plan', async () => {
    setup(null, OPEN('LD-2026-040'))
    cacheOther()
    await ownCheck()
    const [a] = await importText(requestText(request({ answers: {} })))
    expect(a.outcome).toBe('refused')
    expect((await importText(requestText(otherRequest())))[0].outcome).toBe('accepted')
    await planWithout()
  })

  it('a held request the operator refuses never appears in a plan', async () => {
    setup(null, APPROVAL)
    cacheOther()
    await ownCheck()
    await importText(requestText(request()))
    await importText(requestText(otherRequest()))
    expect((await post(`/api/federation/requests/${ID_A}/decide`, { accept: false, reason: 'Not now.' })).status).toBe(200)
    expect((await post(`/api/federation/requests/${ID_B}/decide`, { accept: true })).status).toBe(200)
    await planWithout()
  })

  it('a rejected proposal\'s node never appears in a plan', async () => {
    // a vote, so a proposal can fail and be rejected
    setup(TWO.replace('method: approve, count: 1', 'method: vote, window: PT1M, quorum: 1, threshold: 0.5'), APPROVAL)
    cacheOther()
    await ownCheck()
    const [a] = await importText(requestText(request()))
    const [b] = await importText(requestText(otherRequest()))
    clock = new Date(NOW.getTime() + 10_000); as('bruno')
    expect((await post(`/api/proposals/${a.proposal}/events`, { kind: 'vote', vote: 'no' })).status).toBe(200)
    expect((await post(`/api/proposals/${b.proposal}/events`, { kind: 'vote', vote: 'yes' })).status).toBe(200)
    clock = new Date(NOW.getTime() + 90_000)
    const r = await reject(a.proposal!)
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200)
    expect(hubRequests(repo).find(h => h.record.id === ID_A)).toMatchObject({ outcome: 'refused', final: true })
    as('bruno')
    const rb = await post(`/api/proposals/${b.proposal}/ratify`, {})
    expect(rb.status, JSON.stringify(await rb.clone().json())).toBe(200)
    as('steward-a')
    await planWithout()
  })
})

describe('the inbox lives outside git', () => {
  it('inboxPut writes under stateDir, keyed by the sha256 of the ref', () => {
    setup(null, OPEN('LD-2026-040'))
    inboxPut(repo, { transport: 'github', ref: ISSUE, text: 'x' })
    const dir = join(stateDir(repo), 'federation', 'inbox')
    expect(readdirSync(dir)).toEqual([expect.stringMatching(/^[0-9a-f]{64}\.json$/)])
    expect(git('status', '--porcelain')).toBe('')
  })
})
