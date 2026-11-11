/** The routes are the wiring: the collection at `/api/knowledge`, one entry at its record address, and one sentence
 *  when this repository has no commons. Nothing here writes. */
import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mountKnowledge } from '../../../server/knowledge/routes.ts'
import { withRequest } from '../../../server/request.ts'
import { asGitRepo, FIXTURE_NOW, makeBareRepo, makeKmsInstance, type FixtureInstance } from './fixture.ts'

let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

const app = (repo: string, deps: Partial<Parameters<typeof mountKnowledge>[1]> = {}) => {
  const a = new Hono()
  // The app's own error handler, reduced: an HttpError answers its status and its sentence (app.ts's `onError`).
  a.onError((err, c) => c.json({ error: err.message }, ((err as { status?: number }).status ?? 500) as 500))
  // Who asks: the request middleware, as app.ts mounts it (git's identity, locally).
  a.use('/api/*', withRequest({ repo, hosted: false, membership: null }))
  mountKnowledge(a, { repo, now: () => FIXTURE_NOW, ...deps })
  return a
}

describe('the knowledge routes', () => {
  it('answers the collection with its lanes', async () => {
    instance = makeKmsInstance()
    const res = await app(instance.dir).request('/api/knowledge')
    expect(res.status).toBe(200)
    const body = await res.json() as { configured: boolean; lanes: { id: string; count: number }[] }
    expect(body.configured).toBe(true)
    expect(body.lanes.map(l => [l.id, l.count])).toEqual([['draft', 0], ['awaiting', 1], ['published', 6], ['internal', 1]])
  })

  it('answers one entry at its record address', async () => {
    instance = makeKmsInstance()
    const res = await app(instance.dir).request('/api/knowledge/entry/encyclopedia-entry/living-mulch')
    expect(res.status).toBe(200)
    const body = await res.json() as { row: { title: string }; checks: unknown[] }
    expect(body.row.title).toBe('Living mulch')
    expect(body.checks).toHaveLength(6)
  })

  it('answers 404 with a sentence for an entry that is not there', async () => {
    instance = makeKmsInstance()
    const res = await app(instance!.dir).request('/api/knowledge/entry/encyclopedia-entry/no-such-entry')
    expect(res.status).toBe(404)
    expect((await res.json() as { error: string }).error).toContain('No entry encyclopedia-entry/no-such-entry')
  })

  it('answers configured: false rather than an error when there is no canon', async () => {
    const bare = makeBareRepo()
    try {
      const res = await app(bare.dir).request('/api/knowledge')
      expect(res.status).toBe(200)
      expect((await res.json() as { configured: boolean }).configured).toBe(false)
    } finally { bare.cleanup() }
  })

  it('lists the runs that touched the commons from the app’s own job records, and no others', async () => {
    instance = makeKmsInstance()
    const jobs = {
      list: () => [
        { id: 'job-1', op: 'knowledge.publish', resource: 'knowledge', status: 'ok', created: '2026-10-27T10:00:00Z', sentence: 'Done. It changed public/; nothing was committed.', changed: ['public/'] },
        { id: 'job-2', op: 'share', resource: 'instance:self', status: 'ok', created: '2026-10-27T09:00:00Z', sentence: 'Shared.', changed: [] },
        { id: 'job-3', op: 'connector.ingest', resource: 'connector:atproto', status: 'failed', created: '2026-10-28T09:00:00Z', sentence: 'Failed: timeout.', changed: [] },
      ],
    }
    const a = new Hono()
    mountKnowledge(a, { repo: instance.dir, now: () => FIXTURE_NOW, jobs: jobs as never })
    const body = await (await a.request('/api/knowledge')).json() as { runs: { id: string; label: string }[] }
    expect(body.runs.map(r => [r.id, r.label])).toEqual([['job-1', 'publish'], ['job-3', 'ingest']])
  })
})

describe('the prepared-edit routes', () => {
  it('prepares without writing, and answers the base an apply needs', async () => {
    instance = asGitRepo(makeKmsInstance())
    const before = instance.snapshot()
    const res = await app(instance.dir).request('/api/knowledge/entry/encyclopedia-entry/living-mulch/prepare', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { audience: 'Field crews · volunteer growers' } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { base: string; text: string; changes: unknown[] }
    expect(body.base).toMatch(/^[0-9a-f]{64}$/)
    expect(body.text).toContain('volunteer growers')
    expect(body.changes).toHaveLength(1)
    expect(instance.snapshot()).toEqual(before)
  })

  it('refuses a body that is not an edit, in one sentence', async () => {
    instance = asGitRepo(makeKmsInstance())
    const res = await app(instance.dir).request('/api/knowledge/entry/encyclopedia-entry/living-mulch/prepare', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nope": true}',
    })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toContain('{"fields"')
  })
})

describe('the apply route asks who is writing (review fix)', () => {
  const MEMBERS = 'schema_version: "2.0"\nmembers:\n  - { id: steward-a, name: Steward A, kind: person, handles: { git: steward@local } }\n'
  const post = (a: ReturnType<typeof app>, path: string, body: unknown) => a.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const PATH = '/api/knowledge/entry/encyclopedia-entry/living-mulch'

  it('refuses a git identity no member holds, 403, and writes and commits nothing', async () => {
    instance = makeKmsInstance()
    writeFileSync(join(instance.dir, 'data/members.yaml'), MEMBERS)
    asGitRepo(instance, 'stranger@local')
    const a = app(instance.dir)
    const file = join(instance.dir, 'data/kb/encyclopedia-entry.yaml')
    const was = readFileSync(file, 'utf8')
    const prepared = await (await post(a, `${PATH}/prepare`, { fields: { audience: 'Anyone' } })).json() as { base: string; rule: { direct: boolean; sentence: string } }
    expect(prepared.rule.direct).toBe(false)
    expect(prepared.rule.sentence).toMatch(/Read-only/)
    const res = await post(a, `${PATH}/apply`, { fields: { audience: 'Anyone' }, base: prepared.base })
    expect(res.status).toBe(403)
    expect(readFileSync(file, 'utf8')).toBe(was)
    expect(execFileSync('git', ['-C', instance.dir, 'log', '--format=%s']).toString().trim().split('\n')).toHaveLength(1)
  })

  it('applies for a member git names, under the rule the house judged', async () => {
    instance = makeKmsInstance()
    writeFileSync(join(instance.dir, 'data/members.yaml'), MEMBERS)
    asGitRepo(instance, 'steward@local')
    const a = app(instance.dir)
    const prepared = await (await post(a, `${PATH}/prepare`, { fields: { audience: 'Growers' } })).json() as { base: string; rule: { direct: boolean } }
    expect(prepared.rule.direct).toBe(true)
    const res = await post(a, `${PATH}/apply`, { fields: { audience: 'Growers' }, base: prepared.base })
    expect(res.status).toBe(200)
    const log = execFileSync('git', ['-C', instance.dir, 'log', '-1', '--format=%B']).toString()
    expect(log).toContain('Org-Actor: steward-a')
    expect(log).toContain('Org-Rule: workspace/direct') // the canon is class workspace since L6 (R-55)
  })
})
