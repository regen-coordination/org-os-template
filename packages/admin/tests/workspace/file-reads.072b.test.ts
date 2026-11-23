import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { startServer } from '../../server/serve.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { fileLevels, readableEntry, viewerReader } from '../../server/workspace/reads.ts'
import { displayNames } from '../../server/session/names.ts'
import { fileLoosens } from '../../server/workspace/files.ts'
import { checkVisibilityPolicy, fileLevel, readFilesPolicy } from '../../lib/visibility.mjs'
import { DOC, HUB, ID, MAIL, PEPPER, cookieFor, house, repoWith } from './file-reads.fixtures.ts'

// org-os 0.7.2, round 2: the routes beyond /api/files, the registries and the map that read a record of a file the `files`
// section keeps from a member (the whole-branch review's C1, C2, I1-I8, M3). Synthetic values only.

const TASK = 'SENTINEL-TASK-0f72'
const GOV = 'SENTINEL-GOV-0f72'
const NAME = 'Example Steward'

/** Governance whose description is kept at members, and a maintainer; with `steward` as a governance role held by all. */
const GOVERNANCE = (stewardForAll: boolean) => `schema_version: "2.0"
governance:
  model: "steward-council"
  description: "${GOV}"
  roles:
    maintainer: { members: ["${ID.steward}"] }
${stewardForAll ? '    steward: { all: true }\n' : ''}`
const POLICY = (files: string) => `visibility:
  collections:
    projects: { default: public }
    governance:
      default: public
      fields: { description: members }
    members:
      default: public
      fields: { name: members }
${files}`
const FILES = `  files:
    default: role:steward
    paths:
      data/projects.yaml: members
`

function repoOf(files: string, o: { stewardForAll?: boolean } = {}): string {
  const repo = repoWith(GOVERNANCE(o.stewardForAll ?? false))
  const data: Record<string, string> = {
    'data/tasks.yaml': `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: open }\n`,
    'data/visibility.yaml': POLICY(files),
  }
  for (const [p, t] of Object.entries(data)) { mkdirSync(dirname(join(repo, p)), { recursive: true }); writeFileSync(join(repo, p), t) }
  execSync('git add -A && git commit -qm "fixture: tasks, governance, the policy"', { cwd: repo, stdio: 'pipe' })
  return repo
}

/** The hosted server as Railway runs it (writes off), with the fixture's Roles, and a way to sign people in. */
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
  return { ask, cookieOf, close, routes, member: await cookieOf(MAIL.member), steward: await cookieOf(MAIL.steward) }
}

const memberViewer = { kind: 'member' as const, id: ID.member, hats: [], roles: ['network-member'], hubRoles: ['network-member'] }
const stewardViewer = { kind: 'member' as const, id: ID.steward, hats: [], roles: ['network-member', 'steward'], hubRoles: ['network-member', 'steward'] }

describe('C1, C2, I1: hosted routes a member reached a Steward-only record by', () => {
  it('comments: a record of a kept file is not there for a member (no anchor oracle, no threads, no mentionables)', async () => {
    const h = await hosted(repoOf(FILES))
    try {
      const anchored = await h.ask('/api/comments', { method: 'POST', body: JSON.stringify({ target: 'record:tasks:t-1', body: 'x', anchor: { exact: 'SENTINEL-TASK' } }) }, h.member)
      expect(anchored.status).toBe(404)
      expect((await h.ask('/api/comments?target=record:tasks:t-1', {}, h.member)).status).toBe(404)
      expect((await h.ask('/api/mentionables?target=record:tasks:t-1', {}, h.member)).status).toBe(404)
      // A Steward comments on it as before.
      const own = await h.ask('/api/comments', { method: 'POST', body: JSON.stringify({ target: 'record:tasks:t-1', body: 'x' }) }, h.steward)
      expect(own.status).toBe(201)
    } finally { await h.close() }
  }, 60_000)

  it('GET /api/governance gives a member denied the file the public view', async () => {
    const h = await hosted(repoOf(FILES))
    try {
      expect(await (await h.ask('/api/governance', {}, h.member)).text()).not.toContain(GOV)
      expect(await (await h.ask('/api/governance', {}, h.steward)).text()).toContain(GOV)
    } finally { await h.close() }
  }, 60_000)

  it('the knowledge routes are not there for a member the canon (data/kb/**) is kept from', async () => {
    const h = await hosted(repoOf(FILES))
    try {
      for (const path of ['/api/knowledge', '/api/knowledge/plan', '/api/knowledge/entry/claim/x']) {
        expect([path, (await h.ask(path, {}, h.member)).status]).toEqual([path, 404])
      }
      expect((await h.ask('/api/knowledge', {}, h.steward)).status).toBe(200)
    } finally { await h.close() }
  }, 60_000)
})

describe('I2, I3: the tray and proposals', () => {
  it('refuses a member\'s record op on a record of a kept file, as one no rule governs', async () => {
    const h = await house(repoOf(FILES), { writes: true })
    const member = await cookieFor(h, MAIL.member)
    const res = await h.app.request('http://localhost:4680/api/changes/ops', { method: 'POST',
      headers: { host: 'localhost:4680', cookie: member, 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }] }) })
    expect(res.status).toBe(422)
    expect(await res.text()).not.toContain(TASK)
  })

  it('withholds a record op on a kept file in a ledger entry, as a file op is', () => {
    const repo = repoOf(FILES)
    const entry = { id: 'p1', ops: [{ op: 'update', record: 'tasks:t-1', set: { title: TASK }, before: { title: TASK } }, { op: 'update', record: 'projects:proj-001', set: { status: 'x' } }] }
    const shown = readableEntry(entry, viewerReader(repo, memberViewer))
    expect(JSON.stringify(shown)).not.toContain(TASK)
    expect(shown.ops[1]).toEqual(entry.ops[1])
    expect(readableEntry(entry, viewerReader(repo, stewardViewer))).toEqual(entry)
  })
})

describe('I4, I5: names and Roles', () => {
  it('says a member\'s name to a viewer denied data/members.yaml only as the public may: their id', () => {
    const repo = repoOf(FILES)
    expect(displayNames(repo, null, { viewer: memberViewer })(ID.steward)).not.toBe(NAME)
    expect(displayNames(repo, null, { viewer: stewardViewer })(ID.steward)).toBe(NAME)
  })

  it('judges role: against the Roles table, never a governance role of the same name', () => {
    const repo = repoOf(FILES, { stewardForAll: true })
    // A network member holds the governance role `steward` (all: true) in `roles`, not the Roles-table Steward.
    const v = { ...memberViewer, roles: ['network-member', 'steward'] }
    expect(fileLevels(repo, v)('data/tasks.yaml')).toBe(false)
    expect(fileLevels(repo, stewardViewer)('data/tasks.yaml')).toBe(true)
  })
})

describe('I6, I7, I8, M3: the policy, its check and its reading', () => {
  const ctx = { registries: ['members', 'governance', 'projects'], roles: ['maintainer'], tree: null }
  const errorsOf = (files: unknown) => checkVisibilityPolicy({ visibility: { collections: { members: { default: 'public', fields: { name: 'members' } } }, files } }, ctx)
    .filter(p => p.level === 'error').map(p => p.path)

  it('refuses a default or a folder that opens a file with field levels whole', () => {
    expect(errorsOf({ default: 'members' })).toContain('visibility.files.default')
    expect(errorsOf({ default: 'role:steward', paths: { 'data/**': 'members' } })).toContain('visibility.files.paths.data/**')
    expect(errorsOf({ default: 'members', paths: { 'data/members.yaml': 'role:steward' } })).toEqual([])
  })

  it('refuses an empty files section, and reads it as closed', () => {
    expect(errorsOf(null)).toContain('visibility.files')
    const files = readFilesPolicy({ visibility: { files: null } })
    expect(files).not.toBeNull()
    expect(fileLevel(files, 'data/projects.yaml')?.level).toBe('role')
  })

  it('counts removing or widening the files section as a loosening (a publication)', () => {
    const repo = repoOf(FILES)
    const op = (text: string) => ({ op: 'file', path: 'data/visibility.yaml', text }) as unknown as Parameters<typeof fileLoosens>[1]
    expect(fileLoosens(repo, op(POLICY('')))).toBe(true)
    expect(fileLoosens(repo, op(POLICY(FILES.replace('default: role:steward', 'default: role:network-member'))))).toBe(true)
    expect(fileLoosens(repo, op(POLICY(FILES.replace('data/projects.yaml: members', 'data/projects.yaml: role:steward'))))).toBe(false)
  })

  it('matches a folder listing for the folder itself (data/kb for data/kb/**)', () => {
    const files = readFilesPolicy({ visibility: { files: { default: 'role:steward', paths: { 'data/kb/**': 'members' } } } })
    expect(fileLevel(files, 'data/kb')).toEqual({ level: 'members' })
    expect(fileLevel(files, 'data/kbx.yaml')).toEqual({ level: 'role', role: 'steward' })
  })
})

describe('M6: the sweep, wider', () => {
  it('never answers a network member, on any GET route with or without a target, path or from query, with a Steward-only value', async () => {
    const h = await hosted(repoOf(FILES))
    try {
      const queries = ['', '?target=record:tasks:t-1', '?target=record:governance:governance', '?path=data/tasks.yaml', '?path=data/governance.yaml', '?from=1', '?q=SENTINEL']
      const urls = new Set(h.routes.flatMap(p => ['tasks', 'governance'].flatMap(name => queries.map(q =>
        p.replace(':name', name).replace(':registry', name).replace(':id', 't-1').replace(/:[A-Za-z]+/g, 'x') + q))))
      const seen: string[] = []
      const limited: string[] = []
      for (const url of urls) {
        const text = await Promise.race([
          h.ask(url, {}, h.member).then(async (r: Response) => { if (r.status === 429) limited.push(url); return r.text() }).catch(() => ''),
          new Promise<string>(resolve => setTimeout(() => resolve(''), 2000)),
        ])
        for (const s of [TASK, GOV]) if (text.includes(s)) seen.push(`${url} → ${s}`)
      }
      expect(limited).toEqual([])
      expect(seen).toEqual([])
      expect(await (await h.ask('/api/governance', {}, h.steward)).text()).toContain(GOV)
    } finally { await h.close() }
  }, 180_000)
})
