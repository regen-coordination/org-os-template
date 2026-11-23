import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../../server/serve.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { slugOf } from '../../lib/workspace/pages.mjs'
import { DOC, HUB, MAIL, PEPPER, cookieFor, house, repoWith } from './file-reads.fixtures.ts'

// org-os 0.7.3: the fresh review of 0.7.2's round 3, its probes kept as tests (synthetic values only). Writes on: what still
// reached a kept file, or said it exists (I1, I2, M-a), and the library's receipts (I4).

const TASK = 'SENTINEL-TASK-r3'
const RECEIPT = 'SENTINEL-RECEIPT-r3'
const SHELF = join(dirname(fileURLToPath(import.meta.url)), '..', 'library', 'fixtures', 'test-shelf')
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["example-dao:person:steward"] }
`
const POLICY = (files: string) => `visibility:
  collections:
    projects: { default: public }
    members:
      default: public
      fields: { name: members }
${files}`
const FILES = `  files:
    default: role:steward
    paths:
      data/projects.yaml: members
`
const MEETING = slugOf('2026-11-20 Council')

function repoOf(files = FILES): string {
  const repo = repoWith(GOVERNANCE)
  const data: Record<string, string> = {
    'data/tasks.yaml': `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: open }\n`,
    'data/meetings.yaml': `schema_version: "2.0"\nmeetings:\n  - { id: ${MEETING}, title: "Council", date: "2026-11-20" }\n`,
    'data/visibility.yaml': POLICY(files),
    'pages/hello-0001.md': `---\ntitle: Hello\n---\n\nA members page.\n`,
  }
  for (const [p, t] of Object.entries(data)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t) }
  appendFileSync(join(repo, 'federation.yaml'), `library:\n  shelves:\n    - { path: ${SHELF} }\n`)
  execSync('git add -A && git commit -qm "fixture: tasks, meetings, a page, the policy, the shelf"', { cwd: repo, stdio: 'pipe' })
  return repo
}

async function hostedWritesOn(repo: string) {
  vi.stubEnv('HOUSE_EMAIL_PEPPER', PEPPER)
  vi.stubEnv('HOUSE_SESSION_PRIVATE_JWK', JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })))
  vi.stubEnv('SESSION_COOKIE_NAME', 'org_session_dev')
  vi.stubEnv('SESSION_COOKIE_DOMAIN', 'example.org')
  vi.stubEnv('RESEND_API_KEY', 're_test_synthetic')
  vi.stubEnv('MAIL_FROM', 'hub@example.org')
  const mailer = recordingMailer()
  const server = await startServer({ repo, port: 0, hosted: true, mailer, instanceWrites: 'on', fetch: async () => { throw new Error('no network in this test') },
    hostedConfig: { origin: HUB, host: new URL(HUB).host, portalOrigin: null, bind: '127.0.0.1', port: 0, trustProxy: true, portalDir: repo, portalEveryMs: null, push: false } as HostedConfig })
  await server.privateStore!.replaceRoles(DOC)
  let n = 0
  const ask = (path: string, init: RequestInit = {}, cookie?: string) => { n++; return Promise.resolve(server.app.request(`${HUB}${path}`,
    { ...init, headers: { host: new URL(HUB).host, origin: HUB, 'x-real-ip': `10.7.${(n >> 8) & 255}.${n & 255}`, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } })) }
  const cookieOf = async (email: string) => {
    const before = mailer.sent.length
    await ask('/api/session/email', { method: 'POST', body: JSON.stringify({ email }) })
    for (let i = 0; i < 50 && mailer.sent.length === before; i++) await new Promise(r => setTimeout(r, 20))
    const token = new URL(mailer.sent[before]!.link).searchParams.get('token')!
    const res = await ask('/api/session/link', { method: 'POST', body: JSON.stringify({ token }) })
    return `org_session_dev=${res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!}`
  }
  const close = async () => { await server.close(); vi.unstubAllEnvs() }
  return { server, ask, close, member: await cookieOf(MAIL.member) }
}

describe('0.7.3, review of round 3: records minted into a kept file, and their slug de-dup as an existence oracle', () => {
  it('POST /api/meetings by a member the meetings file is kept from is refused, alike for a meeting that exists and one that does not', async () => {
    const h = await house(repoOf(), { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const send = (title: string) => h.app.request('http://localhost:4680/api/meetings', { method: 'POST',
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, body: JSON.stringify({ title, date: '2026-11-20' }) })
    const hit = await send('Council')
    const hitBody = await hit.text()
    const miss = await send('Nothing Like It')
    const missBody = await miss.text()
    expect(hit.status).toBe(422)
    expect(miss.status).toBe(422)
    expect(hitBody.replace('Council', '')).toBe(missBody.replace('Nothing Like It', ''))
  })

  it('Turn into a task by a member the tasks file is kept from is refused, alike whether a task id exists or not', async () => {
    const h = await hostedWritesOn(repoOf())
    try {
      const comment = async (body: string) => {
        const r = await h.ask('/api/comments', { method: 'POST', body: JSON.stringify({ target: 'page:hello-0001', body }) }, h.member)
        const j = await r.json() as { comment?: { id: string } }
        return j.comment!.id
      }
      const hit = await h.ask(`/api/comments/${await comment('t 1')}/task`, { method: 'POST', body: '{}' }, h.member)
      const hitBody = await hit.text()
      const miss = await h.ask(`/api/comments/${await comment('t 9')}/task`, { method: 'POST', body: '{}' }, h.member)
      const missBody = await miss.text()
      expect(hit.status).toBe(422)
      expect(missBody).toBe(hitBody)
    } finally { await h.close() }
  }, 60_000)
})

describe('0.7.3, review of round 3: library answers', () => {
  it('a library add into kept files is refused, and says nothing of a kept record staged before the file was kept', async () => {
    const repo = repoOf('')
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const send = (method: string, path: string, body?: unknown) => h.app.request(`http://localhost:4680${path}`, { method,
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    expect((await send('POST', '/api/changes/ops', { ops: [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }] })).status).toBe(200)
    writeFileSync(join(repo, 'data/visibility.yaml'), POLICY(FILES))
    writeFileSync(join(repo, 'data/tasks.yaml'), `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: blocked, notes: "moved-r3" }\n`)
    execSync('git commit -qam "policy: the files section; the task moved"', { cwd: repo, stdio: 'pipe' })
    const tray = await (await send('GET', '/api/changes')).json() as { state: string; stale: number[] }
    expect(JSON.stringify(tray)).not.toContain(TASK) // round 3's own claim holds here
    const added = await send('POST', '/api/library/board:test-desk/add', {})
    const text = await added.text()
    expect(text).not.toContain(TASK)
  })

  it('a library add the member may make answers the tray withheld: nothing of a kept record staged before it was kept', async () => {
    const repo = repoOf('')
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const send = (method: string, path: string, body?: unknown) => h.app.request(`http://localhost:4680${path}`, { method,
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    expect((await send('POST', '/api/changes/ops', { ops: [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }] })).status).toBe(200)
    // The library's own files stay members': the add is the member's to make; the tasks file is kept.
    writeFileSync(join(repo, 'data/visibility.yaml'), POLICY(`${FILES}      data/library.yaml: members\n      data/boards.yaml: members\n`))
    writeFileSync(join(repo, 'data/tasks.yaml'), `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: blocked, notes: "moved-r3" }\n`)
    execSync('git commit -qam "policy: the files section; the task moved"', { cwd: repo, stdio: 'pipe' })
    const added = await send('POST', '/api/library/board:test-desk/add', {})
    expect(added.status).toBe(200)
    const text = await added.text()
    expect(text).toContain('boards:test-desk')
    expect(text).not.toContain(TASK)
    expect(text).not.toContain('moved-r3')
  })

  it('the tray\'s `state` says nothing of a kept record that moved', async () => {
    const repo = repoOf('')
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const send = (method: string, path: string, body?: unknown) => h.app.request(`http://localhost:4680${path}`, { method,
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    expect((await send('POST', '/api/changes/ops', { ops: [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }] })).status).toBe(200)
    writeFileSync(join(repo, 'data/visibility.yaml'), POLICY(FILES))
    execSync('git commit -qam "policy: the files section"', { cwd: repo, stdio: 'pipe' })
    const before = await (await send('GET', '/api/changes')).json() as { state: string; stale: number[] }
    writeFileSync(join(repo, 'data/tasks.yaml'), `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: blocked }\n`)
    execSync('git commit -qam "the task moved"', { cwd: repo, stdio: 'pipe' })
    const after = await (await send('GET', '/api/changes')).json() as { state: string; stale: number[] }
    expect(after.state).toBe(before.state)
  })

  it('GET /api/library and an entry preview list no receipt of a kept data/library.yaml', async () => {
    const repo = repoOf()
    writeFileSync(join(repo, 'data/library.yaml'), `installed:
  - id: ${RECEIPT}
    entry: board:test-desk
    version: 1.0.0
    shelf: test-shelf
    created:
      - { record: boards:test-desk, base: null }
    status: installed
    by: probe-a
    at: 2026-10-29
    decision: { rule: records/direct, change: chg_x }
    removed: null
`)
    execSync('git add -A && git commit -qm "fixture: a receipt"', { cwd: repo, stdio: 'pipe' })
    const h = await house(repo)
    const member = await cookieFor(h, MAIL.member)
    const get = (path: string) => h.app.request(`http://localhost:4680${path}`, { headers: { host: 'localhost:4680', cookie: member } })
    const receipts = await get('/api/library/receipts')
    const list = await (await get('/api/library')).text()
    const preview = await (await get('/api/library/board:test-desk/preview')).text()
    expect(receipts.status).toBe(404) // round 3's fix
    expect(list + preview).not.toContain(RECEIPT)
  })
})

describe('0.7.3, review of round 3: a library rules entry against a kept data/governance.yaml', () => {
  const SENTINEL_GOV = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["example-dao:person:steward"] }
    sentinel-role-r3: { members: ["example-dao:person:steward"] }
  rules:
    - { id: sentinel-rule-r3, applies_to: [records], propose: maintainer, decide: { by: maintainer, method: direct } }
`
  const withGov = () => {
    const repo = repoOf()
    writeFileSync(join(repo, 'data/governance.yaml'), SENTINEL_GOV)
    execSync('git commit -qam "fixture: governance with sentinels"', { cwd: repo, stdio: 'pipe' })
    return repo
  }
  it('preview (a read, writes off) says nothing of the kept governance', async () => {
    const h = await house(withGov())
    const member = await cookieFor(h, MAIL.member)
    const get = (path: string) => h.app.request(`http://localhost:4680${path}`, { headers: { host: 'localhost:4680', cookie: member } })
    const gov = await (await get('/api/governance')).text()
    const texts: string[] = []
    for (const id of ['rules:approve-one-maintainer', 'rules:consent-7d', 'rules:vote-quorum', 'rules:treasury-safe', 'system:safe']) {
      const r = await get(`/api/library/${id}/preview`)
      texts.push(`${id} ${r.status} ${await r.text()}`)
    }
    const all = texts.join('\n')
    expect(all).not.toContain('sentinel-')
  })
  it('add (writes on) answers nothing of the kept governance', async () => {
    const h = await house(withGov(), { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const r = await h.app.request('http://localhost:4680/api/library/rules:approve-one-maintainer/add', { method: 'POST',
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, body: '{}' })
    const text = await r.text()
    expect(text).not.toContain('sentinel-')
  })
})
