import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { guardFetched } from '../../server/proposals/propose.ts'
import { recordRemoteTrunkAbsent } from '../../server/git.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { revOf } from '../../lib/proposals.mjs'
import type { BuildResult } from '../../server/proposals/branch.ts'

// Every test builds a throwaway repository under the temp directory (makeChangeRepo), with synthetic members ana,
// bruno and carla (and bot, an agent); a remote, where a test needs one, is a bare repository in the temp directory
// too. Nothing here touches a real instance. The clock is injected.
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
const gov = (rules: string, roles = '    maintainer: { members: [bruno, carla] }\n    member: { all: true }', extra = '') =>
  `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n${extra}  roles:\n${roles}\n  rules:\n${rules}\n  decisions: []\n`
const RECORDS = '    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }'
const PEOPLE = '    - { id: people, applies_to: [members], propose: member, decide: { by: maintainer, method: approve, count: 1 } }'
const CONSENSUS_GOV = gov(`${RECORDS}\n${PEOPLE}`)

const NOW = new Date('2026-10-18T12:00:00Z')
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
const MEMBER = { op: 'update', record: 'members:ana', set: { role: 'Steward' } }
const BODY = { title: 'Move one project', rationale: 'It is ready.' }

let repo: string
let app: Hono
let extra: string[] = []
let build: ((...a: unknown[]) => Promise<BuildResult>) | undefined

/** A repository of ana, bruno and carla under `governance`, with `who` as the git identity, and the app. */
function setup(governance: string = CONSENSUS_GOV, who = 'ana') {
  repo = makeChangeRepo(governance)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members"')
  git(repo, `config user.email ${who}@example.test`)
  app = createApp(repo, (a, ctx) => mountProposals(a, {
    repo, withLock: ctx.withLock, startBranch: 'main', now: () => NOW, build: build ? (...a2) => build!(...a2) : undefined,
  }))
}
beforeEach(() => { build = undefined; extra = [] })
afterEach(() => { removeFixtureRepo(repo); for (const d of extra) rmSync(d, { recursive: true, force: true }) })

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const stageOps = async (ops: unknown[]) => { const r = await app.request('/api/changes/ops', json('POST', { ops })); expect(r.status).toBe(200); return r.json() }
const open = (body: unknown = BODY) => app.request('/api/proposals', json('POST', body))
const staged = async () => (await (await app.request('/api/changes')).json()).ops as unknown[]
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const sha = (rev: string) => git(repo, `rev-parse ${rev}`).trim()
const hasRef = (ref: string) => { try { git(repo, `rev-parse --verify -q ${ref}`); return true } catch { return false } }
const ledgerFile = () => join(repo, 'data', 'proposals.yaml')

/** Nothing opened: no commit, no ledger, no branch, and the change is still staged. */
async function expectUntouched(before: { commits: number; ops: number }) {
  expect(commits()).toBe(before.commits)
  expect(existsSync(ledgerFile())).toBe(false)
  expect(git(repo, 'branch --list "proposal/*"').trim()).toBe('')
  expect(await staged()).toHaveLength(before.ops)
}
const refused = async (res: Response, status: number) => { expect(res.status).toBe(status); return res.json() as Promise<Record<string, unknown>> }

describe('POST /api/proposals: a staged change becomes a proposal', () => {
  it('opens an entry with the rule snapshot, classes, rev, base, branch and ops with bases; one trunk commit; the branch; the change cleared', async () => {
    setup()
    const v = await stageOps([PROJECT])
    const base = v.ops[0].base as string
    const [before, tip] = [commits(), sha('HEAD')]
    const res = await open()
    expect(res.status).toBe(201)
    const body = await res.json()
    const id = body.id as string
    expect(id).toMatch(/^p-2026-10-18-001-[0-9a-f]{4}$/) // the day's counter, then 4 hex of a random draw (final review I5)
    expect(body).toMatchObject({ id, state: 'open', author: 'ana', branchState: 'built' })
    expect(body.note).toBeUndefined()

    const [entry] = readLedger(repo).entries
    expect(entry).toMatchObject({
      id, title: 'Move one project', rationale: 'It is ready.', author: 'ana', classes: ['records'], state: 'open',
      rev: revOf([PROJECT]), base: tip, branch: `proposal/${id}`, events: [], closed: null,
      rules: [{ id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }],
      ops: [{ ...PROJECT, base }],
    })
    expect(String(entry!.opened)).toBe('2026-10-18T12:00:00Z') // the injected clock

    expect(commits()).toBe(before + 1) // one commit on the trunk, the entry's
    expect(git(repo, 'diff --name-only HEAD~1 HEAD').trim()).toBe('data/proposals.yaml')
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD'))).toEqual({ actor: 'ana', change: v.id, rule: 'records/approve', proposal: id })

    expect(sha(`proposal/${id}^`)).toBe(tip) // the branch: one commit on the tip the ops were checked against
    expect(git(repo, `diff --name-only ${tip} proposal/${id}`).trim()).toBe('data/projects.yaml')
    expect(parseTrailers(git(repo, `log -1 --format=%B proposal/${id}`))).toEqual({ actor: 'ana', change: v.id, proposal: id })

    expect(await staged()).toEqual([]) // cleared, as after Apply
    expect(git(repo, 'status --porcelain').trim()).toBe('') // the working tree holds neither the ops nor a leftover
    expect(git(repo, 'show HEAD:data/projects.yaml')).toContain('status: "execute"') // the trunk is as it was
  })

  it('a second proposal the same day takes the next id', async () => {
    setup()
    await stageOps([PROJECT]); expect((await open()).status).toBe(201)
    await stageOps([{ op: 'update', record: 'projects:proj-001', set: { type: 'initiative' } }])
    const second = await (await open({ title: 'Another' })).json()
    expect(second.id).toMatch(/^p-2026-10-18-002-[0-9a-f]{4}$/)
    expect(readLedger(repo).entries.map(e => String(e.id).slice(0, 'p-2026-10-18-00N'.length))).toEqual(['p-2026-10-18-001', 'p-2026-10-18-002'])
  })

  it('a project and a member: one proposal, two rules, both named in Org-Rule', async () => {
    setup()
    const v = await stageOps([PROJECT, MEMBER])
    const res = await open()
    expect(res.status).toBe(201)
    const entries = readLedger(repo).entries
    expect(entries).toHaveLength(1)
    expect(entries[0]!.classes).toEqual(['records', 'members'])
    expect(entries[0]!.rules.map(r => r.id)).toEqual(['records', 'people'])
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD')).rule).toBe('records/approve,people/approve')
    expect(parseTrailers(git(repo, 'log -1 --format=%B HEAD')).change).toBe(v.id)
  })

  it('an agent a role lists may propose; the author is the agent', async () => {
    setup(gov(RECORDS.replace('propose: member', 'propose: scout'), '    maintainer: { members: [bruno, carla] }\n    scout: { members: [bot] }'), 'bot')
    await stageOps([PROJECT])
    expect((await open()).status).toBe(201)
    expect(readLedger(repo).entries[0]!.author).toBe('bot')
  })

  it('a branch that cannot be built leaves the proposal, and says the branch will be built (P2-R25)', async () => {
    build = async () => { throw new Error('the worktree could not be made') }
    setup()
    await stageOps([PROJECT])
    const before = commits()
    const res = await open()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.branchState).toBe('missing')
    expect(body.note).toMatch(/proposal p-2026-10-18-001-[0-9a-f]{4} is open.*could not be built \(the worktree could not be made\).*branch will be built again/)
    expect(commits()).toBe(before + 1)
    expect(readLedger(repo).entries).toHaveLength(1)
    expect(hasRef(`proposal/${body.id}`)).toBe(false)
    expect(await staged()).toEqual([]) // the ops live in the ledger now
  })
})

describe('POST /api/proposals refuses, in words, and writes nothing', () => {
  it('a class no rule covers', async () => {
    setup(gov(RECORDS))
    await stageOps([MEMBER])
    const b = await refused(await open(), 409)
    expect(b.code).toBe('NO_RULE')
    expect(b.error).toBe('No rule in data/governance.yaml covers the class members; nobody can propose it until a rule does. Nothing was written.')
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('a stale op (409), naming the count', async () => {
    setup()
    await stageOps([PROJECT])
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('Node Onboarding Program', 'Renamed on the trunk'))
    git(repo, 'commit -qam "the trunk changes the record"')
    const b = await refused(await open(), 409)
    expect(b).toMatchObject({ code: 'STALE', stale: [0] })
    expect(b.error).toMatch(/Not proposed: one op was staged against a record that has changed since.*Nothing was written/)
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('ops that no longer validate (422, with the field)', async () => {
    setup()
    await stageOps([{ op: 'update', record: 'projects:proj-001', set: { lead: 'carla' } }])
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS.replace(/ {2}- \{ id: carla.*\n/, '')) // carla leaves; the project's record is unchanged
    git(repo, 'commit -qam "carla leaves"')
    const b = await refused(await open(), 422)
    expect(b.errors).toEqual([{ record: 'projects:proj-001', field: 'lead', message: expect.stringMatching(/carla/) }])
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('an actor who may not propose under the rule (403 with the rule engine’s sentence)', async () => {
    setup(gov(`${RECORDS}\n${PEOPLE.replace('propose: member', 'propose: maintainer')}`))
    await stageOps([MEMBER])
    const b = await refused(await open(), 403)
    expect(b.reason).toBe('"ana" does not hold the maintainer role, which rule "people" asks of whoever proposes.')
    expect(b.error).toBe(b.reason)
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('an agent that no propose role lists', async () => {
    setup(CONSENSUS_GOV, 'bot')
    await stageOps([PROJECT])
    const b = await refused(await open(), 403)
    expect(b.reason).toBe('"bot" does not hold the member role, which rule "records" asks of whoever proposes.')
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('an agent never applies, so a direct rule whose proposers it joins still sends it to a proposal (P2-R26)', async () => {
    const direct = RECORDS.replace('method: approve, count: 1', 'method: direct').replace('propose: member', 'propose: scout')
    setup(gov(direct, '    maintainer: { members: [bruno] }\n    scout: { members: [bot] }'), 'bot')
    await stageOps([PROJECT])
    expect((await open()).status).toBe(201)
  })

  it('an unknown actor (a git email no member holds)', async () => {
    setup()
    await stageOps([PROJECT])
    git(repo, 'config user.email stranger@example.test')
    const b = await refused(await open(), 403)
    expect(String(b.reason)).toMatch(/^Read-only: your git email `stranger@example\.test` matches no member/)
    git(repo, 'config user.email ana@example.test') // back to a member, to read what is still staged
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('a change the actor may apply alone: nothing opens, and the response says to Apply', async () => {
    setup(gov(RECORDS.replace('method: approve, count: 1', 'method: direct')), 'bruno')
    await stageOps([PROJECT])
    const b = await refused(await open(), 409)
    expect(b.code).toBe('DIRECT')
    expect(b.error).toMatch(/You may apply this change yourself under rule "records".*no proposal was opened\. Use Apply\./)
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('a solo instance, where every person applies', async () => {
    setup('schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  decisions: []\n', 'bruno')
    await stageOps([PROJECT])
    expect((await refused(await open(), 409)).code).toBe('DIRECT')
  })

  it('nothing staged, and a body without a title', async () => {
    setup()
    expect((await refused(await open(), 400)).code).toBe('EMPTY')
    await stageOps([PROJECT])
    expect((await refused(await open({ rationale: 'x' }), 400)).error).toMatch(/"title" is missing/)
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('a title the ledger’s schema refuses (422, with the field)', async () => {
    setup()
    await stageOps([PROJECT])
    const b = await refused(await open({ title: '' }), 422)
    expect(JSON.stringify(b.errors)).toMatch(/title/)
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('a trunk name the platform cannot build refs from (R28)', async () => {
    setup(gov(RECORDS, undefined, '  trunk: MERGE_HEAD\n'))
    await stageOps([PROJECT])
    const b = await refused(await open(), 409)
    expect(b.code).toBe('TRUNK')
    expect(b.error).toMatch(/"MERGE_HEAD" cannot be the trunk.*reserved/)
    await expectUntouched({ commits: commits(), ops: 1 })
  })

  it('the repository is off the trunk the server started on', async () => {
    setup()
    await stageOps([PROJECT])
    git(repo, 'checkout -q -b elsewhere')
    expect((await refused(await open(), 409)).code).toBe('OFF_TRUNK')
    expect(await staged()).toHaveLength(1) // the change goes only after the ledger commit: a refused write leaves it staged
    expect(existsSync(ledgerFile())).toBe(false)
  })

  // Spec 3.4: rules and mayPropose (1), direct (2), then stale and validate (3).
  const goStale = () => {
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('Node Onboarding Program', 'Renamed on the trunk'))
    git(repo, 'commit -qam "the trunk changes the record"')
  }
  it('a stale op on a change the actor may apply alone gets the direct answer', async () => {
    setup(gov(RECORDS.replace('method: approve, count: 1', 'method: direct')), 'bruno')
    await stageOps([PROJECT]); goStale()
    expect((await refused(await open(), 409)).code).toBe('DIRECT')
  })
  it('a stale op by someone who may not propose gets the 403', async () => {
    setup(CONSENSUS_GOV, 'bot')
    await stageOps([PROJECT]); goStale()
    expect((await refused(await open(), 403)).reason).toMatch(/does not hold the member role/)
  })
  it('a stale op in a class no rule covers gets the uncovered-class answer', async () => {
    setup(gov(RECORDS))
    await stageOps([MEMBER])
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS.replace('name: Ana', 'name: Ana S'))
    git(repo, 'commit -qam "the trunk changes ana"')
    expect((await refused(await open(), 409)).code).toBe('NO_RULE')
  })
})

describe('POST /api/proposals reads the last fetch and never fetches (P2-R31)', () => {
  let remote: string
  const bare = () => {
    remote = mkdtempSync(join(tmpdir(), 'propose-remote-')); extra.push(remote)
    execSync('git init -q --bare -b main', { cwd: remote })
  }
  /** A bare remote in the temp directory, with the trunk pushed and fetched once. */
  function withRemote() {
    bare()
    git(repo, `remote add origin ${remote}`); git(repo, 'push -q origin main'); git(repo, 'fetch -q origin')
  }
  const fetchedAt = (minutesAgo: number) => {
    const t = new Date(NOW.getTime() - minutesAgo * 60e3)
    utimesSync(join(repo, '.git', 'FETCH_HEAD'), t, t)
  }
  /** Two commits land on the remote from a second clone. */
  function remoteMoves() {
    const other = mkdtempSync(join(tmpdir(), 'propose-clone-')); extra.push(other)
    execSync(`git clone -q ${remote} ${other}`, { stdio: 'pipe', cwd: tmpdir() })
    const run = (c: string) => execSync(`git ${c}`, { cwd: other, stdio: 'pipe' })
    run('config user.email carla@example.test'); run('config user.name carla')
    run('commit -q --allow-empty -m "remote one"'); run('commit -q --allow-empty -m "remote two"'); run('push -q origin main')
  }

  it('a fresh fetch that shows nothing new: the proposal opens', async () => {
    setup(); withRemote(); fetchedAt(5)
    await stageOps([PROJECT])
    expect((await open()).status).toBe(201)
  })
  it('an old fetch: Sync first', async () => {
    setup(); withRemote(); fetchedAt(20)
    await stageOps([PROJECT])
    const b = await refused(await open(), 409)
    expect(b.code).toBe('SYNC_FIRST')
    expect(b.error).toMatch(/^Sync first: the last fetch was 20 minutes ago.*no older than 15 minutes/)
    await expectUntouched({ commits: commits(), ops: 1 })
  })
  it('a fetch that shows commits the trunk lacks: Sync first, counting them', async () => {
    setup(); withRemote(); remoteMoves(); git(repo, 'fetch -q origin'); fetchedAt(1)
    await stageOps([PROJECT])
    const b = await refused(await open(), 409)
    expect(b.error).toMatch(/^Sync first: the remote has 2 commits you have not merged\./)
    await expectUntouched({ commits: commits(), ops: 1 })
  })
  it('a fetch just over the limit says 16 minutes, never "15 minutes ago" beside "no older than 15"', async () => {
    setup(); withRemote(); fetchedAt(15.3)
    await stageOps([PROJECT])
    const b = await refused(await open(), 409)
    expect(b.error).toMatch(/^Sync first: the last fetch was 16 minutes ago.*no older than 15 minutes/)
  })
  it('an invalid trunk name is refused before the fetch is read', async () => {
    setup(gov(RECORDS, undefined, '  trunk: MERGE_HEAD\n')); withRemote(); fetchedAt(60)
    await stageOps([PROJECT])
    expect((await refused(await open(), 409)).code).toBe('TRUNK') // not SYNC_FIRST: the ledger's own guard would come after the fetch reading
  })
  it('a fetch of exactly 15 minutes still counts as fresh', async () => {
    setup(); withRemote(); fetchedAt(15)
    await stageOps([PROJECT])
    expect((await open()).status).toBe(201)
  })
  it('a remote that was never fetched from: Sync first', async () => {
    setup(); bare()
    git(repo, `remote add origin ${remote}`)
    await stageOps([PROJECT])
    const b = await refused(await open(), 409)
    expect(b.error).toMatch(/^Sync first: this repository has never fetched/)
  })
  describe('a trunk the remote has never had (F-L3-2)', () => {
    const noTrunk = () => {
      setup(); bare()
      git(repo, 'remote add origin ' + remote)
      git(repo, 'branch -q elsewhere'); git(repo, 'push -q origin elsewhere')
      git(repo, 'fetch -q origin') // a fetch that brings no main
    }
    const absentAt = (at: Date, url = remote) => recordRemoteTrunkAbsent(repo, { url, trunk: 'main', at })
    it('with the absence recorded, Propose succeeds', async () => {
      noTrunk(); absentAt(NOW)
      await stageOps([PROJECT])
      expect((await open()).status).toBe(201)
    })
    it('after 15 minutes and one second it asks to Sync again', async () => {
      noTrunk(); absentAt(new Date(NOW.getTime() - 15 * 60e3 - 1000))
      await stageOps([PROJECT])
      expect((await refused(await open(), 409)).code).toBe('SYNC_FIRST')
    })
    it('a record for another remote url is void', async () => {
      noTrunk(); absentAt(NOW, '/somewhere/else.git')
      await stageOps([PROJECT])
      expect((await refused(await open(), 409)).code).toBe('SYNC_FIRST')
    })
    it('hosted: guardFetched returns at once, whatever the fetch says', async () => {
      noTrunk()
      await expect(guardFetched(repo, 'main', NOW, 'a proposal is opened', { hosted: true })).resolves.toBeUndefined()
      await expect(guardFetched(repo, 'main', NOW)).rejects.toMatchObject({ body: { code: 'SYNC_FIRST' } })
    })
  })
  it('it does not fetch on its own: the remote moves and nothing is learned of it', async () => {
    setup(); withRemote(); fetchedAt(5); remoteMoves() // not fetched
    await stageOps([PROJECT])
    expect((await open()).status).toBe(201)
    expect(git(repo, 'rev-list --count main..origin/main').trim()).toBe('0') // the tracking ref is as the last fetch left it
  })
})
