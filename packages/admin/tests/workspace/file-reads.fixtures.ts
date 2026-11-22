// Shared by the 0.7.1 (D6) agent-layer read tests: a hosted Example DAO whose people sign in by emailed link, and the
// repositories they read. Synthetic values only.
import { expect, afterEach, vi } from 'vitest'
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
import type { HostedConfig } from '../../server/hosted/config.ts'
import { emailKey } from '../../lib/session-token.mjs'


export const HUB = 'https://hub.example.org'
export const HOST = 'localhost:4680'
export const PEPPER = '0f'.repeat(32)
export const T0 = new Date('2026-11-18T10:00:00.000Z')
export const ID = {
  steward: 'example-dao:person:steward', member: 'example-dao:person:network-member', none: 'example-dao:person:no-role',
  rolesOnly: 'example-dao:person:roles-steward', local: 'example-dao:person:at-the-machine',
}
/** The network member's own git identity, for a proposal they make at a machine (fix round 1). */
export const MEMBER_AT_MACHINE = 'member-at-machine@example.org'
export const MAIL = { steward: 'steward@example.org', member: 'member@example.org', none: 'none@example.org', rolesOnly: 'roles-steward@example.org' }
export const DOC: RolesDoc = {
  roles_version: '2026-11-18',
  people: [
    { id: ID.steward, name: 'Example Steward', email_keys: [emailKey(MAIL.steward, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
    { id: ID.member, name: 'Example Member', email_keys: [emailKey(MAIL.member, PEPPER)], roles: ['network-member'], nodes: [] },
    { id: ID.none, name: 'Example Nobody', email_keys: [emailKey(MAIL.none, PEPPER)], roles: [], nodes: [] },
    // A Roles-table steward the governance lists in no role: their Role is no governance role (PR7-R92).
    { id: ID.rolesOnly, name: 'Example Roles Steward', email_keys: [emailKey(MAIL.rolesOnly, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
  ],
}
export const MEMBERS = `schema_version: "2.0"
members:
  - { id: "${ID.steward}", name: "Example Steward", kind: person }
  - { id: "${ID.member}", name: "Example Member", kind: person, handles: { git: ["${MEMBER_AT_MACHINE}"] } }
  - { id: "${ID.rolesOnly}", name: "Example Roles Steward", kind: person }
  - { id: "${ID.local}", name: "At The Machine", kind: person, handles: { git: ["${TEST_EMAIL}"] } }
`
/** A workspace rule that names its deciders: the council decides the agent layer. */
export const NAMED = `schema_version: "2.0"
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
export const MAINTAINED = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
`
/** No workspace rule and no maintainer role defined: the implied one (everyone) does not count, so no signed-in viewer reads. */
export const UNMAINTAINED = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { members: ["${ID.steward}"] }
`
export const DAY = 'memory/2026-11-01.md'
export const AGENT_LAYER: Record<string, string> = {
  [DAY]: '# 1 Nov\n\nSynthetic council note: the treasury review moves to Friday.\n',
  'MEMORY.md': '# Memory\n\n- synthetic index line\n',
  'HEARTBEAT.md': '# Heartbeat\n\n- synthetic pulse\n',
  'docs/agent-plans/plan-a.md': '# Plan A\n\nSynthetic agent plan.\n',
  'docs/plans/plan-b.md': '# Plan B\n\nSynthetic strategic plan.\n',
}
export const CONTROL = 'data/governance.yaml'

const cleanup: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) { try { f() } catch { /* gone */ } } })

export function signInConfig(): SignInConfig {
  const read = readSignInConfig({
    HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })),
    SESSION_COOKIE_NAME: 'org_session_dev', SESSION_COOKIE_DOMAIN: 'example.org', RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
  }, { hosted: true, origin: HUB })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}

/** A fresh repository holding the agent layer, with `governance`, all committed (a governed file is one git tracks). */
export function repoWith(governance: string): string {
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
export async function house(repo: string, o: { proposals?: boolean; writes?: boolean } = {}) {
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
    if (o.proposals) mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, hosted: true, readOnly: !o.writes, membership })
  }, { request: withRequest({ repo, hosted: true, membership, store, signIn, now }), hosted: true, ...(o.writes ? {} : { instanceWrites: 'off' as const }) })
  return { app, signIn, mailer, settled: () => email!.settled() }
}
export type House = Awaited<ReturnType<typeof house>>

export function call(app: Hono, path: string, cookie?: string) {
  return app.request(`http://${HOST}${path}`, { headers: { host: HOST, ...(cookie ? { cookie } : {}) } })
}

export async function cookieFor(h: House, email: string): Promise<string> {
  const before = h.mailer.sent.length
  await h.app.request(`http://${HOST}/api/session/email`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  await h.settled()
  const token = new URL(h.mailer.sent[before]!.link).searchParams.get('token')!
  const res = await h.app.request(`http://${HOST}/api/session/link`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
  expect(res.status).toBe(200)
  const jws = res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!
  return `${h.signIn.cookie.name}=${jws}`
}

export const fileAt = (app: Hono, path: string, cookie?: string) => call(app, `/api/files?path=${encodeURIComponent(path)}`, cookie)
/** What a path that is not there is answered with: the same words, whoever asks. */
export const missing = (path: string) => ({ error: `${path} is not a governed file, so it has no editor here.` })
export const readable = async (app: Hono, cookie?: string) =>
  Object.fromEntries(((await (await call(app, '/api/editors', cookie)).json()) as { pattern: string; readable: boolean }[]).map(r => [r.pattern, r.readable]))
export const DECIDERS_ROWS = ['memory/**', 'MEMORY.md', 'HEARTBEAT.md', 'docs/plans/**', 'docs/agent-plans/**']
