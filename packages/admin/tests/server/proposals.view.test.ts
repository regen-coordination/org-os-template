import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { buildBranch, type BuildResult } from '../../server/proposals/branch.ts'
import { createEntry, readLedger } from '../../server/proposals/ledger.ts'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { readResources } from '../../server/resources/index.ts'
import { safe } from '../../server/systems/safe.ts'
import { SystemReader } from '../../server/systems/reader.ts'
import { guardedFetch, type FetchLike, type OutcomeReading, type SystemRef } from '../../server/systems/driver.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { derivedState, leadMethod, liveEvents, revOf, type Proposal } from '../../lib/proposals.mjs'
import { describeRule, resolveRoles } from '../../lib/rules.mjs'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { transition } from '../../lib/machines/run.mjs'
import { proposal as machine, proposalGuards } from '../../lib/machines/proposal.mjs'

// The proposal views and the routes spec §3.15 lists that earlier tasks did not build (0.6 P2, Task 15): GET
// /api/proposals and /:id, revise, replay, prepare, the page visit that reads a system, and the proposals adapter.
// Every test builds a throwaway repository under the temp directory (makeChangeRepo), with synthetic members ana,
// bruno and carla; every git command runs with that repository as its cwd. The clock is injected. The Safe Transaction
// Service is a fake answering recorded JSON; nothing touches the network.

const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
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
const RECORDS = '- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }'
const gov = (rules: string) =>
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno, carla] }\n    member: { all: true }\n  rules:\n    ${rules}\n  decisions: []\n`
const APPROVE = gov(RECORDS)
const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }

const NOW = new Date('2026-10-18T12:00:00Z')
const STATUS = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

let repo: string
let app: Hono
let clock: Date
let failBuild = false
const temps: string[] = []

function setup(governance = APPROVE) {
  repo = makeChangeRepo(governance)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members"')
  app = createApp(repo, (a, ctx) => mountProposals(a, {
    repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock,
    build: (...args: Parameters<typeof buildBranch>): Promise<BuildResult> => {
      if (failBuild) return Promise.reject(new Error('the disk is full'))
      return buildBranch(...args)
    },
  }))
}
beforeEach(() => { clock = new Date(NOW); failBuild = false })
afterEach(() => { removeFixtureRepo(repo); for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true }) })

/** The git identity the next requests are made as. */
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const head = () => git(repo, 'rev-parse HEAD').trim()
const entry = (id: string) => readLedger(repo).entries.find(e => e.id === id)!
const project = () => readRegistry(repo, 'projects').entries!.find(e => e.id === 'proj-001')!
/** The trunk adds a second project: data/projects.yaml, the ops' file, changes, and no op's record does. */
const addProject = () => {
  writeFileSync(join(repo, 'data', 'projects.yaml'), `${readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8')}  - id: "proj-002"\n    title: "Seed Library"\n    status: "idea"\n    type: "program"\n    lead: "carla"\n`)
  git(repo, 'commit -qam "the trunk adds a project"')
}
/** Everything a read could have moved: every ref, HEAD, the working tree's status, the worktree list. */
const snapshot = () => [git(repo, 'for-each-ref'), head(), git(repo, 'status --porcelain'), git(repo, 'worktree list --porcelain')].join('\n--\n')

/** `author` stages ops and proposes them; returns the proposal's id. */
async function propose(author = 'bruno', ops: unknown[] = [STATUS]): Promise<string> {
  as(author)
  expect((await app.request('/api/changes/ops', json({ ops }))).status).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Move one project' }))
  expect(res.status).toBe(201)
  return (await res.json()).id
}
const list = async (who: string) => { as(who); const res = await app.request('/api/proposals'); expect(res.status).toBe(200); return res.json() as Promise<Record<string, unknown>[]> }
const view = async (who: string, id: string) => { as(who); return app.request(`/api/proposals/${id}`) }
const send = (who: string, id: string, body: unknown) => { as(who); tick(); return app.request(`/api/proposals/${id}/events`, json(body)) }
const revise = (who: string, id: string, ops: unknown) => { as(who); tick(); return app.request(`/api/proposals/${id}/revise`, json({ ops })) }
const replay = (who: string, id: string, body: unknown = {}) => { as(who); tick(); return app.request(`/api/proposals/${id}/replay`, json(body)) }

/** What the machine enables for `who`, asked independently of the route: every event `transition` lets pass, with the
 *  actor as its writer (and their latest live event as the one a retract would name). */
function enabledFor(who: string, id: string): string[] {
  const p = entry(id) as Proposal
  const members = readRegistry(repo, 'members').entries!
  const governance = (parse(readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')) as { governance: Record<string, unknown> }).governance
  const book = resolveRoles(governance, members)
  const state = derivedState(p, { stale: false }) // used on proposals whose records the trunk has not changed
  const context = {
    outcome: evaluateAll({ proposal: p as never, book, now: clock }).state, method: leadMethod(p.rules) ?? undefined, author: p.author,
    proposal: p, rules: p.rules, book, known: members.map(m => String(m.id)),
  }
  const mine = liveEvents(p as never).filter(e => e.by === who && e.kind !== 'retract').at(-1)
  const kind = (t: string) => (t === 'REPLAYED' ? 'replay' : t.toLowerCase())
  return machine.events.filter(t => t !== 'TRUNK_MOVED' && transition(machine, proposalGuards, state, { type: t, by: who, of: mine?.id }, context).ok).map(kind)
}

describe('GET /api/proposals', () => {
  it('answers ProposalView[]: the entry, derived, evaluation, the rules as sentences, stale, branchState, needsYou and can', async () => {
    setup()
    const id = await propose('bruno')
    const [v, ...rest] = await list('carla')
    expect(rest).toEqual([])
    expect(v).toMatchObject({
      id, title: 'Move one project', author: 'bruno', state: 'open', branch: `proposal/${id}`, rev: entry(id).rev,
      ops: entry(id).ops, events: [], derived: 'approving', stale: [], branchState: 'built', needsYou: true,
    })
    expect(v!.evaluation).toMatchObject({ state: 'pending', missing: 'needs 1 more approval from a maintainer other than the author' })
    expect(v!.rules).toEqual([{ direct: false, sentence: describeRule(RULE), source: `data/proposals.yaml ${id} rules: records` }])
    // no attach: no rule of it waits on an outside system (fix round 1); no replay: the trunk has changed none of its
    // ops' files since its base, only the ledger (final review I4)
    expect(v!.can).toEqual(['approve', 'object', 'comment'])
    expect(v!.cannot).toMatchObject({ replay: 'Already on the trunk: nothing to replay.' })
  })

  it('needsYou: true for a decider who has not acted, false for the author under four eyes, false once they approved, false for one who decides nothing', async () => {
    setup()
    const id = await propose('bruno')
    const needs = async (who: string) => (await list(who))[0]!.needsYou
    expect(await needs('carla')).toBe(true)
    expect(await needs('bruno')).toBe(false) // the author, and no rule sets self_approve
    expect(await needs('ana')).toBe(false) // a member who decides nothing
    expect((await send('carla', id, { kind: 'approve' })).status).toBe(200)
    expect(await needs('carla')).toBe(false)
    expect((await list('carla'))[0]!.evaluation).toMatchObject({ state: 'met' })
  })

  it('two rules: the author is needed only while a rule that counts their own approval waits (spec §3.2, question 2)', async () => {
    // records counts the author's approval (self_approve); people, decided by another role, does not.
    setup(`schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno, carla] }\n    board: { members: [bruno, ana] }\n    member: { all: true }\n  rules:\n` +
      `    - { id: records, applies_to: [records], propose: member, self_approve: true, decide: { by: maintainer, method: approve, count: 1 } }\n` +
      `    - { id: people, applies_to: [members], propose: member, decide: { by: board, method: approve, count: 1 } }\n  decisions: []\n`)
    const id = await propose('bruno', [STATUS, { op: 'update', record: 'members:ana', set: { name: 'Ana Maria' } }])
    const needs = async (who: string) => (await list(who))[0]!.needsYou
    expect(await needs('bruno')).toBe(true) // records waits, and counts his approval
    expect((await send('carla', id, { kind: 'approve' })).status).toBe(200) // records is met; people waits on the board
    expect((await list('bruno'))[0]!.can).toContain('approve') // he may still write one (records lets him) ...
    expect(await needs('bruno')).toBe(false) // ... but it would count toward no rule that waits
    expect(await needs('ana')).toBe(true)
  })

  it('an objection is acting too: the objector is no longer needed', async () => {
    setup()
    const id = await propose('bruno')
    expect((await send('carla', id, { kind: 'object', text: 'It moves the stage too early.' })).status).toBe(200)
    expect((await list('carla'))[0]!.needsYou).toBe(false)
  })

  it('can is what the machine enables for the actor who asks; an identity no member holds reads, and can do nothing', async () => {
    setup()
    const id = await propose('bruno')
    expect((await send('carla', id, { kind: 'comment', text: 'Looking.' })).status).toBe(200)
    for (const who of ['ana', 'bruno', 'carla']) expect((await list(who))[0]!.can).toEqual(enabledFor(who, id))
    expect((await list('carla'))[0]!.can).toContain('retract') // carla has an event of her own to take back
    git(repo, 'config user.email stranger@example.test')
    const res = await app.request('/api/proposals')
    expect(res.status).toBe(200)
    const [v] = await res.json()
    expect(v).toMatchObject({ id, can: [], needsYou: false, derived: 'approving' })
  })

  it('cannot: for each event the machine refuses the actor now, its sentence, so a disabled action can say why (spec §3.14); none for one who only reads', async () => {
    setup()
    const id = await propose('bruno')
    for (const who of ['ana', 'bruno', 'carla']) {
      const v = (await list(who))[0]!
      const cannot = v.cannot as Record<string, string>
      // every event a member could ask for is either enabled or refused with a sentence, never both
      expect([...v.can as string[], ...Object.keys(cannot)].sort()).toEqual(machine.events.filter(t => t !== 'TRUNK_MOVED').map(t => (t === 'REPLAYED' ? 'replay' : t.toLowerCase())).sort())
      for (const k of v.can as string[]) expect(cannot[k]).toBeUndefined()
      for (const text of Object.values(cannot)) expect(text).toMatch(/\S/)
    }
    const carla = (await list('carla'))[0]!.cannot as Record<string, string>
    expect(carla.revise).toBe(`only the author of a proposal can revise it; this one is "bruno"'s.`)
    expect(carla.withdraw).toBe('only its author can withdraw a proposal')
    expect(carla.ratify).toBe('its rule is not met yet')
    expect(carla.vote).toBe("That can't be done now: Open: waiting for approvals.")
    const bruno = (await list('bruno'))[0]!.cannot as Record<string, string>
    expect(bruno.approve).toMatch(/^"bruno" wrote this proposal and cannot approve their own proposal/)
    git(repo, 'config user.email stranger@example.test')
    const [v] = await (await app.request('/api/proposals')).json()
    expect(v).toMatchObject({ can: [], cannot: {} })
  })

  it('branchState is missing when the branch could not be built; derived is stale and stale names the op when the trunk changed its record', async () => {
    setup()
    failBuild = true
    const id = await propose('bruno')
    expect((await list('carla'))[0]).toMatchObject({ branchState: 'missing', derived: 'approving', stale: [] })
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('lead: "bruno"', 'lead: "carla"'))
    git(repo, 'commit -qam "the trunk moves the project\'s lead"')
    const v = (await list('carla'))[0]!
    expect(v).toMatchObject({ derived: 'stale', stale: [0], needsYou: false })
    expect(v.can).not.toContain('approve')
  })

  it('a closed proposal is listed with its final state; it needs nobody, and nothing can be written to it', async () => {
    setup()
    const id = await propose('bruno')
    expect((await send('bruno', id, { kind: 'withdraw' })).status).toBe(200)
    expect((await list('carla'))[0]).toMatchObject({ id, state: 'withdrawn', derived: 'withdrawn', needsYou: false, can: [] })
  })

  it('no ledger: an empty list', async () => {
    setup()
    expect(await list('carla')).toEqual([])
  })
})

describe('GET /api/proposals/:id', () => {
  it('adds the diff git gives for <trunk>...proposal/<id>, and moves nothing', async () => {
    setup()
    const id = await propose('bruno')
    const before = snapshot()
    const res = await view('carla', id)
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(v).toMatchObject({ id, derived: 'approving', branchState: 'built', needsYou: true, ops: entry(id).ops, events: [] })
    expect(v.diff).toBe(git(repo, `diff main...proposal/${id}`))
    expect(v.diff).toContain('+    status: "develop"')
    as('bruno') // the snapshot was taken as bruno; only the identity the requests were made as differs
    expect(snapshot()).toBe(before)
  })

  it('current: each op\'s record as the trunk holds it now (null for a create), so the page can draw what an op changes and what a stale one now finds', async () => {
    setup()
    const id = await propose('bruno', [STATUS, { op: 'create', record: 'projects:proj-009', value: { title: 'New', status: 'idea', type: 'program', lead: 'ana' } }])
    const v = await (await view('carla', id)).json()
    expect(v.current).toEqual([project(), null])
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('lead: "bruno"', 'lead: "carla"'))
    git(repo, 'commit -qam "the trunk moves the project\'s lead"')
    const stale = await (await view('carla', id)).json()
    expect(stale).toMatchObject({ derived: 'stale', stale: [0] })
    expect(stale.current[0]).toMatchObject({ id: 'proj-001', lead: 'carla' })
  })

  it('a missing branch is built first, on the trunk tip, and then diffed', async () => {
    setup()
    failBuild = true
    const id = await propose('bruno')
    expect(git(repo, `branch --list proposal/${id}`).trim()).toBe('')
    failBuild = false
    const commitsBefore = commits()
    const v = await (await view('carla', id)).json()
    expect(v.branchState).toBe('built')
    expect(git(repo, `rev-parse proposal/${id}^`).trim()).toBe(head())
    expect(v.diff).toBe(git(repo, `diff main...proposal/${id}`))
    expect(v.diff).toContain('+    status: "develop"')
    expect(commits()).toBe(commitsBefore) // building the cache writes no commit on the trunk
  })

  it('a branch that cannot be built leaves the diff null, and says why', async () => {
    setup()
    failBuild = true
    const id = await propose('bruno')
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('lead: "bruno"', 'lead: "carla"'))
    git(repo, 'commit -qam "the trunk moves the project\'s lead"')
    failBuild = false
    const v = await (await view('carla', id)).json()
    expect(v).toMatchObject({ derived: 'stale', branchState: 'missing', diff: null })
    expect(v.note).toMatch(/proposal\/p-2026-10-18-001-[0-9a-f]{4} could not be built.*changed on the trunk/)
  })

  it('a branch whose ops do not validate on the trunk: the note names the field error, and carries no local path (fix round 1)', async () => {
    setup()
    failBuild = true
    const id = await propose('bruno', [{ op: 'update', record: 'projects:proj-001', set: { lead: 'carla' } }])
    failBuild = false
    // the trunk removes carla: the op's record did not change (not stale), but its value now names no member
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS.replace(/  - \{ id: carla.*\n/, ''))
    git(repo, 'commit -qam "carla leaves"')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const v = await (await view('bruno', id)).json()
    expect(v).toMatchObject({ diff: null, stale: [] })
    expect(v.note).toMatch(/^There is no diff to show: proposal\/p-2026-10-18-001-[0-9a-f]{4} could not be built: projects:proj-001 · lead: /)
    expect(v.note).toMatch(/carla/)
    expect(v.note).not.toMatch(/the change has 1 error/)
    expect(v.note).not.toContain(tmpdir())
    expect(v.note).not.toMatch(/worktree/)
    // the path is for whoever runs the server: it is logged there
    expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toMatch(/ran in the worktree .*proposals.*, which was removed/)
    warn.mockRestore()
  })

  it('404 for a proposal the ledger does not hold', async () => {
    setup()
    await propose('bruno')
    const res = await view('carla', 'p-2026-10-18-009')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('The ledger has no proposal p-2026-10-18-009.')
  })
})

describe('every proposal route answers a ProposalView (fix round 1)', () => {
  /** The view's own fields, and `branch` only as the ledger's name for the branch. */
  const isView = (v: Record<string, unknown>, id: string) => {
    expect(v).toMatchObject({ id, branch: `proposal/${id}`, derived: expect.any(String), stale: expect.any(Array), needsYou: expect.any(Boolean), can: expect.any(Array) })
    expect(['built', 'missing']).toContain(v.branchState)
    expect(v.rules).toEqual([expect.objectContaining({ sentence: describeRule(RULE), source: `data/proposals.yaml ${id} rules: records` })])
    expect(v.evaluation).toMatchObject({ state: expect.any(String), parts: expect.any(Array) })
  }
  it('propose (201), events, revise, replay, ratify (with commit and decision), close and a withdraw', async () => {
    setup()
    as('bruno')
    expect((await app.request('/api/changes/ops', json({ ops: [STATUS] }))).status).toBe(200)
    const opened = await app.request('/api/proposals', json({ title: 'Move one project' }))
    expect(opened.status).toBe(201)
    const first = await opened.json()
    const id = first.id
    isView(first, id)
    expect(first).toMatchObject({ commit: expect.stringMatching(/^[0-9a-f]{40}$/), needsYou: false })
    const commented = await (await send('carla', id, { kind: 'comment', text: 'Looking.' })).json()
    isView(commented, id)
    expect(commented.commit).toBe(head())
    const revised = await (await revise('bruno', id, [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop', title: 'Renamed' }, base: baseOf(project()) }])).json()
    isView(revised, id)
    addProject() // the trunk changes the ops' file, so a mechanical replay is offered (final review I4)
    const replayed = await (await replay('carla', id)).json()
    isView(replayed, id)
    isView(await (await send('carla', id, { kind: 'approve' })).json(), id)
    as('carla'); tick()
    const ratified = await app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status).toBe(200)
    const r = await ratified.json()
    isView(r, id)
    expect(r).toMatchObject({ state: 'ratified', derived: 'ratified', commit: head(), decision: expect.anything() })

    const second = await propose('bruno', [{ op: 'update', record: 'projects:proj-001', set: { status: 'execute' } }])
    const closed = await (async () => { as('bruno'); tick(); return app.request(`/api/proposals/${second}/close`, json({ outcome: 'withdrawn' })) })()
    expect(closed.status).toBe(200)
    const c = await closed.json()
    expect(c).toMatchObject({ id: second, state: 'withdrawn', derived: 'withdrawn', branch: `proposal/${second}`, commit: head(), can: [] })
    const third = await propose('bruno', [{ op: 'update', record: 'projects:proj-001', set: { status: 'pause' } }])
    const withdrawn = await (await send('bruno', third, { kind: 'withdraw' })).json()
    expect(withdrawn).toMatchObject({ id: third, derived: 'withdrawn', branch: `proposal/${third}`, branchState: 'built', commit: head() })
  })
})

describe('POST /api/proposals/:id/revise', () => {
  const renamed = () => [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop', title: 'Renamed' }, base: baseOf(project()) }]

  it('the author’s new ops: one commit with a revise event and the new rev, the branch rebuilt; approvals on the old rev stop counting', async () => {
    setup()
    const id = await propose('bruno')
    const oldRev = entry(id).rev
    expect((await send('carla', id, { kind: 'approve' })).status).toBe(200)
    expect((await list('carla'))[0]!.evaluation).toMatchObject({ state: 'met' })
    const before = commits()
    const trunk = head()
    const ops = renamed()
    const res = await revise('bruno', id, ops)
    expect(res.status).toBe(200)
    const ledgerOps = ops
    const rev = revOf(ledgerOps)
    expect(rev).not.toBe(oldRev)
    expect(commits()).toBe(before + 1)
    expect(git(repo, 'diff --name-only HEAD~1 HEAD').trim()).toBe('data/proposals.yaml')
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD'))).toEqual({ actor: 'bruno', rule: 'records/approve', proposal: id })
    const e = entry(id)
    expect(e).toMatchObject({ rev, ops: ledgerOps, base: trunk })
    expect(e.events.at(-1)).toMatchObject({ kind: 'revise', by: 'bruno', rev, ops: ledgerOps, at: clock.toISOString().replace('.000Z', 'Z') })
    // the approval is still in the ledger, on the old rev, and the evaluator does not count it
    expect(e.events.find(x => x.kind === 'approve')).toMatchObject({ by: 'carla', rev: oldRev })
    expect(liveEvents(e as never).some(x => x.kind === 'approve')).toBe(false)
    const v = await res.json()
    expect(v).toMatchObject({ id, rev, derived: 'approving', branchState: 'built', commit: head() })
    expect(v.evaluation).toMatchObject({ state: 'pending' })
    expect((await list('carla'))[0]!.needsYou).toBe(true)
    // the branch holds the new content, built on the trunk tip the revision was checked against
    expect(git(repo, `rev-parse proposal/${id}^`).trim()).toBe(trunk)
    expect(git(repo, `show proposal/${id}:data/projects.yaml`)).toContain('title: "Renamed"')
  })

  it('only the author revises: anyone else is the machine’s refusal (409 REFUSED), and nothing is written', async () => {
    setup()
    const id = await propose('bruno')
    const before = commits()
    const res = await revise('carla', id, renamed())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REFUSED', machine: 'proposal', event: 'REVISE', reason: expect.stringContaining('only the author') })
    expect(commits()).toBe(before)
  })

  it('refuses in words, before anything is written: a stale op, ops that do not validate, a class its rules do not cover, ops that change nothing, a ledger op', async () => {
    setup()
    const id = await propose('bruno')
    const before = commits()
    const stale = await revise('bruno', id, [{ ...renamed()[0], base: 'not-the-base' }])
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'STALE', stale: [0], error: expect.stringMatching(/Not revised.*Nothing was written/) })
    const invalid = await revise('bruno', id, [{ op: 'update', record: 'projects:proj-001', set: { lead: 'nobody' }, base: baseOf(project()) }])
    expect(invalid.status).toBe(422)
    expect((await invalid.json()).errors).toEqual([{ record: 'projects:proj-001', field: 'lead', message: expect.stringMatching(/nobody/) }])
    const member = readRegistry(repo, 'members').entries!.find(m => m.id === 'ana')!
    const other = await revise('bruno', id, [{ op: 'update', record: 'members:ana', set: { name: 'Ana Maria' }, base: baseOf(member) }])
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: 'CLASSES', error: expect.stringMatching(/members:ana.*records/) })
    const same = await revise('bruno', id, entry(id).ops)
    expect(same.status).toBe(409)
    expect(await same.json()).toMatchObject({ code: 'UNCHANGED' })
    const ledger = await revise('bruno', id, [{ op: 'update', record: `proposals:${id}`, set: { title: 'x' }, base: null }])
    expect(ledger.status).toBe(422)
    expect((await revise('bruno', id, [])).status).toBe(400)
    expect((await revise('bruno', id, [{ op: 'update', record: 'projects:proj-001', set: { title: 'x' } }])).status).toBe(400) // no base
    expect(commits()).toBe(before)
  })

  it('a branch that cannot be built leaves the revision, and says the branch will be built', async () => {
    setup()
    const id = await propose('bruno')
    failBuild = true
    const res = await revise('bruno', id, renamed())
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(v).toMatchObject({ rev: revOf(renamed()) })
    expect(v.note).toMatch(/revised, but its branch proposal\/p-2026-10-18-001-[0-9a-f]{4} could not be built \(the disk is full\)\. The branch will be built again/)
    expect(entry(id).rev).toBe(revOf(renamed()))
    // the old tip still stands, built from the old rev: it is outdated, so it reads missing, and the page builds it again
    expect(git(repo, `branch --list proposal/${id}`).trim()).not.toBe('')
    expect(v.branchState).toBe('missing')
    expect((await list('carla'))[0]!.branchState).toBe('missing')
    failBuild = false
    const page = await (await view('carla', id)).json()
    expect(page.branchState).toBe('built')
    expect(page.diff).toBe(git(repo, `diff main...proposal/${id}`))
    expect(page.diff).toContain('+    title: "Renamed"')
    expect(git(repo, `log -1 --format=%B proposal/${id}`)).toContain(`Built from rev ${revOf(renamed())} of the proposal's ops.`)
  })

  it('reads the last fetch first, as Propose does: a remote never fetched is Sync first', async () => {
    setup()
    const id = await propose('bruno')
    const bare = mkdtempSync(join(tmpdir(), 'view-remote-'))
    temps.push(bare)
    execSync('git init -q --bare', { cwd: bare, stdio: 'pipe' })
    git(repo, `remote add origin ${bare}`)
    const before = commits()
    const res = await revise('bruno', id, renamed())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'SYNC_FIRST' })
    expect(commits()).toBe(before)
  })
})

describe('POST /api/proposals/:id/replay', () => {
  const TITLED = { op: 'update', record: 'projects:proj-001', set: { title: 'Renamed', status: 'develop' } }
  /** bruno proposes a new title and status; carla approves; the trunk then changes the project's status itself. */
  async function staleProposal(): Promise<string> {
    setup()
    const id = await propose('bruno', [TITLED])
    expect((await send('carla', id, { kind: 'approve' })).status).toBe(200)
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('status: "execute"', 'status: "pause"'))
    git(repo, 'commit -qam "the trunk pauses the project"')
    expect((await list('carla'))[0]!.derived).toBe('stale')
    return id
  }

  it('stale: replay is offered to the author alone; without a choice it is 409 naming the stale ops; anyone else is refused; nothing is written', async () => {
    const id = await staleProposal()
    const before = [commits(), git(repo, 'for-each-ref')]
    expect((await list('carla'))[0]!.can).not.toContain('replay')
    expect((await list('bruno'))[0]!.can).toContain('replay')
    const other = await replay('carla', id)
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: 'REFUSED', machine: 'proposal', state: 'stale', event: 'REPLAYED', reason: expect.stringMatching(/only its author/) })
    const author = await replay('bruno', id)
    expect(author.status).toBe(409)
    expect(await author.json()).toMatchObject({ code: 'STALE', records: ['projects:proj-001'], stale: [0], error: expect.stringMatching(/Keep mine or Take theirs/) })
    expect([commits(), git(repo, 'for-each-ref')]).toEqual(before)
  })

  it('Keep mine, from the author: a replay event, rev unchanged and the approval standing, the branch rebuilt on the trunk tip', async () => {
    const id = await staleProposal()
    const rev = entry(id).rev
    const trunk = head()
    const res = await replay('bruno', id, { choose: 'mine' })
    expect(res.status).toBe(200)
    const e = entry(id)
    expect(e.rev).toBe(rev)
    expect(e.events.at(-1)).toMatchObject({ kind: 'replay', by: 'bruno', base: trunk })
    expect(git(repo, `rev-parse proposal/${id}^`).trim()).toBe(trunk)
    const v = await res.json()
    expect(v).toMatchObject({ id, rev, derived: 'approving', stale: [], branchState: 'built', commit: head() })
    expect(v.evaluation).toMatchObject({ state: 'met' })
  })

  it('Take theirs, from the author: the field the trunk changed is dropped, a revise event with a new rev', async () => {
    const id = await staleProposal()
    const rev = entry(id).rev
    const res = await replay('bruno', id, { choose: 'theirs' })
    expect(res.status).toBe(200)
    const e = entry(id)
    expect(e.rev).not.toBe(rev)
    expect(e.ops).toEqual([expect.objectContaining({ op: 'update', record: 'projects:proj-001', set: { title: 'Renamed' } })])
    expect(e.events.at(-1)).toMatchObject({ kind: 'revise', by: 'bruno', rev: e.rev })
    expect((await res.json()).evaluation).toMatchObject({ state: 'pending' }) // carla's approval was of the old rev
  })

  it('a choice from anyone but the author is refused (409 REFUSED), and nothing is written', async () => {
    const id = await staleProposal()
    const before = commits()
    const res = await replay('carla', id, { choose: 'mine' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REFUSED', machine: 'proposal', reason: expect.stringContaining('only its author') })
    expect(commits()).toBe(before)
  })

  // Final review I4: a mechanical replay is offered, and acts, only when the trunk changed one of the ops' files since the
  // proposal's base; each replay writes an event, which moves the trunk only in the ledger, so the next press has nothing to do.
  it('not stale, the trunk changed an ops file: any member replays it mechanically, a replay event records the base; then it is a fixed point', async () => {
    setup()
    const id = await propose('bruno')
    const rev = entry(id).rev
    expect((await list('carla'))[0]!.can).not.toContain('replay') // only the ledger moved
    addProject()
    const trunk = head()
    expect((await list('carla'))[0]!.can).toContain('replay')
    expect(git(repo, `rev-parse proposal/${id}^`).trim()).not.toBe(trunk)
    const res = await replay('carla', id)
    expect(res.status).toBe(200)
    expect(entry(id).events.at(-1)).toMatchObject({ kind: 'replay', by: 'carla', base: trunk })
    expect(entry(id).rev).toBe(rev)
    expect(git(repo, `rev-parse proposal/${id}^`).trim()).toBe(trunk)
    const v = await res.json()
    expect(v).toMatchObject({ id, rev, derived: 'approving', branchState: 'built', commit: head() })
    // the replay's own commit touched only the ledger: nothing more to replay, and a second press writes nothing
    expect(v.can).not.toContain('replay')
    expect(v.cannot.replay).toBe('Already on the trunk: nothing to replay.')
    const before = [commits(), git(repo, 'for-each-ref'), entry(id).events.length]
    const again = await replay('carla', id)
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'REFUSED', event: 'REPLAYED', error: 'Already on the trunk: nothing to replay.' })
    expect([commits(), git(repo, 'for-each-ref'), entry(id).events.length]).toEqual(before)
  })

  it('not stale and the trunk changed no ops file: the route answers "Already on the trunk", nothing is written; a choice from anyone but the author is refused; a body that is not a choice is 400', async () => {
    setup()
    failBuild = true
    const id = await propose('bruno')
    failBuild = false
    expect((await (await view('carla', id)).json()).branchState).toBe('built') // the page built it, on the trunk tip, with no commit
    writeFileSync(join(repo, 'notes.txt'), 'the trunk moves elsewhere'); git(repo, 'add notes.txt'); git(repo, 'commit -qm "a note"')
    const before = [commits(), git(repo, 'for-each-ref'), entry(id).events.length]
    const res = await replay('carla', id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REFUSED', event: 'REPLAYED', error: 'Already on the trunk: nothing to replay.' })
    expect([commits(), git(repo, 'for-each-ref'), entry(id).events.length]).toEqual(before)
    const chose = await replay('carla', id, { choose: 'mine' }) // nothing to replay, whoever asks and with whatever choice
    expect(chose.status).toBe(409)
    expect(await chose.json()).toMatchObject({ code: 'REFUSED', event: 'REPLAYED', reason: 'Already on the trunk: nothing to replay.' })
    addProject() // now there is something to replay: a choice from anyone but the author is refused as a revision
    const other = await replay('carla', id, { choose: 'mine' })
    expect(other.status).toBe(409)
    expect(await other.json()).toMatchObject({ code: 'REFUSED', event: 'REVISE', reason: expect.stringMatching(/only the author/) })
    expect([commits() - 1, entry(id).events.length]).toEqual([before[0], before[2]])
    expect((await replay('bruno', id, { choose: 'both' })).status).toBe(400)
  })
})

// ── a proposal that waits on a Safe ──────────────────────────────────────────────────────────────────

const ADDR = '0x5afe000000000000000000000000000000005afe'
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: treasury-safe, kind: safe, name: Treasury, chain: "eip155:42220", address: "${ADDR}", driver: safe }
  - { id: wiki, kind: website, name: Wiki, url: "https://wiki.example.test" }
`
const TREASURY_GOV = gov(`- { id: treasury, applies_to: [treasury], propose: member, decide: { by: system, system: treasury-safe } }
    ${RECORDS}`)
const TREASURY_RULE = { id: 'treasury', applies_to: ['treasury'], propose: 'member', decide: { by: 'system', method: 'system', system: 'treasury-safe' } }
const DIR = new URL('./fixtures/safe-outcome/', import.meta.url)
const load = (file: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(file, DIR), 'utf8'))
const API = 'https://api.safe.global/tx-service/celo/api'
const INFO = `${API}/v1/safes/${ADDR}/`
const HASH = '0xb654430c2746c667a0b73282191427a86062e8a20e2e6724371fd853abc52008'
const TX = { to: '0x00000000000000000000000000000000000a11ce', value: '250000000000000000', data: '0x', operation: 0 }
const SAFE_ID = 'p-2026-10-18-001'

/** What the fake service answers (url → body), and every url it was asked for. */
let routes: Record<string, unknown>
let asked: string[]
let failing: string | null
const fetch: FetchLike = async url => {
  asked.push(url)
  const body = routes[url]
  return body === undefined ? { ok: false, status: 404, json: async () => ({ detail: 'Not found.' }) } : { ok: true, status: 200, json: async () => body }
}
const driverCtx = () => ({ fetchJson: guardedFetch(safe, fetch, new AbortController().signal), now: () => clock, members: [], sleep: async () => {} })
/** The outcome reader the page visit gets: the real Safe driver over the fake service, counting its reads. */
let reads = 0
const outcomes = {
  async outcome(system: Record<string, unknown>, ref: SystemRef, opened: string): Promise<OutcomeReading> {
    reads++
    if (failing !== null) return { ok: false, error: failing }
    return safe.outcome!(system, ref, { ...driverCtx(), opened })
  },
}

function setupSafe(systems: 'reader' | 'outcomes' = 'outcomes') {
  repo = makeChangeRepo(TREASURY_GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members and a synthetic Safe"')
  // The reader is the server's own, over the fake service: guardedFetch, the declared host, the pacing.
  const reader = systems === 'reader' ? new SystemReader({ repo, fetch, now: () => clock }) : outcomes
  app = createApp(repo, (a, c) => mountProposals(a, { repo, withLock: c.withLock, startBranch: 'main', now: () => clock, systems: reader as never }))
}
/** A treasury proposal opened by ana directly in the ledger: it holds no ops (the transaction is its content). */
async function openTreasury(id = SAFE_ID, rule: Record<string, unknown> = TREASURY_RULE) {
  await createEntry(repo, {
    id, title: 'Pay the venue', author: 'ana', classes: [String((rule.applies_to as string[])[0])], rules: [rule], state: 'open',
    opened: clock.toISOString().replace('.000Z', 'Z'), rev: revOf([]), base: null, branch: null, ops: [], events: [], closed: null,
  }, { actor: 'ana', rule: `${String(rule.id)}/${String((rule.decide as { method: string }).method)}` }, { now: () => clock, startBranch: 'main' })
}
const prepare = (id: string, body: unknown = TX, who = 'ana') => { as(who); return app.request(`/api/proposals/${id}/prepare`, json(body)) }
async function attach(): Promise<void> {
  const p = await safe.prepare!({ id: 'treasury-safe', kind: 'safe', chain: 'eip155:42220', address: ADDR, driver: 'safe' }, { proposal: { classes: ['treasury'] }, tx: TX as never }, driverCtx())
  if (!p.ok) throw new Error(p.error)
  expect((await send('ana', SAFE_ID, { kind: 'attach', ref: p.ref })).status).toBe(200)
  tick()
}

describe('POST /api/proposals/:id/prepare', () => {
  beforeEach(() => { routes = { [INFO]: load('safe.json') }; asked = []; failing = null; reads = 0 })

  it('reads the Safe’s nonce through the reader, answers the payload, its hash and the Safe app link, and writes nothing', async () => {
    setupSafe('reader')
    await openTreasury()
    const before = snapshot()
    const res = await prepare(SAFE_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      payload: { ...TX, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: '0x0000000000000000000000000000000000000000', refundReceiver: '0x0000000000000000000000000000000000000000', nonce: 8 },
      safeTxHash: HASH,
      appLink: `https://app.safe.global/home?safe=celo:${ADDR}`,
      ref: { system: 'treasury-safe', id: HASH, payload: { to: TX.to, value: TX.value, data_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/), operation: 0, nonce: 8 } },
    })
    expect(asked).toEqual([INFO]) // one GET, to the declared host
    as('ana')
    expect(snapshot()).toBe(before)
  })

  it('refuses, in words: a proposal that waits on no system, a system that is not a Safe, a Safe older than 1.3.0; a body that is not a transaction is 400', async () => {
    setupSafe('reader')
    await openTreasury()
    await openTreasury('p-2026-10-18-002', RULE)
    await openTreasury('p-2026-10-18-003', { ...TREASURY_RULE, id: 'wiki', decide: { by: 'system', method: 'system', system: 'wiki' } })
    const none = await prepare('p-2026-10-18-002')
    expect(none.status).toBe(409)
    expect((await none.json()).error).toMatch(/waits on no outside system/)
    const wiki = await prepare('p-2026-10-18-003')
    expect(wiki.status).toBe(409)
    expect((await wiki.json()).error).toMatch(/"wiki" is not a Safe/)
    expect(asked).toEqual([])
    routes = { [INFO]: { ...load('safe.json'), version: '1.2.0' } }
    const old = await prepare(SAFE_ID)
    expect(old.status).toBe(409)
    expect((await old.json()).error).toMatch(/version 1\.2\.0, older than 1\.3\.0/)
    expect((await prepare(SAFE_ID, { to: TX.to })).status).toBe(400)
    expect((await prepare('p-2026-10-18-009')).status).toBe(404)
  })

  it('a Safe that cannot be read is 502, in words', async () => {
    setupSafe('reader')
    await openTreasury()
    routes = {}
    const res = await prepare(SAFE_ID)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/Not prepared: .*api\.safe\.global answered 404/)
  })
})

describe('GET /api/proposals/:id is the page visit that reads the system (P2-R12)', () => {
  beforeEach(() => {
    routes = { [INFO]: load('safe.json'), [`${API}/v1/multisig-transactions/${HASH}/`]: load('tx-pending.json') }
    asked = []; failing = null; reads = 0
  })

  it('a proposal a system decides offers attach to a member who may propose; POST …/check answers a view', async () => {
    setupSafe()
    await openTreasury()
    expect((await list('ana'))[0]!.can).toContain('attach')
    await attach()
    as('bruno'); tick()
    const res = await app.request(`/api/proposals/${SAFE_ID}/check`, json({}))
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(v).toMatchObject({ id: SAFE_ID, derived: 'approving', stale: [], needsYou: false, branchState: 'missing', appended: true, commit: head(), reading: { ok: true, outcome: 'pending' } })
    expect(v.rules).toEqual([expect.objectContaining({ sentence: describeRule(TREASURY_RULE) })])
  })

  it('with a live attach on its rev, a visit reads and records a system event; another visit within the reader’s window reads nothing; after it, it reads again', async () => {
    setupSafe()
    await openTreasury()
    await attach()
    const before = commits()
    const v = await (await view('bruno', SAFE_ID)).json()
    expect(reads).toBe(1)
    expect(commits()).toBe(before + 1)
    expect(entry(SAFE_ID).events.at(-1)).toMatchObject({ kind: 'system', by: 'system:treasury-safe', outcome: 'pending', confirmations: 1, required: 2 })
    expect(v.evaluation).toMatchObject({ missing: `transaction ${HASH}: 1 of 2 signatures` })
    expect(v.events.at(-1)).toMatchObject({ kind: 'system' })
    tick(10)
    await view('carla', SAFE_ID)
    expect(reads).toBe(1)
    tick(31)
    routes[`${API}/v1/multisig-transactions/${HASH}/`] = load('tx-executed.json')
    const after = await (await view('carla', SAFE_ID)).json()
    expect(reads).toBe(2)
    expect(commits()).toBe(before + 2)
    expect(after.evaluation).toMatchObject({ state: 'met' })
  })

  it('a failed read records nothing, and the view carries attention', async () => {
    setupSafe()
    await openTreasury()
    await attach()
    failing = 'api.safe.global could not be reached (getaddrinfo ENOTFOUND)'
    const before = commits()
    const res = await view('bruno', SAFE_ID)
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(commits()).toBe(before)
    expect(v.attention).toEqual({ level: 'warn', text: 'read failed: api.safe.global could not be reached (getaddrinfo ENOTFOUND)' })
  })

  it('check: whether Check now may read, from the same guards as POST …/check (fix round 1)', async () => {
    setupSafe()
    await openTreasury()
    const check = async (who: string) => (await (await view(who, SAFE_ID)).json()).check
    expect(await check('bruno')).toBe('Nothing is attached to read yet.')
    await attach()
    expect(await check('bruno')).toBe(true)
    git(repo, 'config user.email stranger@example.test')
    expect((await (await app.request(`/api/proposals/${SAFE_ID}`)).json()).check).toMatch(/only a member/)
    expect((await send('ana', SAFE_ID, { kind: 'withdraw' })).status).toBe(200)
    expect(await check('bruno')).toMatch(/^That can't be done now: Withdrawn/)
  })

  it('check, for a proposal people decide: the sentence POST …/check answers', async () => {
    setup()
    const id = await propose('bruno')
    expect((await list('carla'))[0]!.check).toBe(`Nothing to check: proposal ${id} waits on no outside system; its rules are decided by people.`)
  })

  it('reads nothing with no attach, for a visitor no member holds, or for a closed proposal', async () => {
    setupSafe()
    await openTreasury()
    await view('bruno', SAFE_ID)
    expect(reads).toBe(0)
    await attach()
    git(repo, 'config user.email stranger@example.test')
    expect((await app.request(`/api/proposals/${SAFE_ID}`)).status).toBe(200)
    expect(reads).toBe(0)
    expect((await send('ana', SAFE_ID, { kind: 'withdraw' })).status).toBe(200)
    tick(60)
    await view('bruno', SAFE_ID)
    expect(reads).toBe(0)
  })
})

// ── the adapter ────────────────────────────────────────────────────────────────────────────────────

describe('the proposals adapter: proposals as resources', () => {
  const graph = () => readResources(repo, { now: () => clock })

  it('kind proposal on the Organization board, an edge touches to each record its ops name and proposed-by to its author, warn while open', async () => {
    setup()
    const id = await propose('bruno')
    const g = await graph()
    const node = g.nodes.find(n => n.id === `proposal:${id}`)
    expect(node).toMatchObject({
      kind: 'proposal', board: 'organization', name: 'Move one project', status: 'approving',
      attention: { level: 'warn', text: 'open: needs 1 more approval from a maintainer other than the author' },
      source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: id },
    })
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: `proposal:${id}`, to: 'project:proj-001', kind: 'touches' },
      { from: `proposal:${id}`, to: 'person:bruno', kind: 'proposed-by' },
    ]))
  })

  it('alert when stale, alert when a window closes within a day; a closed proposal asks nothing', async () => {
    setup(gov(RECORDS.replace('propose: member,', 'propose: member, expires: PT20H,')))
    const id = await propose('bruno')
    const soon = (await graph()).nodes.find(n => n.id === `proposal:${id}`)!
    expect(soon.attention).toEqual({ level: 'alert', text: 'closes in 20 hours: needs 1 more approval from a maintainer other than the author' })
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('lead: "bruno"', 'lead: "carla"'))
    git(repo, 'commit -qam "the trunk moves the project\'s lead"')
    const stale = (await graph()).nodes.find(n => n.id === `proposal:${id}`)!
    expect(stale).toMatchObject({ status: 'stale', attention: { level: 'alert', text: 'stale: 1 op was staged against a record that has changed' } })
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
    git(repo, 'commit -qam "the lead is back"')
    expect((await send('bruno', id, { kind: 'withdraw' })).status).toBe(200)
    const closed = (await graph()).nodes.find(n => n.id === `proposal:${id}`)!
    expect(closed).toMatchObject({ status: 'withdrawn', attention: null })
  })

  it('no ledger: no proposal resources and no card', async () => {
    setup()
    const g = await graph()
    expect(g.nodes.filter(n => n.kind === 'proposal' || n.id.includes('proposals'))).toEqual([])
  })
})
