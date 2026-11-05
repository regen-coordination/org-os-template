import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { removeFixtureRepo, SYSTEMS_YAML } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals, type ProposalRoutesDeps } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { parseTrailers } from '../../lib/trailers.mjs'

// POST /api/proposals/:id/close (0.6 P2 spec §3.8, the other closings): reject, expire and withdraw are single commits
// on the trunk, no merge. Every test builds a throwaway repository under the temp directory (makeChangeRepo), with
// synthetic members ana, bruno and carla (and bot, an agent); a remote, where one is needed, is a bare repository in the
// temp directory. Nothing here touches a real instance. The clock is injected near the real now.
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
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n    ${rule}\n  decisions: []\n`
const APPROVE = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }')
const VOTE = gov('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: vote, window: PT1M, quorum: 1, threshold: 0.5 } }')

const GOV2 = (rule: string) =>
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno, carla] }\n    member: { all: true }\n  rules:\n    ${rule}\n  decisions: []\n`
const QUORUM2 = GOV2('- { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: vote, window: PT1M, quorum: 2, threshold: 0.5 } }')
const SYSTEM = gov('- { id: records, applies_to: [records], propose: member, decide: { by: system, method: system, system: treasury-safe } }')

const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000
const DAY = 86_400_000
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

let repo: string
let app: Hono
let clock: Date
let ID = ''
const extra: string[] = []

function setup(governance = APPROVE, deps: Partial<ProposalRoutesDeps> = {}) {
  repo = makeChangeRepo(governance)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members"')
  mount(deps)
}
function mount(deps: Partial<ProposalRoutesDeps> = {}) {
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock, ...deps }))
}
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
beforeEach(() => { clock = new Date(BASE); ID = '' })
afterEach(() => { removeFixtureRepo(repo); for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true }) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const tick = (ms = 60_000) => { clock = new Date(clock.getTime() + ms) }
const sha = (rev = 'HEAD') => git(repo, `rev-parse ${rev}`).trim()
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')

async function propose(): Promise<string> {
  as('ana')
  expect((await app.request('/api/changes/ops', json({ ops: [PROJECT] }))).status).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Move one project' }))
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201)
  ID = (await res.json()).id
  return ID
}
const vote = async (who: string, v: string) => { tick(10_000); as(who); const r = await app.request(`/api/proposals/${ID}/events`, json({ kind: 'vote', vote: v })); expect(r.status, JSON.stringify(await r.clone().json())).toBe(200) }
const close = (who: string, outcome: string) => { as(who); return app.request(`/api/proposals/${ID}/close`, json({ outcome })) }

/** Every tracked file's bytes, the status, the index and HEAD: "the repository is as it was". */
const snapshot = () => ({
  head: sha(),
  files: execSync('git ls-files -z | xargs -0 shasum', { cwd: repo, stdio: 'pipe' }).toString(),
  status: git(repo, 'status --porcelain --untracked-files=no'),
  staged: git(repo, 'diff --cached --name-only'),
  merging: existsSync(join(repo, '.git', 'MERGE_HEAD')),
})
async function refused(res: Response, status: number, error: RegExp): Promise<Record<string, unknown>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  expect(String(body.error)).toMatch(error)
  return body
}
/** A failed vote: the one decider (bruno) votes no, which completes the electorate. */
async function failed() { setup(VOTE); await propose(); await vote('bruno', 'no'); tick() }
/** A lapsed one: nobody decides within the default thirty days. */
async function lapsed() { setup(); await propose(); tick(31 * DAY) }
const ROWS = () => parse(readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')).governance.decisions

describe('POST /api/proposals/:id/close', () => {
  it('rejected, for a failed vote: one commit, no merge, the row, the trailers, the branch kept, nothing else touched', async () => {
    await failed()
    const T = sha(); const branch = sha(`refs/heads/proposal/${ID}`)
    const res = await close('bruno', 'rejected')
    const view = await res.json()
    expect(res.status, JSON.stringify(view)).toBe(200)

    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toEqual([sha(), T]) // one parent: no merge
    expect(git(repo, 'log -1 --format=%s').trim()).toBe(`proposals: reject ${ID} — Move one project`)
    const date = iso(clock.getTime()).slice(0, 10)
    const decision = `gov-${date.replace(/-/g, '')}-001`
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({ actor: 'bruno', rule: 'records/vote', proposal: ID, decision })
    expect(view).toMatchObject({ id: ID, state: 'rejected', commit: sha(), decision: { id: decision, outcome: 'rejected' } })
    expect(view.can).toEqual([])

    const entry = readLedger(repo).entries.find(e => e.id === ID)!
    expect(entry.state).toBe('rejected')
    expect(entry.closed).toEqual({ at: iso(clock.getTime()), by: 'bruno', decision })
    expect(entry.events.at(-1)).toMatchObject({ kind: 'reject', by: 'bruno', at: iso(clock.getTime()) })
    expect(ROWS()).toEqual([{
      id: decision, proposal: ID, rule: 'records', method: 'vote', outcome: 'rejected', status: 'rejected',
      by: [], date, title: 'Move one project', summary: '0 yes, 1 no, 0 abstaining.',
    }])
    // the branch is kept, the records are not changed, and only the two ledger files differ from the old tip
    expect(sha(`refs/heads/proposal/${ID}`)).toBe(branch)
    expect(parse(readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8')).projects[0].status).toBe('execute')
    const changed = git(repo, `diff --name-only ${T} HEAD`).trim().split('\n').sort()
    expect(changed).toEqual(['data/governance.yaml', 'data/proposals.yaml'])
    for (const file of git(repo, `ls-tree -r --name-only ${T}`).trim().split('\n').filter(f => !changed.includes(f))) {
      expect(git(repo, `rev-parse HEAD:${file}`), file).toBe(git(repo, `rev-parse ${T}:${file}`))
    }
    expect(git(repo, 'status --porcelain --untracked-files=no')).toBe('')
  })

  it('expired, past the time to live: one commit, an expire event, a row with outcome expired, the branch kept', async () => {
    await lapsed()
    const T = sha(); const branch = sha(`refs/heads/proposal/${ID}`)
    const res = await close('ana', 'expired') // the author may close it
    const view = await res.json()
    expect(res.status, JSON.stringify(view)).toBe(200)
    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toEqual([sha(), T])
    const decision = view.decision.id
    expect(git(repo, 'log -1 --format=%s').trim()).toBe(`proposals: expire ${ID} — Move one project`)
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({ actor: 'ana', rule: 'records/approve', proposal: ID, decision })
    const entry = readLedger(repo).entries.find(e => e.id === ID)!
    expect(entry).toMatchObject({ state: 'expired', closed: { by: 'ana', decision } })
    expect(entry.events.at(-1)).toMatchObject({ kind: 'expire', by: 'ana' })
    expect(ROWS()).toMatchObject([{ id: decision, outcome: 'expired', status: 'expired', method: 'approve', by: [] }])
    expect(sha(`refs/heads/proposal/${ID}`)).toBe(branch)
    expect(git(repo, `diff --name-only ${T} HEAD`).trim().split('\n').sort()).toEqual(['data/governance.yaml', 'data/proposals.yaml'])
  })

  it('expired under a decider’s objection: the row says it was held by the objection, not "no objection"', async () => {
    setup(); await propose(); tick()
    as('bruno'); expect((await app.request(`/api/proposals/${ID}/events`, json({ kind: 'object', text: 'Not yet.' }))).status).toBe(200)
    tick(31 * DAY)
    expect((await close('ana', 'expired')).status).toBe(200)
    expect(ROWS()).toMatchObject([{ outcome: 'expired', summary: '0 approvals; held by an objection (bruno) until it expired.' }])
  })

  it('expired under a system rule: the row does not say it was executed', async () => {
    setup(SYSTEM); writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS_YAML); git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a system"'); await propose(); tick(31 * DAY)
    expect((await close('ana', 'expired')).status).toBe(200)
    expect(ROWS()).toMatchObject([{ outcome: 'expired', method: 'system', summary: 'the system had not executed it before it expired.' }])
  })

  it('P2-R10: a vote whose quorum is not reached by the expiry is expired, with its row', async () => {
    setup(QUORUM2); await propose(); await vote('bruno', 'yes'); tick(31 * DAY)
    const res = await close('carla', 'expired')
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
    expect(ROWS()).toMatchObject([{ outcome: 'expired', status: 'expired', method: 'vote', by: ['bruno'], summary: '1 yes, 0 no, 0 abstaining; it expired without a decision.' }])
    expect(readLedger(repo).entries.find(e => e.id === ID)!.state).toBe('expired')
  })

  it('withdrawn, by the author only: one commit, a withdraw event, no row, no Org-Decision trailer, the branch kept', async () => {
    setup(); await propose(); tick()
    const T = sha(); const branch = sha(`refs/heads/proposal/${ID}`)
    const before = snapshot()
    const other = await refused(await close('bruno', 'withdrawn'), 409, /only its author can withdraw a proposal/)
    expect(other).toMatchObject({ code: 'REFUSED', machine: 'proposal' })
    expect(snapshot()).toEqual(before)

    const res = await close('ana', 'withdrawn')
    const view = await res.json()
    expect(res.status, JSON.stringify(view)).toBe(200)
    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toEqual([sha(), T])
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({ actor: 'ana', rule: 'records/approve', proposal: ID })
    expect(view).toMatchObject({ state: 'withdrawn', commit: sha() })
    expect(readLedger(repo).entries.find(e => e.id === ID)!.closed).toEqual({ at: iso(clock.getTime()), by: 'ana', decision: null })
    expect(ROWS()).toEqual([])
    expect(git(repo, `diff --name-only ${T} HEAD`).trim()).toBe('data/proposals.yaml')
    expect(sha(`refs/heads/proposal/${ID}`)).toBe(branch)
  })

  it('rejected while the evaluation is pending: refused with the machine’s sentence, nothing written', async () => {
    setup(); await propose(); tick()
    const before = snapshot()
    const body = await refused(await close('bruno', 'rejected'), 409, /its rule has not failed/)
    expect(body).toMatchObject({ code: 'REFUSED', machine: 'proposal', event: 'REJECT' })
    expect(snapshot()).toEqual(before)
  })

  it('expired before the expiry instant: refused, nothing written', async () => {
    setup(); await propose(); tick(29 * DAY)
    const before = snapshot()
    await refused(await close('bruno', 'expired'), 409, /its time has not run out yet/)
    expect(snapshot()).toEqual(before)
  })

  it('a closing is a person’s act: an agent, or a member who neither authored nor decides, is refused', async () => {
    await lapsed()
    const before = snapshot()
    await refused(await close('carla', 'expired'), 409, /only the author or one of the people who decide/)
    expect(snapshot()).toEqual(before)
    await refused(await close('bot', 'expired'), 409, /"bot" is an agent, and an agent never decides/)
    expect(snapshot()).toEqual(before)
  })

  it('a body without a known outcome is a 400', async () => {
    await failed()
    const before = snapshot()
    as('bruno')
    for (const body of [{}, { outcome: 'ratified' }, { outcome: 7 }]) {
      expect((await app.request(`/api/proposals/${ID}/close`, json(body))).status).toBe(400)
    }
    expect((await app.request('/api/proposals/p-none/close', json({ outcome: 'rejected' }))).status).toBe(404)
    expect(snapshot()).toEqual(before)
  })

  it('a closed proposal cannot be closed again', async () => {
    await failed()
    expect((await close('bruno', 'rejected')).status).toBe(200)
    const before = snapshot()
    await refused(await close('bruno', 'rejected'), 409, /already rejected/)
    expect(snapshot()).toEqual(before)
  })

  describe('the same preflight as ratify', () => {
    it('a tracked file with uncommitted changes: refused, untouched', async () => {
      await failed()
      writeFileSync(join(repo, 'data', 'projects.yaml'), `${PROJECTS}# edited\n`)
      const before = snapshot()
      const body = await refused(await close('bruno', 'rejected'), 409, /data\/projects\.yaml has changes that are not committed/)
      expect(body.code).toBe('DIRTY')
      expect(snapshot()).toEqual(before)
    })
    it('off the trunk', async () => {
      await failed()
      git(repo, 'checkout -q -b elsewhere')
      const before = snapshot()
      expect((await refused(await close('bruno', 'rejected'), 409, /decisions are recorded on the trunk/)).code).toBe('OFF_TRUNK')
      expect(snapshot()).toEqual(before)
      git(repo, 'checkout -q main')
    })
    it('a merge in progress', async () => {
      await failed()
      writeFileSync(join(repo, '.git', 'MERGE_HEAD'), `${sha()}\n`)
      expect((await refused(await close('bruno', 'rejected'), 409, /a merge is already in progress/)).code).toBe('MERGE_IN_PROGRESS')
      rmSync(join(repo, '.git', 'MERGE_HEAD'))
    })
    it('governance.yaml untracked in git: refused (the closing writes it)', async () => {
      await failed()
      git(repo, 'rm -q --cached data/governance.yaml'); git(repo, 'commit -qm "fixture: untrack governance"')
      writeFileSync(join(repo, 'data', 'governance.yaml'), VOTE)
      const before = snapshot()
      expect((await refused(await close('bruno', 'rejected'), 409, /data\/governance\.yaml/)).code).toBe('UNTRACKED')
      expect(snapshot()).toEqual(before)
    })
    it('a dirty tree names its paths, as ratify’s refusal does', async () => {
      await failed()
      writeFileSync(join(repo, 'data', 'projects.yaml'), `${PROJECTS}# edited\n`)
      expect((await refused(await close('bruno', 'rejected'), 409, /not committed/)).paths).toEqual(['data/projects.yaml'])
    })
    it('the clock behind the ledger', async () => {
      await failed()
      clock = new Date(clock.getTime() - 3 * 3600_000)
      const before = snapshot()
      expect((await refused(await close('bruno', 'withdrawn'), 409, /clock/)).code).toBe('CLOCK')
      expect(snapshot()).toEqual(before)
    })
    describe('the last fetch', () => {
      let remote: string
      function withRemote() {
        remote = mkdtempSync(join(tmpdir(), 'close-remote-')); extra.push(remote)
        execSync('git init -q --bare -b main', { cwd: remote, stdio: 'pipe' })
        git(repo, `remote add origin ${remote}`); git(repo, 'push -q origin main'); git(repo, 'fetch -q origin')
      }
      const fetchedAt = (minutesAgo: number) => { const t = new Date(clock.getTime() - minutesAgo * 60e3); utimesSync(join(repo, '.git', 'FETCH_HEAD'), t, t) }
      it('older than PT15M: Sync first, for a rejection and for a withdrawal alike', async () => {
        await failed(); withRemote(); fetchedAt(20)
        const before = snapshot()
        const body = await refused(await close('bruno', 'rejected'), 409, /^Sync first: the last fetch was 20 minutes ago, and a proposal is closed on a fetch no older than 15 minutes/)
        expect(body.code).toBe('SYNC_FIRST')
        await refused(await close('bruno', 'withdrawn'), 409, /^Sync first/)
        expect(snapshot()).toEqual(before)
      })
      it('a withdraw written through POST .../events is refused the same way', async () => {
        setup(); withRemote(); fetchedAt(1); await propose(); tick(); fetchedAt(20)
        const before = snapshot()
        as('ana')
        const res = await app.request(`/api/proposals/${ID}/events`, json({ kind: 'withdraw' }))
        expect((await refused(res, 409, /^Sync first: the last fetch was 20 minutes ago/)).code).toBe('SYNC_FIRST')
        expect(snapshot()).toEqual(before)
        fetchedAt(1)
        expect((await app.request(`/api/proposals/${ID}/events`, json({ kind: 'withdraw', text: 'Later.' }))).status).toBe(200)
        expect(readLedger(repo).entries.find(e => e.id === ID)!.events.at(-1)).toMatchObject({ kind: 'withdraw', text: 'Later.' })
      })
      it('a fresh fetch with nothing new closes', async () => {
        await failed(); withRemote(); fetchedAt(1)
        expect((await close('bruno', 'rejected')).status).toBe(200)
      })
    })
  })

  describe('a failure forced inside the closing leaves every tracked file as it was', () => {
    const calls: string[] = []
    afterEach(() => { calls.length = 0 })

    it('after the first file is written and staged, the second write fails: the original bytes are back and staged again', async () => {
      let writes = 0
      await failed()
      mount({ closeGit: { write: (path, text) => { calls.push(path); if (++writes === 2) throw new Error('disk full'); writeFileSync(path, text) } } })
      const before = snapshot()
      const body = await refused(await close('bruno', 'rejected'), 503, /data\/governance\.yaml could not be written or staged \(disk full\)/)
      expect(body.code).toBe('CLOSE_UNDONE')
      expect(calls.map(p => p.split('/').slice(-2).join('/'))).toEqual(['data/proposals.yaml', 'data/governance.yaml'])
      expect(snapshot()).toEqual(before)
      expect(readLedger(repo).entries.find(e => e.id === ID)!.state).toBe('open')
    })
    it('the first write fails', async () => {
      await failed()
      mount({ closeGit: { write: () => { throw new Error('read-only') } } })
      const before = snapshot()
      await refused(await close('bruno', 'rejected'), 503, /data\/proposals\.yaml could not be written or staged \(read-only\)/)
      expect(snapshot()).toEqual(before)
    })
    it('staging fails after the first write', async () => {
      await failed()
      let first = true
      mount({ closeGit: { stage: async () => { if (first) { first = false; throw new Error('index locked') } } } })
      const before = snapshot()
      await refused(await close('bruno', 'rejected'), 503, /index locked/)
      expect(snapshot()).toEqual(before)
    })
    it('git refuses the commit (a hook): the bytes are back, the index agrees with them', async () => {
      await failed()
      writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "no commits today" >&2\nexit 1\n', { mode: 0o755 })
      const before = snapshot()
      const body = await refused(await close('bruno', 'rejected'), 503, /git refused the commit.*no commits today/s)
      expect(body.code).toBe('CLOSE_UNDONE')
      expect(snapshot()).toEqual(before)
      expect(snapshot().merging).toBe(false)
    })
    it('a file that cannot be put back is not added again: the index never holds the closing’s half-restored text', async () => {
      let writes = 0
      const added: string[][] = []
      await failed()
      mount({ closeGit: {
        write: (path, text) => { if (++writes === 2) throw new Error('disk full'); writeFileSync(path, text) },
        restore: () => { throw new Error('read-only') },
        restage: async (_r, paths) => { added.push(paths) },
      } })
      const body = await refused(await close('bruno', 'rejected'), 500, /Putting the files back did not leave.*data\/proposals\.yaml, data\/governance\.yaml could not be put back/)
      expect(body.code).toBe('CLOSE_STUCK')
      expect(added.flat()).toEqual([]) // neither file is added again
    })
    it('negative control: with the restage removed from the code under test, the same failure leaves the first file staged', async () => {
      let writes = 0
      await failed()
      mount({ closeGit: { restage: async () => {}, write: (path, text) => { if (++writes === 2) throw new Error('disk full'); writeFileSync(path, text) } } })
      const before = snapshot()
      await close('bruno', 'rejected')
      expect(snapshot().staged.trim()).toBe('data/proposals.yaml')
      expect(snapshot()).not.toEqual(before)
    })
  })

  it('a ledger with the notes of the author in it keeps every other byte (a comment above the entry survives)', async () => {
    await failed()
    const path = join(repo, 'data', 'proposals.yaml')
    writeFileSync(path, `# the ledger\n${readFileSync(path, 'utf8')}`); git(repo, 'commit -qam "fixture: a comment"')
    expect((await close('bruno', 'rejected')).status).toBe(200)
    expect(readFileSync(path, 'utf8').startsWith('# the ledger\n')).toBe(true)
  })
})
