// The N2 acceptance (network N2 Task 15, ruling R12): a node joins a hub's network end to end, on scratch instances,
// through the real server. Each instance runs `startServer` with the fake atproto network handed in-process (`network`):
// two PDS hosts, a PLC directory and the instances' own sites, all answered by one injected fetch. GitHub is a fake `gh`
// first on PATH. Nothing reaches the network: `networkFetch` throws under VITEST, and the fake answers everything else.
//
// The instances are invented: Cedar Node (the node), Delta Hub (the hub), Fern Node (invited) and Gale Node (refused).
// The play follows the plan's pilot (decision 1a), stands in for the ReFi BCN → ReFi DAO join, and is the record the
// acceptance file (docs/superpowers/plans/2026-11-22-network-n2-atproto-acceptance.md) was written from. With
// N2_ACCEPTANCE_OUT set, it writes its transcript there (the invite token redacted); with N2_ACCEPTANCE_KEEP set, it
// keeps the scratch instances and their state folders, for the screenshots.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, parse as parseYaml } from 'yaml'
import { makeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { stateDir } from '../../server/state.ts'
import { LINK_NSID, PROFILE_NSID } from '../../lib/federation/links.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'
import { loadStandardsInput } from '../../lib/standards/load.mjs'
import { buildCore } from '../../lib/standards/build.mjs'
import { atprotoLine, linkWords } from '../../app/src/pages/federationWords.ts'
import type { FetchLike } from '../../server/systems/driver.ts'
import type { Resource } from '../../server/resources/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

// ── the cast ─────────────────────────────────────────────────────────────────────────────────────────

const HOST_A = 'https://pds-a.example.com'
const HOST_B = 'https://pds-b.example.net'
const NODE_DID = plcDid('cedar-node')
const HUB_DID = plcDid('delta-hub')
const PRIVATE_DID = plcDid('hollow-grove')
const FERN_DID = plcDid('fern-node')
const NODE_URL = 'https://cedar-node.example.org'
const HUB_URL = 'https://delta-hub.example.org'
const FERN_URL = 'https://fern-node.example.org'
const GALE_URL = 'https://gale-node.example.org'
const PRIVATE_NAME = 'Hollow Grove'
const PRIVATE_URL = 'https://hollow-grove.example.org'
const NODE_PASSWORD = 'cedar-UNMISTAKABLE-app-pass-3307'
const HUB_PASSWORD = 'delta-UNMISTAKABLE-app-pass-8812'
const FERN_PASSWORD = 'fern-UNMISTAKABLE-app-pass-6620'
const NETWORK = 'Delta'
const WHERE = 'https://github.com/delta-hub/join-requests'
/** Distinctive, so a grep finds any leak. */
const ANSWERS = {
  cedar: 'We steward a bioregional seed library, ANSWER-cedar-5d2e.',
  gale: 'We run a tool library, ANSWER-gale-77c1.',
  fern: 'Invited at the autumn gathering, ANSWER-fern-90ab.',
}
const REFUSAL = 'Not this season: the network is full, DECISION-gale-41f0.'

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [identity], propose: maintainer, decide: { by: maintainer, method: direct } }
    - { id: records, applies_to: [records, members, governance, systems, treasury, operations, publication, workspace], propose: maintainer, decide: { by: maintainer, method: direct } }
  decisions: []
`

interface Cast { name: string; type: string; url: string; did?: string; pds?: string; handle?: string; networks?: string[]; peers?: string[] }
const federationText = (c: Cast) => [
  '# federation manifest (scratch instance for the N2 acceptance)',
  'version: "1.0"',
  'identity:',
  `  name: "${c.name}"`,
  `  type: "${c.type}"`,
  `  url: ${c.url}`,
  `  daoURI: ${c.url}/.well-known/dao.json`,
  ...(c.did ? [`  did: "${c.did}"`] : []),
  ...(c.networks?.length ? ['networks:', ...c.networks] : []),
  ...(c.peers?.length ? ['peers:', ...c.peers] : ['peers: []']),
  'metadata:',
  '  framework_version: "0.7"',
  '',
].join('\n')
const identityText = (c: Cast) => `# ${c.name}\n\n- **Name:** ${c.name}\n- **Type:** ${c.type}\n`
const kmsText = (c: Cast) => ['adapter: repo-data', 'target: "."', 'atproto:', `  did: "${c.did}"`, `  pds: "${c.pds}"`, `  handle: "${c.handle}"`,
  `  nsid_authority: "org.${c.name.toLowerCase().replace(/\s+/g, '')}"`, ''].join('\n')

const CAST = {
  node: { name: 'Cedar Node', type: 'LocalNode', url: NODE_URL, did: NODE_DID, pds: HOST_A, handle: 'cedar-node.example.org',
    peers: ['  - name: ' + PRIVATE_NAME, `    url: ${PRIVATE_URL}`, `    did: "${PRIVATE_DID}"`, '    link: peerOf', '    visibility: private', '    trust: read'] },
  hub: { name: 'Delta Hub', type: 'Network', url: HUB_URL, did: HUB_DID, pds: HOST_B, handle: 'delta-hub.example.org', networks: [`  - { name: ${NETWORK}, role: hub }`] },
  fern: { name: 'Fern Node', type: 'LocalNode', url: FERN_URL, did: FERN_DID, pds: HOST_A, handle: 'fern-node.example.org' },
  gale: { name: 'Gale Node', type: 'LocalNode', url: GALE_URL },
} satisfies Record<string, Cast>
type Who = keyof typeof CAST

// ── the world ────────────────────────────────────────────────────────────────────────────────────────

let scratch: string
let net: FakeNetwork
let ghState: string
let ghLog: string
const repos = {} as Record<Who, string>
const servers = {} as Record<Who, Running>
/** What the acceptance file is written from: every call and its answer. */
const transcript: { step: string; who: Who | '-'; call: string; status?: number; out: unknown }[] = []
let step = ''
/** Filled when the invite is made; the transcript never carries it. */
let TOKEN = ''
let INVITE_ID = ''
const redact = (s: string) => (TOKEN ? s.split(TOKEN).join('<token>') : s)

/** An instance's published federation.json, built from its repository as the generator builds it (the instance's site). */
function siteDoc(who: Who): unknown {
  const { input } = loadStandardsInput(repos[who], { parseYaml })
  if (!input) throw new Error(`${who} has nothing to publish`)
  return buildCore(input).files['federation.json']
}
const SITES: Record<string, Who> = {
  'cedar-node.example.org': 'node', 'delta-hub.example.org': 'hub', 'fern-node.example.org': 'fern', 'gale-node.example.org': 'gale',
}
const answer = (status: number, body: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
  return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => body, json: async () => JSON.parse(body) as unknown }
}
/** The fake network, plus each instance's site serving its federation.json. Everything else is the fake PDS's. */
const fetchAll: FetchLike = async (url, init) => {
  const u = new URL(url)
  const who = SITES[u.host]
  if (who && u.pathname === '/.well-known/federation.json') {
    net.requests.push({ method: 'GET', url })
    return answer(200, JSON.stringify(siteDoc(who)))
  }
  return net.fetch(url, init)
}
const lookupAll = async (host: string): Promise<string[]> => (SITES[host.toLowerCase()] ? ['93.184.216.34'] : net.lookup(host))

const FAKE_GH = `#!/usr/bin/env node
// A fake gh for the N2 acceptance: issues kept in a JSON file; nothing reaches GitHub.
const fs = require('fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n')
const load = () => { try { return JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8')) } catch { return { issues: [] } } }
const save = s => fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(s, null, 2))
const opt = n => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1] }
const out = s => { process.stdout.write(s + '\\n'); process.exit(0) }
if (args[0] === '--version') out('gh version 2.62.0 (fake)')
if (args[0] === 'auth' && args[1] === 'status') out('Logged in to github.com (fake)')
if (args[0] === 'issue') {
  const s = load()
  if (args[1] === 'create') {
    const repo = opt('--repo'); const url = 'https://github.com/' + repo + '/issues/' + (s.issues.length + 1)
    s.issues.push({ repo, url, title: opt('--title'), body: fs.readFileSync(opt('--body-file'), 'utf8'), state: 'OPEN', comments: [] })
    save(s); out(url)
  }
  if (args[1] === 'list') {
    const repo = opt('--repo')
    out(JSON.stringify(s.issues.filter(i => i.repo === repo && i.state === 'OPEN' && i.title.includes('org-os join request')).map(i => ({ url: i.url, body: i.body }))))
  }
  const issue = s.issues.find(i => i.url === args[2])
  if (!issue) { process.stderr.write('no such issue'); process.exit(1) }
  if (args[1] === 'view') out(JSON.stringify({ state: issue.state, comments: issue.comments }))
  if (args[1] === 'close') { issue.state = 'CLOSED'; issue.comments.push({ body: opt('--comment'), authorAssociation: 'OWNER' }); save(s); out('closed') }
}
process.stderr.write('fake gh: not built: ' + args.join(' ')); process.exit(1)
`

// ── talking to the servers, as the Federation page does ──────────────────────────────────────────────

async function call(who: Who, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await servers[who].app.request(path, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
  const text = await res.text()
  let json: any = text
  try { json = JSON.parse(text) } catch { /* text */ }
  transcript.push({ step, who, call: redact(`${method} ${path}${body === undefined ? '' : ` ${JSON.stringify(body)}`}`), status: res.status, out: JSON.parse(redact(JSON.stringify(json))) })
  return { status: res.status, json }
}
/** The instance cards, as the Federation page reads them. */
const cards = async (who: Who): Promise<Resource[]> => (await (await servers[who].app.request('/api/resources?kind=instance')).json()) as Resource[]
const selfOf = async (who: Who): Promise<Resource> => (await cards(who)).find(r => r.facts.self === true)!
const peerOf = async (who: Who, name: string): Promise<Resource> => {
  const nodes = await cards(who)
  const found = nodes.find(r => r.name === name && r.facts.self !== true)
  if (!found) throw new Error(`${who} has no peer card named ${name}`)
  return found
}
const settled = new Set(['ok', 'failed', 'timed-out', 'cancelled', 'finished-with-surprises', 'interrupted'])
/** Plans an operation on the instance's own card, confirms it with its nonce, and waits for the job. */
async function run(who: Who, op: string, params: Record<string, unknown> = {}): Promise<{ status: string; log: string; summary: string; sentence: string | null }> {
  const self = await selfOf(who)
  const planned = await call(who, 'POST', `/api/operations/${op}/plan`, { resource: self.id, params })
  if (planned.status !== 200) throw new Error(`${who} ${op} not planned (${planned.status}): ${JSON.stringify(planned.json)}`)
  const sub = await call(who, 'POST', '/api/jobs', { nonce: planned.json.nonce })
  const id = sub.json.id as string
  for (let i = 0; i < 400; i++) {
    const r = (await (await servers[who].app.request(`/api/jobs/${id}`)).json()) as { job: { status: string; sentence: string | null }; log: string }
    if (settled.has(r.job.status)) {
      transcript.push({ step, who, call: `job ${op} ${JSON.stringify(params)}`, out: { status: r.job.status, sentence: r.job.sentence, log: redact(r.log) } })
      return { status: r.job.status, log: r.log, summary: String(planned.json.summary ?? ''), sentence: r.job.sentence }
    }
    await new Promise(res => setTimeout(res, 25))
  }
  throw new Error(`${who} ${op} never finished`)
}
const ok = async (who: Who, op: string, params: Record<string, unknown> = {}) => {
  const r = await run(who, op, params)
  expect(r.status, `${who} ${op}: ${r.sentence ?? ''}\n${r.log}`).toBe('ok')
  return r
}
const note = (who: Who | '-', what: string, out: unknown) => transcript.push({ step, who, call: what, out })
/** Waits until the self card lists outgoing request `id` on the trunk: the card is re-read when the watcher sees the commit,
 *  as the Federation page waits for its event. */
async function onCard(who: Who, id: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const out = (await selfOf(who)).facts.outgoing as { id: string; onTrunk: boolean }[] | undefined
    if (out?.some(o => o.id === id && o.onTrunk)) return
    await new Promise(res => setTimeout(res, 25))
  }
  throw new Error(`${who}'s card never listed request ${id}`)
}

const git = (who: Who, ...args: string[]) => execFileSync('git', args, { cwd: repos[who], stdio: 'pipe' }).toString()
const fedOf = (who: Who) => parse(readFileSync(join(repos[who], 'federation.yaml'), 'utf8')) as Record<string, any>
/** Every file under a folder (`.git` aside), as one text. */
function filesUnder(dir: string, skip = new Set(['.git'])): string {
  if (!existsSync(dir)) return ''
  let out = ''
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const p = join(dir, name)
    out += statSync(p).isDirectory() ? filesUnder(p, skip) : `\n${p}\n${readFileSync(p, 'utf8')}`
  }
  return out
}
/** Each file under `dir` that holds `needle`, relative to it. */
function filesHolding(dir: string, needle: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  const hits: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) hits.push(...filesHolding(p, needle, base))
    else if (readFileSync(p, 'utf8').includes(needle)) hits.push(p.slice(base.length + 1))
  }
  return hits
}
const writeLog = () => JSON.stringify(net.writes)
/** The governed identity change that adds a member's DID after its acceptance (final review F-I2): the migration list,
 *  which writes a DID only where the cache ties it to that peer both ways, and publishes nothing by itself (R28). */
async function migrateDid(who: Who, url: string, did: string): Promise<void> {
  const index = (fedOf(who).peers as Record<string, unknown>[]).findIndex(p => p.url === url)
  const listed = await call(who, 'GET', '/api/federation/migration')
  expect(listed.json.rows).toEqual(expect.arrayContaining([expect.objectContaining({ index, did, binding: null })]))
  const writes = net.writes.length
  const set = await call(who, 'POST', '/api/federation/migration', { set: [{ index, did }] })
  expect(set.status, JSON.stringify(set.json)).toBe(200)
  expect(set.json.commit).toMatch(/^[0-9a-f]{7,}$/)
  expect(git(who, 'log', '-1', '--format=%B')).toMatch(/Org-Rule: identity\/direct/)
  expect(git(who, 'log', '-1', '--format=%B')).not.toContain('federation/join')
  expect((fedOf(who).peers as Record<string, unknown>[])[index].did).toBe(did)
  expect(net.writes.length).toBe(writes)
}

// ── setting the stage ────────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'n2-acceptance-'))
  net = makeFakeNetwork({ hosts: {
    [HOST_A]: { accounts: { [NODE_DID]: { handle: 'cedar-node.example.org', password: NODE_PASSWORD }, [FERN_DID]: { handle: 'fern-node.example.org', password: FERN_PASSWORD } } },
    [HOST_B]: { accounts: { [HUB_DID]: { handle: 'delta-hub.example.org', password: HUB_PASSWORD }, [PRIVATE_DID]: { handle: 'hollow-grove.example.org', password: 'unused' } } },
  } })
  // GitHub is a fake gh first on PATH, for every server in this process; it keeps its issues in a file.
  const bin = join(scratch, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  ghState = join(scratch, 'gh-issues.json')
  ghLog = join(scratch, 'gh-calls.log')
  writeFileSync(ghLog, '')
  process.env.PATH = `${bin}:${process.env.PATH}`
  process.env.FAKE_GH_STATE = ghState
  process.env.FAKE_GH_LOG = ghLog

  for (const who of Object.keys(CAST) as Who[]) {
    const c: Cast = CAST[who]
    const repo = makeFixtureRepo()
    repos[who] = repo
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
    writeFileSync(join(repo, 'federation.yaml'), federationText(c))
    writeFileSync(join(repo, 'IDENTITY.md'), identityText(c))
    if (c.did) writeFileSync(join(repo, 'kms.yaml'), kmsText(c))
    // Where the instance lives: its origin is its own address, as a peer's federation.json names it.
    git(who, 'remote', 'add', 'origin', c.url)
    git(who, 'add', '-A')
    git(who, 'commit', '-qm', `${c.name}: identity, governance${c.did ? ', its atproto account in kms.yaml' : ''}`)
    servers[who] = await startServer({
      repo, port: 0, fetch: fetchAll,
      // Ruling R12: the fake network in-process, for this server only, with its own app password.
      network: { fetch: fetchAll, lookup: lookupAll, resolveTxt: net.resolveTxt, allowPlaceholderLexicons: true,
        env: { ATPROTO_APP_PASSWORD: who === 'node' ? NODE_PASSWORD : who === 'hub' ? HUB_PASSWORD : who === 'fern' ? FERN_PASSWORD : undefined } },
    })
  }
}, 60_000)

afterAll(async () => {
  for (const s of Object.values(servers)) await s?.close()
  if (process.env.N2_ACCEPTANCE_OUT) {
    writeFileSync(process.env.N2_ACCEPTANCE_OUT, redact(JSON.stringify({ repos, stateDirs: Object.fromEntries((Object.keys(repos) as Who[]).map(w => [w, stateDir(repos[w])])), transcript }, null, 2)))
  }
  if (!process.env.N2_ACCEPTANCE_KEEP) {
    for (const r of Object.values(repos)) { rmSync(r, { recursive: true, force: true }); rmSync(stateDir(r), { recursive: true, force: true }) }
    rmSync(scratch, { recursive: true, force: true })
  }
})

// ── the play ─────────────────────────────────────────────────────────────────────────────────────────

describe('N2 acceptance: a node joins a hub on atproto, on scratch instances, through the real server', () => {
  let requestId = ''
  let issue = ''

  it('1. the hub chooses open-with-approval; each side looks the other up and ties its DID', async () => {
    step = '1 open'
    const policy = await call('hub', 'POST', '/api/federation/join', { policy: 'open-with-approval', types: ['LocalNode'], asks: ['why'], where: WHERE })
    expect(policy.status).toBe(200)
    expect(policy.json.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(fedOf('hub').join).toEqual({ policy: 'open-with-approval', types: ['LocalNode'], asks: ['why'], where: WHERE })

    await ok('node', 'federation.check-links', { address: HUB_URL })
    const hub = await call('node', 'GET', `/api/federation/hub?address=${encodeURIComponent(HUB_URL)}`)
    expect(hub.json.hub).toMatchObject({ name: 'Delta Hub', type: 'Network', networks: [NETWORK], join: { policy: 'open-with-approval', where: WHERE } })
    // So that the ask stages the hub's DID, the node ties it first: the hub's federation.json names it, and its handle (the
    // hub's own host) names it back. Without this the ask stages no DID, and the migration list suggests it later (F-I1).
    await ok('node', 'federation.check-links', { handle: 'delta-hub.example.org' })

    // So that the migration list can add the node's DID after acceptance, the hub ties it the same way: the node's
    // federation.json names it, and its handle (the node's own host) names it back.
    await ok('hub', 'federation.check-links', { address: NODE_URL })
    await ok('hub', 'federation.check-links', { handle: 'cedar-node.example.org' })
  })

  it('2. the node asks (committed under its rule), then sends by github through gh; the hub polls and receives under its policy', async () => {
    step = '2 ask'
    const asked = await call('node', 'POST', '/api/federation/ask', { hub: HUB_URL, network: NETWORK, answers: { why: ANSWERS.cedar } })
    expect(asked.status).toBe(200)
    expect(asked.json.commit).toMatch(/^[0-9a-f]{7,}$/)
    requestId = asked.json.id
    await onCard('node', requestId)
    const hubPeer = (fedOf('node').peers as Record<string, unknown>[]).find(p => p.url === HUB_URL)!
    expect(hubPeer).toMatchObject({ name: 'Delta Hub', relationship: 'hub', requested: requestId, did: HUB_DID })

    // The ways it can go, as the Send menu lists them.
    const ways = await call('node', 'GET', `/api/federation/transports?hub=${encodeURIComponent(HUB_URL)}&id=${requestId}`)
    expect(ways.json.find((w: { id: string }) => w.id === 'github').unavailable).toBeNull()
    expect(ways.json.find((w: { id: string }) => w.id === 'file').unavailable).toBeNull()

    const sent = await ok('node', 'federation.send', { id: requestId, transport: 'github' })
    issue = /Sent as an issue: (\S+)/.exec(sent.log)![1]
    expect(issue).toBe('https://github.com/delta-hub/join-requests/issues/1')

    step = '2 receive'
    const polled = await ok('hub', 'federation.poll')
    expect(polled.log).toContain('1 request waiting.')
    const got = await call('hub', 'POST', '/api/federation/requests/receive', {})
    // The hub's maintainer may change identity alone, so the request is held for them to decide (not proposed).
    expect(got.json).toEqual([{ ref: issue, outcome: 'held', sentence: `Held for you to decide: Cedar Node asks to join ${NETWORK}.` }])
    note('-', 'path taken', 'held, then accepted by the maintainer (their rule for identity is direct)')
  })

  it('3. the hub accepts and tells the node through gh; the node reads the answer and records it', async () => {
    step = '3 accept'
    const accepted = await call('hub', 'POST', `/api/federation/requests/${requestId}/decide`, { accept: true })
    expect(accepted.json).toMatchObject({ outcome: 'accepted' })
    const member = (fedOf('hub').peers as Record<string, unknown>[]).find(p => p.url === NODE_URL)!
    expect(member).toMatchObject({ name: 'Cedar Node', type: 'LocalNode', relationship: 'node', decision: `request ${requestId}` })
    // An acceptance never writes a DID (F-I2): the hub adds it through the migration list, before publishing hasMember.
    expect(member.did).toBeUndefined()
    expect(git('hub', 'log', '-1', '--format=%B')).toMatch(/Org-Rule: identity\/direct/)
    step = '3 migrate'
    await migrateDid('hub', NODE_URL, NODE_DID)
    step = '3 accept'

    const told = await ok('hub', 'federation.reply', { id: requestId })
    expect(told.log).toBe('Told Cedar Node: Accepted.\n')

    step = '3 record'
    const status = await ok('node', 'federation.status', { id: requestId })
    expect(status.log).toMatch(/^Accepted: /)
    const recorded = await call('node', 'POST', `/api/federation/outgoing/${requestId}/record`, {})
    expect(recorded.json.commit).toMatch(/^[0-9a-f]{7,}$/)
    const hubPeer = (fedOf('node').peers as Record<string, unknown>[]).find(p => p.url === HUB_URL)!
    expect(hubPeer.requested).toBeUndefined()
    expect(String(hubPeer.decision)).toMatch(/^Accepted: /)
  })

  it('4. the hub publishes: one hasMember for the node and its profile; the node reads their record, its own missing as drift', async () => {
    step = '4 hub publishes'
    await ok('hub', 'federation.check-links')
    const pub = await ok('hub', 'federation.publish-links')
    expect(pub.summary).toBe('Publish 1 link and withdraw 0, and update the profile.')
    expect(net.records(HUB_DID, LINK_NSID).map(r => r.value)).toEqual([
      { $type: LINK_NSID, subject: NODE_DID, relation: 'hasMember', network: NETWORK, createdAt: expect.any(String) },
    ])
    expect(net.records(HUB_DID, PROFILE_NSID).map(r => r.value)).toEqual([
      { $type: PROFILE_NSID, name: 'Delta Hub', networks: [{ hub: HUB_DID, name: NETWORK }], createdAt: expect.any(String) },
    ])

    step = '4 node checks'
    await ok('node', 'federation.check-links')
    const card = await peerOf('node', 'Delta Hub')
    note('node', 'peer card Delta Hub', { link: card.facts.link, sources: card.facts.sources, drift: card.facts.drift })
    // The plan's done-when says `claimed` here. The state is worked out as R23 says: federation.yaml is our side (it lists
    // the hub, with the recorded decision) and their record is theirs, so it reads `mutual`; that our own record is
    // missing is drift on our side. Recorded in the acceptance file as an open question against R22's wording.
    expect(card.facts.link).toBe('mutual')
    expect(card.facts.sources).toMatchObject({ files: 'lists-us', atproto: 'lists-us' })
    expect(atprotoLine(card.facts.link as string, card.facts.sources as never, card.facts.linkReason as string | null)).toBe("On atproto: they've published it")
    expect((card.facts.drift as { side: string; text: string }[]).filter(d => d.side === 'ours').map(d => d.text)).toEqual(['Not published yet.'])
  })

  it('5. the node publishes its memberOf; a check on both reads mutual, from both repositories on their two hosts', async () => {
    step = '5 node publishes'
    const pub = await ok('node', 'federation.publish-links')
    expect(pub.summary).toBe('Publish 1 link and withdraw 0, and update the profile. 1 peer is kept private.')
    expect(net.records(NODE_DID, LINK_NSID).map(r => r.value)).toEqual([
      { $type: LINK_NSID, subject: HUB_DID, relation: 'memberOf', network: NETWORK, createdAt: expect.any(String) },
    ])

    step = '5 mutual'
    const before = net.requests.length
    await ok('node', 'federation.check-links')
    await ok('hub', 'federation.check-links')
    const reads = net.requests.slice(before).filter(r => r.url.includes('com.atproto.repo.listRecords')).map(r => {
      const u = new URL(r.url)
      return `${u.host} ${u.searchParams.get('repo')}`
    })
    // Each DID is read from its own PDS: the node's on host A, the hub's on host B, by both sides.
    expect(new Set(reads)).toEqual(new Set([`pds-a.example.com ${NODE_DID}`, `pds-b.example.net ${HUB_DID}`, `pds-b.example.net ${PRIVATE_DID}`]))
    note('-', 'listRecords reads during the mutual check (host, repository)', [...new Set(reads)])
    const nodeSide = await peerOf('node', 'Delta Hub')
    const hubSide = await peerOf('hub', 'Cedar Node')
    note('node', 'peer card Delta Hub', { link: nodeSide.facts.link, sources: nodeSide.facts.sources, drift: nodeSide.facts.drift })
    note('hub', 'peer card Cedar Node', { link: hubSide.facts.link, sources: hubSide.facts.sources, drift: hubSide.facts.drift })
    expect(nodeSide.facts.link).toBe('mutual')
    expect(hubSide.facts.link).toBe('mutual')
    expect(linkWords('mutual')).toBeTruthy()
    expect(nodeSide.facts.drift).toEqual([])
    expect(hubSide.facts.drift).toEqual([])
  })

  it('6. host B down: the node keeps its last reading, with that reading\'s date, never left', async () => {
    step = '6 failure'
    const before = await peerOf('node', 'Delta Hub')
    net.setDown(new URL(HOST_B).host)
    try {
      const r = await run('node', 'federation.check-links')
      expect(r.log).toContain('Delta Hub on atproto: Not read: pds-b.example.net could not be reached.')
      const card = await peerOf('node', 'Delta Hub')
      note('node', 'peer card Delta Hub, host B down', { link: card.facts.link, linkReason: card.facts.linkReason, sources: card.facts.sources })
      expect(card.facts.link).toBe('mutual')
      expect(card.facts.linkReason).toBe(before.facts.linkReason)
      expect((card.facts.sources as { checked: string }).checked).toBe((before.facts.sources as { checked: string }).checked)
      // `couldn't check (<date>)` is drawn only when there is no earlier reading; here the earlier one stays (R23).
      expect(atprotoLine(card.facts.link as string, card.facts.sources as never, card.facts.linkReason as string)).toBe("On atproto: they've published it")
    } finally { net.setDown(new URL(HOST_B).host, false) }
  })

  it('7. a refusal: Gale asks by file; the hub imports it, holds it, and refuses with a reason', async () => {
    step = '7 refusal'
    await ok('gale', 'federation.check-links', { address: HUB_URL })
    const asked = await call('gale', 'POST', '/api/federation/ask', { hub: HUB_URL, network: NETWORK, answers: { why: ANSWERS.gale } })
    expect(asked.status).toBe(200)
    await onCard('gale', asked.json.id)
    const sent = await ok('gale', 'federation.send', { id: asked.json.id, transport: 'file' })
    const text = sent.log.slice(sent.log.indexOf('spec: '))
    expect(text).toContain(`id: ${asked.json.id}`)
    const got = await call('hub', 'POST', '/api/federation/requests/receive', { text })
    expect(got.json[0]).toMatchObject({ outcome: 'held' })
    const refused = await call('hub', 'POST', `/api/federation/requests/${asked.json.id}/decide`, { accept: false, reason: REFUSAL })
    expect(refused.json).toMatchObject({ outcome: 'refused', sentence: `Refused: ${REFUSAL}` })
    expect((fedOf('hub').peers as Record<string, unknown>[]).some(p => p.url === GALE_URL)).toBe(false)
  })

  it('8. an invite: the hub switches to invite and makes one; an invited request is refused by github and goes by file', async () => {
    step = '8 invite'
    expect((await call('hub', 'POST', '/api/federation/join', { policy: 'invite' })).status).toBe(200)
    const made = await call('hub', 'POST', '/api/federation/invites', { name: 'Fern Node', type: 'LocalNode', network: NETWORK, days: 14 })
    expect(made.status).toBe(201)
    TOKEN = /#invite=(.+)$/.exec(made.json.link)![1]
    INVITE_ID = made.json.id
    // Redact the answer already in the transcript, now that the token is known.
    for (const t of transcript) t.out = JSON.parse(redact(JSON.stringify(t.out)))
    expect(made.json.link).toBe(`${HUB_URL}/.well-known/federation.json#invite=${TOKEN}`)

    await ok('fern', 'federation.check-links', { address: HUB_URL })
    await ok('fern', 'federation.check-links', { handle: 'delta-hub.example.org' })
    const asked = await call('fern', 'POST', '/api/federation/ask', { hub: HUB_URL, network: NETWORK, answers: { why: ANSWERS.fern }, invite: TOKEN })
    expect(asked.status).toBe(200)
    const id = asked.json.id as string
    await onCard('fern', id)
    expect(readFileSync(join(repos.fern, 'federation', 'outgoing', `${id}.yaml`), 'utf8')).not.toContain(TOKEN)

    const byGithub = await call('fern', 'POST', '/api/operations/federation.send/plan', { resource: (await selfOf('fern')).id, params: { id, transport: 'github' } })
    expect(byGithub.status).toBe(409)
    expect(byGithub.json.error).toBe('Not sent: An invited request goes as a file, so the invite stays private.')

    const sent = await ok('fern', 'federation.send', { id, transport: 'file' })
    expect(sent.log).not.toContain(TOKEN)
    expect(sent.log).toContain('It holds your invite, so it is saved at')
    const file = await servers.fern.app.request(`/api/federation/outgoing/${id}/request-file`)
    expect(file.headers.get('cache-control')).toBe('no-store')
    const text = await file.text()
    expect(text).toContain(`invite: ${TOKEN}`)

    // The hub ties Fern's DID first, as it did Cedar's, so the migration list can add it after acceptance.
    await ok('hub', 'federation.check-links', { address: FERN_URL })
    await ok('hub', 'federation.check-links', { handle: 'fern-node.example.org' })
    const got = await call('hub', 'POST', '/api/federation/requests/receive', { text })
    expect(got.json[0]).toMatchObject({ outcome: 'accepted' })
    const member = (fedOf('hub').peers as Record<string, unknown>[]).find(p => p.url === FERN_URL)!
    expect(member).toMatchObject({ name: 'Fern Node', relationship: 'node', decision: `invite ${INVITE_ID}` })
    expect(member.did).toBeUndefined()
    expect(git('hub', 'log', '-1', '--format=%B')).toContain('Org-Rule: federation/join')
    const invites = parse(readFileSync(join(repos.hub, 'data', 'invites.yaml'), 'utf8')) as { invites: Record<string, unknown>[] }
    expect(invites.invites).toEqual([expect.objectContaining({ id: INVITE_ID, used_by: id, token_sha256: sha256Hex(TOKEN) })])
    // The same invite can't be used twice.
    const again = await call('hub', 'POST', '/api/federation/requests/receive', { text: text.replace(id, '00000000-0000-4000-8000-000000000001') })
    expect(again.json[0]).toMatchObject({ outcome: 'refused' })
    step = '8 migrate'
    await migrateDid('hub', FERN_URL, FERN_DID)

    // A file-sent join has no answer to read, so no Record step (controller ruling on Task 15, concern 3): once the hub's
    // federation.json lists Fern, the link is mutual by files and Fern's memberOf is wanted without a recorded decision (R4).
    step = '8 fern publishes'
    await ok('fern', 'federation.check-links')
    const before = await peerOf('fern', 'Delta Hub')
    note('fern', 'peer card Delta Hub, no Record step', { link: before.facts.link, sources: before.facts.sources, drift: before.facts.drift })
    const fernPeer = (fedOf('fern').peers as Record<string, unknown>[]).find(p => p.url === HUB_URL)!
    expect(fernPeer.decision).toBeUndefined()
    expect((before.facts.drift as { side: string; text: string }[]).filter(d => d.side === 'ours').map(d => d.text)).toEqual(['Not published yet.'])
    const fernPub = await ok('fern', 'federation.publish-links')
    expect(fernPub.summary).toBe('Publish 1 link and withdraw 0, and update the profile.')
    expect(net.records(FERN_DID, LINK_NSID).map(r => r.value)).toEqual([
      { $type: LINK_NSID, subject: HUB_DID, relation: 'memberOf', network: NETWORK, createdAt: expect.any(String) },
    ])
    // The hub publishes its hasMember for Fern; both read mutual.
    await ok('hub', 'federation.check-links')
    expect((await ok('hub', 'federation.publish-links')).summary).toBe('Publish 1 link and withdraw 0.')
    await ok('fern', 'federation.check-links')
    await ok('hub', 'federation.check-links')
    const fernSide = await peerOf('fern', 'Delta Hub')
    const hubSide = await peerOf('hub', 'Fern Node')
    note('fern', 'peer card Delta Hub after both published', { link: fernSide.facts.link, drift: fernSide.facts.drift })
    note('hub', 'peer card Fern Node after both published', { link: hubSide.facts.link, drift: hubSide.facts.drift })
    expect([fernSide.facts.link, hubSide.facts.link]).toEqual(['mutual', 'mutual'])
  })

  it('9. the node leaves under its rule and publishes; the hub, after a check, reads left: they withdrew their record', async () => {
    step = '9 leave'
    const left = await call('node', 'POST', `/api/federation/outgoing/${requestId}/withdraw`, {})
    expect(left.json).toMatchObject({ leaving: true, text: `Leaving ${NETWORK}. The hub will see the link as left. Then publish, so your record is withdrawn.` })
    expect(left.json.commit).toMatch(/^[0-9a-f]{7,}$/)
    await ok('node', 'federation.check-links')
    const pub = await ok('node', 'federation.publish-links')
    note('node', 'publish after leaving', pub.summary)
    expect(net.records(NODE_DID, LINK_NSID)).toEqual([])

    await ok('hub', 'federation.check-links')
    const card = await peerOf('hub', 'Cedar Node')
    note('hub', 'peer card Cedar Node after the node left', { link: card.facts.link, sources: card.facts.sources })
    expect(card.facts.link).toBe('left')
    expect(atprotoLine(card.facts.link as string, card.facts.sources as never, card.facts.linkReason as string | null)).toBe('They withdrew their record.')
  })

  it('10. privacy: only R24 keys were written; no request, answer, invite, decision or private peer reached the PDS', () => {
    step = '10 privacy'
    const puts = net.writes.filter(w => w.nsid === 'com.atproto.repo.putRecord')
    expect(puts.length).toBeGreaterThan(0)
    const keys = new Set<string>()
    for (const w of puts) {
      const record = w.body.record as Record<string, unknown>
      if (w.body.collection === LINK_NSID) expect(Object.keys(record).sort()).toEqual(expect.arrayContaining(['$type', 'createdAt', 'relation', 'subject']))
      for (const k of Object.keys(record)) keys.add(`${String(w.body.collection)}#${k}`)
      if (w.body.collection === LINK_NSID) for (const k of Object.keys(record)) expect(['$type', 'subject', 'relation', 'network', 'createdAt']).toContain(k)
      if (w.body.collection === PROFILE_NSID) for (const k of Object.keys(record)) expect(['$type', 'name', 'networks', 'createdAt']).toContain(k)
      expect([LINK_NSID, PROFILE_NSID]).toContain(w.body.collection)
    }
    note('-', 'every record key the PDS received', [...keys].sort())

    // Every request id, answer, invite id, token and its hash, decision text, and the private peer: none in the write log.
    const log = writeLog()
    const ledger = parse(readFileSync(join(repos.hub, 'data', 'federation-requests.yaml'), 'utf8')) as { requests: Record<string, any>[] }
    const records = ledger.requests
    expect(records.map(r => r.outcome).sort()).toEqual(['accepted', 'accepted', 'refused', 'refused'])
    const needles: Record<string, string> = {
      ...Object.fromEntries(records.map((r, i) => [`request id ${i + 1}`, r.id])),
      ...Object.fromEntries(Object.entries(ANSWERS).map(([k, v]) => [`answer (${k})`, v])),
      'invite id': INVITE_ID, 'invite token': TOKEN, 'token hash': sha256Hex(TOKEN),
      'decision (hub, accept by request)': `request ${requestId}`, 'decision (hub, accept by invite)': `invite ${INVITE_ID}`, 'decision (hub, refusal)': REFUSAL,
      'decision (node, recorded)': String(parse(git('node', 'show', `HEAD~1:federation.yaml`)).peers.find((p: { url?: string }) => p.url === HUB_URL)?.decision ?? 'missing'),
      'private peer name': PRIVATE_NAME, 'private peer DID': PRIVATE_DID, 'private peer url': PRIVATE_URL, 'private peer host': 'hollow-grove.example.org',
      'node password': NODE_PASSWORD, 'hub password': HUB_PASSWORD, 'fern password': FERN_PASSWORD,
    }
    const found = Object.entries(needles).filter(([, v]) => log.includes(v)).map(([k]) => k)
    note('-', `grep of the PDS write log (${net.writes.length} writes) for ${Object.keys(needles).length} needles`, { needles: Object.keys(needles), found })
    expect(found).toEqual([])
    expect(needles['decision (node, recorded)']).not.toBe('missing')

    // Every POST to a PDS host is one of the three XRPC methods N2 calls, and nothing else.
    const pdsHosts = new Set([HOST_A, HOST_B].map(h => new URL(h).host))
    const posts = net.requests.filter(r => r.method === 'POST' && pdsHosts.has(new URL(r.url).host))
    const methods = new Set(posts.map(r => new URL(r.url).pathname))
    note('-', 'every XRPC method POSTed to a PDS host', [...methods].sort())
    expect(posts.length).toBeGreaterThan(0)
    for (const r of posts) expect(['/xrpc/com.atproto.server.createSession', '/xrpc/com.atproto.repo.putRecord', '/xrpc/com.atproto.repo.deleteRecord'], r.url).toContain(new URL(r.url).pathname)
    // The app passwords, against the bodies as sent (before the fake's redaction): each went only to its own account's
    // PDS, in createSession, and in no other request (not a putRecord or deleteRecord body, not another host).
    const holders = { [NODE_PASSWORD]: HOST_A, [HUB_PASSWORD]: HOST_B, [FERN_PASSWORD]: HOST_A }
    expect(net.raw.length).toBeGreaterThan(0)
    for (const [password, host] of Object.entries(holders)) {
      const carriers = net.raw.filter(r => r.body.includes(password))
      expect(carriers.length).toBeGreaterThan(0)
      for (const r of carriers) expect(`${r.method} ${r.url}`).toBe(`POST ${host}/xrpc/com.atproto.server.createSession`)
    }
    // Every other needle is in no request body either, raw or redacted.
    const rawBodies = net.raw.map(r => r.body).join('\n')
    const inRaw = Object.entries(needles).filter(([k]) => !k.endsWith('password')).filter(([, v]) => rawBodies.includes(v)).map(([k]) => k)
    expect(inRaw).toEqual([])

    // The private peer: no record, and never named in a job's output, a receipt or a log.
    const jobsAndReceipts = (Object.keys(repos) as Who[]).map(w => filesUnder(join(stateDir(repos[w]), 'jobs')) + filesUnder(join(stateDir(repos[w]), 'federation'), new Set(['atproto', 'remote']))).join('\n')
    for (const n of [PRIVATE_NAME, PRIVATE_URL]) expect(jobsAndReceipts).not.toContain(n)
    expect(jobsAndReceipts).not.toContain(PRIVATE_DID)
    expect(net.records(NODE_DID, LINK_NSID).concat(net.records(HUB_DID, LINK_NSID)).some(r => r.value.subject === PRIVATE_DID)).toBe(false)
  })

  it('11. the invite token is in no tree, no git history, no job log, no receipt; in state only where the asker keeps it', () => {
    step = '11 token'
    const where: Record<string, unknown> = {}
    for (const w of Object.keys(repos) as Who[]) {
      const tree = filesHolding(repos[w], TOKEN).filter(p => !p.startsWith('.git/'))
      const history = git(w, 'log', '-p', '--all').includes(TOKEN)
      const state = filesHolding(stateDir(repos[w]), TOKEN)
      where[w] = { tree, history, state }
      expect(tree).toEqual([])
      expect(history).toBe(false)
      expect(state.filter(p => p.startsWith('jobs/'))).toEqual([])
      expect(state.filter(p => p.endsWith('published.json'))).toEqual([])
    }
    // The asker's state folder alone holds it, where Task 8 keeps it outside git (R18): the outgoing state and the saved file.
    expect((where.fern as { state: string[] }).state.sort()).toEqual([expect.stringMatching(/^federation\/outgoing\/[0-9a-f-]{36}\.json$/), expect.stringMatching(/^federation\/outgoing\/[0-9a-f-]{36}\.request\.yaml$/)])
    for (const w of ['node', 'hub', 'gale'] as Who[]) expect((where[w] as { state: string[] }).state).toEqual([])
    expect(readFileSync(ghState, 'utf8')).not.toContain(TOKEN)
    expect(readFileSync(ghLog, 'utf8')).not.toContain(TOKEN)
    expect(writeLog()).not.toContain(TOKEN)
    note('-', 'where the invite token is', where)
  })

  it('12. both scratch histories pass validate-governance --strict and validate-identity', () => {
    step = '12 validators'
    for (const w of ['node', 'hub', 'fern', 'gale'] as Who[]) {
      const gov = spawnSync(process.execPath, [join(ROOT, 'scripts', 'validate-governance.mjs'), repos[w], '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
      note(w, 'node scripts/validate-governance.mjs <copy> --strict', { code: gov.status, out: (gov.stdout + gov.stderr).trim().split('\n').slice(-6) })
      expect(gov.status, gov.stdout + gov.stderr).toBe(0)
      const id = spawnSync(process.execPath, [join(ROOT, 'scripts', 'validate-identity.mjs'), repos[w]], { encoding: 'utf8' })
      note(w, 'node scripts/validate-identity.mjs <copy>', { code: id.status, out: (id.stdout + id.stderr).trim().split('\n').slice(-6) })
      expect(id.status, id.stdout + id.stderr).toBe(0)
    }
  })
})
