// DAO-OS L6 spec §11.2 (F-L3-3): the `file` op, a governed file edited whole by the source editor, staged, applied and
// proposed through the change engine. Every test builds a throwaway repository under the temp directory (makeChangeRepo);
// nothing here touches a real instance. Placeholders only.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git, SOLO } from './fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { targetsOf } from '../../server/changes/stage.ts'
import { FILE_AND_RECORDS, FILE_OP_MAX_BYTES, GENERATED, NARROWED_IN_GIT, blobId, fileLoosens } from '../../server/workspace/files.ts'
import { EDITORS } from '../../lib/workspace/editors.mjs'
import { gitSafetyProblems } from '../../server/private/guard.ts'
import { readConfig } from '../../server/visibility/config.ts'
import { parseTrailers } from '../../lib/trailers.mjs'

let repo: string
let app: Hono
afterEach(() => removeFixtureRepo(repo))

const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const read = (rel: string) => readFileSync(join(repo, rel), 'utf8')
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const commitAll = (files: Record<string, string>, msg = 'fixture') => {
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(repo, rel), text)
  git(repo, 'add -A'); git(repo, `commit -qm "${msg}"`)
}
function setup(governance: string | null = SOLO, files: Record<string, string> = {}) {
  repo = makeChangeRepo(governance)
  if (Object.keys(files).length > 0) commitAll(files)
  app = createApp(repo)
}
const fileOp = (path: string, text: string | null, base?: string | null) => ({ op: 'file', path, text, ...(base !== undefined ? { base } : {}) })
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json({ ops }))
const apply = () => app.request('/api/changes/apply', json({}))
const view = async () => (await app.request('/api/changes')).json()

const RULES = `schema_version: "2.0"
governance:
  model: steward-council
  roles:
    stewards: { members: [steward-a] }
  rules:
    - id: members
      applies_to: [records, members, governance, identity, systems, treasury, operations, publication]
      propose: stewards
      decide: { by: stewards, method: direct }
`
const NOBODY = 'rule members: nobody can propose under it. The stewards role has no member with a git or wallet handle and is not sourced from a hat. ' +
  "Add a handle first (the owner's claim: §8.1)."

describe('the file op: staged, checked, applied (L6 §11.2)', () => {
  it('staging data/governance.yaml with a comment added keeps the comment through apply', async () => {
    setup()
    const text = SOLO.replace('governance:\n', 'governance:\n  # Decided by the one maintainer until the council forms.\n')
    const staged = await stageOps([fileOp('data/governance.yaml', text)])
    expect(staged.status, await staged.clone().text()).toBe(200)
    const v = await staged.json()
    expect(v.ops).toEqual([{ op: 'file', path: 'data/governance.yaml', text, base: blobId(SOLO) }])
    expect(v.classes).toEqual(['governance'])
    expect(v.stale).toEqual([])
    const before = commits()
    const res = await apply()
    expect(res.status, await res.clone().text()).toBe(200)
    expect(read('data/governance.yaml')).toBe(text)
    expect(commits()).toBe(before + 1)
    expect(git(repo, 'show --name-only --format= HEAD').trim()).toBe('data/governance.yaml')
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('admin(data/governance.yaml): edit data/governance.yaml')
    expect(parseTrailers(git(repo, 'log -1 --format=%B')).rule).toBe('solo/direct')
    expect((await view()).ops).toEqual([])
  })

  it("a governance text that locks the org out is refused with L5's §7.6 sentence, and nothing is staged", async () => {
    setup(RULES)
    const res = await stageOps([fileOp('data/governance.yaml', RULES.replace('[steward-a]', '[ana]'))])
    expect(res.status).toBe(422)
    const { errors } = await res.json()
    expect(errors).toContainEqual(expect.objectContaining({ record: 'data/governance.yaml', message: NOBODY }))
    expect((await view()).ops).toEqual([])
    // the members edited whole, or deleted, are judged the same way
    const members = read('data/members.yaml').replace('    handles:\n      git: ["admin-test@local"]\n', '')
    for (const text of [members, null]) {
      const whole = await stageOps([fileOp('data/members.yaml', text)])
      expect(whole.status, String(text)).toBe(422)
      expect((await whole.json()).errors).toContainEqual({ record: 'data/members.yaml', field: '', message: NOBODY })
    }
  })

  it('a data/visibility.yaml text that loosens a collection adds publication; one that narrows does not', async () => {
    const VIS = 'visibility:\n  collections:\n    projects: { default: members }\n'
    setup(SOLO, { 'data/visibility.yaml': VIS })
    const loosen = { op: 'file' as const, path: 'data/visibility.yaml', text: VIS.replace('members }', 'public }'), base: blobId(VIS) }
    const narrow = { ...loosen, text: VIS.replace('projects: { default: members }', 'projects: { default: members, fields: { lead: "role:stewards" } }') }
    expect(fileLoosens(repo, loosen)).toBe(true)
    expect(fileLoosens(repo, narrow)).toBe(false)
    expect(targetsOf({ ops: [loosen] }, repo)).toEqual([['publication'], ['publication']])
    expect(targetsOf({ ops: [narrow] }, repo)).toEqual([['publication']])
    const res = await stageOps([loosen])
    expect(res.status, await res.clone().text()).toBe(200)
    expect((await res.json()).classes).toEqual(['publication'])
  })

  it('a .well-known/ path is refused with GENERATED', async () => {
    setup()
    const res = await stageOps([fileOp('.well-known/dao.json', '{}\n')])
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toEqual([{ record: '.well-known/dao.json', field: 'path', message: GENERATED }])
  })

  it('DECISIONS.md and data/proposals.yaml are refused: ratify and the proposal routes write them', async () => {
    setup(SOLO, { 'DECISIONS.md': '# Decisions\n' })
    for (const path of ['DECISIONS.md', 'data/proposals.yaml']) {
      const res = await stageOps([fileOp(path, '# x\n')])
      expect(res.status, path).toBe(422)
      expect((await res.json()).errors[0]).toMatchObject({ record: path, field: 'path' })
    }
    const off = await stageOps([fileOp('README.md', 'x\n')])
    expect(off.status).toBe(422)
    expect((await off.json()).errors[0].message).toBe('README.md is not a governed file, so it has no editor here. Nothing was staged.')
  })

  it('a file op and a record op on one file are refused with FILE_AND_RECORDS, either way round', async () => {
    setup()
    const projects = read('data/projects.yaml')
    expect((await stageOps([{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])).status).toBe(200)
    const res = await stageOps([fileOp('data/projects.yaml', `${projects}# a note\n`)])
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toEqual([{ record: 'data/projects.yaml', field: '', message: FILE_AND_RECORDS('data/projects.yaml') }])
    expect((await view()).ops).toHaveLength(1)
    // the other way round: a record op on a file the change edits whole
    await app.request('/api/changes', { method: 'DELETE' })
    expect((await stageOps([fileOp('data/projects.yaml', `${projects}# a note\n`)])).status).toBe(200)
    const back = await stageOps([{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])
    expect(back.status).toBe(422)
    expect((await back.json()).errors[0].message).toBe('This change already edits data/projects.yaml whole; apply or discard that first, then edit its records. Nothing was staged.')
    // both in one request
    await app.request('/api/changes', { method: 'DELETE' })
    const both = await stageOps([{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }, fileOp('data/projects.yaml', `${projects}# b\n`)])
    expect(both.status).toBe(422)
    expect((await both.json()).errors).toContainEqual({ record: 'data/projects.yaml', field: '', message: FILE_AND_RECORDS('data/projects.yaml') })
  })

  // Task 20 review I1 (PF-R96): Keep mine is a three-way merge of mine over theirs (was: mine kept whole over theirs).
  it("a stale base is 0.6's stale, and Keep mine restages mine merged over theirs", async () => {
    setup()
    const projects = read('data/projects.yaml')
    const mine = `# mine\n${projects}`
    expect((await stageOps([fileOp('data/projects.yaml', mine)])).status).toBe(200)
    commitAll({ 'data/projects.yaml': `${projects}# theirs\n` }, 'someone else edits projects')
    const v = await view()
    expect(v.stale).toEqual([0])
    expect(v.state).toBe('stale')
    const refused = await apply()
    expect(refused.status).toBe(409)
    expect((await refused.json()).code).toBe('STALE')
    const rebased = await app.request('/api/changes/ops/0/rebase', json({ keep: 'mine' }))
    expect(rebased.status).toBe(200)
    const after = await rebased.json()
    expect(after.stale).toEqual([])
    expect(after.ops[0]).toEqual({ op: 'file', path: 'data/projects.yaml', text: `# mine\n${projects}# theirs\n`, base: blobId(`${projects}# theirs\n`) })
    expect((await apply()).status).toBe(200)
    expect(read('data/projects.yaml')).toBe(`# mine\n${projects}# theirs\n`)
  })

  it('Take theirs drops a stale file op', async () => {
    setup()
    const projects = read('data/projects.yaml')
    expect((await stageOps([fileOp('data/projects.yaml', `${projects}# mine\n`)])).status).toBe(200)
    commitAll({ 'data/projects.yaml': `${projects}# theirs\n` }, 'someone else edits projects')
    const res = await app.request('/api/changes/ops/0/rebase', json({ keep: 'theirs' }))
    expect((await res.json()).ops).toEqual([])
  })

  it('a base the editor read, older than the file, is stale at once', async () => {
    setup()
    const projects = read('data/projects.yaml')
    const res = await stageOps([fileOp('data/projects.yaml', `${projects}# mine\n`, blobId('an older text\n'))])
    expect((await res.json()).stale).toEqual([0])
  })

  it(`a text over ${FILE_OP_MAX_BYTES} bytes is refused`, async () => {
    setup()
    const big = `# ${'x'.repeat(FILE_OP_MAX_BYTES)}\n`
    const res = await stageOps([fileOp('memory/2026-10-30.md', big)])
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0]).toMatchObject({ record: 'memory/2026-10-30.md', field: 'text', message: expect.stringMatching(/up to 1048576 bytes/) })
    const fits = await stageOps([fileOp('memory/2026-10-30.md', 'x'.repeat(FILE_OP_MAX_BYTES))])
    expect(fits.status).toBe(200)
  })

  it('YAML that does not parse is refused, and an entry that does not validate is refused by its field', async () => {
    setup()
    const bad = await stageOps([fileOp('data/horizon.yaml', 'horizon: [unclosed\n')])
    expect(bad.status).toBe(422)
    expect((await bad.json()).errors[0].message).toMatch(/^data\/horizon\.yaml is not valid YAML/)
    const entry = await stageOps([fileOp('data/projects.yaml', read('data/projects.yaml').replace('lead: "steward-a"', 'lead: "nobody-here"'))])
    expect(entry.status).toBe(422)
    expect((await entry.json()).errors[0]).toMatchObject({ record: 'projects:proj-001', field: expect.stringContaining('lead') })
  })

  // Coordinator ruling (Task 4 review): a restricted value in a file op is the person's input, answered 422 in words.
  it('a text holding a restricted field value is refused 422, naming the field, not the value', async () => {
    setup(SOLO, { 'data/visibility.yaml': 'visibility:\n  collections:\n    members:\n      fields: { email: "role:stewards" }\n' })
    const members = read('data/members.yaml').replace('    handles:\n      git: ["admin-test@local"]', '    email: "secret-value@example.invalid"\n    handles:\n      git: ["admin-test@local"]')
    const res = await stageOps([fileOp('data/members.yaml', members)])
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors).toEqual([{ record: 'data/members.yaml', field: 'email', message:
      'Not staged: data/members.yaml would hold the email of steward-a, which data/visibility.yaml restricts to role:stewards; it belongs in the private store, ' +
      'and git holds nothing stricter than members. Nothing was staged.' }])
    expect(JSON.stringify(body)).not.toContain('secret-value')
    expect((await view()).ops).toEqual([])
  })

  it('a file that already holds a restricted value can still be edited when the op adds none', async () => {
    const VIS = 'visibility:\n  collections:\n    members:\n      fields: { email: "role:stewards" }\n'
    setup(SOLO)
    // held from before the policy restricted it (a hand edit): the file op neither adds nor moves it
    commitAll({ 'data/members.yaml': read('data/members.yaml').replace('    handles:\n      git: ["admin-test@local"]', '    email: "held-value@example.invalid"\n    handles:\n      git: ["admin-test@local"]'), 'data/visibility.yaml': VIS })
    const text = read('data/members.yaml').replace('role: "Contributor"', 'role: "Contributor and editor"')
    const staged = await stageOps([fileOp('data/members.yaml', text)])
    expect(staged.status, await staged.clone().text()).toBe(200)
    const res = await apply()
    expect(res.status, await res.clone().text()).toBe(200)
    expect(read('data/members.yaml')).toBe(text)
  })

  it("a whole data/members.yaml that puts a wallet in someone else's record is refused at apply with OWN_LINK; one's own is applied", async () => {
    setup()
    const others = read('data/members.yaml').replace('    joined: "2025-02-01"\n', '    joined: "2025-02-01"\n    handles:\n      wallet: "eip155:42220:0x00000000000000000000000000000000000000a2"\n')
    expect((await stageOps([fileOp('data/members.yaml', others)])).status).toBe(200)
    const refused = await apply()
    expect(refused.status).toBe(403)
    expect((await refused.json()).code).toBe('OWN_LINK')
    await app.request('/api/changes', { method: 'DELETE' })
    const mine = read('data/members.yaml').replace('      git: ["admin-test@local"]', '      git: ["admin-test@local"]\n      wallet: "eip155:42220:0x00000000000000000000000000000000000000a1"')
    expect((await stageOps([fileOp('data/members.yaml', mine)])).status).toBe(200)
    const ok = await apply()
    expect(ok.status, await ok.clone().text()).toBe(200)
  })

  it("a whole registry file that raises a record's visibility adds publication, as the record op would", async () => {
    setup()
    const projects = read('data/projects.yaml')
    const raised = { op: 'file' as const, path: 'data/projects.yaml', text: projects.replace('    status: "execute"', '    status: "execute"\n    visibility: public'), base: blobId(projects) }
    const noted = { ...raised, text: `${projects}# a note\n` }
    expect(targetsOf({ ops: [raised] }, repo)).toContainEqual(['publication'])
    expect(targetsOf({ ops: [noted] }, repo)).not.toContainEqual(['publication'])
    const res = await stageOps([raised])
    expect(res.status, await res.clone().text()).toBe(200)
    expect((await res.json()).classes).toEqual(['records', 'publication'])
  })

  it('a whole data/visibility.yaml that narrows a field git still holds values of is refused, and points to the narrow control', async () => {
    setup(RULES)
    commitAll({ 'data/members.yaml': read('data/members.yaml').replace('    handles:\n      git: ["admin-test@local"]', '    email: "held-value@example.invalid"\n    handles:\n      git: ["admin-test@local"]') })
    const res = await stageOps([fileOp('data/visibility.yaml', 'visibility:\n  collections:\n    members:\n      fields: { email: "role:stewards" }\n')])
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors).toEqual([{ record: 'data/visibility.yaml', field: 'email', message: NARROWED_IN_GIT('data/members.yaml', 'email') }])
    expect(JSON.stringify(body)).not.toContain('held-value')
    // a narrowing of a field no record holds is staged
    const ok = await stageOps([fileOp('data/visibility.yaml', 'visibility:\n  collections:\n    members:\n      fields: { phone: "role:stewards" }\n')])
    expect(ok.status, await ok.clone().text()).toBe(200)
  })

  it('federation.yaml and IDENTITY.md apply in one commit with class identity', async () => {
    setup(SOLO, { 'IDENTITY.md': '# Fixture Org\n' })
    const federation = read('federation.yaml').replace('Fixture Org', 'Fixture Org, renamed')
    const res = await stageOps([fileOp('federation.yaml', federation), fileOp('IDENTITY.md', '# Fixture Org, renamed\n')])
    expect(res.status, await res.clone().text()).toBe(200)
    expect((await res.json()).classes).toEqual(['identity'])
    const before = commits()
    expect((await apply()).status).toBe(200)
    expect(commits()).toBe(before + 1)
    expect(git(repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['IDENTITY.md', 'federation.yaml'])
    expect(git(repo, 'log -1 --format=%s').trim()).toBe('admin(federation.yaml, IDENTITY.md): apply 2 changes')
    expect(read('IDENTITY.md')).toBe('# Fixture Org, renamed\n')
  })

  it('a null text deletes the file, in one commit', async () => {
    setup(SOLO, { 'data/horizon.yaml': 'horizon: []\n' })
    expect((await stageOps([fileOp('data/horizon.yaml', null)])).status).toBe(200)
    expect((await apply()).status).toBe(200)
    expect(git(repo, 'ls-files data/horizon.yaml').trim()).toBe('')
    expect(git(repo, 'show --name-status --format= HEAD').trim()).toBe('D\tdata/horizon.yaml')
  })

  it('a refused commit puts the file back, as the record writes do', async () => {
    setup()
    const before = read('data/governance.yaml')
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "no thanks" >&2\nexit 1\n', { mode: 0o755 })
    expect((await stageOps([fileOp('data/governance.yaml', `${before}# x\n`)])).status).toBe(200)
    const res = await apply()
    expect(res.status).toBe(503)
    expect(read('data/governance.yaml')).toBe(before)
    expect(git(repo, 'status --porcelain --untracked-files=no').trim()).toBe('')
  })
})

describe('nothing stricter than members enters git through a proposal of a file op', () => {
  it('a ledger whose file op holds a restricted value is a git-safety problem, naming the field, not the value', () => {
    setup(SOLO, { 'data/visibility.yaml': 'visibility:\n  collections:\n    members:\n      fields: { email: "role:stewards" }\n' })
    const members = 'members:\n  - { id: steward-a, name: Steward A, email: secret-value@example.invalid }\n'
    const ledger = `proposals:\n  - id: p-2026-10-30-001-a1b2\n    ops:\n      - op: file\n        path: data/members.yaml\n        text: ${JSON.stringify(members)}\n        base: null\n`
    const problems = gitSafetyProblems(repo, [{ path: 'data/proposals.yaml', text: ledger }], readConfig(repo))
    expect(problems.map(p => ({ record: p.record, field: p.field }))).toEqual([{ record: 'p-2026-10-30-001-a1b2', field: 'email' }])
    expect(JSON.stringify(problems)).not.toContain('secret-value')
  })
})

describe('GET /api/editors and GET /api/files (L6 §16)', () => {
  it('answers the §11.1 table', async () => {
    setup()
    expect(await (await app.request('/api/editors')).json()).toEqual(JSON.parse(JSON.stringify(EDITORS)))
  })
  it('answers a governed file with its text, base, class and editor', async () => {
    setup()
    const res = await app.request('/api/files?path=data/governance.yaml')
    expect(await res.json()).toEqual({ path: 'data/governance.yaml', text: SOLO, base: blobId(SOLO), class: 'governance', editor: 'rules+source' })
    const missing = await (await app.request('/api/files?path=data/horizon.yaml')).json()
    expect(missing).toEqual({ path: 'data/horizon.yaml', text: null, base: null, class: 'records', editor: 'source' })
    expect((await app.request('/api/files?path=README.md')).status).toBe(404)
    expect((await app.request('/api/files?path=../x')).status).toBe(400)
  })
  it('a file holding a restricted value is answered 403, naming no value', async () => {
    setup(SOLO, { 'data/visibility.yaml': 'visibility:\n  collections:\n    members:\n      fields: { role: "role:stewards" }\n' })
    const res = await app.request('/api/files?path=data/members.yaml')
    expect(res.status).toBe(403)
    const text = await res.text()
    expect(text).not.toContain('Core Steward')
  })
  it('a collection file whose entries cannot be read is answered 403 with a sentence, never served whole (T19 review M1)', async () => {
    setup(SOLO, { 'data/members.yaml': 'members: [UNREAD-MEMBER-TEXT\n  : : :' })
    const res = await app.request('/api/files?path=data/members.yaml')
    const body = await res.text()
    expect(res.status).toBe(403)
    expect(JSON.parse(body)).toEqual({ error: 'data/members.yaml cannot be read as its entries, so whether every member may read it cannot be said, and it is not served whole here. Fix it in the repository first.' })
    expect(body).not.toContain('UNREAD-MEMBER-TEXT')
  })
})

describe('a proposal carries a file op, and ratify writes it', () => {
  const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
`
  const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-b] }
    member: { all: true }
  rules:
    - { id: identity, applies_to: [records, members, governance, identity, systems, publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
  const as = (who: string) => git(repo, `config user.email ${who}@example.test`)

  it('the ledger holds the op as staged; ratify merges the file', async () => {
    repo = makeChangeRepo(GOV)
    commitAll({ 'data/members.yaml': MEMBERS, 'IDENTITY.md': '# Fixture Org\n' }, 'fixture: members and identity')
    let now = new Date(Math.floor(Date.now() / 1000) * 1000 - 120_000)
    app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => now }))
    as('steward-a')
    const text = '# Fixture Org\n\nA second paragraph, proposed.\n'
    expect((await stageOps([fileOp('IDENTITY.md', text)])).status).toBe(200)
    const proposed = await app.request('/api/proposals', json({ title: 'Say more about the org' }))
    const body = await proposed.json()
    expect(proposed.status, JSON.stringify(body)).toBe(201)
    const id = String(body.id)
    const ledger = read('data/proposals.yaml')
    expect(ledger).toContain('op: file')
    expect(ledger).toContain('path: IDENTITY.md')
    expect(read('IDENTITY.md')).toBe('# Fixture Org\n') // proposed, not applied
    expect(new ChangeStore(repo).load('steward-a')).toBeNull()
    // Update proposal carries the file op as staged, with its base and nothing else
    now = new Date(now.getTime() + 60_000)
    const revised = `${text}A third, revised in.\n`
    const rev = await app.request(`/api/proposals/${id}/revise`, json({ ops: [{ op: 'file', path: 'IDENTITY.md', text: revised, base: blobId('# Fixture Org\n') }] }))
    expect(rev.status, await rev.clone().text()).toBe(200)
    expect(read('data/proposals.yaml')).toContain('A third, revised in.')
    expect(read('data/proposals.yaml')).not.toContain('before:')
    now = new Date(now.getTime() + 60_000)
    as('steward-b')
    expect((await app.request(`/api/proposals/${id}/events`, json({ kind: 'approve' }))).status).toBe(200)
    now = new Date(now.getTime() + 60_000)
    const detail = await app.request(`/api/proposals/${id}`)
    expect(detail.status).toBe(200)
    const ratified = await app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status, await ratified.clone().text()).toBe(200)
    expect(read('IDENTITY.md')).toBe(revised)
    expect(git(repo, 'diff --name-only HEAD^1 HEAD').trim().split('\n').sort()).toEqual(['IDENTITY.md', 'data/governance.yaml', 'data/proposals.yaml'])
    expect(parseTrailers(git(repo, 'log -1 --format=%B')).proposal).toBe(id)
    // validate:governance reads the merge as the ratify of that op: IDENTITY.md is its file op's text, nothing more.
    const script = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
    const r = spawnSync('node', [script, repo], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout).not.toMatch(/the merge also changes IDENTITY\.md|IDENTITY\.md in the merge/)
    expect(r.stdout.split('\n').filter(l => l.includes('proposals: ratify'))).toEqual([])
    expect(r.stdout).toMatch(/Results: /)
  })
})
