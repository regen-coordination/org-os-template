import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { MEMBERS_ONLY } from '../../server/visibility/gate.ts'
import { EDITORS } from '../../lib/workspace/editors.mjs'
import { diffFor } from '../../server/workspace/reads.ts'
import {
  AGENT_LAYER, CONTROL, DAY, MAIL, MAINTAINED, NAMED, T0, UNMAINTAINED,
  HOST, call, cookieFor, fileAt, house, missing, readable, repoWith, DECIDERS_ROWS,
} from './file-reads.fixtures.ts'

// 0.7.1 (D6, rulings PR7-R91…): on a Hub that signs people in, the workspace's agent layer — memory/**, MEMORY.md,
// HEARTBEAT.md, docs/plans/**, docs/agent-plans/** — is read only by those who decide under the workspace rule that governs
// it. Anyone else is answered as for a path that is not there (404, the same words), so nothing says whether the file
// exists. The person at the machine (git's identity) reads what git holds, as in 0.6. Synthetic values only: Example DAO.

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
    // M1 (PR7-R97): a withheld op names nothing of its file, not even its path.
    expect(theirs.ops[0]).toEqual({ op: 'file', withheld: true })
    expect(JSON.stringify(theirs.ops)).not.toContain(DAY)
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
