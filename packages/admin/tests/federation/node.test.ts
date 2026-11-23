// The node's side of joining a network (network N2 Task 8): ask, send, follow the answer, record it; then, and only then
// through the separate confirmed operation, publish `memberOf`. Every test runs in a fresh temp repository with the fake
// network and a fake transport: nothing reaches GitHub, a real PDS or plc.directory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { createApp } from '../../server/app.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { mountOperations } from '../../server/operations/routes.ts'
import { Plans } from '../../server/operations/plans.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { JobStore, stateDir, type JobRecord } from '../../server/state.ts'
import { runCommand } from '../../server/resources/run.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { mountFederation } from '../../server/federation/routes.ts'
import { clearState, federationSendOperation, federationStatusOperation, readState, SENTENCES, outgoingPath } from '../../server/federation/node.ts'
import { remoteCache, wellKnownUrlOf } from '../../server/federation/remote.ts'
import { registerTransport, transportOf } from '../../server/federation/transports/index.ts'
import type { Transport } from '../../server/federation/transports/types.ts'
import { atprotoCache, readRepo } from '../../server/federation/atproto/read.ts'
import { planPublish, publishLinksOperation, type PublishDeps } from '../../server/federation/atproto/publish.ts'
import { LINK_NSID } from '../../lib/federation/links.mjs'
import type { FederationRequest } from '../../lib/federation/request.mjs'
import type { Graph, Resource } from '../../server/resources/types.ts'
import type { InProcess } from '../../server/operations/catalogue.ts'

/** Identity changes are proposed and approved: asking stages instead of committing. */
const CONSENSUS = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [identity], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SELF = plcDid('fixture-org')
const HUB = plcDid('mesh-hub')
const HUB_SITE = 'https://mesh-hub.example.org'
const OWN_SITE = 'https://fixture-org.example.com'
const NOW = new Date('2026-11-22T12:00:00.000Z')
const PASSWORD = 'zq7-UNMISTAKABLE-app-pass-4410'
const TOKEN = 'tok-UNMISTAKABLE-invite-9931'

let repo: string
let app: ReturnType<typeof createApp>
let net: FakeNetwork
let sent: { request: FederationRequest; where: string | null }[]
let ready: string | null
let answer: { state: 'waiting' | 'accepted' | 'refused'; reason?: string }
let unregister: () => void
let finished: JobRecord[]
let plans: Plans
let issued = 0
let store: ResourceStore
let invalidated = 0

const write = (rel: string, text: string) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text) }
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg) }
const HUB_DOC = (join: Record<string, unknown> | null = { policy: 'open-with-approval', asks: ['purpose'], where: HUB_SITE }) => ({
  spec: 'org-os/federation/1', name: 'Mesh Hub', type: 'Network', did: HUB, networks: [{ name: 'Mesh' }, { name: 'Commons' }], ...(join ? { join } : {}),
})
const cacheHub = (doc: Record<string, unknown> = HUB_DOC()) => remoteCache(repo).put(wellKnownUrlOf(HUB_SITE)!, doc, NOW)
const FED = (more = '') => `# the org's federation manifest\nidentity:\n  name: "Fixture Org"\n  type: "Organization"\n  url: ${OWN_SITE}\n  did: "${SELF}"\n${more}`

const fake: Transport = {
  id: 'fake', label: 'Send by a fake way',
  unavailable: () => null,
  ready: async () => ready,
  send: async (request, where) => { sent.push({ request, where }); return { ref: 'https://github.com/mesh/hub/issues/7', summary: 'Sent it.' } },
  status: async () => answer,
}

const build = () => {
  const jobs = new JobStore(repo)
  store = new ResourceStore({ repo, now: () => NOW, run: runCommand, lastOk: () => null }, [fleet])
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: j => finished.push(j) })
  const real = new Plans()
  plans = real
  const counting = Object.assign(Object.create(real), { issue: (p: never) => { issued += 1; return real.issue(p) }, take: (n: unknown) => real.take(n) }) as Plans
  const catalogue = [federationSendOperation({ now: () => NOW }), federationStatusOperation({ now: () => NOW }), publishLinksOperation(pdeps())]
  app = createApp(repo, (a, ctx) => {
    mountFederation(a, { repo, withLock: ctx.withLock, now: () => NOW, invalidate: () => { invalidated += 1 } })
    mountOperations(a, { repo, store, jobs, executor, plans: counting, catalogue })
  })
}

const pdeps = (o: Partial<PublishDeps> = {}): PublishDeps => ({
  fetch: net.fetch, lookup: net.lookup, env: { ATPROTO_APP_PASSWORD: PASSWORD }, now: NOW, allowPlaceholderLexicons: true, run: runCommand, ...o,
})

const setup = (governance: string | null) => {
  repo = makeChangeRepo(governance)
  write('federation.yaml', FED())
  write('kms.yaml', ['adapter: repo-data', 'target: "."', 'atproto:', `  did: "${SELF}"`, '  pds: "https://pds-one.example.com"', '  handle: "fixture-org.example.com"', '  nsid_authority: "org.fixture"', ''].join('\n'))
  commit('the org: identity, kms')
  cacheHub()
  build()
}

beforeEach(() => {
  sent = []; ready = null; answer = { state: 'waiting' }; finished = []; issued = 0
  net = makeFakeNetwork({ hosts: {
    'https://pds-one.example.com': { accounts: { [SELF]: { handle: 'fixture-org.example.com', password: PASSWORD } } },
    'https://pds-two.example.net': { accounts: { [HUB]: { handle: 'mesh-hub.example.org', password: 'hub-pass' } } },
  } })
  unregister = registerTransport(fake)
})
afterEach(() => { unregister(); removeFixtureRepo(repo) })

const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const ask = async (body: Record<string, unknown> = {}) => {
  const res = await post('/api/federation/ask', { hub: HUB_SITE, network: 'Mesh', answers: { purpose: 'we work on soil' }, ...body })
  return { res, json: await res.json() as Record<string, unknown> }
}
/** What applying a staged change does: its files land on the trunk. */
const applyStaged = () => {
  const store = new ChangeStore(repo)
  for (const change of store.all().changes) {
    for (const op of change.ops) {
      if (op.op !== 'file') continue
      if (op.text === null) rmSync(join(repo, op.path), { force: true })
      else write(op.path, op.text)
    }
    store.clear(change.actor)
  }
  commit('apply the staged change')
}
const stagedOps = () => new ChangeStore(repo).all().changes.flatMap(c => c.ops).filter(o => o.op === 'file') as { path: string; text: string | null }[]
const card = async (): Promise<Resource> => { store.invalidateAdapter('fleet'); return cardNow() }
const cardNow = async (): Promise<Resource> => ((await fleet.read({ repo, now: () => NOW, run: runCommand, lastOk: () => null })) as Graph).nodes.find(n => n.facts.self === true)!
const outgoing = async () => (await card()).facts.outgoing as { id: string; onTrunk: boolean; sent: unknown; status: unknown; atproto: { theirs: string } }[]
const filesUnder = (dir: string): string => {
  if (!existsSync(dir)) return ''
  let out = ''
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    out += statSync(p).isDirectory() ? filesUnder(p) : `\n${p}\n${readFileSync(p, 'utf8')}`
  }
  return out
}
const planSend = async (id: string, transport = 'fake') => {
  const r = await post('/api/operations/federation.send/plan', { resource: (await card()).id, params: { id, transport } })
  return { r, json: await r.json() as { nonce?: string; error?: string; summary?: string } }
}
const runJob = async (nonce: string) => {
  const r = await post('/api/jobs', { nonce })
  const { id } = await r.json() as { id: string }
  await expect.poll(() => finished.find(j => j.id === id)?.status, { interval: 20, timeout: 10_000 }).toBe('ok')
}

describe('ask', () => {
  it('stages exactly two file ops, keeps the comments of federation.yaml, and stages the hub\'s did', async () => {
    setup(CONSENSUS)
    const { res, json } = await ask()
    expect(res.status, JSON.stringify(json)).toBe(200)
    expect(json.staged).toBe(true)
    const ops = stagedOps()
    expect(ops.map(o => o.path)).toEqual(['federation.yaml', outgoingPath(json.id as string)])
    expect(ops[0].text).toContain("# the org's federation manifest")
    expect(ops[0].text).toContain(`did: ${HUB}`)
    expect(ops[0].text).toMatch(/requested: .*\n/)
    expect(ops[0].text).toContain('role: node')
    expect(ops[1].text).toContain('network: Mesh')
    expect(ops[1].text).not.toContain('invite')
    // staging dirties nothing
    expect(git('status', '--porcelain')).toBe('')
  })

  it('an unanswered ask is 400 Answer "<ask>", a closed hub is 400, a hub never looked up is 400', async () => {
    setup(CONSENSUS)
    const a = await ask({ answers: {} })
    expect([a.res.status, a.json.error]).toEqual([400, 'Answer "purpose".'])
    cacheHub(HUB_DOC({ policy: 'closed' }))
    const c = await ask()
    expect([c.res.status, c.json.error]).toEqual([400, "This network isn't taking requests."])
    const n = await ask({ hub: 'https://never-seen.example.org' })
    expect([n.res.status, n.json.error]).toEqual([400, SENTENCES.lookFirst])
    expect(stagedOps()).toEqual([])
  })

  it('the hub route answers from a fresh cache only', async () => {
    setup(CONSENSUS)
    const fresh = await (await app.request(`/api/federation/hub?address=${encodeURIComponent(HUB_SITE)}`)).json() as { hub: { name: string; networks: string[]; join: { asks: string[] } } }
    expect(fresh.hub.name).toBe('Mesh Hub')
    expect(fresh.hub.networks).toEqual(['Mesh', 'Commons'])
    expect(fresh.hub.join.asks).toEqual(['purpose'])
    remoteCache(repo).put(wellKnownUrlOf(HUB_SITE)!, HUB_DOC(), new Date(NOW.getTime() - 11 * 60_000))
    expect(await (await app.request(`/api/federation/hub?address=${encodeURIComponent(HUB_SITE)}`)).json()).toEqual({ problem: SENTENCES.lookFirst })
  })

  it('the transports route says why a way is unavailable', async () => {
    setup(CONSENSUS)
    ready = 'Not ready here.'
    const rows = await (await app.request(`/api/federation/transports?hub=${encodeURIComponent(HUB_SITE)}`)).json() as { id: string; unavailable: string | null }[]
    expect(rows.find(r => r.id === 'file')!.unavailable).toBeNull()
    expect(rows.find(r => r.id === 'fake')!.unavailable).toBe('Not ready here.')
    expect(rows.find(r => r.id === 'github')!.unavailable).toBe("This hub doesn't take requests on GitHub.")
  })
})

describe('the outgoing file never holds the invite token', () => {
  it('stages a file with no invite, keeps the token in the state file only, and the transport receives it at send', async () => {
    setup(CONSENSUS)
    cacheHub(HUB_DOC({ policy: 'invite', asks: ['purpose'], where: HUB_SITE }))
    expect((await ask()).json.error).toBe('This network joins by invite. Add your invite.')
    const { json } = await ask({ invite: TOKEN })
    const id = json.id as string
    for (const op of stagedOps()) expect(op.text).not.toContain(TOKEN)
    expect(readState(repo, id)!.invite).toBe(TOKEN)
    applyStaged()
    expect(git('log', '-p', '--all')).not.toContain(TOKEN)
    const { r, json: plan } = await planSend(id)
    expect(r.status, JSON.stringify(plan)).toBe(200)
    await runJob(plan.nonce!)
    expect(sent).toHaveLength(1)
    expect(sent[0].request.invite).toBe(TOKEN)
    // and the card, a plan's summary and the job's log never carry it
    expect(JSON.stringify(await card())).not.toContain(TOKEN)
    expect(JSON.stringify(plan)).not.toContain(TOKEN)
    expect(filesUnder(join(stateDir(repo), 'jobs'))).not.toContain(TOKEN)
  })

  it('a file sent without an invite returns its text; one with an invite is saved beside, not printed', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    applyStaged()
    const file = transportOf('file')!
    expect(file.unavailable(null, null)).toBeNull()
    const { json: plan } = await planSend(id, 'file')
    await runJob(plan.nonce!)
    const log = filesUnder(join(stateDir(repo), 'jobs'))
    expect(log).toContain('spec: org-os/federation-request/1')
  })

  it('a file sent with an invite is saved beside, outside git, and its token is not in the job log', async () => {
    setup(CONSENSUS)
    cacheHub(HUB_DOC({ policy: 'invite', asks: ['purpose'], where: HUB_SITE }))
    const id = (await ask({ invite: TOKEN })).json.id as string
    applyStaged()
    const { json: plan } = await planSend(id, 'file')
    await runJob(plan.nonce!)
    expect(filesUnder(join(stateDir(repo), 'jobs'))).not.toContain(TOKEN)
    const saved = readFileSync(join(stateDir(repo), 'federation', 'outgoing', `${id}.request.yaml`), 'utf8')
    expect(saved).toContain(TOKEN)
    expect(git('ls-files')).not.toContain('request.yaml')
  })
})

describe('send waits for the trunk; withdraw after mutual is leaving', () => {
  it('send is unavailable before apply and available after; the plan refuses before apply', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    const rows = await (await app.request(`/api/operations?resource=${encodeURIComponent((await card()).id)}`)).json() as { id: string; label: string; unavailable: string | null; preset: { transport: string } | null }[]
    const send = rows.filter(r => r.id === 'federation.send')
    expect(send.length).toBeGreaterThan(1)
    expect(new Set(send.map(r => r.unavailable))).toEqual(new Set([SENTENCES.applyFirst]))
    const before = await planSend(id)
    expect([before.r.status, before.json.error]).toEqual([409, `Not sent: ${SENTENCES.applyFirst}`])
    applyStaged()
    const after = (await (await app.request(`/api/operations?resource=${encodeURIComponent((await card()).id)}`)).json() as { id: string; preset: { transport: string }; unavailable: string | null }[])
      .find(r => r.id === 'federation.send' && r.preset?.transport === 'fake')!
    expect(after.unavailable).toBeNull()
  })

  it('withdraw before acceptance removes the entries and the outgoing file', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    applyStaged()
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    const json = await res.json() as { text: string; leaving: boolean }
    expect(res.status).toBe(200)
    expect(json.leaving).toBe(false)
    const ops = stagedOps()
    expect(ops.map(o => o.path)).toEqual(['federation.yaml', outgoingPath(id)])
    expect(ops[0].text).not.toContain('Mesh Hub')
    expect(ops[0].text).not.toContain('role: node')
    expect(ops[0].text).toContain("# the org's federation manifest")
    expect(ops[1].text).toBeNull()
  })

  it('a request that is not on the trunk yet has nothing to withdraw', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    expect([res.status, (await res.json() as { error: string }).error]).toEqual([409, SENTENCES.notApplied])
  })

  it('withdraw after the decision is leaving, and says to publish', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    applyStaged()
    writeState(id)
    const rec = await post(`/api/federation/outgoing/${id}/record`)
    expect(rec.status).toBe(200)
    applyStaged()
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    expect(await res.json()).toMatchObject({ leaving: true, text: 'Leaving Mesh. The hub will see the link as left. Then publish, so your record is withdrawn.' })
  })
  it('ask, record and withdraw each have the cards read again: their commit lands after federation.yaml is written', async () => {
    setup(null)
    invalidated = 0
    const id = (await ask()).json.id as string
    expect(invalidated).toBe(1)
    writeState(id)
    expect((await post(`/api/federation/outgoing/${id}/record`)).status).toBe(200)
    expect(invalidated).toBe(2)
    expect((await post(`/api/federation/outgoing/${id}/withdraw`)).status).toBe(200)
    expect(invalidated).toBe(3)
  })
})

import { writeState as put } from '../../server/federation/node.ts'
function writeState(id: string) {
  const s = readState(repo, id)!
  put(repo, id, { ...s, sent: { transport: 'fake', ref: 'https://github.com/mesh/hub/issues/7', at: NOW.toISOString() }, status: { state: 'accepted', reason: 'Accepted: welcome', at: NOW.toISOString() } })
}

describe('following the answer', () => {
  it('ready() failing makes plan answer 409 Not sent, and no nonce is issued', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    applyStaged()
    ready = 'Sign in to gh first: gh auth login.'
    const { r, json } = await planSend(id)
    expect([r.status, json.error]).toEqual([409, 'Not sent: Sign in to gh first: gh auth login.'])
    expect(issued).toBe(0)
    expect(sent).toEqual([])
  })

  it('send records where it went outside git; status stores the answer; accepted offers Record it, which stages the decision', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    applyStaged()
    const p = await planSend(id)
    await runJob(p.json.nonce!)
    expect(readState(repo, id)!.sent).toMatchObject({ transport: 'fake', ref: 'https://github.com/mesh/hub/issues/7' })
    expect(git('status', '--porcelain')).toBe('')
    expect((await outgoing())[0].sent).toMatchObject({ transport: 'fake' })

    // not accepted yet
    const early = await post(`/api/federation/outgoing/${id}/record`)
    expect([early.status, (await early.json() as { error: string }).error]).toEqual([409, SENTENCES.notAccepted])

    answer = { state: 'accepted', reason: 'Accepted: welcome to Mesh' }
    const resource = (await card()).id
    const sp = await (await post('/api/operations/federation.status/plan', { resource, params: { id } })).json() as { nonce: string }
    await runJob(sp.nonce)
    expect(readState(repo, id)!.status).toMatchObject({ state: 'accepted', reason: 'Accepted: welcome to Mesh' })

    const rec = await post(`/api/federation/outgoing/${id}/record`)
    const body = await rec.json() as { text: string; staged: boolean }
    expect(body.text).toBe('Recorded. Once this is on your trunk, publish the link so it shows as mutual on atproto.')
    const [op] = stagedOps()
    expect(op.path).toBe('federation.yaml')
    expect(op.text).toContain('decision: "Accepted: welcome to Mesh"')
    expect(op.text).not.toContain('requested:')
    expect(op.text).toContain("# the org's federation manifest")
  })

  it('the self card lists the request: onTrunk false before apply and true after, with the atproto reading', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    // staged: state exists, the file is not on the trunk
    expect(await outgoing()).toEqual([expect.objectContaining({ id, onTrunk: false, sent: null, status: null })])
    applyStaged()
    const [o] = await outgoing()
    expect(o).toMatchObject({ id, network: 'Mesh', hub: HUB_SITE, onTrunk: true })
    expect(o.atproto).toEqual({ theirs: 'unknown' })
  })
})

describe('nothing reaches atproto until the node publishes, and only through the confirmed operation', () => {
  it('asking, sending and following write nothing; after a recorded acceptance the plan holds exactly the memberOf; leaving plans its removal', async () => {
    setup(null)
    const check = async () => atprotoCache(repo).put(SELF, await readRepo(SELF, { fetch: net.fetch, lookup: net.lookup, now: NOW }), NOW)
    await check()

    // The solo rule is direct: asking commits at once. Nothing is on atproto, and nothing was written.
    const id = (await ask()).json.id as string
    expect((await outgoing())[0].onTrunk).toBe(true)
    const p = await planSend(id)
    await runJob(p.json.nonce!)
    answer = { state: 'accepted', reason: 'Accepted: welcome' }
    const resource = (await card()).id
    const sp = await (await post('/api/operations/federation.status/plan', { resource, params: { id } })).json() as { nonce: string }
    await runJob(sp.nonce)
    expect(net.writes).toEqual([])

    // Before the acceptance is recorded the link is undecided: nothing to publish.
    await expect(planPublish(repo, pdeps())).rejects.toThrow('Not published: Nothing to publish.')

    // Record it (direct under the solo rule): still no write, and then exactly one memberOf for the hub.
    const rec = await post(`/api/federation/outgoing/${id}/record`)
    expect(rec.status).toBe(200)
    expect(net.writes).toEqual([])
    const { plan } = await planPublish(repo, pdeps())
    expect(plan.create.map(c => c.record)).toEqual([expect.objectContaining({ subject: HUB, relation: 'memberOf', network: 'Mesh' })])
    expect(plan.create).toHaveLength(1)
    expect(plan.delete).toEqual([])
    // Planning wrote nothing either; the write is the confirmed operation's.
    expect(net.writes).toEqual([])
    const op = publishLinksOperation(pdeps())
    const planned = await op.plan(await card(), {}, repo) as InProcess
    expect(net.writes).toEqual([])
    await planned.inProcess(repo, new AbortController().signal)
    expect(net.records(SELF, LINK_NSID).map(r => r.value)).toEqual([expect.objectContaining({ subject: HUB, relation: 'memberOf', network: 'Mesh' })])

    // Leaving: withdraw in git, then the plan deletes the record.
    const left = await post(`/api/federation/outgoing/${id}/withdraw`)
    expect(await left.json()).toMatchObject({ leaving: true })
    const after = await planPublish(repo, pdeps())
    expect(after.plan.create).toEqual([])
    expect(after.plan.delete).toHaveLength(1)
    expect(after.plan.delete[0].value).toMatchObject({ subject: HUB, relation: 'memberOf', network: 'Mesh' })
  })
})

describe('fix round 1: the trunk lists, edits build on each other, withdrawing undoes only the ask', () => {
  const fedText = () => readFileSync(join(repo, 'federation.yaml'), 'utf8')

  it('a request on the trunk is listed, sent and withdrawn with the state folder wiped', async () => {
    setup(null)
    const id = (await ask()).json.id as string
    rmSync(join(stateDir(repo), 'federation'), { recursive: true, force: true })
    expect(await outgoing()).toEqual([expect.objectContaining({ id, network: 'Mesh', hub: HUB_SITE, onTrunk: true, sent: null })])
    const p = await planSend(id)
    expect(p.r.status, JSON.stringify(p.json)).toBe(200)
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    expect(res.status).toBe(200)
    expect(fedText()).toContain('Mesh Hub') // no state: the ask is not known to have created the peer, so it is kept
    expect(fedText()).not.toContain('requested')
    expect(fedText()).not.toContain('role: node')
    expect((await res.json() as { text: string }).text).toContain("The hub's peer entry was kept")
    expect(existsSync(join(repo, outgoingPath(id)))).toBe(false)
  })

  const OTHER_SITE = 'https://other-hub.example.org'
  it('asks to two different hubs in one change keep both; a second ask to a hub with one waiting is refused', async () => {
    setup(CONSENSUS)
    remoteCache(repo).put(wellKnownUrlOf(OTHER_SITE)!, { ...HUB_DOC(), name: 'Other Hub', did: undefined, networks: [{ name: 'Commons' }] }, NOW)
    const a = await ask()
    const b = await ask({ hub: OTHER_SITE, network: 'Commons' })
    expect([a.res.status, b.res.status]).toEqual([200, 200])
    const ops = stagedOps()
    expect(ops.filter(o => o.path === 'federation.yaml')).toHaveLength(1)
    expect(ops.map(o => o.path).sort()).toEqual(['federation.yaml', outgoingPath(a.json.id as string), outgoingPath(b.json.id as string)].sort())
    const text = ops.find(o => o.path === 'federation.yaml')!.text!
    expect(text).toContain(`requested: ${a.json.id}`)
    expect(text).toContain(`requested: ${b.json.id}`)
    const again = await ask({ network: 'Commons' })
    expect([again.res.status, again.json.error]).toEqual([409, 'You have a request to this hub waiting: withdraw it or wait for the answer.'])
    const same = await ask()
    expect(same.res.status).toBe(409)
    expect(stagedOps().filter(o => o.path !== 'federation.yaml')).toHaveLength(2)
  })

  it('withdrawing a pending request says Withdrawn, never Leaving', async () => {
    setup(null)
    const id = (await ask()).json.id as string
    const body = await (await post(`/api/federation/outgoing/${id}/withdraw`)).json() as { leaving: boolean; text: string }
    expect(body.leaving).toBe(false)
    expect(body.text).toMatch(/^Withdrawn: Mesh\./)
    expect(body.text).not.toContain('Leaving')
  })

  it('an unreadable request file on the trunk has its own sentence', async () => {
    setup(null)
    const id = (await ask()).json.id as string
    write(outgoingPath(id), 'not: [a request\n')
    commit('break the request file')
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    expect(res.status).toBe(409)
    expect((await res.json() as { error: string }).error).toContain("can't be read, so it can't be withdrawn here")
  })

  it('clear refuses a request whose ask is staged and not applied', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    const res = await post(`/api/federation/outgoing/${id}/clear`)
    expect(res.status).toBe(409)
    expect(readState(repo, id)).not.toBeNull()
  })

  it('a member of one network asks for a second and withdraws it: the first stays, and it is not leaving', async () => {
    setup(null)
    write('federation.yaml', FED(`networks:\n  - name: Mesh\n    hub: ${HUB_SITE}\n    role: node\npeers:\n  - name: Mesh Hub\n    url: ${HUB_SITE}\n    relationship: hub\n    decision: "2026-10-01"\n`))
    commit('already a member of Mesh')
    const id = (await ask({ network: 'Commons' })).json.id as string
    expect(fedText()).toContain('name: Commons')
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    const body = await res.json() as { leaving: boolean; text: string }
    expect(body.leaving).toBe(false)
    expect(body.text).not.toContain('Leaving')
    const text = fedText()
    expect(text).toContain('name: Mesh\n')
    expect(text).not.toContain('Commons')
    expect(text).toContain('Mesh Hub')
    expect(text).toContain('decision: "2026-10-01"')
    expect(text).not.toContain('requested')
  })

  it('leaving one network keeps the hub while another network of it is listed', async () => {
    setup(null)
    write('federation.yaml', FED(`networks:\n  - name: Mesh\n    hub: ${HUB_SITE}\n    role: node\npeers:\n  - name: Mesh Hub\n    url: ${HUB_SITE}\n    relationship: hub\n    decision: "2026-10-01"\n`))
    commit('already a member of Mesh')
    const id = (await ask({ network: 'Commons' })).json.id as string
    writeState(id)
    expect((await post(`/api/federation/outgoing/${id}/record`)).status).toBe(200)
    const res = await post(`/api/federation/outgoing/${id}/withdraw`)
    expect(await res.json()).toMatchObject({ leaving: true })
    expect(fedText()).toContain('name: Mesh\n')
    expect(fedText()).toContain('Mesh Hub')
    expect(fedText()).not.toContain('Commons')
  })

  it('a federation.yaml that is not YAML is a sentence, not a 500', async () => {
    setup(CONSENSUS)
    write('federation.yaml', 'identity: [unclosed\n')
    cacheHub() // the state folder is named from federation.yaml, so look the hub up again
    const r = await ask()
    expect([r.res.status, r.json.error]).toEqual([409, "federation.yaml can't be read as YAML, so nothing was changed. Fix it first."])
  })

  it("a hub's did that isn't a DID is not staged", async () => {
    setup(CONSENSUS)
    cacheHub({ ...HUB_DOC(), did: 'not a did' })
    await ask()
    expect(stagedOps()[0].text).not.toContain('not a did')
  })

  it('a state-only request (its staged ask discarded) is listed as not applied and can be cleared, git untouched', async () => {
    setup(CONSENSUS)
    const id = (await ask()).json.id as string
    new ChangeStore(repo).all().changes.forEach(c => new ChangeStore(repo).clear(c.actor))
    expect(await outgoing()).toEqual([expect.objectContaining({ id, onTrunk: false })])
    const res = await post(`/api/federation/outgoing/${id}/clear`)
    expect(res.status).toBe(200)
    expect(await outgoing()).toEqual([])
    expect(git('status', '--porcelain')).toBe('')
    expect(clearState).toBeTypeOf('function')
  })
})
