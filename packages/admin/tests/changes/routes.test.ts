import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git, CONSENSUS } from './fixtures.ts'
import { createApp } from '../../server/app.ts'
import { parseTrailers } from '../../lib/trailers.mjs'

let repo: string
let app: Hono
let events: unknown[]
const setup = (governance?: string | null) => {
  repo = makeChangeRepo(governance)
  events = []
  app = createApp(repo, undefined, { notify: msg => events.push(msg) })
}
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json('POST', { ops }))
const view = async () => (await app.request('/api/changes')).json()
const apply = () => app.request('/api/changes/apply', json('POST', {}))
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const projects = () => join(repo, 'data', 'projects.yaml')
const UPDATE = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
const MEMBER = { op: 'update', record: 'members:ana', set: { role: 'Steward' } }

describe('the Changes routes', () => {
  it('GET answers an empty change under the solo rule', async () => {
    setup()
    expect(await view()).toMatchObject({ id: '', ops: [], classes: [], stale: [], current: [], rule: { direct: true, sentence: 'the maintainer decides alone' } })
  })

  it('POST /ops stages, answers the view, tells every tab, and leaves the tree alone', async () => {
    setup()
    const res = await stageOps([UPDATE])
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(v.id).toMatch(/^chg_/)
    expect(v.actor).toBe('steward-a')
    expect(v.ops).toEqual([{ ...UPDATE, base: expect.stringMatching(/^[0-9a-f]{64}$/), before: expect.objectContaining({ id: 'proj-001' }) }])
    expect(v.classes).toEqual(['records'])
    expect(v.state).toBe('staged')
    expect(events).toEqual([{ type: 'changes' }])
    expect(git(repo, 'status --porcelain')).toBe('')
  })

  it('a refused op is 422 with record, field and message, and nothing is staged', async () => {
    setup()
    const res = await stageOps([{ op: 'update', record: 'projects:proj-001', set: { lead: 'ghost' } }])
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ errors: [{ record: 'projects:proj-001', field: 'lead', message: 'no member with id "ghost" in members' }] })
    expect((await view()).ops).toEqual([])
    expect(events).toEqual([])
  })

  it('a body that is not ops is 400 in words', async () => {
    setup()
    for (const body of [{}, { ops: [] }, { ops: [{ op: 'rename', record: 'projects:proj-001' }] }, { ops: [{ op: 'update', record: 'projects:proj-001' }] }]) {
      const res = await app.request('/api/changes/ops', json('POST', body))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/The body must be \{"ops": \[\.\.\.\]\}/)
    }
  })

  it('DELETE /ops/:n takes one op out; a number past the end is 404', async () => {
    setup()
    await stageOps([UPDATE, MEMBER])
    const res = await app.request('/api/changes/ops/0', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect((await res.json()).ops.map((o: { record: string }) => o.record)).toEqual(['members:ana'])
    expect((await app.request('/api/changes/ops/5', { method: 'DELETE' })).status).toBe(404)
  })

  it('DELETE /api/changes discards everything with 204', async () => {
    setup()
    await stageOps([UPDATE])
    expect((await app.request('/api/changes', { method: 'DELETE' })).status).toBe(204)
    expect((await view()).ops).toEqual([])
  })

  it('apply makes one commit with the three trailers and clears the change', async () => {
    setup()
    const { id } = await (await stageOps([UPDATE, MEMBER])).json()
    const res = await apply()
    expect(res.status).toBe(200)
    const { commit } = await res.json()
    expect(commit).toBe(git(repo, 'rev-parse HEAD').trim())
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({ actor: 'steward-a', change: id, rule: 'solo/direct' })
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('admin(projects, members): apply 2 changes')
    expect((await view()).ops).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'changes' })
  })

  it('an outside edit makes the op stale: apply answers 409, then theirs or mine brings it back', async () => {
    setup()
    await stageOps([{ op: 'update', record: 'projects:proj-001', set: { title: 'Mine', status: 'develop' } }])
    writeFileSync(projects(), readFileSync(projects(), 'utf8').replace('title: "Node Onboarding Program"', 'title: "Theirs"'))
    git(repo, 'commit -qam outside')
    expect((await view()).stale).toEqual([0])
    const res = await apply()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ stale: [0], code: 'STALE' })
    const theirs = await (await app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'theirs' }))).json()
    expect(theirs.ops[0].set).toEqual({ status: 'develop' })
    expect(theirs.stale).toEqual([])
    expect((await apply()).status).toBe(200)
    expect(readFileSync(projects(), 'utf8')).toContain('title: "Theirs"')
  })

  it('keep mine re-bases on the current entry and applies the staged value', async () => {
    setup()
    await stageOps([{ op: 'update', record: 'projects:proj-001', set: { title: 'Mine' } }])
    writeFileSync(projects(), readFileSync(projects(), 'utf8').replace('title: "Node Onboarding Program"', 'title: "Theirs"'))
    git(repo, 'commit -qam outside')
    const mine = await (await app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))).json()
    expect(mine.stale).toEqual([])
    expect((await apply()).status).toBe(200)
    expect(readFileSync(projects(), 'utf8')).toContain('title: "Mine"')
    expect((await app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'both' }))).status).toBe(400)
  })

  it('an outside commit to another record of the same file is no conflict, and survives the apply (Review Focus 3)', async () => {
    setup()
    await stageOps([UPDATE])
    writeFileSync(projects(), `${readFileSync(projects(), 'utf8')}  - id: "proj-002"\n    title: "Elsewhere"\n`)
    git(repo, 'commit -qam outside')
    expect((await view()).stale).toEqual([])
    expect((await apply()).status).toBe(200)
    const text = readFileSync(projects(), 'utf8')
    expect(text).toContain('id: "proj-002"')
    expect(text).toContain('status: "develop"')
  })

  it('two tabs staging at the same moment both land (Review Focus 2)', async () => {
    setup()
    const answers = await Promise.all([stageOps([UPDATE]), stageOps([MEMBER])])
    expect(answers.map(r => r.status)).toEqual([200, 200])
    expect((await view()).ops.map((o: { record: string }) => o.record).sort()).toEqual(['members:ana', 'projects:proj-001'])
  })

  it('a commit that fails answers 503 and keeps every op', async () => {
    setup()
    await stageOps([UPDATE])
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 })
    const res = await apply()
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/hook says no/)
    expect((await view()).ops).toHaveLength(1)
  })

  it('nothing staged: apply is 400 with code EMPTY', async () => {
    setup()
    const res = await apply()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Nothing is staged: the change holds no ops to apply.', code: 'EMPTY' })
  })

  it('GET /api/actor answers who this caller is', async () => {
    setup()
    expect(await (await app.request('/api/actor')).json()).toMatchObject({ id: 'steward-a', name: 'Steward A', kind: 'person' })
  })
})

describe('the changes event (final review)', () => {
  const CHANGES = { type: 'changes' }

  it('goes out after unstage, rebase and discard', async () => {
    setup()
    await stageOps([UPDATE, MEMBER])
    events.length = 0
    expect((await app.request('/api/changes/ops/1', { method: 'DELETE' })).status).toBe(200)
    expect(events).toEqual([CHANGES])

    writeFileSync(projects(), readFileSync(projects(), 'utf8').replace('title: "Node Onboarding Program"', 'title: "Theirs"'))
    git(repo, 'commit -qam outside')
    events.length = 0
    expect((await app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))).status).toBe(200)
    expect(events).toEqual([CHANGES])

    events.length = 0
    expect((await app.request('/api/changes', { method: 'DELETE' })).status).toBe(204)
    expect(events).toEqual([CHANGES])
  })

  it('does not go out after a refused apply: 400 EMPTY, 403, 409 STALE', async () => {
    setup()
    expect((await apply()).status).toBe(400)
    expect(events).toEqual([])

    await stageOps([UPDATE])
    events.length = 0
    git(repo, 'config user.email stranger@local')
    expect((await apply()).status).toBe(403)
    git(repo, 'config user.email admin-test@local')
    expect(events).toEqual([])

    writeFileSync(projects(), readFileSync(projects(), 'utf8').replace('title: "Node Onboarding Program"', 'title: "Theirs"'))
    git(repo, 'commit -qam outside')
    const res = await apply()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('STALE')
    expect(events).toEqual([])
    expect((await view()).ops).toHaveLength(1)
  })
})

describe('refusals under the rule', () => {
  it('an actor git cannot match can neither stage nor apply, and is told why', async () => {
    setup()
    git(repo, 'config user.email stranger@local')
    const res = await stageOps([UPDATE])
    expect(res.status).toBe(403)
    const sentence = 'Read-only: your git email `stranger@local` matches no member in `data/members.yaml`.'
    expect(await res.json()).toEqual({ reason: sentence, error: sentence })
    expect((await apply()).status).toBe(403)
    expect((await view()).rule).toMatchObject({ direct: false, sentence })
  })

  it('a consensus instance stages, and refuses Apply with its sentence', async () => {
    setup(CONSENSUS)
    expect((await stageOps([UPDATE])).status).toBe(200)
    expect((await view()).rule).toMatchObject({ direct: false })
    const res = await apply()
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('Fixture Org decides changes by consensus, and data/governance.yaml writes no rule for it, so nothing can be proposed until a rule is written.')
    expect(commits()).toBe(2)
    expect((await view()).ops).toHaveLength(1)
  })
})

describe('the review rulings', () => {
  const BOB = { id: 'bob', name: 'Bob', role: 'Contributor', layer: 'contributor', status: 'active', joined: '2026-01-01' }
  const CREATE_BOB = { op: 'create', record: 'members:bob', value: BOB }
  const LEAD_BOB = { op: 'update', record: 'projects:proj-001', set: { lead: 'bob' } }

  it('two concurrent stage requests to the same change both survive (no lost update)', async () => {
    setup()
    const answers = await Promise.all([stageOps([UPDATE]), stageOps([MEMBER]), stageOps([CREATE_BOB])])
    expect(answers.map(r => r.status)).toEqual([200, 200, 200])
    const v = await view()
    expect(v.ops.map((o: { record: string }) => o.record).sort()).toEqual(['members:ana', 'members:bob', 'projects:proj-001'])
    const ids = await Promise.all(answers.map(async r => (await r.json()).id))
    expect(new Set(ids).size).toBe(1)
  })

  it('removing a create that another op refers to is 422 and leaves the change unchanged', async () => {
    setup()
    await stageOps([CREATE_BOB])
    await stageOps([LEAD_BOB])
    const before = await view()
    expect(before.ops).toHaveLength(2)
    const res = await app.request('/api/changes/ops/0', { method: 'DELETE' })
    expect(res.status).toBe(422)
    const { errors } = await res.json()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toMatchObject({ record: expect.any(String), field: expect.any(String), message: expect.stringMatching(/bob/) })
    expect(await view()).toEqual(before)
  })

  it('a registry file with YAML errors reaches the client as 409, never 422', async () => {
    setup()
    writeFileSync(projects(), 'projects:\n  - id: [unclosed\n')
    git(repo, 'commit -qam broken')
    const res = await stageOps([UPDATE])
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Not saved/)
  })

  it('a delete that other entries came to name is 422 { errors } on Apply, and the change stays', async () => {
    setup()
    writeFileSync(join(repo, 'data', 'members.yaml'), `${readFileSync(join(repo, 'data', 'members.yaml'), 'utf8')}  - id: "bob"\n    name: "Bob"\n    role: "Contributor"\n    layer: "contributor"\n    status: "active"\n    joined: "2026-01-01"\n`)
    git(repo, 'commit -qam bob')
    expect((await stageOps([{ op: 'delete', record: 'members:bob' }])).status).toBe(200)
    writeFileSync(projects(), readFileSync(projects(), 'utf8').replace('lead: "steward-a"', 'lead: "bob"'))
    git(repo, 'commit -qam lead-bob')
    const res = await apply()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ errors: [{ record: 'members:bob', field: '', message: expect.stringMatching(/bob/) }] })
    expect((await view()).ops).toHaveLength(1)
  })
})
