import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createApp } from '../../server/app.ts'
import { viewerReader } from '../../server/workspace/reads.ts'
import { gateGraph, Levels } from '../../server/visibility/gate.ts'
import type { Graph, Resource } from '../../server/resources/types.ts'
import { checkVisibilityPolicy, fileLevel, readFilesPolicy, FILE_ROLES } from '../../lib/visibility.mjs'
import { validateRepo } from '../../lib/data-validate.mjs'
import { ROLES } from '../../server/private/store.ts'
import { MAIL, call, cookieFor, fileAt, house, missing, readable, repoWith, MAINTAINED, ID, DOC, HUB, PEPPER } from './file-reads.fixtures.ts'
import { startServer } from '../../server/serve.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'

// org-os 0.7.2: raw file reads by Role. data/visibility.yaml's `files:` section says which Roles read which data/** file
// whole (GET /api/files and everything that takes the same reader), and the registries and map cards read from a file a
// member may not read are given to them as the public is given them. Synthetic values only.

const FIN = 'SENTINEL-FIN-0f72'
const TASK = 'SENTINEL-TASK-0f72'
const NEW = 'SENTINEL-NEW-0f72'
const KB = 'SENTINEL-KB-0f72'

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
      data/kb/**: members
`
const DATA: Record<string, string> = {
  'data/finances.yaml': `schema_version: "2.0"\nfinances:\n  treasury: { primary_safe: "0xabc", chain: "optimism", note: "${FIN}" }\n  budgets: []\n  expenses: []\n  revenues: []\n`,
  'data/tasks.yaml': `schema_version: "2.0"\ntasks:\n  - { id: t-1, title: "${TASK}", status: open }\n`,
  'data/new.yaml': `note: "${NEW}"\n`,
  'data/kb/claim-1.yaml': `id: claim-1\ntext: "${KB}"\n`,
}

/** The fixture house's repository with the data above and a policy carrying `files` (or none). */
function repoOf(files: string | null): string {
  const repo = repoWith(MAINTAINED)
  for (const [path, text] of Object.entries(DATA)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  writeFileSync(join(repo, 'data', 'visibility.yaml'), POLICY(files ?? ''))
  execSync('git add -A && git commit -qm "fixture: data and the policy"', { cwd: repo, stdio: 'pipe' })
  return repo
}

async function signedIn(files: string | null) {
  const repo = repoOf(files)
  const h = await house(repo)
  return { repo, h, member: await cookieFor(h, MAIL.member), steward: await cookieFor(h, MAIL.steward) }
}

describe('GET /api/files with a files section', () => {
  it('keeps a Steward-only file from a network member, as a path that is not there, and gives it a Steward whole', async () => {
    const { h, member, steward } = await signedIn(FILES)
    const denied = await fileAt(h.app, 'data/finances.yaml', member)
    expect([denied.status, await denied.json()]).toEqual([404, missing('data/finances.yaml')])
    const whole = await fileAt(h.app, 'data/finances.yaml', steward)
    expect(whole.status).toBe(200)
    expect(JSON.stringify(await whole.json())).toContain(FIN)
  })

  it('gives a listed members file to a network member', async () => {
    const { h, member } = await signedIn(FILES)
    expect((await fileAt(h.app, 'data/projects.yaml', member)).status).toBe(200)
  })

  it('reads a listed folder: data/kb/** at members gives a network member the file in it', async () => {
    const { h, member } = await signedIn(FILES)
    const res = await fileAt(h.app, 'data/kb/claim-1.yaml', member)
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).toContain(KB)
  })

  it('holds an unlisted file someone adds later at the default: Steward-only', async () => {
    const { h, member, steward } = await signedIn(FILES)
    expect((await fileAt(h.app, 'data/new.yaml', member)).status).toBe(404)
    expect((await fileAt(h.app, 'data/new.yaml', steward)).status).toBe(200)
  })

  it('changes nothing for an instance without a files section (opt-in, F3)', async () => {
    const { h, member } = await signedIn(null)
    expect((await fileAt(h.app, 'data/finances.yaml', member)).status).toBe(200)
  })

  it('leaves the person at the machine ungated', async () => {
    const repo = repoOf(FILES)
    const app = createApp(repo)
    expect((await app.request('/api/files?path=data%2Ffinances.yaml')).status).toBe(200)
  })

  it('says the denied rows unreadable in /api/editors', async () => {
    const { h, member, steward } = await signedIn(FILES)
    const m = await readable(h.app, member)
    expect([m['data/tasks.yaml'], m['data/projects.yaml']]).toEqual([false, true])
    expect((await readable(h.app, steward))['data/tasks.yaml']).toBe(true)
  })

  it('judges a viewer alone the same way (the reader the ledger, diffs and views take)', () => {
    const repo = repoOf(FILES)
    const member = viewerReader(repo, { kind: 'member', id: ID.member, hats: [], roles: ['network-member'] })
    const steward = viewerReader(repo, { kind: 'member', id: ID.steward, hats: [], roles: ['network-member', 'steward'] })
    expect([member('data/finances.yaml'), member('data/projects.yaml'), member('IDENTITY.md')]).toEqual([false, true, true])
    expect(steward('data/finances.yaml')).toBe(true)
  })
})

describe('registries and the map read from a file a member may not read', () => {
  it('gives a network member a Steward-only registry as the public is given it: here, nothing', async () => {
    const { h, member, steward } = await signedIn(FILES)
    const asMember = await (await call(h.app, '/api/registries/tasks', member)).json() as { entries: unknown[] }
    expect(asMember.entries).toEqual([])
    const list = await (await call(h.app, '/api/registries', member)).json() as { name: string }[]
    expect(list.map(r => r.name)).not.toContain('tasks')
    const asSteward = await (await call(h.app, '/api/registries/tasks', steward)).json() as { entries: unknown[] }
    expect(JSON.stringify(asSteward.entries)).toContain(TASK)
    expect((await call(h.app, '/api/registries/tasks/t-1/changed', member)).status).toBe(404)
  })

  it('still gives a network member what the collection makes public', async () => {
    const repo = repoOf(FILES.replace('data/projects.yaml: members', 'data/ideas.yaml: members'))
    const h = await house(repo)
    const member = await cookieFor(h, MAIL.member)
    const projects = await (await call(h.app, '/api/registries/projects', member)).json() as { entries: { id: string }[] }
    expect(projects.entries.map(e => e.id)).toContain('proj-001')
  })

  it('gives a network member a map card read from a Steward-only file as the public is given it, with its edges', () => {
    const repo = repoOf(FILES)
    const card = (id: string, kind: string, registry: string, entityId: string): Resource => ({
      id, kind, board: 'work', name: entityId, status: null, attention: null, changed: null, facts: {},
      source: { path: `data/${registry}.yaml`, editable: true, registry, entityId },
    } as unknown as Resource)
    const graph: Graph = { nodes: [card('task:t-1', 'task', 'tasks', 't-1'), card('project:proj-001', 'project', 'projects', 'proj-001')], edges: [{ from: 'project:proj-001', to: 'task:t-1', kind: 'depends-on' }] }
    const member = gateGraph({ kind: 'member', id: ID.member, hats: [], roles: ['network-member'] }, graph, new Levels(repo))
    expect(member.nodes.map(n => n.id)).toEqual(['project:proj-001'])
    expect(member.edges).toEqual([])
    // Without the files section's answer the same member is given the card: the section is what keeps it.
    const open = gateGraph({ kind: 'member', id: ID.member, hats: [], roles: ['network-member'] }, graph, new Levels(repo), undefined, undefined, () => true)
    expect(open.nodes.map(n => n.id)).toContain('task:t-1')
    const steward = gateGraph({ kind: 'member', id: ID.steward, hats: [], roles: ['network-member', 'steward'] }, graph, new Levels(repo))
    expect(steward.nodes.map(n => n.id)).toEqual(['task:t-1', 'project:proj-001'])
    expect(steward.edges).toHaveLength(1)
  })

  it('never answers a network member, on any GET route, with a value only a Steward-only file holds', async () => {
    const { h, member, steward } = await signedIn(FILES)
    const routes = [...new Set(h.app.routes.filter(r => r.method === 'GET' && r.path.startsWith('/api/')).map(r => r.path))]
    const urls = new Set(routes.flatMap(p => ['tasks', 'finances', 'new'].map(name =>
      p.replace(':name', name).replace(':registry', name).replace(':id', 't-1').replace(/:[A-Za-z]+/g, 'x'))))
    const bodies: string[] = []
    for (const url of urls) {
      const ask = (cookie: string) => Promise.race([
        Promise.resolve(call(h.app, url, cookie)).then((r: Response) => r.text()).catch(() => ''),
        new Promise<string>(resolve => setTimeout(() => resolve(''), 2000)),
      ])
      const seen = await ask(member)
      for (const s of [FIN, TASK, NEW]) if (seen.includes(s)) bodies.push(`${url} → ${s}`)
      void steward
    }
    expect(bodies).toEqual([])
    // And the Steward is given them where they are served.
    expect(await (await call(h.app, '/api/registries/tasks', steward)).text()).toContain(TASK)
  }, 60_000)
})

describe('the policy and its check', () => {
  const ctx = { registries: ['members', 'projects', 'finances', 'tasks'], roles: ['maintainer'], tree: null }
  const errors = (files: string) => checkVisibilityPolicy({ visibility: { collections: { members: { default: 'public', fields: { name: 'members' } } }, files: JSON.parse(files) } }, ctx)
    .filter(p => p.level === 'error').map(p => p.path)

  it('reads files.default and paths, and a level per path', () => {
    const files = readFilesPolicy({ visibility: { files: { default: 'role:steward', paths: { 'data/projects.yaml': 'members', 'data/kb/**': 'members' } } } })
    expect(fileLevel(files, 'data/projects.yaml')).toEqual({ level: 'members' })
    expect(fileLevel(files, 'data/kb/a/b.yaml')).toEqual({ level: 'members' })
    expect(fileLevel(files, 'data/finances.yaml')).toEqual({ level: 'role', role: 'steward' })
    expect(fileLevel(files, 'IDENTITY.md')).toBeNull()
    expect(fileLevel(readFilesPolicy({ visibility: {} }), 'data/finances.yaml')).toBeNull()
  })

  it('fails closed on a level it cannot read', () => {
    const files = readFilesPolicy({ visibility: { files: { default: 'stewards', paths: { 'data/projects.yaml': 'role:Ops' } } } })
    for (const path of ['data/projects.yaml', 'data/finances.yaml']) {
      const l = fileLevel(files, path)
      expect(l?.level).toBe('role')
      expect(['steward', 'node-lead', 'network-member']).not.toContain((l as { role: string }).role)
    }
  })

  it('names the Roles table\'s Roles, no others', () => {
    expect([...FILE_ROLES].sort()).toEqual([...ROLES].sort())
  })

  it('validates a data/visibility.yaml carrying a files section', () => {
    const problems = (validateRepo(repoOf(FILES)) as { file?: string; level?: string; message: string }[])
      .filter(p => p.file === 'data/visibility.yaml' && p.level !== 'warn')
    expect(problems).toEqual([])
  })

  it('refuses public, a path outside data/, a listed file with field levels, and a role that is no Roles-table Role', () => {
    expect(errors('{"default":"public"}')).toContain('visibility.files.default')
    expect(errors('{"default":"role:steward","paths":{"IDENTITY.md":"members"}}')).toContain('visibility.files.paths.IDENTITY.md')
    expect(errors('{"default":"role:steward","paths":{"data/members.yaml":"members"}}')).toContain('visibility.files.paths.data/members.yaml')
    expect(errors('{"default":"role:not-a-role"}')).toContain('visibility.files.default')
    expect(errors('{"default":"role:steward","paths":{"data/projects.yaml":"members","data/kb/**":"role:node-lead"}}')).toEqual([])
  })
})

describe('the hosted server as Railway runs it', () => {
  it('never answers a network member, on any GET route it mounts, with a value only a Steward-only file holds', async () => {
    const repo = repoOf(FILES)
    vi.stubEnv('HOUSE_EMAIL_PEPPER', PEPPER)
    vi.stubEnv('HOUSE_SESSION_PRIVATE_JWK', JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })))
    vi.stubEnv('SESSION_COOKIE_NAME', 'org_session_dev')
    vi.stubEnv('SESSION_COOKIE_DOMAIN', 'example.org')
    vi.stubEnv('RESEND_API_KEY', 're_test_synthetic')
    vi.stubEnv('MAIL_FROM', 'hub@example.org')
    const mailer = recordingMailer()
    const server = await startServer({ repo, port: 0, hosted: true, hostedConfig: { origin: HUB, host: new URL(HUB).host, portalOrigin: null, bind: '127.0.0.1', port: 0, trustProxy: false, portalDir: repo, portalEveryMs: null, push: false } as HostedConfig, mailer,
      fetch: async () => { throw new Error('no network in this test') } })
    try {
      await server.privateStore!.replaceRoles(DOC)
      // Addressed as the Hub's origin, as Railway's proxy addresses it.
      const ask = (path: string, init: RequestInit = {}, cookie?: string) => server.app.request(`${HUB}${path}`,
        { ...init, headers: { host: new URL(HUB).host, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } })
      const cookieOf = async (email: string) => {
        const before = mailer.sent.length
        const sent = await ask('/api/session/email', { method: 'POST', body: JSON.stringify({ email }) })
        for (let i = 0; i < 50 && mailer.sent.length === before; i++) await new Promise(r => setTimeout(r, 20))
        if (mailer.sent.length === before) throw new Error(`no link sent: ${sent.status} ${await sent.text()}`)
        const token = new URL(mailer.sent[before]!.link).searchParams.get('token')!
        const res = await ask('/api/session/link', { method: 'POST', body: JSON.stringify({ token }) })
        const jws = res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!
        return `org_session_dev=${jws}`
      }
      const member = await cookieOf(MAIL.member)
      const steward = await cookieOf(MAIL.steward)
      const routes = [...new Set(server.app.routes.filter(r => r.method === 'GET' && r.path.startsWith('/api/')).map(r => r.path))]
      const urls = new Set(routes.flatMap(p => ['tasks', 'finances', 'new'].map(name =>
        p.replace(':name', name).replace(':registry', name).replace(':id', 't-1').replace(/:[A-Za-z]+/g, 'x'))))
      const seen: string[] = []
      for (const url of urls) {
        const text = await Promise.race([
          Promise.resolve(ask(url, {}, member)).then((r: Response) => r.text()).catch(() => ''),
          new Promise<string>(resolve => setTimeout(() => resolve(''), 2000)),
        ])
        for (const s of [FIN, TASK, NEW]) if (text.includes(s)) seen.push(`${url} → ${s}`)
      }
      expect(routes.length).toBeGreaterThan(50)
      expect(seen).toEqual([])
      expect(await (await ask('/api/registries/tasks', {}, steward)).text()).toContain(TASK)
    } finally {
      await server.close()
      vi.unstubAllEnvs()
    }
  }, 180_000)
})
