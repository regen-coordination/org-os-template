import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeFixtureRepo, removeFixtureRepo, TEST_EMAIL } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { mountOperations } from '../../server/operations/routes.ts'
import { Plans } from '../../server/operations/plans.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { JobStore, type JobRecord } from '../../server/state.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { Operation } from '../../server/operations/catalogue.ts'
import type { Adapter, Resource } from '../../server/resources/types.ts'
import { git } from '../changes/fixtures.ts'

let repo: string
let app: ReturnType<typeof createApp>
let plans: Plans
let finished: JobRecord[]

const mod: Resource = { id: 'module:a', kind: 'module', board: 'systems', name: 'module a', status: null, attention: null, changed: null, facts: {}, source: null }
const oneModule: Adapter = { name: 'modules', board: 'systems', title: 'Modules', watch: [], async read() { return { nodes: [mod], edges: [] } } }
const base: Pick<Operation, 'kinds' | 'network' | 'timeoutMs' | 'refreshes' | 'unavailable' | 'params'> = {
  kinds: ['module'], network: false, timeoutMs: 10_000, refreshes: 'modules', unavailable: () => null,
  params: { type: 'object', additionalProperties: false } }
const CAT: Operation[] = [
  { ...base, id: 'fake.change', label: () => 'Change', effect: 'changes',
    params: { type: 'object', additionalProperties: false, required: ['word'], properties: { word: { type: 'string', maxLength: 10 } } },
    plan: (_r, p) => ({ cmd: process.execPath, args: ['-e', `console.log(${JSON.stringify(String(p.word))})`], writes: [] }) },
  { ...base, id: 'fake.read', label: () => 'Read', effect: 'reads', plan: () => ({ inProcess: async () => 'read it\n' }) },
  { ...base, id: 'fake.slow', label: () => 'Slow', effect: 'reads', plan: () => ({ cmd: process.execPath, args: ['-e', 'setTimeout(()=>{},30000)'], writes: [] }) },
  { ...base, id: 'fake.never', label: () => 'Never', effect: 'reads', unavailable: () => 'not on this machine', plan: () => ({ inProcess: async () => '' }) },
  { ...base, id: 'fake.variants', label: () => 'Variant', effect: 'reads',
    params: { type: 'object', additionalProperties: false, properties: { n: { type: 'integer' } } },
    variants: () => [{ label: 'Variant 0', params: { n: 0 }, unavailable: null }, { label: 'Variant 1', params: { n: 1 }, unavailable: 'no' }],
    plan: () => ({ inProcess: async () => '' }) },
]

beforeEach(() => {
  repo = makeFixtureRepo()
  finished = []
  const jobs = new JobStore(repo)
  const store = new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null }, [oneModule])
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: j => finished.push(j) }, { killGraceMs: 200 })
  plans = new Plans()
  app = createApp(repo, a => mountOperations(a, { repo, store, jobs, executor, plans, catalogue: CAT }))
})
afterEach(() => removeFixtureRepo(repo))

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const done = (id: string) => expect.poll(() => finished.find(j => j.id === id)?.status, { interval: 20, timeout: 10_000 })

describe('operation routes', () => {
  it('lists a resource\'s operations, one per variant, with why one is unavailable', async () => {
    const ops = await (await app.request('/api/operations?resource=module%3Aa')).json()
    expect(ops.map((o: { id: string; label: string; confirm: boolean; unavailable: string | null }) => [o.id, o.label, o.confirm, o.unavailable])).toEqual([
      ['fake.change', 'Change', true, null], ['fake.read', 'Read', false, null], ['fake.slow', 'Slow', false, null],
      ['fake.never', 'Never', false, 'not on this machine'], ['fake.variants', 'Variant 0', false, null], ['fake.variants', 'Variant 1', false, 'no'],
    ])
    expect(ops[4].preset).toEqual({ n: 0 })
  })

  it('lists every available operation for ⌘K', async () => {
    const pairs = await (await app.request('/api/operations')).json()
    expect(pairs.map((p: { op: string }) => p.op)).toEqual(['fake.change', 'fake.read', 'fake.slow', 'fake.variants'])
    expect(pairs[0]).toMatchObject({ resource: 'module:a', resourceName: 'module a', board: 'systems', confirm: true })
  })

  it('a changing operation runs only with the nonce its plan gave', async () => {
    const direct = await post('/api/jobs', { op: 'fake.change', resource: 'module:a', params: { word: 'hi' } })
    expect(direct.status).toBe(403)
    expect((await direct.json()).error).toMatch(/runs only with a confirmation/)

    const planned = await (await post('/api/operations/fake.change/plan', { resource: 'module:a', params: { word: 'hi' } })).json()
    expect(planned).toMatchObject({ op: 'fake.change', resource: 'module:a', inProcess: false, cmd: process.execPath, confirm: true, writes: [] })
    expect(planned.args).toEqual(['-e', 'console.log("hi")'])

    const run = await post('/api/jobs', { nonce: planned.nonce })
    expect(run.status).toBe(202)
    const job = await run.json()
    await done(job.id).toBe('ok')
    const read = await (await app.request(`/api/jobs/${job.id}`)).json()
    expect(read.log).toBe('hi\n')

    const again = await post('/api/jobs', { nonce: planned.nonce })
    expect(again.status).toBe(409)
  })

  it('a double-clicked Run starts one job (Review Focus 2)', async () => {
    const a = (await (await post('/api/operations/fake.change/plan', { resource: 'module:a', params: { word: 'a' } })).json()).nonce
    const [first, second] = await Promise.all([post('/api/jobs', { nonce: a }), post('/api/jobs', { nonce: a })])
    expect([first.status, second.status].sort()).toEqual([202, 409])
    const refused = first.status === 409 ? first : second
    expect((await refused.json()).error).toMatch(/already used or has expired/)
    const list = await (await app.request('/api/jobs')).json()
    expect(list.filter((j: { op: string }) => j.op === 'fake.change')).toHaveLength(1)
  })

  it('refuses bad params, unknown things and unavailable operations in words', async () => {
    const bad = await post('/api/operations/fake.change/plan', { resource: 'module:a', params: { word: 'far too long a word' } })
    expect(bad.status).toBe(422)
    expect((await bad.json()).errors[0]).toMatchObject({ field: 'word' })
    expect((await post('/api/operations/nope/plan', { resource: 'module:a' })).status).toBe(404)
    expect((await post('/api/operations/fake.read/plan', { resource: 'module:zzz' })).status).toBe(404)
    const never = await post('/api/jobs', { op: 'fake.never', resource: 'module:a' })
    expect(never.status).toBe(409)
    expect((await never.json()).error).toBe('Not run: not on this machine.')
  })

  it('runs a reading operation directly, lists jobs, and cancels', async () => {
    const read = await (await post('/api/jobs', { op: 'fake.read', resource: 'module:a' })).json()
    await done(read.id).toBe('ok')
    const slow = await (await post('/api/jobs', { op: 'fake.slow', resource: 'module:a' })).json()
    expect((await app.request(`/api/jobs/${slow.id}`, { method: 'DELETE' })).status).toBe(200)
    await done(slow.id).toBe('cancelled')
    expect((await app.request(`/api/jobs/${slow.id}`, { method: 'DELETE' })).status).toBe(409)
    const list = await (await app.request('/api/jobs?resource=module%3Aa')).json()
    expect(list.map((j: { op: string }) => j.op)).toEqual(['fake.slow', 'fake.read'])
    expect((await app.request('/api/jobs/no-such-job')).status).toBe(404)
  })

  it('the guard still stands in front: another site, or a form post, is refused', async () => {
    expect((await post('/api/jobs', { op: 'fake.read', resource: 'module:a' }, { origin: 'https://evil.example' })).status).toBe(403)
    const form = await app.request('/api/jobs', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })
    expect(form.status).toBe(415)
  })
})

// The operations routes act only for a member (kms-admin review: they checked no actor, `knowledge.publish` included).
// Planning, running and cancelling are acts, held to the same known actor staging is (`knownActorOf`); the lists are reads.
describe('who may plan, run and cancel an operation', () => {
  const stranger = () => git(repo, 'config user.email stranger@local')
  const READ_ONLY = 'Read-only: your git email `stranger@local` matches no member in `data/members.yaml`.'

  it('plans nothing for a git identity no member holds, and says why', async () => {
    stranger()
    const res = await post('/api/operations/fake.change/plan', { resource: 'module:a', params: { word: 'hi' } })
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe(READ_ONLY)
  })

  it('runs nothing for them: not a read, and not a confirmed plan a member was given (its nonce is not spent)', async () => {
    const planned = await (await post('/api/operations/fake.change/plan', { resource: 'module:a', params: { word: 'hi' } })).json()
    stranger()
    expect((await post('/api/jobs', { op: 'fake.read', resource: 'module:a' })).status).toBe(403)
    expect((await post('/api/jobs', { nonce: planned.nonce })).status).toBe(403)
    git(repo, `config user.email ${TEST_EMAIL}`)
    expect((await post('/api/jobs', { nonce: planned.nonce })).status).toBe(202)
  })

  it('cancels nothing for them', async () => {
    const job = await (await post('/api/jobs', { op: 'fake.slow', resource: 'module:a' })).json()
    stranger()
    expect((await app.request(`/api/jobs/${job.id}`, { method: 'DELETE' })).status).toBe(403)
    git(repo, `config user.email ${TEST_EMAIL}`)
    expect((await app.request(`/api/jobs/${job.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('still lists what a resource offers, and the jobs, to anyone who may read', async () => {
    stranger()
    expect((await app.request('/api/operations?resource=module%3Aa')).status).toBe(200)
    expect((await app.request('/api/jobs')).status).toBe(200)
  })
})
