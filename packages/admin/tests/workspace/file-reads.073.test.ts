import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { startServer } from '../../server/serve.ts'
import { createApp } from '../../server/app.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { checkVisibilityPolicy } from '../../lib/visibility.mjs'
import { validateRepo } from '../../lib/data-validate.mjs'
import { DOC, HUB, ID, MAIL, PEPPER, cookieFor, house, repoWith } from './file-reads.fixtures.ts'

// org-os 0.7.3: the minors both 0.7.2 reviews deferred, each a member a data file is kept from still being told something
// of it (M4: WebSocket ids and `?from` marks; `/:id/changed`; the library's removal preview), the policy check skipping
// custom collections (I6), and the sweep given names to look for. Synthetic values only.

const TASK = 'SENTINEL-TASK-0f73b'
const SYSTEM = 'treasury-0f73b'
// Every member's name but the asking member's own.
const OTHERS = ['Example Steward', 'Example Roles Steward', 'At The Machine']
const SHELF = join(dirname(fileURLToPath(import.meta.url)), '..', 'library', 'fixtures', 'test-shelf')

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
`
// Tasks are public by their collection, so a member the tasks file is kept from is still shown them, as the public is.
const POLICY = (files: string) => `visibility:
  collections:
    projects: { default: public }
    tasks: { default: public }
    members:
      default: public
      fields: { name: members }
${files}`
const FILES = `  files:
    default: role:steward
    paths:
      data/projects.yaml: members
      data/library.yaml: members
`

function write(repo: string, files: Record<string, string>, message: string, actor?: string): void {
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t) }
  execSync(`git add -A && git commit -qm "${message}"${actor ? ` -m "Org-Actor: ${actor}"` : ''}`, { cwd: repo, stdio: 'pipe' })
}

function repoOf(governance = GOVERNANCE): string {
  const repo = repoWith(governance)
  write(repo, {
    'data/tasks.yaml': `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: open }\n`,
    'data/systems.yaml': `schema_version: "2.0"\nsystems:\n  - { id: ${SYSTEM}, name: "Treasury", driver: link }\n`,
    'data/projects.yaml': `schema_version: "2.0"\nprojects:\n  - { id: p-1, name: "A project" }\n`,
    'data/visibility.yaml': POLICY(FILES),
  }, 'fixture: tasks, systems, projects, the policy')
  // A second actor: a Steward's commit to each file, so anything that says who changed what has a name to say.
  appendFileSync(join(repo, 'data/tasks.yaml'), '# a Steward was here\n')
  appendFileSync(join(repo, 'data/projects.yaml'), '# a Steward was here\n')
  execSync(`git add -A && git commit -qm "tasks, projects: a line" -m "Org-Actor: ${ID.steward}"`, { cwd: repo, stdio: 'pipe' })
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
  // Each request from its own address (the proxy is trusted), so the hosted rate limits never answer a sweep's request.
  let n = 0
  const ask = (path: string, init: RequestInit = {}, cookie?: string) => { n++; return Promise.resolve(server.app.request(`${HUB}${path}`,
    { ...init, headers: { host: new URL(HUB).host, origin: HUB, 'x-real-ip': `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } })) }
  const cookieOf = async (email: string) => {
    const before = mailer.sent.length
    await ask('/api/session/email', { method: 'POST', body: JSON.stringify({ email }) })
    for (let i = 0; i < 50 && mailer.sent.length === before; i++) await new Promise(r => setTimeout(r, 20))
    const token = new URL(mailer.sent[before]!.link).searchParams.get('token')!
    const res = await ask('/api/session/link', { method: 'POST', body: JSON.stringify({ token }) })
    return `org_session_dev=${res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!}`
  }
  const close = async () => { await server.close(); vi.unstubAllEnvs() }
  const routes = [...new Set(server.app.routes.filter(r => r.method === 'GET' && r.path.startsWith('/api/')).map(r => r.path))]
  return { server, ask, close, routes, member: await cookieOf(MAIL.member), steward: await cookieOf(MAIL.steward) }
}

type Heard = { type: string; registry?: string; ids?: string[] }
async function listen(port: number, cookie: string): Promise<{ ws: WebSocket; heard: Heard[] }> {
  const heard: Heard[] = []
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events`, { headers: { host: new URL(HUB).host, origin: HUB, cookie } })
  ws.on('message', d => heard.push(JSON.parse(String(d)) as Heard))
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
  return { ws, heard }
}
const until = async (ok: () => boolean, ms = 6000) => { for (let i = 0; i < ms / 25 && !ok(); i++) await new Promise(r => setTimeout(r, 25)) }

describe('M4: what the WebSocket tells a member of a kept file', () => {
  it('registry-changed: a member the file is kept from hears of it only when the public does', async () => {
    const repo = repoOf()
    const h = await hosted(repo)
    const m = await listen(h.server.port, h.member), s = await listen(h.server.port, h.steward)
    try {
      await new Promise(r => setTimeout(r, 300))
      // A change the public cannot see (a comment line): the tasks file is kept from the member.
      appendFileSync(join(repo, 'data/tasks.yaml'), '# touched\n')
      appendFileSync(join(repo, 'data/projects.yaml'), '# touched\n')
      const heardOf = (l: { heard: Heard[] }, r: string) => l.heard.some(x => x.type === 'registry-changed' && x.registry === r)
      await until(() => heardOf(s, 'tasks') && heardOf(m, 'projects'))
      expect(heardOf(s, 'tasks')).toBe(true)
      expect(heardOf(m, 'projects')).toBe(true)
      await new Promise(r => setTimeout(r, 300))
      expect(heardOf(m, 'tasks')).toBe(false)
    } finally { m.ws.close(); s.ws.close(); await h.close() }
  }, 60_000)

  it('resources-changed: no id of a card read from a kept file reaches the member', async () => {
    const repo = repoOf()
    const h = await hosted(repo)
    const m = await listen(h.server.port, h.member), s = await listen(h.server.port, h.steward)
    try {
      await new Promise(r => setTimeout(r, 500))
      writeFileSync(join(repo, 'data/systems.yaml'), `schema_version: "2.0"\nsystems:\n  - { id: ${SYSTEM}, name: "Treasury two", driver: link }\n`)
      const ids = (l: { heard: Heard[] }) => l.heard.filter(x => x.type === 'resources-changed').flatMap(x => x.ids ?? [])
      await until(() => ids(s).some(id => id.includes(SYSTEM)))
      expect(ids(s).some(id => id.includes(SYSTEM))).toBe(true)
      await new Promise(r => setTimeout(r, 300))
      expect(ids(m).filter(id => id.includes(SYSTEM))).toEqual([])
    } finally { m.ws.close(); s.ws.close(); await h.close() }
  }, 60_000)
})

describe('M4 and /:id/changed: the registry routes', () => {
  it('?from carries no from mark to a member the file is kept from', async () => {
    const h = await hosted(repoOf())
    try {
      expect(await (await h.ask('/api/registries/tasks?from=1', {}, h.steward)).text()).toContain('fromMark')
      const asMember = await (await h.ask('/api/registries/tasks?from=1', {}, h.member)).text()
      expect(asMember).toContain('t-1') // the public's view of the record
      expect(asMember).not.toContain('fromMark')
    } finally { await h.close() }
  }, 60_000)

  it('/:id/changed is not there for a member the file is kept from', async () => {
    const h = await hosted(repoOf())
    try {
      expect((await h.ask('/api/registries/tasks/t-1/changed', {}, h.steward)).status).toBe(200)
      expect((await h.ask('/api/registries/tasks/t-1/changed', {}, h.member)).status).toBe(404)
      expect((await h.ask('/api/registries/projects/p-1/changed', {}, h.member)).status).toBe(200)
    } finally { await h.close() }
  }, 60_000)
})

describe('the library\'s removal preview', () => {
  it('names no record of a kept file, nor its state or referrers, to a member who reads the receipts', async () => {
    // A solo maintainer's org, so the person at the machine's add from the library applies.
    const repo = repoOf(`schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  decisions: []\n`)
    write(repo, { 'federation.yaml': `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n` }, 'fixture: the test shelf')
    // The person at the machine adds a System from the library; its record lands in data/systems.yaml (kept).
    const local = createApp(repo)
    const post = (path: string, body: unknown) => local.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    expect((await post('/api/library/system%3Atest-link/add', { config: { id: 'test-link', name: 'Test link', url: 'https://dao.example.org' } })).status).toBe(200)
    const applied = await post('/api/changes/apply', {})
    expect(applied.status, await applied.clone().text()).toBe(200)
    const h = await house(repo)
    const member = await cookieFor(h, MAIL.member), steward = await cookieFor(h, MAIL.steward)
    const get = (cookie: string) => h.app.request('http://localhost:4680/api/library/receipts/system-test-link/removal', { headers: { host: 'localhost:4680', cookie } })
    expect(await (await get(steward)).text()).toContain('systems:test-link')
    const asMember = await get(member)
    expect(asMember.status).toBe(200)
    expect(await asMember.text()).not.toContain('systems:test-link')
  }, 60_000)
})

describe('the library\'s stage routes (writes on)', () => {
  it('refuses a member\'s removal that would stage ops on a kept file, before staging anything', async () => {
    const repo = repoOf(`schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  decisions: []\n`)
    write(repo, { 'federation.yaml': `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n` }, 'fixture: the test shelf')
    const local = createApp(repo)
    const post = (path: string, body: unknown) => local.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    expect((await post('/api/library/system%3Atest-link/add', { config: { id: 'test-link', name: 'Test link', url: 'https://dao.example.org' } })).status).toBe(200)
    expect((await post('/api/changes/apply', {})).status).toBe(200)
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const at = (path: string, init: RequestInit = {}) => h.app.request(`http://localhost:4680${path}`,
      { ...init, headers: { host: 'localhost:4680', origin: 'http://localhost:4680', 'content-type': 'application/json', cookie: member } })
    const removed = await at('/api/library/receipts/system-test-link/remove', { method: 'POST', body: '{}' })
    expect(removed.status, await removed.clone().text()).toBe(422)
    expect(await removed.text()).not.toContain('Test link')
    expect(await (await at('/api/changes')).text()).not.toContain('systems:test-link')
  }, 60_000)
})

describe('I6: the policy check reads a custom collection\'s own file', () => {
  const policy = { visibility: { collections: { circles: { default: 'members', fields: { status: 'members' } } },
    files: { default: 'role:steward', paths: { 'data/collections/circles.yaml': 'members' } } } }
  it('refuses a key that opens a custom collection with field levels whole', () => {
    const errors = checkVisibilityPolicy(policy, { registries: ['circles'], roles: [], tree: null, files: { circles: 'data/collections/circles.yaml' } })
      .filter(p => p.level === 'error').map(p => p.path)
    expect(errors).toContain('visibility.files.paths.data/collections/circles.yaml')
  })
  it('and so does the validator, which knows each custom collection\'s file', () => {
    const repo = repoWith(GOVERNANCE)
    write(repo, {
      'data/collections.yaml': 'collections:\n  - id: circles\n    name: Circles\n    fields:\n      - { id: name, type: text }\n      - { id: status, type: text }\n',
      'data/collections/circles.yaml': 'circles:\n  - { id: c-1, name: "A circle", status: open }\n',
      'data/visibility.yaml': `visibility:\n  collections:\n    circles:\n      default: members\n      fields: { status: members }\n  files:\n    default: role:steward\n    paths:\n      data/collections/circles.yaml: members\n`,
    }, 'fixture: a custom collection with field levels, opened whole')
    const problems = validateRepo(repo) as unknown as { file?: string; path?: string; level?: string }[] | { problems: { file?: string; path?: string; level?: string }[] }
    const list = Array.isArray(problems) ? problems : problems.problems
    expect(list.filter(p => p.level === 'error' && p.file === 'data/visibility.yaml').map(p => p.path)).toContain('visibility.files.paths.data/collections/circles.yaml')
  })
})

describe('the sweep, with a second actor and names', () => {
  it('never answers a network member, on any GET route, with another member\'s name or a Steward-only value', async () => {
    const h = await hosted(repoOf())
    try {
      const queries = ['', '?target=record:tasks:t-1', '?target=record:projects:p-1', '?path=data/tasks.yaml', '?path=data/members.yaml', '?from=1', '?q=Example']
      const urls = new Set(h.routes.flatMap(p => ['tasks', 'projects', 'members'].flatMap(name => queries.map(q =>
        p.replace(':name', name).replace(':registry', name).replace(':id', name === 'tasks' ? 't-1' : name === 'projects' ? 'p-1' : ID.steward).replace(/:[A-Za-z]+/g, 'x') + q))))
      const seen: string[] = []
      const limited: string[] = []
      for (const url of urls) {
        const text = await Promise.race([
          h.ask(url, {}, h.member).then(async (r: Response) => { if (r.status === 429) limited.push(url); return r.text() }).catch(() => ''),
          new Promise<string>(resolve => setTimeout(() => resolve(''), 2000)),
        ])
        for (const s of OTHERS) if (text.includes(s)) seen.push(`${url} → ${s}`)
      }
      expect(limited).toEqual([])
      expect(seen).toEqual([])
      // The control: a Steward is told the names.
      expect(await (await h.ask('/api/registries/members', {}, h.steward)).text()).toContain('Example Steward')
    } finally { await h.close() }
  }, 240_000)
})
