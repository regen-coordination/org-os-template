// W2a through the server (wizards spec §5.4a): plan, confirm, write, commit, undo, and every
// refusal at both ends. The repositories are scratch copies; the script that writes is the real one.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, TEST_EMAIL } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountBootstrap } from '../../server/bootstrap/routes.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { JobStore } from '../../server/state.ts'

const MEMBERS = `schema_version: "2.0"

# who we are
members:
  - id: "ana"
    name: "Ana Costa"
    handles:
      github: "ana-costa"
  - id: "bo"
    name: "Bo Lind"
    handles:
      git: "bo@example.org"
`

let repo: string
let app: ReturnType<typeof createApp>
let home: string

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
const members = () => readFileSync(join(repo, 'data', 'members.yaml'), 'utf8')
const commits = () => Number(git('rev-list', '--count', 'HEAD'))

/** A scratch instance whose git address is TEST_EMAIL (who authored its first commit) and which no
 *  member holds: the state W2a serves. */
function boot(opts: { members?: string; governance?: string | null; script?: string } = {}) {
  repo = makeFixtureRepo()
  home = mkdtempSync(join(tmpdir(), 'claim-state-'))
  process.env.ORG_OS_ADMIN_HOME = home
  writeFileSync(join(repo, 'data', 'members.yaml'), opts.members ?? MEMBERS)
  if (opts.governance) writeFileSync(join(repo, 'data', 'governance.yaml'), opts.governance)
  git('add', '-A')
  git('commit', '-q', '-m', 'scratch: members without the git address')
  const jobs = new JobStore(repo)
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: () => {} }, { killGraceMs: 200 })
  app = createApp(repo, (a, ctx) => mountBootstrap(a, { repo, jobs, executor, withLock: ctx.withLock, script: opts.script }))
}
beforeEach(() => boot())
afterEach(() => { removeFixtureRepo(repo); rmSync(home, { recursive: true, force: true }) })

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const plan = (body: unknown) => post('/api/bootstrap/claim/plan', body)
const confirm = (nonce: unknown) => post('/api/bootstrap/claim/confirm', { nonce })
const actor = async () => (await app.request('/api/actor')).json()

describe('GET /api/bootstrap/claim: what the page may offer', () => {
  it('offers the persons who hold no address, and says nothing is written', async () => {
    const r = await (await app.request('/api/bootstrap/claim')).json()
    expect(r).toMatchObject({ available: true, refusal: null, address: TEST_EMAIL, rule: 'bootstrap/claim', canCreate: false })
    expect(r.candidates).toEqual([{ id: 'ana', name: 'Ana Costa' }])
  })

  it('says why not for each organisation the claim is not for', async () => {
    removeFixtureRepo(repo)
    boot({ governance: 'governance:\n  rules:\n    - id: r1\n' })
    expect((await (await app.request('/api/bootstrap/claim')).json())).toMatchObject({ available: false, refusal: expect.stringMatching(/has rules for who its members are/) })
    removeFixtureRepo(repo)
    boot({ governance: 'governance: [unclosed\n' })
    expect((await (await app.request('/api/bootstrap/claim')).json())).toMatchObject({ available: false, refusal: expect.stringMatching(/governance\.yaml cannot be read/) })
  })

  it('says you are already someone, when a member holds the address', async () => {
    removeFixtureRepo(repo)
    boot({ members: MEMBERS.replace('github: "ana-costa"', `git: "${TEST_EMAIL}"`) })
    expect(await (await app.request('/api/bootstrap/claim')).json()).toMatchObject({ available: false, refusal: expect.stringMatching(/already `ana`/) })
  })

  it('says so when every person already has an address', async () => {
    removeFixtureRepo(repo)
    boot({ members: MEMBERS.replace('github: "ana-costa"', 'git: "ana@example.org"') })
    const r = await (await app.request('/api/bootstrap/claim')).json()
    expect(r.available).toBe(false)
    expect(r.refusal).toMatch(/already has a git address/)
  })
})

describe('plan: what the person sees before anything is written', () => {
  it('shows the exact line, the address as git reports it, the commit and the trailers; writes nothing', async () => {
    const before = members()
    const res = await plan({ member: 'ana' })
    expect(res.status).toBe(200)
    const p = await res.json()
    expect(p.nonce).toMatch(/^[0-9a-f]{48}$/)
    expect(p.review).toMatchObject({
      address: TEST_EMAIL, file: 'data/members.yaml', lines: [`      git: ${TEST_EMAIL}`],
      member: { id: 'ana', name: 'Ana Costa', created: false },
      commit: { trailers: { 'Org-Actor': `unknown <${TEST_EMAIL}>`, 'Org-Rule': 'bootstrap/claim' } },
      writes: ['data/members.yaml'], network: false, cmd: process.execPath,
    })
    expect(p.review.note).toBe('This file is committed. If this repository is public, the address becomes public. Use your noreply address if you prefer.')
    expect(p.review.args).toEqual(expect.arrayContaining(['--member', 'ana', '--address', TEST_EMAIL]))
    expect(p.review.timeoutMs).toBeLessThanOrEqual(15_000)
    expect(members()).toBe(before)
    expect(git('status', '--porcelain')).toBe('')
  })

  it('reads the address itself: an address in the body is not used', async () => {
    const p = await (await plan({ member: 'ana', address: 'someone-else@example.org' })).json()
    expect(p.review.address).toBe(TEST_EMAIL)
    expect(p.review.args).not.toContain('someone-else@example.org')
  })

  it('shows two lines for a member without handles, and the id of a new member before it is confirmed', async () => {
    removeFixtureRepo(repo)
    boot({ members: 'schema_version: "2.0"\nmembers:\n  - id: cy\n    name: Cy\n' })
    expect((await (await plan({ member: 'cy' })).json()).review.lines).toEqual(['    handles:', `      git: ${TEST_EMAIL}`])
    removeFixtureRepo(repo)
    boot({ members: 'schema_version: "2.0"\nmembers: []\n' })
    const p = await (await plan({ create: { name: 'Ana Costa' } })).json()
    expect(p.review.member).toMatchObject({ id: 'ana-costa', name: 'Ana Costa', created: true })
    expect(p.review.lines).toEqual(['  - id: ana-costa', '    name: "Ana Costa"', '    handles:', `      git: ${TEST_EMAIL}`])
  })

  const refused: [string, () => void, unknown, RegExp][] = [
    ['written rules', () => boot({ governance: 'governance:\n  rules:\n    - id: r1\n' }), { member: 'ana' }, /has rules for who its members are/],
    ['rules at the top level beside a governance block', () => boot({ governance: 'governance:\n  model: solo-maintainer\nrules:\n  - id: r1\n' }), { member: 'ana' }, /has rules for who its members are/],
    ['a non-solo model', () => boot({ governance: 'governance:\n  model: consensus\n' }), { member: 'ana' }, /not decided by one maintainer/],
    ['an unreadable governance.yaml', () => boot({ governance: 'governance:\n\tmodel: tab\n' }), { member: 'ana' }, /governance\.yaml cannot be read/],
    ['a known actor', () => boot({ members: MEMBERS.replace('github: "ana-costa"', `git: "${TEST_EMAIL}"`) }), { member: 'ana' }, /already `ana`/],
    ['an address already claimed in the top-level email', () => boot({ members: MEMBERS.replace('name: "Ana Costa"', `name: "Ana Costa"\n    email: "${TEST_EMAIL}"`) }), { member: 'ana' }, /already `ana`/],
    ['a member who has an address', () => boot(), { member: 'bo' }, /already has a git address/],
    ['a member who does not exist', () => boot(), { member: 'zed' }, /no member `zed`/],
    ['a create beside people', () => boot(), { create: { name: 'Zed' } }, /already has people/],
  ]
  for (const [name, setup, body, pattern] of refused) {
    it(`refuses ${name}, in a sentence, and issues no nonce`, async () => {
      removeFixtureRepo(repo)
      setup()
      const res = await plan(body)
      expect(res.status).toBe(409)
      const out = await res.json()
      expect(out.error).toMatch(pattern)
      expect(out.nonce).toBeUndefined()
    })
  }

  it('refuses an address git has never seen author a commit here', async () => {
    git('config', 'user.email', 'new@example.org')
    const out = await (await plan({ member: 'ana' })).json()
    expect(out.error).toBe('Git has never seen new@example.org author a commit here; add it to data/members.yaml yourself, or commit once and try again.')
  })

  it('refuses a members file with changes that are not committed', async () => {
    writeFileSync(join(repo, 'data', 'members.yaml'), `${MEMBERS}# note\n`)
    expect((await (await plan({ member: 'ana' })).json()).error).toMatch(/not committed/)
  })

  it('answers a body it cannot read with a sentence', async () => {
    for (const body of [{}, { member: 3 }, { member: 'ana', create: { name: 'x' } }, { create: {} }, { create: { name: 4 } }]) {
      const res = await plan(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect((await res.json()).error).toMatch(/\{"member": "<id>"\}/)
    }
  })

  it('is refused from another site, as every route is', async () => {
    const res = await post('/api/bootstrap/claim/plan', { member: 'ana' }, { origin: 'http://evil.example' })
    expect(res.status).toBe(403)
  })
})

describe('confirm: the write, the commit, the trailers, the undo', () => {
  it('writes one line, commits it once with the trailers, and the actor becomes the member', async () => {
    const p = await (await plan({ member: 'ana' })).json()
    const was = commits()
    const res = await confirm(p.nonce)
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out).toMatchObject({ ok: true, member: { id: 'ana' }, changed: ['data/members.yaml'] })
    expect(members()).toBe(MEMBERS.replace('      github: "ana-costa"\n', `      github: "ana-costa"\n      git: ${TEST_EMAIL}\n`))
    expect(commits()).toBe(was + 1)
    expect(out.commit).toBe(git('rev-parse', 'HEAD'))
    const body = git('log', '-1', '--format=%B')
    expect(body).toMatch(/^admin\(members\): claim the git handle for ana/)
    expect(body).toContain(`Org-Actor: unknown <${TEST_EMAIL}>`)
    expect(body).toContain('Org-Rule: bootstrap/claim')
    expect(git('show', '--stat', '--format=', 'HEAD')).toMatch(/data\/members\.yaml \| 1 \+/)
    expect(git('status', '--porcelain')).toBe('')
    expect(await actor()).toMatchObject({ id: 'ana' })
  })

  it('writes a new member when there is none to claim', async () => {
    removeFixtureRepo(repo)
    boot({ members: 'schema_version: "2.0"\nmembers: []\n' })
    const p = await (await plan({ create: { name: 'Ana Costa' } })).json()
    expect((await confirm(p.nonce)).status).toBe(200)
    expect(members()).toBe(`schema_version: "2.0"\nmembers:\n  - id: ana-costa\n    name: "Ana Costa"\n    handles:\n      git: ${TEST_EMAIL}\n`)
    expect(await actor()).toMatchObject({ id: 'ana-costa' })
  })

  it('is undone by git revert of that one commit, and the actor is unknown again', async () => {
    const p = await (await plan({ member: 'ana' })).json()
    const out = await (await confirm(p.nonce)).json()
    git('revert', '--no-edit', out.commit)
    expect(members()).toBe(MEMBERS)
    expect(await actor()).toEqual({ unknown: TEST_EMAIL })
  })

  it('takes a nonce once: the second use is refused and writes nothing', async () => {
    const p = await (await plan({ member: 'ana' })).json()
    expect((await confirm(p.nonce)).status).toBe(200)
    const was = commits()
    const again = await confirm(p.nonce)
    expect(again.status).toBe(409)
    expect((await again.json()).error).toMatch(/already used or has expired/)
    expect(commits()).toBe(was)
  })

  it('refuses an invented nonce, or none, and writes nothing', async () => {
    expect((await confirm('f'.repeat(48))).status).toBe(409)
    expect((await confirm(undefined)).status).toBe(409)
    expect(members()).toBe(MEMBERS)
  })

  const changed: [string, (sha: string) => Promise<void> | void, RegExp][] = [
    ['another claim lands first', () => {
      writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS.replace('github: "ana-costa"', 'git: "ana@example.org"'))
      git('commit', '-qam', 'someone else claimed')
    }, /data\/members\.yaml/],
    ['a hand edit that is not committed', () => { writeFileSync(join(repo, 'data', 'members.yaml'), `${MEMBERS}# edited\n`) }, /data\/members\.yaml/],
    ['a rule is written', () => {
      writeFileSync(join(repo, 'data', 'governance.yaml'), 'governance:\n  rules:\n    - id: r1\n')
      git('add', 'data/governance.yaml'); git('commit', '-qm', 'rules')
    }, /data\/governance\.yaml/],
    ['governance.yaml becomes unreadable', () => {
      writeFileSync(join(repo, 'data', 'governance.yaml'), 'governance: [unclosed\n')
      git('add', 'data/governance.yaml'); git('commit', '-qm', 'broken')
    }, /data\/governance\.yaml/],
    ['the git email changes', () => { git('config', 'user.email', 'other@example.org') }, /your git email/],
  ]
  for (const [name, change, pattern] of changed) {
    it(`re-checks at confirm: ${name}`, async () => {
      const p = await (await plan({ member: 'ana' })).json()
      await change('')
      const was = commits()
      const text = members()
      const res = await confirm(p.nonce)
      expect(res.status).toBe(409)
      const out = await res.json()
      expect(out.error).toMatch(/^Something changed since you reviewed this: /)
      expect(out.error).toMatch(pattern)
      expect(out.error).toMatch(/Nothing was written\. Prepare it again\.$/)
      expect(members()).toBe(text)
      expect(commits()).toBe(was)
    })
  }

  it('refuses when a rule is written and the page is behind: the gate is asked again, not trusted', async () => {
    const p = await (await plan({ member: 'ana' })).json()
    writeFileSync(join(repo, 'data', 'governance.yaml'), 'governance:\n  model: solo-maintainer\n  rules:\n    - id: r1\n')
    const out = await (await confirm(p.nonce)).json()
    expect(out.error).toMatch(/Something changed/)
    expect(members()).toBe(MEMBERS)
  })

  it('does not commit a job that changed a file it did not declare, and says so', async () => {
    removeFixtureRepo(repo)
    const dir = mkdtempSync(join(tmpdir(), 'claim-script-'))
    const script = join(dir, 'greedy.mjs')
    writeFileSync(script, `import { writeFileSync, appendFileSync } from 'node:fs'
appendFileSync('data/members.yaml', '# edited\\n'); writeFileSync('data/extra.yaml', 'x: 1\\n')\n`)
    chmodSync(script, 0o755)
    boot({ script })
    const p = await (await plan({ member: 'ana' })).json()
    const was = commits()
    const res = await confirm(p.nonce)
    expect(res.status).toBe(500)
    const out = await res.json()
    expect(out.error).toMatch(/changed files it does not declare|changed .* it did not say/i)
    expect(out.error).toMatch(/nothing was committed/i)
    expect(commits()).toBe(was)
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers "written, not committed" and leaves the file when git refuses the commit', async () => {
    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "no commits today" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    const p = await (await plan({ member: 'ana' })).json()
    const res = await confirm(p.nonce)
    expect(res.status).toBe(503)
    const out = await res.json()
    expect(out.code).toBe('WRITTEN_NOT_COMMITTED')
    expect(out.error).toMatch(/^Written, not committed: data\/members\.yaml has the new line/)
    expect(members()).toContain(`git: ${TEST_EMAIL}`)
  })
})

// DAO-OS L5 Task 11 (F-L3-1, spec §8.1): in a locked-out org the HTTP claim refuses and names the owner's command;
// the routes never make the owner's claim themselves (C-9).
describe('a locked-out organisation', () => {
  const LOCKED = `governance:
  model: steward-council
  roles:
    stewards: { members: [ana] }
  rules:
    - id: members
      applies_to: [members, governance]
      propose: stewards
      decide: { by: stewards, method: direct }
`
  const COMMAND = 'node scripts/claim-handle.mjs --repo <instance> --owner --member <id> (--git <email> | --wallet <CAIP-10>)'

  it('GET says it is locked out, and its refusal names the command', async () => {
    removeFixtureRepo(repo)
    boot({ governance: LOCKED })
    const r = await (await app.request('/api/bootstrap/claim')).json()
    expect(r).toMatchObject({ available: false, lockedOut: true, command: COMMAND, candidates: [] })
    expect(r.refusal).toBe('This organisation has rules for who its members are, and nobody can propose a change to them: the stewards role, ' +
      `which proposes them, holds no person with a git or wallet handle. Its owner can add a handle on the machine that holds the repository: ${COMMAND}`)
  })

  it('plan refuses with the same sentence and writes nothing; a body asking for the owner\'s claim is not a body the route takes', async () => {
    removeFixtureRepo(repo)
    boot({ governance: LOCKED })
    const before = members()
    const res = await plan({ member: 'ana' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain(COMMAND)
    const owner = await plan({ member: 'ana', owner: true, wallet: 'eip155:42220:0x00000000000000000000000000000000000000a1' })
    expect(owner.status).toBe(400)
    expect(members()).toBe(before)
  })

  it('an org that is not locked out says so, with no command', async () => {
    const r = await (await app.request('/api/bootstrap/claim')).json()
    expect(r).toMatchObject({ available: true, lockedOut: false, command: null })
  })
})
