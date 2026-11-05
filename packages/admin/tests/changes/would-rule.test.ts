import { describe, it, expect, afterEach } from 'vitest'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { createApp } from '../../server/app.ts'

/** POST /api/changes/rule (spec 2026-11-04 §3, the new-record form's governance line): the rule the viewer's change
 *  would fall under with these ops added. Read only: it stages nothing, writes nothing and tells no tab. */

/** Records are the stewards' to decide alone; a member is approved by one steward. */
const SPLIT = `schema_version: "2.0"
governance:
  model: steward-council
  roles:
    stewards: { members: [steward-a] }
  rules:
    - id: records
      applies_to: [records]
      propose: stewards
      decide: { by: stewards, method: direct }
    - id: people
      applies_to: [members]
      propose: stewards
      decide: { by: stewards, method: approve, count: 1 }
`

let repo: string
let app: Hono
let events: unknown[]
const setup = (governance?: string | null) => {
  repo = makeChangeRepo(governance) // a fresh mkdtemp repository each time
  events = []
  app = createApp(repo, undefined, { notify: msg => events.push(msg) })
}
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const wouldRule = (body: unknown) => app.request('/api/changes/rule', json('POST', body))
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json('POST', { ops }))
const view = async () => (await app.request('/api/changes')).json()
const CREATE = { op: 'create', record: 'projects:new-one', value: { id: 'new-one', title: 'New one' } }
const MEMBER = { op: 'update', record: 'members:ana', set: { role: 'Steward' } }

describe('POST /api/changes/rule', () => {
  it('answers the rule a create would fall under, and stages, writes and announces nothing', async () => {
    setup()
    const res = await wouldRule({ ops: [CREATE] })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ direct: true, sentence: 'the maintainer decides alone' })
    expect((await view()).ops).toEqual([])
    expect(events).toEqual([])
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('judges the viewer’s current change with the ops added, and leaves that change as it was', async () => {
    setup(SPLIT)
    expect(await (await wouldRule({ ops: [CREATE] })).json()).toMatchObject({ direct: true })
    expect((await stageOps([MEMBER])).status).toBe(200)
    events = []
    const rule = await (await wouldRule({ ops: [CREATE] })).json()
    expect(rule).toMatchObject({ direct: false, proposable: true })
    expect(rule.sentence).toMatch(/Propose it instead\.$/)
    expect((await view()).ops.map((o: { record: string }) => o.record)).toEqual(['members:ana'])
    expect(events).toEqual([])
  })

  it('a body that is not ops is 400 in words', async () => {
    setup()
    for (const body of [{}, { ops: [] }, { ops: [{ op: 'rename', record: 'projects:x' }] }]) {
      const res = await wouldRule(body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/The body must be \{"ops": \[\.\.\.\]\}/)
    }
  })

  it('still asks who is asking: an actor git cannot match is told why, as staging tells them', async () => {
    setup()
    git(repo, 'config user.email stranger@local')
    const res = await wouldRule({ ops: [CREATE] })
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('Read-only: your git email `stranger@local` matches no member in `data/members.yaml`.')
  })
})
