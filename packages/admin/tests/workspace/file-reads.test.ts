import { describe, it, expect, afterEach, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Hono } from 'hono'
import { makeFixtureRepo, TEST_EMAIL } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type RolesDoc } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { mountEmailSignIn, type EmailSignIn } from '../../server/session/email.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { Membership } from '../../server/session/membership.ts'
import { mountSession } from '../../server/session/routes.ts'
import { withRequest } from '../../server/request.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { MEMBERS_ONLY } from '../../server/visibility/gate.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { EDITORS } from '../../lib/workspace/editors.mjs'
import { emailKey } from '../../lib/session-token.mjs'
import { diffFor } from '../../server/workspace/reads.ts'

// 0.7.1 (D6, rulings PR7-R91…): on a Hub that signs people in, the workspace's agent layer — memory/**, MEMORY.md,
// HEARTBEAT.md, docs/plans/**, docs/agent-plans/** — is read only by those who decide under the workspace rule that governs
// it. Anyone else is answered as for a path that is not there (404, the same words), so nothing says whether the file
// exists. The person at the machine (git's identity) reads what git holds, as in 0.6. Synthetic values only: Example DAO.

const HUB = 'https://hub.example.org'
const HOST = 'localhost:4680'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-11-18T10:00:00.000Z')
const ID = {
  steward: 'example-dao:person:steward', member: 'example-dao:person:network-member', none: 'example-dao:person:no-role',
  rolesOnly: 'example-dao:person:roles-steward', local: 'example-dao:person:at-the-machine',
}
const MAIL = { steward: 'steward@example.org', member: 'member@example.org', none: 'none@example.org', rolesOnly: 'roles-steward@example.org' }
const DOC: RolesDoc = {
  roles_version: '2026-11-18',
  people: [
    { id: ID.steward, name: 'Example Steward', email_keys: [emailKey(MAIL.steward, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
    { id: ID.member, name: 'Example Member', email_keys: [emailKey(MAIL.member, PEPPER)], roles: ['network-member'], nodes: [] },
    { id: ID.none, name: 'Example Nobody', email_keys: [emailKey(MAIL.none, PEPPER)], roles: [], nodes: [] },
    // A Roles-table steward the governance lists in no role: their Role is no governance role (PR7-R92).
    { id: ID.rolesOnly, name: 'Example Roles Steward', email_keys: [emailKey(MAIL.rolesOnly, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
  ],
}
const MEMBERS = `schema_version: "2.0"
members:
  - { id: "${ID.steward}", name: "Example Steward", kind: person }
  - { id: "${ID.member}", name: "Example Member", kind: person }
  - { id: "${ID.rolesOnly}", name: "Example Roles Steward", kind: person }
  - { id: "${ID.local}", name: "At The Machine", kind: person, handles: { git: ["${TEST_EMAIL}"] } }
`
/** A workspace rule that names its deciders: the council decides the agent layer. */
const NAMED = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { members: ["${ID.steward}", "${ID.local}"] }
    steward: { members: [] }
  rules:
    - { id: agent-layer, applies_to: ["workspace:agent"], propose: council, decide: { by: council, method: direct } }
    - { id: everything, applies_to: [all], propose: council, decide: { by: council, method: approve, count: 1 } }
`
/** No workspace rule (WORKSPACE_DIRECT): the org's own defined maintainer role reads. */
const MAINTAINED = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
`
/** No workspace rule and no maintainer role defined: the implied one (everyone) does not count, so no signed-in viewer reads. */
const UNMAINTAINED = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { members: ["${ID.steward}"] }
`
const DAY = 'memory/2026-11-01.md'
const AGENT_LAYER: Record<string, string> = {
  [DAY]: '# 1 Nov\n\nSynthetic council note: the treasury review moves to Friday.\n',
  'MEMORY.md': '# Memory\n\n- synthetic index line\n',
  'HEARTBEAT.md': '# Heartbeat\n\n- synthetic pulse\n',
  'docs/agent-plans/plan-a.md': '# Plan A\n\nSynthetic agent plan.\n',
  'docs/plans/plan-b.md': '# Plan B\n\nSynthetic strategic plan.\n',
}
const CONTROL = 'data/governance.yaml'

const cleanup: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) { try { f() } catch { /* gone */ } } })

function signInConfig(): SignInConfig {
  const read = readSignInConfig({
    HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })),
    SESSION_COOKIE_NAME: 'org_session_dev', SESSION_COOKIE_DOMAIN: 'example.org', RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
  }, { hosted: true, origin: HUB })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}

/** A fresh repository holding the agent layer, with `governance`, all committed (a governed file is one git tracks). */
function repoWith(governance: string): string {
  const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), governance)
  writeFileSync(join(repo, 'IDENTITY.md'), '# Example DAO\n')
  for (const [path, text] of Object.entries(AGENT_LAYER)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  execSync('git add -A && git commit -qm "fixture: the agent layer"', { cwd: repo, stdio: 'pipe' })
  return repo
}

/** The hosted Hub with instance writes off, signing people in by emailed link (tests/session/person.test.ts's house). */
async function house(repo: string, o: { proposals?: boolean; writes?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'file-reads-store-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
  await store.replaceRoles(DOC)
  const now = () => T0
  const reader = {
    wearer: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const signIn = signInConfig()
  const mailer = recordingMailer()
  const hostedConfig = { origin: HUB, trustProxy: false } as HostedConfig
  let email: EmailSignIn | undefined
  const app = createApp(repo, (a, ctx) => {
    mountSession(a, { repo, store, membership, hosted: true, signIn, now })
    email = mountEmailSignIn(a, { repo, store, config: signIn, mailer, now, hosted: hostedConfig })
    if (o.proposals) mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, hosted: true, readOnly: true, membership })
  }, { request: withRequest({ repo, hosted: true, membership, store, signIn, now }), hosted: true, ...(o.writes ? {} : { instanceWrites: 'off' as const }) })
  return { app, signIn, mailer, settled: () => email!.settled() }
}
type House = Awaited<ReturnType<typeof house>>

function call(app: Hono, path: string, cookie?: string) {
  return app.request(`http://${HOST}${path}`, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } })
}

async function cookieFor(h: House, email: string): Promise<string> {
  const before = h.mailer.sent.length
  await h.app.request(`http://${HOST}/api/session/email`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  await h.settled()
  const token = new URL(h.mailer.sent[before]!.link).searchParams.get('token')!
  const res = await h.app.request(`http://${HOST}/api/session/link`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  expect(res.status).toBe(200)
  const jws = res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!
  return `${h.signIn.cookie.name}=${jws}`
}

const fileAt = (app: Hono, path: string, cookie?: string) => call(app, `/api/files?path=${encodeURIComponent(path)}`, cookie)
/** What a path that is not there is answered with: the same words, whoever asks. */
const missing = (path: string) => ({ error: `${path} is not a governed file, so it has no editor here.` })
const readable = async (app: Hono, cookie?: string) =>
  Object.fromEntries(((await (await call(app, '/api/editors', cookie)).json()) as { pattern: string; readable: boolean }[]).map(r => [r.pattern, r.readable]))
const DECIDERS_ROWS = ['memory/**', 'MEMORY.md', 'HEARTBEAT.md', 'docs/plans/**', 'docs/agent-plans/**']

async function seesAll(app: Hono, cookie: string): Promise<void> {
  for (const [path, text] of Object.entries(AGENT_LAYER)) {
    const res = await fileAt(app, path, cookie)
    expect([path, res.status]).toEqual([path, 200])
    expect(await res.json()).toMatchObject({ path, text, editor: 'source', class: 'workspace' })
  }
  const rows = await readable(app, cookie)
  for (const pattern of DECIDERS_ROWS) expect([pattern, rows[pattern]]).toEqual([pattern, true])
}

async function seesNone(app: Hono, cookie: string): Promise<void> {
  for (const path of Object.keys(AGENT_LAYER)) {
    const res = await fileAt(app, path, cookie)
    expect([path, res.status, await res.json()]).toEqual([path, 404, missing(path)])
  }
  // A day that is not there reads exactly as a day that is, and as a path no rule governs.
  const absent = await fileAt(app, 'memory/2026-11-02.md', cookie)
  expect([absent.status, await absent.json()]).toEqual([404, missing('memory/2026-11-02.md')])
  const ungoverned = await fileAt(app, 'notes/2026-11-01.md', cookie)
  expect([ungoverned.status, await ungoverned.json()]).toEqual([404, missing('notes/2026-11-01.md')])
  const rows = await readable(app, cookie)
  for (const pattern of DECIDERS_ROWS) expect([pattern, rows[pattern]]).toEqual([pattern, false])
}

describe('the agent layer is read by its deciders (0.7.1, D6)', () => {
  it('four viewers on a hosted Hub, a workspace rule naming its deciders', async () => {
    const h = await house(repoWith(NAMED))
    // The public, and a person holding no Role (who reads as the public): the members' side is closed, as before.
    for (const cookie of [undefined, await cookieFor(h, MAIL.none)]) {
      for (const path of [DAY, CONTROL]) {
        const res = await fileAt(h.app, path, cookie)
        expect([res.status, await res.json()]).toEqual([401, { error: MEMBERS_ONLY, code: 'SIGN_IN' }])
      }
      expect((await call(h.app, '/api/editors', cookie)).status).toBe(401)
    }
    // A network member: every member reads the control file; none of the agent layer, as if it were not there.
    const member = await cookieFor(h, MAIL.member)
    expect((await fileAt(h.app, CONTROL, member)).status).toBe(200)
    await seesNone(h.app, member)
    const rows = await readable(h.app, member)
    expect(rows['data/governance.yaml']).toBe(true)
    expect(rows['IDENTITY.md']).toBe(true)
    // The steward decides under the rule (the council): they read all of it.
    const steward = await cookieFor(h, MAIL.steward)
    await seesAll(h.app, steward)
    expect((await fileAt(h.app, CONTROL, steward)).status).toBe(200)
    // A day not written yet is still one the steward may create: as before, 200 with no text.
    expect(await (await fileAt(h.app, 'memory/2026-11-02.md', steward)).json()).toMatchObject({ path: 'memory/2026-11-02.md', text: null })
  })

  it('a Roles-table Role is not the governance role of the same name (PR7-R92)', async () => {
    // The governance defines `steward` with nobody in it, and a rule decided by it: a Roles-table steward does not decide.
    const h = await house(repoWith(NAMED.replace('decide: { by: council, method: direct }', 'decide: { by: steward, method: direct }')))
    await seesNone(h.app, await cookieFor(h, MAIL.rolesOnly))
  })

  it('no workspace rule: the org\'s own maintainer role reads', async () => {
    const h = await house(repoWith(MAINTAINED))
    await seesAll(h.app, await cookieFor(h, MAIL.steward))
    await seesNone(h.app, await cookieFor(h, MAIL.member))
  })

  it('no workspace rule and no maintainer role: no signed-in viewer reads the agent layer', async () => {
    const h = await house(repoWith(UNMAINTAINED))
    await seesNone(h.app, await cookieFor(h, MAIL.steward))
    await seesNone(h.app, await cookieFor(h, MAIL.member))
    expect((await fileAt(h.app, CONTROL, await cookieFor(h, MAIL.member))).status).toBe(200)
  })

  it('the person at the machine (git\'s identity) still reads it; a preview reads as the viewer it previews (PR7-R93)', async () => {
    const repo = repoWith(UNMAINTAINED)
    const app = createApp(repo)
    for (const [path, text] of Object.entries(AGENT_LAYER)) {
      const res = await app.request(`/api/files?path=${encodeURIComponent(path)}`)
      expect([path, res.status, (await res.json()).text]).toEqual([path, 200, text])
    }
    expect(await (await app.request('/api/editors')).json()).toEqual(JSON.parse(JSON.stringify(EDITORS.map(r => ({ ...r, readable: true })))))
    // View as members: what a member would read, so the agent layer is not there.
    const preview = await app.request(`/api/files?path=${encodeURIComponent(DAY)}&as=members`)
    expect([preview.status, await preview.json()]).toEqual([404, missing(DAY)])
    // A git identity no member holds reads what git holds too, as in 0.6.
    execSync('git config user.email nobody-here@example.org', { cwd: repo, stdio: 'pipe' })
    expect((await createApp(repo).request(`/api/files?path=${encodeURIComponent(DAY)}`)).status).toBe(200)
  })
})

describe('a proposal on the agent layer, as each viewer reads it (0.7.1, D6)', () => {
  it('drops the hunks and the text of a path the viewer may not read, file by file', async () => {
    const repo = repoWith(NAMED)
    // Proposed at the machine: a memory day and the org's identity, in one proposal.
    const local = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => T0 }))
    const post = (path: string, body: unknown) => local.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const SECRET = 'Synthetic council-only line: the grant shortlist.'
    const staged = await post('/api/changes/ops', { ops: [
      { op: 'file', path: DAY, text: `${AGENT_LAYER[DAY]}\n${SECRET}\n` },
      { op: 'file', path: 'IDENTITY.md', text: '# Example DAO\n\nA synthetic line every member reads.\n' },
    ] })
    expect(staged.status).toBe(200)
    const proposed = await post('/api/proposals', { title: 'Note the shortlist' })
    expect(proposed.status).toBe(201)
    const id = String((await proposed.json()).id)

    const h = await house(repo, { proposals: true })
    const member = await cookieFor(h, MAIL.member)
    const steward = await cookieFor(h, MAIL.steward)
    const detail = async (cookie: string) => {
      const res = await call(h.app, `/api/proposals/${id}`, cookie)
      expect(res.status).toBe(200)
      return res.json() as Promise<{ diff: string | null; ops: { op: string; path?: string; text?: string | null }[] }>
    }
    const theirs = await detail(member)
    expect(theirs.diff).toContain('diff --git a/IDENTITY.md b/IDENTITY.md')
    expect(theirs.diff).toContain('A synthetic line every member reads.')
    expect(theirs.diff).not.toContain(DAY)
    expect(theirs.diff).not.toContain(SECRET)
    expect(JSON.stringify(theirs)).not.toContain(SECRET)
    expect(JSON.stringify(theirs)).not.toContain('treasury review')
    const day = theirs.ops.find(o => o.path === DAY)!
    expect(day).toEqual({ op: 'file', path: DAY, withheld: true })
    expect(theirs.ops.find(o => o.path === 'IDENTITY.md')?.text).toContain('A synthetic line every member reads.')
    // The list holds the same ops.
    const list = await (await call(h.app, '/api/proposals', member)).json() as { id: string }[]
    expect(JSON.stringify(list)).not.toContain(SECRET)

    const ours = await detail(steward)
    expect(ours.diff).toContain(`diff --git a/${DAY} b/${DAY}`)
    expect(ours.diff).toContain(SECRET)
    expect(ours.diff).toContain('A synthetic line every member reads.')
    expect(ours.ops.find(o => o.path === DAY)?.text).toContain(SECRET)
    expect(JSON.stringify(await (await call(h.app, '/api/proposals', steward)).json())).toContain(SECRET)
  })
})

describe('staging the agent layer unread (0.7.1, D6; PR7-R94)', () => {
  it('a file op on a path the viewer may not read is refused as on a path that is not there', async () => {
    const h = await house(repoWith(NAMED), { writes: true })
    const stage = (cookie: string, path: string) => h.app.request(`http://${HOST}/api/changes/ops`, {
      method: 'POST', headers: { host: HOST, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'file', path, text: '# synthetic\n' }] }),
    })
    const member = await cookieFor(h, MAIL.member)
    const res = await stage(member, DAY)
    expect([res.status, await res.json()]).toEqual([422, { errors: [{ record: DAY, field: 'path', message: `${DAY} is not a governed file, so it has no editor here. Nothing was staged.` }] }])
    const steward = await cookieFor(h, MAIL.steward)
    expect((await stage(steward, DAY)).status).toBe(200)
  })
})

describe('diffFor: a diff without the files a viewer may not read', () => {
  const may = (path: string) => !path.startsWith('memory/')
  const section = (a: string, b: string, body = '@@ -1 +1 @@\n-x\n+y\n') => `diff --git a/${a} b/${b}\nindex 1..2 100644\n--- a/${a}\n+++ b/${b}\n${body}`
  it('drops a file\'s sections, a rename into or out of the layer, and keeps the rest byte for byte', () => {
    const keep = section('IDENTITY.md', 'IDENTITY.md')
    const day = section('memory/2026-11-01.md', 'memory/2026-11-01.md')
    const moved = 'diff --git a/notes.md b/memory/notes.md\nsimilarity index 90%\nrename from notes.md\nrename to memory/notes.md\n'
    const created = 'diff --git a/memory/new.md b/memory/new.md\nnew file mode 100644\nindex 0..1\n--- /dev/null\n+++ b/memory/new.md\n@@ -0,0 +1 @@\n+secret\n'
    expect(diffFor(`${keep}${day}${moved}${created}${keep}`, may)).toBe(`${keep}${keep}`)
  })
  it('keeps everything for the person at the machine', () => {
    const all = Object.assign(() => true, { all: true as const })
    const day = section('memory/2026-11-01.md', 'memory/2026-11-01.md')
    expect(diffFor(day, all)).toBe(day)
  })
})
