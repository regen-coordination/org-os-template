// The Federation page's server side (network N2 Task 13): the Join policy form's one federation.yaml edit, the saved
// copy of an invited request offered as a download (never as text), and the card facts the page draws from. Every test
// runs in a fresh temp repository; nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountFederation } from '../../server/federation/routes.ts'
import { stateDir } from '../../server/state.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { runCommand } from '../../server/resources/run.ts'
import { joinText } from '../../server/federation/node.ts'
import type { Graph } from '../../server/resources/types.ts'

const NOW = new Date('2026-11-23T10:00:00.000Z')
const ID = '3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e31'
const RAISED = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a, bruno] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [identity], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`
const FED = [
  '# the hub', 'identity:', '  name: "Mesh Hub"', '  type: "Network"', '  url: https://mesh-hub.example.org',
  'networks:', '  - { name: Mesh, role: hub }', '  - { name: Valley, hub: https://valley.example.org, role: node }',
  'peers:',
  '  - name: Valley Hub', '    url: https://valley.example.org', '    decision: "2026-10-01"',
  '  - name: Hidden Grove', '    url: https://hidden-grove.example.org', '    visibility: private',
  '  - name: Folder Friend', '    repo: ../folder-friend',
  '',
].join('\n')

let repo: string
let app: ReturnType<typeof createApp>
const write = (rel: string, text: string) => { mkdirSync(join(repo, rel, '..'), { recursive: true }); writeFileSync(join(repo, rel), text) }
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg) }
const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const setup = (governance: string | null) => {
  repo = makeChangeRepo(governance)
  write('data/members.yaml', MEMBERS)
  write('federation.yaml', FED)
  commit('the hub')
  app = createApp(repo, (a, ctx) => mountFederation(a, { repo, withLock: ctx.withLock, now: () => NOW, startBranch: 'main' }))
}
afterEach(() => removeFixtureRepo(repo))

describe('the Join policy form: one federation.yaml edit, class identity', () => {
  beforeEach(() => setup(null))

  it('a solo hub commits the join block it chose; comments survive; nothing else in the file moves', async () => {
    const res = await post('/api/federation/join', { policy: 'open-with-approval', types: ['LocalNode'], asks: ['why'], where: 'https://github.com/mesh/hub' })
    expect(res.status).toBe(200)
    const out = await res.json() as { policy: string; commit?: string }
    expect(out.commit).toMatch(/^[0-9a-f]{7,}$/)
    const text = readFileSync(join(repo, 'federation.yaml'), 'utf8')
    expect(text.startsWith('# the hub\n')).toBe(true)
    const doc = parse(text)
    expect(doc.join).toEqual({ policy: 'open-with-approval', types: ['LocalNode'], asks: ['why'], where: 'https://github.com/mesh/hub' })
    expect(doc.peers).toEqual(parse(FED).peers)
    expect(git('show', '--stat', '--format=%s', 'HEAD')).toContain('federation: join policy open-with-approval')
  })

  it('open takes a decision; open with none removes it (read as "anyone can ask, the hub decides", R17); another policy leaves it', () => {
    const open = joinText(FED, { policy: 'open', decision: 'D-7' })
    expect(parse(open).join).toEqual({ policy: 'open', decision: 'D-7' })
    expect(parse(joinText(open, { policy: 'open', decision: null })).join).toEqual({ policy: 'open' })
    expect(parse(joinText(open, { policy: 'invite' })).join).toEqual({ policy: 'invite', decision: 'D-7' })
    expect(parse(joinText(open, { policy: 'closed', types: [], asks: [], where: null })).join).toEqual({ policy: 'closed', decision: 'D-7' })
  })

  it('refuses a policy it does not know, a where that is not public https, a control character, and an edit that changes nothing', async () => {
    const said = async (body: unknown) => { const r = await post('/api/federation/join', body); return { status: r.status, error: ((await r.json()) as { error: string }).error } }
    expect(await said({ policy: 'wide-open' })).toMatchObject({ status: 400, error: expect.stringMatching(/^Choose a policy/) })
    expect(await said({ policy: 'open', where: 'http://10.0.0.1/hub' })).toMatchObject({ status: 400, error: expect.stringMatching(/public https address/) })
    expect(await said({ policy: 'open', asks: ['why‮'] })).toMatchObject({ status: 400, error: expect.stringMatching(/one line of text/) })
    expect((await post('/api/federation/join', { policy: 'closed' })).status).toBe(200)
    expect(await said({ policy: 'closed' })).toMatchObject({ status: 409, error: expect.stringMatching(/already says this/) })
  })
})

describe('the Join policy form under a raised identity rule', () => {
  beforeEach(() => setup(RAISED))

  it('stages the edit in the actor\'s change; nothing is committed', async () => {
    const head = git('rev-parse', 'HEAD')
    const res = await post('/api/federation/join', { policy: 'invite' })
    expect(await res.json()).toMatchObject({ policy: 'invite', staged: true })
    expect(git('rev-parse', 'HEAD')).toBe(head)
    const ops = new ChangeStore(repo).all().changes.flatMap(c => c.ops)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'file', path: 'federation.yaml' })
  })
})

describe('the saved request file (Task 8\'s invited file send)', () => {
  beforeEach(() => setup(null))

  it('is a download, never cached; with none it is a 404', async () => {
    expect((await app.request(`/api/federation/outgoing/${ID}/request-file`)).status).toBe(404)
    expect((await app.request('/api/federation/outgoing/not-a-uuid/request-file')).status).toBe(404)
    const dir = join(stateDir(repo), 'federation', 'outgoing')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${ID}.request.yaml`), 'spec: org-os/federation-request/1\ninvite: tok-SECRET\n', { mode: 0o600 })
    const res = await app.request(`/api/federation/outgoing/${ID}/request-file`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="join-request-3f8a2c1e.yaml"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toContain('invite: tok-SECRET')
  })
})

describe('the card facts the page draws from', () => {
  beforeEach(() => setup(null))

  it('a peer card says whether it is public; the self card carries the networks and the join block', async () => {
    write('federation.yaml', `${FED}join: { policy: open-with-approval, asks: [why] }\n`)
    const graph = await fleet.read({ repo, now: () => NOW, run: runCommand, lastOk: () => null }) as Graph
    const self = graph.nodes.find(n => n.facts.self === true)!
    expect(self.facts.networks).toEqual([{ name: 'Mesh', hub: null, role: 'hub' }, { name: 'Valley', hub: 'https://valley.example.org', role: 'node' }])
    expect(self.facts.join).toEqual({ policy: 'open-with-approval', types: [], asks: ['why'], where: null, decision: null })
    const byName = Object.fromEntries(graph.nodes.filter(n => n.facts.self !== true).map(n => [n.name, n.facts.public]))
    expect(byName).toEqual({ 'Valley Hub': true, 'Hidden Grove': false, 'Folder Friend': false })
  })
})
