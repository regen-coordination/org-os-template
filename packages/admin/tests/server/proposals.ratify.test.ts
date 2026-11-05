import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals, type ProposalRoutesDeps } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { resolveRoles } from '../../lib/rules.mjs'

// POST /api/proposals/:id/ratify (0.6 P2 spec §3.8): a met proposal becomes one merge commit. Every test builds a
// throwaway repository under the temp directory (makeChangeRepo), with synthetic members ana, bruno and carla (and
// bot, an agent); a remote, where one is needed, is a bare repository in the temp directory. Nothing here touches a
// real instance. The clock is injected, anchored near the real now, so a commit's real date and the clock agree
// within CLOCK_SKEW.
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
const DECISIONS_MD = `# Decisions

## Conventions

Newest first. Each entry has an id, LD-<year>-<NNN>.

---

## 2026-10-01 · LD-2026-001 — The first decision

**Status:** active
`
// bruno decides; carla is a member who neither decides nor (in these tests) writes the proposal.
const gov = (rule: string) =>
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n    ${rule}\n  decisions: []\n`
const APPROVE = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }')
const CONSENT = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: consent, window: PT1M } }')

/** A whole second two minutes before the real now: the clock the tests start from. */
const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
const STATEMENT = { title: 'Develop the onboarding program', decision: 'proj-001 moves to develop.', why: 'It is ready.', scope: 'records' }

let repo: string
let app: Hono
let clock: Date
let ID = ''
const extra: string[] = []

function setup(governance = APPROVE, deps: Partial<ProposalRoutesDeps> = {}, startBranch = 'main') {
  repo = makeChangeRepo(governance)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  writeFileSync(join(repo, 'DECISIONS.md'), DECISIONS_MD)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members and a decisions log"')
  mount(deps, startBranch)
}
function mount(deps: Partial<ProposalRoutesDeps> = {}, startBranch = 'main') {
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch, now: () => clock, ...deps }))
}
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
beforeEach(() => { clock = new Date(BASE); ID = '' })
afterEach(() => { removeFixtureRepo(repo); for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true }) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }
const sha = (rev = 'HEAD') => git(repo, `rev-parse ${rev}`).trim()
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

/** ana proposes one change to a project (with a statement unless told not to); returns its id. */
async function propose(statement: boolean = true): Promise<string> {
  as('ana')
  expect((await app.request('/api/changes/ops', json({ ops: [PROJECT] }))).status).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Move one project', ...(statement ? { statement: STATEMENT } : {}) }))
  expect(res.status).toBe(201)
  ID = (await res.json()).id
  return ID
}
const approve = async () => { tick(); as('bruno'); expect((await app.request(`/api/proposals/${ID}/events`, json({ kind: 'approve' }))).status).toBe(200) }
const ratify = (who: string, body: unknown = {}) => { as(who); return app.request(`/api/proposals/${ID}/ratify`, json(body)) }

/** Every tracked file's bytes, the status and HEAD: "the repository is as it was". */
const snapshot = () => ({
  head: sha(),
  files: execSync('git ls-files -z | xargs -0 shasum', { cwd: repo, stdio: 'pipe' }).toString(),
  status: git(repo, 'status --porcelain --untracked-files=no'),
  merging: existsSync(join(repo, '.git', 'MERGE_HEAD')),
})
async function refused(res: Response, status: number, error: RegExp): Promise<Record<string, unknown>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  expect(String(body.error)).toMatch(error)
  return body
}

/** What `validate:governance` will compute for the merge commit (Task 14a): the ledger in that commit, evaluated at the commit's own date. */
function evaluatedAtCommit(rev = 'HEAD') {
  const at = git(repo, `log -1 --format=%cI ${rev}`).trim()
  const ledger = parse(git(repo, `show ${rev}:data/proposals.yaml`)).proposals
  const entry = ledger.find((p: { id: string }) => p.id === ID)
  const book = resolveRoles(parse(git(repo, `show ${rev}:data/governance.yaml`)).governance, parse(git(repo, `show ${rev}:data/members.yaml`)).members)
  return { at, evaluation: evaluateAll({ proposal: entry, book, now: new Date(at) }) }
}

describe('POST /api/proposals/:id/ratify: one merge commit', () => {
  it('a met proposal ratifies into one merge commit: two parents, the trailers, the records, the ledger, the row, the DECISIONS.md entry, and nothing else', async () => {
    setup(); await propose(); await approve()
    // the trunk moves after the branch was built: a file nobody proposes changes on it
    writeFileSync(join(repo, 'notes.txt'), 'the trunk moved\n'); git(repo, 'add notes.txt'); git(repo, 'commit -qm "trunk: a note"')
    tick()
    const T = sha()
    const res = await ratify('bruno')
    const view = await res.json()
    expect(res.status, JSON.stringify(view)).toBe(200)

    // one merge commit, first parent the old trunk tip, second the branch, whose parent is that tip
    const merge = sha()
    const C = sha(`refs/heads/proposal/${ID}`)
    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toEqual([merge, T, C])
    expect(sha(`${C}^`)).toBe(T)
    expect(git(repo, `rev-list --count ${T}..HEAD --first-parent`).trim()).toBe('1')
    const date = iso(clock.getTime()).slice(0, 10)
    const decision = `gov-${date.replace(/-/g, '')}-001`
    expect(git(repo, 'log -1 --format=%s').trim()).toBe(`proposals: ratify ${ID} — Move one project`)
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({ actor: 'bruno', rule: 'records/approve', proposal: ID, decision })
    expect(view).toMatchObject({ id: ID, state: 'ratified', commit: merge, branchState: 'built', decision: { id: decision } })
    expect(view.evaluation).toMatchObject({ state: 'met' })
    expect(view.can).toEqual([])

    // the records changed
    expect(parse(readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8')).projects[0].status).toBe('develop')
    // the ledger: ratified, closed, the ratify event
    const entry = readLedger(repo).entries.find(e => e.id === ID)!
    expect(entry.state).toBe('ratified')
    expect(entry.closed).toEqual({ at: iso(clock.getTime()), by: 'bruno', decision })
    expect(entry.events.at(-1)).toMatchObject({ kind: 'ratify', by: 'bruno', at: iso(clock.getTime()) })
    // the decision row
    expect(parse(readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')).governance.decisions).toEqual([{
      id: decision, proposal: ID, rule: 'records', method: 'approve', outcome: 'ratified', status: 'ratified',
      by: ['bruno'], date, title: 'Move one project', summary: '1 approval (bruno); no objection.',
    }])
    // the DECISIONS.md entry, newest first, in the file's own scheme
    const md = readFileSync(join(repo, 'DECISIONS.md'), 'utf8')
    expect(md).toContain(`---\n\n## ${date} · LD-2026-002 — Develop the onboarding program\n`)
    expect(md).toContain(`**Refs** — proposal ${ID}, decision ${decision} in data/governance.yaml`)
    expect(md.indexOf('LD-2026-002')).toBeLessThan(md.indexOf('LD-2026-001'))

    // every tracked file outside the ops' file and the three ledger files is byte-identical to the trunk's before
    const changed = git(repo, `diff --name-only ${T} HEAD`).trim().split('\n').sort()
    expect(changed).toEqual(['DECISIONS.md', 'data/governance.yaml', 'data/projects.yaml', 'data/proposals.yaml'])
    for (const file of git(repo, `ls-tree -r --name-only ${T}`).trim().split('\n').filter(f => !changed.includes(f))) {
      expect(git(repo, `rev-parse HEAD:${file}`), file).toBe(git(repo, `rev-parse ${T}:${file}`))
    }
    expect(git(repo, 'status --porcelain --untracked-files=no')).toBe('')
    // generate:schemas was not run: nothing under .well-known changed (P2-R20)
    expect(changed.some(f => f.startsWith('.well-known/'))).toBe(false)
    // validate:governance, reading the commit's date, says met
    expect(evaluatedAtCommit().evaluation.state).toBe('met')
  })

  it('without a statement, DECISIONS.md is not touched; the author may ratify', async () => {
    setup(); await propose(false); await approve(); tick()
    const T = sha()
    const res = await ratify('ana')
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    expect(git(repo, `diff --name-only ${T} HEAD`).trim().split('\n').sort()).toEqual(['data/governance.yaml', 'data/projects.yaml', 'data/proposals.yaml'])
    expect(parseTrailers(git(repo, 'log -1 --format=%B')).actor).toBe('ana')
  })

  it('is evaluated at the whole-second floor of the server’s clock (LOW-5): at .700 a window ending at .500 closes in 1 second; at the next second it ratifies, and the commit’s date says met', async () => {
    setup(CONSENT)
    // W is a whole second in the past, so the commit's real date is later than any clock below
    const W = Math.floor(Date.now() / 1000) * 1000 - 10_000
    clock = new Date(W - 120_000)
    await propose()
    // the window (PT1M) ends at W + 0.500: the proposal is written as opened 60 seconds before that, to the millisecond
    const entry = readLedger(repo).entries[0]!
    const opened = new Date(W + 500 - 60_000).toISOString()
    const path = join(repo, 'data', 'proposals.yaml')
    const text = readFileSync(path, 'utf8')
    expect(text.split(entry.opened).length).toBe(2)
    writeFileSync(path, text.replace(entry.opened, opened)); git(repo, 'commit -qam "fixture: opened to the millisecond"')
    expect(readLedger(repo).entries[0]!.opened).toBe(opened)

    clock = new Date(W + 700)
    const before = snapshot()
    await refused(await ratify('bruno'), 409, /closes in 1 second/)
    expect(snapshot()).toEqual(before)

    clock = new Date(W + 1000)
    const res = await ratify('bruno')
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    expect(readLedger(repo).entries[0]!.closed).toMatchObject({ at: iso(W + 1000) })
    const { at, evaluation } = evaluatedAtCommit()
    expect(Date.parse(at)).toBeGreaterThanOrEqual(W + 1000)
    expect(Math.abs(Date.parse(at) - clock.getTime())).toBeLessThan(10 * 60e3)
    expect(evaluation.state).toBe('met')
  })
})

describe('refusals: each leaves the repository as it was', () => {
  /** A met proposal, ready to ratify. */
  async function ready(governance = APPROVE) { setup(governance); await propose(); await approve(); tick() }

  it('not met: the sentence says what is missing', async () => {
    setup(); await propose(); tick()
    const before = snapshot()
    await refused(await ratify('bruno'), 409, /needs 1 more approval from a maintainer other than the author/)
    expect(snapshot()).toEqual(before)
  })
  it('the client claiming met counts for nothing', async () => {
    setup(); await propose(); tick()
    const before = snapshot()
    await refused(await ratify('bruno', { state: 'met', evaluation: { state: 'met', missing: '' } }), 409, /needs 1 more approval/)
    expect(snapshot()).toEqual(before)
  })
  it('a dirty tree', async () => {
    await ready()
    writeFileSync(join(repo, 'data', 'ideas.yaml'), `${readFileSync(join(repo, 'data', 'ideas.yaml'), 'utf8')}# edited\n`)
    const before = snapshot()
    const body = await refused(await ratify('bruno'), 409, /data\/ideas\.yaml has changes that are not committed/)
    expect(body.code).toBe('DIRTY')
    expect(snapshot()).toEqual(before)
  })
  it('a merge already in progress (the MERGE_HEAD file)', async () => {
    await ready()
    git(repo, 'checkout -q -b side'); git(repo, 'commit -q --allow-empty -m side'); git(repo, 'checkout -q main')
    git(repo, 'merge -q --no-ff --no-commit side')
    const before = snapshot()
    expect(before.merging).toBe(true)
    const body = await refused(await ratify('bruno'), 409, /a merge is already in progress/)
    expect(body.code).toBe('MERGE_IN_PROGRESS')
    expect(snapshot()).toEqual(before)
  })
  it('HEAD off the trunk', async () => {
    await ready()
    git(repo, 'checkout -q -b elsewhere')
    const before = snapshot()
    expect((await refused(await ratify('bruno'), 409, /on the branch "elsewhere".*"main"/)).code).toBe('OFF_TRUNK')
    expect(snapshot()).toEqual(before)
  })
  it('an invalid trunk name, and a trunk branch named MERGE_HEAD (LOW-2)', async () => {
    await ready()
    for (const name of ['+main', 'MERGE_HEAD']) {
      git(repo, `checkout -q -b ${name} main`)
      mount({}, name)
      const before = snapshot()
      expect((await refused(await ratify('bruno'), 409, new RegExp(`"${name.replace('+', '\\+')}" cannot be the trunk`))).code).toBe('TRUNK')
      expect(snapshot()).toEqual(before)
      expect(before.merging).toBe(false)
      git(repo, 'checkout -q main')
    }
  })
  describe('the last fetch', () => {
    let remote: string
    function withRemote() {
      remote = mkdtempSync(join(tmpdir(), 'ratify-remote-')); extra.push(remote)
      execSync('git init -q --bare -b main', { cwd: remote, stdio: 'pipe' })
      git(repo, `remote add origin ${remote}`); git(repo, 'push -q origin main'); git(repo, 'fetch -q origin')
    }
    const fetchedAt = (minutesAgo: number) => { const t = new Date(clock.getTime() - minutesAgo * 60e3); utimesSync(join(repo, '.git', 'FETCH_HEAD'), t, t) }
    it('older than PT15M: Sync first', async () => {
      setup(); withRemote(); fetchedAt(1); await propose(); await approve(); tick()
      fetchedAt(20)
      const before = snapshot()
      const body = await refused(await ratify('bruno'), 409, /^Sync first: the last fetch was 20 minutes ago, and a proposal is ratified on a fetch no older than 15 minutes/)
      expect(body.code).toBe('SYNC_FIRST')
      expect(snapshot()).toEqual(before)
    })
    it('the remote ahead: Sync first, counting the commits', async () => {
      setup(); withRemote(); fetchedAt(1); await propose(); await approve(); tick()
      const other = mkdtempSync(join(tmpdir(), 'ratify-clone-')); extra.push(other)
      execSync(`git clone -q ${remote} ${other}`, { stdio: 'pipe', cwd: tmpdir() })
      const run = (c: string) => execSync(`git ${c}`, { cwd: other, stdio: 'pipe' })
      run('config user.email carla@example.test'); run('config user.name carla')
      run('commit -q --allow-empty -m "remote one"'); run('push -q origin main')
      git(repo, 'fetch -q origin'); fetchedAt(1)
      const before = snapshot()
      await refused(await ratify('bruno'), 409, /^Sync first: the remote has 1 commit you have not merged/)
      expect(snapshot()).toEqual(before)
    })
  })
  it('the clock behind the ledger', async () => {
    await ready()
    clock = new Date(clock.getTime() - 3600e3)
    const before = snapshot()
    expect((await refused(await ratify('bruno'), 409, /clock is .* behind the newest event/)).code).toBe('CLOCK')
    expect(snapshot()).toEqual(before)
  })
  it('a stale proposal: the trunk changed the record under its op', async () => {
    await ready()
    const path = join(repo, 'data', 'projects.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('Node Onboarding Program', 'Node Onboarding')); git(repo, 'commit -qam "trunk: renamed by hand"')
    const before = snapshot()
    const body = await refused(await ratify('bruno'), 409, /./)
    expect(body).toMatchObject({ code: 'REFUSED', machine: 'proposal', state: 'stale', event: 'RATIFY' })
    expect(snapshot()).toEqual(before)
  })
  it('by an agent', async () => {
    await ready()
    const before = snapshot()
    expect(await refused(await ratify('bot'), 409, /an agent never decides/)).toMatchObject({ code: 'REFUSED', event: 'RATIFY' })
    expect(snapshot()).toEqual(before)
  })
  it('by a member who neither decides nor wrote it', async () => {
    await ready()
    const before = snapshot()
    expect(await refused(await ratify('carla'), 409, /only the author or one of the people who decide this proposal can ratify it/)).toMatchObject({ code: 'REFUSED' })
    expect(snapshot()).toEqual(before)
  })
  it('the change already in the trunk: nothing to merge', async () => {
    setup(APPROVE, { ratifyGit: { isAncestor: async () => true } }); await propose(); await approve(); tick()
    const before = snapshot()
    const body = await refused(await ratify('bruno'), 409, /this change is already in the trunk; there is nothing to merge/)
    expect(body.code).toBe('NOTHING_TO_MERGE')
    expect(snapshot().files).toBe(before.files)
    expect(snapshot().status).toBe('')
    expect(snapshot().head).toBe(before.head)
  })
  it('a proposal that is not in the ledger is 404', async () => {
    setup(); await propose()
    ID = 'p-2001-01-01-001'
    expect((await ratify('bruno')).status).toBe(404)
  })
  it('two ratify calls at once are serialised by the write lock; the second is refused, already ratified', async () => {
    await ready()
    as('bruno')
    const [a, b] = await Promise.all([app.request(`/api/proposals/${ID}/ratify`, json({})), app.request(`/api/proposals/${ID}/ratify`, json({}))])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const second = a.status === 409 ? a : b
    expect((await second.json()).error).toMatch(/already ratified/)
    expect(git(repo, 'log --format=%s').split('\n').filter(s => s.startsWith('proposals: ratify')).length).toBe(1)
  })
})
