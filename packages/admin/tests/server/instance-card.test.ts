import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountOperations } from '../../server/operations/routes.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { Plans } from '../../server/operations/plans.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { mountResources } from '../../server/resources/routes.ts'
import { runCommand } from '../../server/resources/run.ts'
import { JobStore } from '../../server/state.ts'

// An instance with no fleet (no data/instances.yaml, no peers in federation.yaml) still has its own card, with the
// real adapters: Sync and Share are operations on that card (0.6 P2 spec §3.10), so they must be reachable without a
// declared fleet. The repository is a fresh fixture under the OS temp dir; only plans are asked for, nothing runs.
let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => {
  repo = makeChangeRepo()
  const store = new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null })
  const jobs = new JobStore(repo)
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: () => {} }, { killGraceMs: 200 })
  app = createApp(repo, a => {
    mountResources(a, store, repo)
    mountOperations(a, { repo, store, jobs, executor, plans: new Plans(), startBranch: 'main' })
  })
})
afterEach(() => removeFixtureRepo(repo))

const SELF = 'instance:fixture-org'
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe("an instance's own card without a fleet", () => {
  it('the fixture declares no fleet', () => {
    expect(existsSync(join(repo, 'data', 'instances.yaml'))).toBe(false)
  })

  it('is a resource, marked as this instance', async () => {
    const res = await app.request('/api/resources?board=systems&kind=instance')
    expect(res.status).toBe(200)
    const nodes = await res.json()
    expect(nodes).toEqual([expect.objectContaining({ id: SELF, kind: 'instance', name: 'Fixture Org', status: 'this instance',
      facts: expect.objectContaining({ self: true }) })])
  })

  it('offers fetch and share, both available, as Governance reads them', async () => {
    const res = await app.request(`/api/operations?resource=${encodeURIComponent(SELF)}`)
    expect(res.status).toBe(200)
    const ops = (await res.json()) as { id: string; unavailable: string | null }[]
    expect(ops.find(o => o.id === 'fetch')).toMatchObject({ unavailable: null })
    expect(ops.find(o => o.id === 'share')).toMatchObject({ unavailable: null })
  })

  it('answers a plan for fetch and for share, not a 404', async () => {
    const fetched = await app.request('/api/operations/fetch/plan', json({ resource: SELF }))
    const fetchPlan = await fetched.json()
    expect(fetched.status, JSON.stringify(fetchPlan)).toBe(200)
    expect(fetchPlan).toMatchObject({ op: 'fetch', resource: SELF, inProcess: true, confirm: true })
    const shared = await app.request('/api/operations/share/plan', json({ resource: SELF }))
    const sharePlan = await shared.json()
    expect(shared.status, JSON.stringify(sharePlan)).toBe(200)
    expect(sharePlan).toMatchObject({ op: 'share', resource: SELF, cmd: 'git', args: ['push', '--', 'origin', 'refs/heads/main:refs/heads/main'], confirm: true })
  })
})
