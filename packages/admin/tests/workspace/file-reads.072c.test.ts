import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { WebSocket } from 'ws'
import { startServer } from '../../server/serve.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { checkVisibilityPolicy, fileLevel, readFilesPolicy } from '../../lib/visibility.mjs'
import { DOC, HUB, ID, MAIL, PEPPER, cookieFor, house, repoWith } from './file-reads.fixtures.ts'

// org-os 0.7.2, round 3: what the second review of round 2 found still reaching a member a file is kept from (its findings
// 1-7). Synthetic values only.

const TASK = 'SENTINEL-TASK-0f73'
const SYSTEM = 'treasury-0f73'
const IMPORT = 'SENTINEL-IMPORT-0f73'
const NAMES = ['Example Steward', 'Example Member', 'Example Roles Steward', 'At The Machine']

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
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

function repoOf(): string {
  const repo = repoWith(GOVERNANCE)
  const data: Record<string, string> = {
    'data/tasks.yaml': `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: open }\n  - { id: t-2, title: "Another task", status: open }\n`,
    'data/systems.yaml': `schema_version: "2.0"\nsystems:\n  - { id: ${SYSTEM}, name: "Treasury", driver: link }\n`,
    'data/imports.yaml': `imports:\n  - { id: ${IMPORT}, source: "${IMPORT}", export: x }\n`,
    'data/visibility.yaml': POLICY(FILES),
    // Imported (members read it), so the import list names its import.
    'pages/hello-0001.md': `---\ntitle: Hello\nfrom: { source: "${IMPORT}", id: "0123456789abcdef0123456789abcdef", exported: x }\n---\n\nA members page.\n`,
  }
  for (const [p, t] of Object.entries(data)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t) }
  execSync('git add -A && git commit -qm "fixture: tasks, systems, imports, a page, the policy"', { cwd: repo, stdio: 'pipe' })
  // A Steward's commit to the projects (members read them): the map's `changed.by` names who made it.
  execSync('printf "\\n" >> data/projects.yaml && git add -A', { cwd: repo, stdio: 'pipe' })
  execSync(`git commit -qm "projects: a line" -m "Org-Actor: ${ID.steward}"`, { cwd: repo, stdio: 'pipe' })
  return repo
}

/** The hosted server as Railway runs it (writes off), with the fixture's Roles, a way to sign people in, and its port. */
async function hosted(repo: string) {
  vi.stubEnv('HOUSE_EMAIL_PEPPER', PEPPER)
  vi.stubEnv('HOUSE_SESSION_PRIVATE_JWK', JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })))
  vi.stubEnv('SESSION_COOKIE_NAME', 'org_session_dev')
  vi.stubEnv('SESSION_COOKIE_DOMAIN', 'example.org')
  vi.stubEnv('RESEND_API_KEY', 're_test_synthetic')
  vi.stubEnv('MAIL_FROM', 'hub@example.org')
  const mailer = recordingMailer()
  const server = await startServer({ repo, port: 0, hosted: true, mailer, fetch: async () => { throw new Error('no network in this test') },
    hostedConfig: { origin: HUB, host: new URL(HUB).host, portalOrigin: null, bind: '127.0.0.1', port: 0, trustProxy: true, portalDir: repo, portalEveryMs: null, push: false } as HostedConfig })
  await server.privateStore!.replaceRoles(DOC)
  let n = 0
  const ask = (path: string, init: RequestInit = {}, cookie?: string) => { n++; return Promise.resolve(server.app.request(`${HUB}${path}`,
    { ...init, headers: { host: new URL(HUB).host, origin: HUB, 'x-real-ip': `10.9.${(n >> 8) & 255}.${n & 255}`, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } })) }
  const cookieOf = async (email: string) => {
    const before = mailer.sent.length
    await ask('/api/session/email', { method: 'POST', body: JSON.stringify({ email }) })
    for (let i = 0; i < 50 && mailer.sent.length === before; i++) await new Promise(r => setTimeout(r, 20))
    const token = new URL(mailer.sent[before]!.link).searchParams.get('token')!
    const res = await ask('/api/session/link', { method: 'POST', body: JSON.stringify({ token }) })
    return `org_session_dev=${res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!}`
  }
  const close = async () => { await server.close(); vi.unstubAllEnvs() }
  return { server, ask, close, member: await cookieOf(MAIL.member), steward: await cookieOf(MAIL.steward), rolesOnly: await cookieOf(MAIL.rolesOnly) }
}
const json = async (r: Response) => JSON.parse(await r.text()) as unknown

describe('round 3, findings 1-3: titles and names a member was still told', () => {
  it('1: GET /api/mentionables offers no record of a kept file, whatever the target', async () => {
    const h = await hosted(repoOf())
    try {
      const asMember = await (await h.ask('/api/mentionables?target=page:hello-0001&q=SENTINEL', {}, h.member)).text()
      expect(asMember).not.toContain(TASK)
      // A page members read: a Steward is not offered it either, since the mention would write its title there.
      expect(await (await h.ask('/api/mentionables?target=page:hello-0001&q=SENTINEL', {}, h.steward)).text()).not.toContain(TASK)
      // On a record of the same kept file, a Steward is offered it as before.
      expect(await (await h.ask('/api/mentionables?target=record:tasks:t-2&q=SENTINEL', {}, h.steward)).text()).toContain(TASK)
    } finally { await h.close() }
  }, 60_000)

  it('2: presence says names only to a viewer who may read the members file', async () => {
    const h = await hosted(repoOf())
    try {
      expect((await h.ask('/api/presence', { method: 'POST', body: JSON.stringify({ target: 'page:hello-0001' }) }, h.steward)).status).toBe(200)
      expect((await h.ask('/api/presence', { method: 'POST', body: JSON.stringify({ target: 'page:hello-0001' }) }, h.rolesOnly)).status).toBe(200)
      const asMember = await (await h.ask('/api/presence?targets=page:hello-0001', {}, h.member)).text()
      for (const name of NAMES) expect(asMember).not.toContain(name)
      expect(asMember).toContain(ID.steward)
      // A Steward still sees the other Steward by name.
      expect(await (await h.ask('/api/presence?targets=page:hello-0001', {}, h.steward)).text()).toContain('Example Roles Steward')
    } finally { await h.close() }
  }, 60_000)

  it('2: the WebSocket presence event says no name to a member, and nothing of a kept record', async () => {
    const h = await hosted(repoOf())
    const heard: { type: string; target?: string; people?: unknown }[] = []
    const ws = new WebSocket(`ws://127.0.0.1:${h.server.port}/api/events`, { headers: { host: new URL(HUB).host, origin: HUB, cookie: h.member } })
    try {
      ws.on('message', d => heard.push(JSON.parse(String(d))))
      await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
      await h.ask('/api/presence', { method: 'POST', body: JSON.stringify({ target: 'record:tasks:t-1' }) }, h.steward)
      await h.ask('/api/presence', { method: 'POST', body: JSON.stringify({ target: 'page:hello-0001' }) }, h.steward)
      for (let i = 0; i < 100 && !heard.some(m => m.type === 'presence' && m.target === 'page:hello-0001'); i++) await new Promise(r => setTimeout(r, 20))
      expect(heard.some(m => m.type === 'presence' && m.target === 'page:hello-0001')).toBe(true)
      expect(heard.filter(m => m.target === 'record:tasks:t-1')).toEqual([])
      for (const name of NAMES) expect(JSON.stringify(heard)).not.toContain(name)
    } finally { ws.close(); await h.close() }
  }, 60_000)

  it('3: the map says no member name to a member the members file is kept from', async () => {
    const h = await hosted(repoOf())
    try {
      const text = await (await h.ask('/api/resources', {}, h.member)).text()
      for (const name of NAMES) expect(text).not.toContain(name)
    } finally { await h.close() }
  }, 60_000)
})

describe('round 3, finding 4: writes to a kept file (writes on)', () => {
  it('refuses a member\'s registry and workspace writes to a kept file before reading it: no existence oracle', async () => {
    const h = await house(repoOf(), { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const send = (method: string, path: string, body?: unknown) => h.app.request(`http://localhost:4680${path}`, { method,
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const answers = [
      await send('POST', '/api/registries/tasks', { id: 't-1', title: 'x' }),
      await send('POST', '/api/registries/tasks', { id: 't-9', title: 'x' }),
      await send('PUT', '/api/registries/tasks/t-1', { id: 't-1', title: 'x' }),
      await send('DELETE', '/api/registries/tasks/t-1'),
      await send('POST', '/api/workspace/records', { ops: [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }] }),
    ]
    expect(answers.map(r => r.status)).toEqual([422, 422, 422, 422, 422])
    for (const r of answers) expect(await r.text()).not.toContain(TASK)
  })

  it('a tray staged before the file was kept says nothing of its record, and Keep mine on it is refused', async () => {
    const repo = repoOf()
    writeFileSync(join(repo, 'data/visibility.yaml'), POLICY(''))
    execSync('git commit -qam "policy: no files section yet"', { cwd: repo, stdio: 'pipe' })
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const send = (method: string, path: string, body?: unknown) => h.app.request(`http://localhost:4680${path}`, { method,
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    expect((await send('POST', '/api/changes/ops', { ops: [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }] })).status).toBe(200)
    writeFileSync(join(repo, 'data/visibility.yaml'), POLICY(FILES))
    writeFileSync(join(repo, 'data/tasks.yaml'), `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: blocked }\n`)
    execSync('git commit -qam "policy: the files section; the task moved"', { cwd: repo, stdio: 'pipe' })
    expect(await (await send('GET', '/api/changes')).text()).not.toContain(TASK)
    const mine = await send('POST', '/api/changes/ops/0/rebase', { keep: 'mine' })
    expect(mine.status).toBe(422)
    expect(await mine.text()).not.toContain(TASK)
  })
})

describe('round 3, finding 5: the canon is read as one', () => {
  it('reads every data/kb/ path at the canon\'s level, and the check refuses a key inside it', () => {
    const files = readFilesPolicy({ visibility: { files: { default: 'role:steward', paths: { 'data/kb/**': 'role:steward', 'data/kb/claim.yaml': 'members' } } } })
    expect(fileLevel(files, 'data/kb/claim.yaml')).toEqual({ level: 'role', role: 'steward' })
    const errors = checkVisibilityPolicy({ visibility: { files: { default: 'role:steward', paths: { 'data/kb/claim.yaml': 'members' } } } },
      { registries: ['members'], roles: [], tree: null }).filter(p => p.level === 'error').map(p => p.path)
    expect(errors).toContain('visibility.files.paths.data/kb/claim.yaml')
  })
})

describe('round 3, finding 6: the framework\'s other readers of a kept file', () => {
  it('system actions, library receipts and the import list follow the file', async () => {
    const h = await house(repoOf(), { proposals: true })
    const member = await cookieFor(h, MAIL.member), steward = await cookieFor(h, MAIL.steward)
    const get = (path: string, cookie: string) => h.app.request(`http://localhost:4680${path}`, { headers: { host: 'localhost:4680', cookie } })
    expect((await get(`/api/systems/${SYSTEM}/actions`, member)).status).toBe(404)
    expect((await get(`/api/systems/${SYSTEM}/actions`, steward)).status).toBe(200)
    expect((await get('/api/library/receipts', member)).status).toBe(404)
    expect((await get('/api/library/receipts', steward)).status).toBe(200)
    expect(await (await get('/api/sources', member)).text()).not.toContain(IMPORT)
    expect(await (await get('/api/sources', steward)).text()).toContain(IMPORT)
  })
})

describe('round 3, finding 7: the @ picker for a Steward', () => {
  it('says a Roles-table Steward can see a record of a Steward-only file', async () => {
    const h = await hosted(repoOf())
    try {
      const list = await json(await h.ask('/api/mentionables?target=record:tasks:t-1', {}, h.steward)) as { kind: string; id: string; canSee: boolean }[]
      expect(list.find(m => m.kind === 'person' && m.id === ID.rolesOnly)?.canSee).toBe(true)
      expect(list.find(m => m.kind === 'person' && m.id === ID.member)?.canSee).toBe(false)
    } finally { await h.close() }
  }, 60_000)
})
