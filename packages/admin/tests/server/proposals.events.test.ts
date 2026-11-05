import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { CLOCK_SKEW_MS, instant } from '../../lib/proposals.mjs'

// Every test builds a throwaway repository under the temp directory (makeChangeRepo), with synthetic members ana,
// bruno and carla (and bot, an agent). Nothing here touches a real instance. The clock is injected.
const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
  - { id: bot, name: Bot, kind: agent, handles: { git: ["bot@example.test"] } }
`
const PROJECTS = `schema_version: "2.0"
projects:
  - id: "proj-001"
    title: "Node Onboarding Program"
    status: "execute"
    type: "program"
    lead: "bruno"
    contributors: ["ana"]
`
const gov = (rule: string) =>
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno, carla] }\n    member: { all: true }\n  rules:\n    ${rule}\n  decisions: []\n`
const APPROVE = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }')
const SELF = gov('- { id: records, applies_to: [records], propose: member, self_approve: true, decide: { by: maintainer, method: approve, count: 1 } }')
const VOTE = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: vote, window: P7D, quorum: 1, threshold: 0.5 } }')

const NOW = new Date('2026-10-18T12:00:00Z')
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
let ID = 'p-2026-10-18-001'

let repo: string
let app: Hono
let clock: Date
let real = false

function setup(governance = APPROVE) {
  repo = makeChangeRepo(governance)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members"')
  app = createApp(repo, (a, ctx) => mountProposals(a, {
    repo, withLock: ctx.withLock, startBranch: 'main', now: () => (real ? new Date() : clock),
  }))
}
/** The git identity the next requests are made as. */
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
beforeEach(() => { clock = new Date(NOW); real = false; ID = 'p-2026-10-18-001' })
afterEach(() => { removeFixtureRepo(repo) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
/** `author` proposes one change to a project; returns the proposal's id. */
async function propose(author = 'ana'): Promise<string> {
  as(author)
  expect((await app.request('/api/changes/ops', json({ ops: [PROJECT] }))).status).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Move one project' }))
  expect(res.status).toBe(201)
  ID = (await res.json()).id
  return ID
}
const send = (who: string, body: unknown, id = ID) => { as(who); return app.request(`/api/proposals/${id}/events`, json(body)) }
const events = () => readLedger(repo).entries[0]!.events
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }

describe('POST /api/proposals/:id/events', () => {
  it('each kind is one trunk commit that touches the ledger alone, with trailers; the response carries the evaluation and what the actor can do', async () => {
    setup(); await propose()
    const cases: [string, Record<string, unknown>, string][] = [
      ['bruno', { kind: 'approve' }, 'approve'],
      ['carla', { kind: 'object', text: 'It moves the stage too early.' }, 'object'],
      ['ana', { kind: 'comment', text: 'Noted.' }, 'comment'],
    ]
    for (const [who, body, kind] of cases) {
      tick()
      const before = commits()
      const res = await send(who, body)
      expect(res.status).toBe(200)
      const view = await res.json()
      expect(commits()).toBe(before + 1)
      expect(git(repo, 'diff --name-only HEAD~1 HEAD').trim()).toBe('data/proposals.yaml')
      expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD'))).toEqual({ actor: who, rule: 'records/approve', proposal: ID })
      const written = events().at(-1)!
      expect(written).toMatchObject({ kind, by: who, at: clock.toISOString().replace('.000Z', 'Z') })
      expect(view).toMatchObject({ id: ID, state: 'open', branchState: 'built', commit: git(repo, 'rev-parse HEAD').trim() })
      expect(view.events.at(-1).id).toBe(written.id)
      expect(view.evaluation).toMatchObject({ state: expect.any(String), missing: expect.any(String) })
      expect(Array.isArray(view.can)).toBe(true)
    }
    // a retract of one's own event
    tick()
    const objection = events().find(e => e.kind === 'object')!
    expect((await send('carla', { kind: 'retract', of: objection.id })).status).toBe(200)
    expect(events().at(-1)).toMatchObject({ kind: 'retract', by: 'carla', of: objection.id })
  })

  it('records the proposal rev on approve, object and vote; the response `can` lists what this actor may write', async () => {
    setup(); await propose()
    const rev = readLedger(repo).entries[0]!.rev
    tick(); await send('bruno', { kind: 'approve' })
    expect(events().at(-1)!.rev).toBe(rev)
    const view = await (await send('carla', { kind: 'comment', text: 'ok' })).json()
    expect(view.can).toEqual(expect.arrayContaining(['comment', 'approve', 'object']))
    expect(view.can).not.toContain('withdraw') // carla is not the author
    as('ana')
    const mine = await (await app.request(`/api/proposals/${ID}/events`, json({ kind: 'comment', text: 'thanks' }))).json()
    expect(mine.can).toContain('withdraw')
    expect(mine.can).not.toContain('approve') // ana decides nothing
  })

  it('`by`, `id` and `at` in the body are ignored: the actor writes', async () => {
    setup(); await propose()
    const res = await send('bruno', { kind: 'approve', by: 'carla', id: 'e-forged', at: '2001-01-01T00:00:00Z' })
    expect(res.status).toBe(200)
    expect(events().at(-1)).toMatchObject({ by: 'bruno', at: '2026-10-18T12:00:00Z' })
    expect(events().at(-1)!.id).not.toBe('e-forged')
  })

  it('an unknown actor writes nothing (403)', async () => {
    setup(); await propose()
    git(repo, 'config user.email stranger@example.test')
    const before = commits()
    const res = await app.request(`/api/proposals/${ID}/events`, json({ kind: 'comment', text: 'hi' }))
    expect(res.status).toBe(403)
    expect(commits()).toBe(before)
  })

  it('a proposal that is not in the ledger is 404; a kind this route does not write is 400; a body that is not an object is 400', async () => {
    setup(); await propose()
    expect((await send('bruno', { kind: 'approve' }, 'p-2026-10-18-009')).status).toBe(404)
    expect((await send('bruno', { kind: 'ratify' })).status).toBe(400)
    expect((await send('bruno', { kind: 'nonsense' })).status).toBe(400)
    expect((await send('bruno', {})).status).toBe(400)
    expect((await send('bruno', [])).status).toBe(400)
  })

  it('an objection without text is 422 and nothing is written; with text it is written', async () => {
    setup(); await propose()
    const before = commits()
    for (const body of [{ kind: 'object' }, { kind: 'object', text: '   ' }]) {
      const res = await send('carla', body)
      expect(res.status).toBe(422)
      expect(JSON.stringify(await res.json())).toMatch(/text/)
    }
    expect(commits()).toBe(before)
    expect((await send('carla', { kind: 'object', text: 'It harms the aim.' })).status).toBe(200)
  })

  it('a comment without text is 422', async () => {
    setup(); await propose()
    expect((await send('ana', { kind: 'comment' })).status).toBe(422)
  })

  it('a vote is yes, no or abstain; anything else is 422; the latest per member is what counts', async () => {
    setup(VOTE); await propose()
    const before = commits()
    expect((await send('bruno', { kind: 'vote' })).status).toBe(422)
    expect((await send('bruno', { kind: 'vote', vote: 'maybe' })).status).toBe(422)
    expect(commits()).toBe(before)
    for (const v of ['yes', 'no', 'abstain']) {
      tick()
      expect((await send('bruno', { kind: 'vote', vote: v })).status).toBe(200)
      expect(events().at(-1)).toMatchObject({ kind: 'vote', vote: v, by: 'bruno' })
    }
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD')).rule).toBe('records/vote')
    // someone who does not decide may not vote
    expect((await send('ana', { kind: 'vote', vote: 'yes' })).status).toBe(409)
  })

  describe('refusals: 409 REFUSED with the guard\'s sentence, and nothing written', () => {
    const refusedWith = async (res: Response, re: RegExp) => {
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body).toMatchObject({ code: 'REFUSED', machine: 'proposal' })
      expect(body.reason).toMatch(re)
      expect(body.error).toBe(body.reason)
      return body
    }

    it('approve by the author', async () => {
      setup(); await propose('bruno')
      const before = commits()
      const body = await refusedWith(await send('bruno', { kind: 'approve' }), /cannot approve their own proposal/)
      expect(body).toMatchObject({ state: 'approving', event: 'APPROVE' })
      expect(commits()).toBe(before)
      expect(events()).toEqual([])
    })

    it('approve by the author is accepted, and counted, when the rule snapshot sets self_approve', async () => {
      setup(SELF); await propose('bruno')
      const view = await (await send('bruno', { kind: 'approve' })).json()
      expect(events()).toHaveLength(1)
      expect(view.evaluation.state).toBe('met')
    })

    it('a refused approval by the author leaves the evaluation pending, whatever a comment says', async () => {
      setup(); await propose('bruno')
      await send('bruno', { kind: 'approve' })
      const view = await (await send('carla', { kind: 'comment', text: 'I will look.' })).json()
      expect(view.evaluation.state).toBe('pending')
    })

    it('approve, object and vote by someone who does not decide', async () => {
      setup(); await propose()
      await refusedWith(await send('ana', { kind: 'approve' }), /does not hold the maintainer role/)
      await refusedWith(await send('ana', { kind: 'object', text: 'No.' }), /does not hold the maintainer role/)
      expect(events()).toEqual([])
    })

    it('an agent decides nothing, and may comment', async () => {
      setup(); await propose()
      await refusedWith(await send('bot', { kind: 'approve' }), /agent/)
      await refusedWith(await send('bot', { kind: 'object', text: 'No.' }), /agent/)
      expect((await send('bot', { kind: 'comment', text: 'A note from the bot.' })).status).toBe(200)
    })

    it('a stale proposal takes comment, retract and withdraw and refuses the rest', async () => {
      setup(); await propose()
      // the record changes on the trunk under the proposal's op
      as('ana')
      writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('status: "execute"', 'status: "decide"'))
      git(repo, 'add -A'); git(repo, 'commit -qm "trunk moves the record"')
      const before = commits()
      await refusedWith(await send('bruno', { kind: 'approve' }), /stale|trunk moved|replayed/i)
      await refusedWith(await send('carla', { kind: 'object', text: 'No.' }), /stale|trunk moved|replayed/i)
      expect(commits()).toBe(before)
      tick(); expect((await send('bruno', { kind: 'comment', text: 'It needs a replay.' })).status).toBe(200)
      const comment = events().at(-1)!
      tick(); expect((await send('bruno', { kind: 'retract', of: comment.id })).status).toBe(200)
      tick(); expect((await send('ana', { kind: 'withdraw' })).status).toBe(200)
    })

    it('a closed proposal takes no event', async () => {
      setup(); await propose()
      tick(); expect((await send('ana', { kind: 'withdraw' })).status).toBe(200)
      const before = commits()
      await refusedWith(await send('bruno', { kind: 'approve' }), /withdrawn|can't be done/i)
      await refusedWith(await send('ana', { kind: 'comment', text: 'Too late.' }), /withdrawn|can't be done/i)
      expect(commits()).toBe(before)
    })

    it('retract of another member\'s event, of an event that is not there, and of no event', async () => {
      setup(); await propose()
      tick(); await send('carla', { kind: 'object', text: 'It harms the aim.' })
      const theirs = events()[0]!.id
      await refusedWith(await send('bruno', { kind: 'retract', of: theirs }), /only the person who wrote an event/)
      await refusedWith(await send('bruno', { kind: 'retract', of: 'e-nothing' }), /no event/)
      await refusedWith(await send('bruno', { kind: 'retract' }), /names no event/)
      expect(events()).toHaveLength(1)
    })

    it('withdraw by someone who is not the author', async () => {
      setup(); await propose()
      await refusedWith(await send('bruno', { kind: 'withdraw' }), /only its author can withdraw/)
    })

    it('an event after the proposal\'s time ran out is refused by the ledger (409 IGNORED), not written', async () => {
      setup(); await propose()
      clock = new Date(NOW.getTime() + 31 * 86400e3)
      const res = await send('bruno', { kind: 'approve' })
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('IGNORED')
    })
  })

  it('withdraw by the author closes it: withdrawn, closed, the branch kept, no decision row', async () => {
    setup(); await propose()
    const decisionsBefore = git(repo, 'show HEAD:data/governance.yaml')
    tick()
    const before = commits()
    const res = await send('ana', { kind: 'withdraw', text: 'I will try again.' })
    expect(res.status).toBe(200)
    const view = await res.json()
    expect(view).toMatchObject({ state: 'withdrawn', closed: { by: 'ana', at: '2026-10-18T12:01:00Z', decision: null } })
    expect(commits()).toBe(before + 1) // state, closed and the event: one commit
    expect(git(repo, 'diff --name-only HEAD~1 HEAD').trim()).toBe('data/proposals.yaml')
    const entry = readLedger(repo).entries[0]!
    expect(entry.state).toBe('withdrawn')
    expect(entry.events.at(-1)).toMatchObject({ kind: 'withdraw', by: 'ana' })
    expect(git(repo, `rev-parse --verify -q proposal/${ID}`).trim()).not.toBe('') // the branch is kept
    expect(view.branchState).toBe('built')
    expect(git(repo, 'show HEAD:data/governance.yaml')).toBe(decisionsBefore) // no decision row
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD'))).toEqual({ actor: 'ana', rule: 'records/approve', proposal: ID })
    expect(view.can).toEqual([])
  })

  it('two events written one after the other keep their order in the file and in time', async () => {
    setup(); await propose()
    tick(); const a = await (await send('bruno', { kind: 'comment', text: 'first' })).json()
    tick(); const b = await (await send('carla', { kind: 'comment', text: 'second' })).json()
    expect(events().map(e => e.text)).toEqual(['first', 'second'])
    expect(b.events.map((e: { text: string }) => e.text)).toEqual(['first', 'second'])
    expect(instant(events()[0]!.at)).toBeLessThan(instant(events()[1]!.at))
    expect(a.events).toHaveLength(1)
  })

  it('an event\'s `at` is within CLOCK_SKEW of its commit\'s committer date', async () => {
    setup(); real = true
    await propose()
    const res = await send('bruno', { kind: 'approve' })
    expect(res.status).toBe(200)
    const committed = Number(git(repo, 'log -1 --format=%ct HEAD').trim()) * 1000
    expect(Math.abs(instant(events().at(-1)!.at) - committed)).toBeLessThanOrEqual(CLOCK_SKEW_MS)
  })
})
