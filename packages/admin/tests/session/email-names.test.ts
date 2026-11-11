import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type RolesDoc } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { mountEmailSignIn, type EmailSignIn } from '../../server/session/email.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { Membership } from '../../server/session/membership.ts'
import { mountSession } from '../../server/session/routes.ts'
import { displayNames } from '../../server/session/names.ts'
import { withRequest } from '../../server/request.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { actorNames, mountConversation, namesFor, targetLevel } from '../../server/workspace/conversation.ts'
import { mountPresence, Presence } from '../../server/workspace/presence.ts'
import { entityChanges } from '../../server/resources/changed.ts'
import { HOUSE_IDENT, parseTrailers } from '../../lib/trailers.mjs'
import { joinPage } from '../../lib/workspace/pages.mjs'
import { emailKey } from '../../lib/session-token.mjs'
import type { HostedConfig } from '../../server/hosted/config.ts'

// R2 (plan §5), the one display name (PF-R258, PF-R259) for a member signed in by an emailed link (0.6.1's sign-in: an
// actor that is a person id, no wallet, no hats). The person is a member in git under that id, so everywhere a person is
// shown they read as their member name, whatever name the Roles table gives them; and a commit they make while the Hub's
// writes are on is committed by the house and names them in Org-Actor. Hosted, a fresh repository and private store
// under the temp directory each; synthetic values only; no network.

const HUB = 'https://hub.example.org'
const HOST = 'localhost:4680'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-11-18T10:00:00.000Z')
const ID = 'example-org:person:example-steward'
const MAIL = 'steward@example.org'
/** The Roles table's name for them: not the members file's, so the test can tell which one is said. */
/** A person with no Role (T2c minor 2): their viewer is the public's, which may not read the members file. */
const VISITOR = 'example-org:person:example-visitor'
const VISITOR_MAIL = 'visitor@example.org'
const DOC: RolesDoc = {
  roles_version: '2026-11-18',
  people: [
    { id: ID, name: 'E. Steward (roles)', email_keys: [emailKey(MAIL, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
    { id: VISITOR, name: 'V. Visitor (roles)', email_keys: [emailKey(VISITOR_MAIL, PEPPER)], roles: [], nodes: [] },
  ],
}
const MEMBERS = `schema_version: "2.0"
members:
  - { id: "${ID}", name: "Example Steward", kind: person }
  - { id: "${VISITOR}", name: "Example Visitor", kind: person }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { members: ["${ID}"] }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: council, method: direct } }
  decisions: []
`
const PAGE = 'notes-0001'

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

async function house(opts: { visibility?: string } = {}) {
  const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  if (opts.visibility !== undefined) writeFileSync(join(repo, 'data', 'visibility.yaml'), opts.visibility)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  writeFileSync(join(repo, 'pages', `${PAGE}.md`), joinPage({ id: PAGE, title: 'Notes', parent: null, order: 1000 }, 'Members only.\n'))
  execFileSync('git', ['add', '-A'], { cwd: repo }); execFileSync('git', ['commit', '-qm', 'fixture: a member signed in by email, a page'], { cwd: repo })
  const dir = mkdtempSync(join(tmpdir(), 'email-names-store-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
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
  const presence = new Presence({ level: t => targetLevel(repo, t, store), names: actorNames(repo, membership), now: () => T0.getTime() })
  let email: EmailSignIn | undefined
  const app = createApp(repo, (a, ctx) => {
    mountSession(a, { repo, store, membership, hosted: true, signIn, now })
    email = mountEmailSignIn(a, { repo, store, config: signIn, mailer, now, hosted: { origin: HUB, trustProxy: false } as HostedConfig })
    mountVisibility(a, { repo, membership, withLock: ctx.withLock, privateStore: ctx.privateStore })
    mountConversation(a, { repo, membership, privateStore: ctx.privateStore, withLock: ctx.withLock, now })
    mountPresence(a, { repo, membership, privateStore: ctx.privateStore, presence })
  }, { request: withRequest({ repo, hosted: true, membership, store, signIn, now }), hosted: true, privateStore: () => store })
  const call = (method: string, path: string, o: { cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { host: HOST }
    if (o.cookie) headers.cookie = o.cookie
    if (o.body !== undefined) headers['content-type'] = 'application/json'
    return app.request(`http://${HOST}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
  }
  const signedIn = async (mail = MAIL): Promise<string> => {
    await call('POST', '/api/session/email', { body: { email: mail } })
    await email!.settled()
    const token = new URL(mailer.sent[mailer.sent.length - 1]!.link).searchParams.get('token')!
    const res = await call('POST', '/api/session/link', { body: { token } })
    expect(res.status).toBe(200)
    const jws = res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!
    return `${signIn.cookie.name}=${jws}`
  }
  return { repo, store, membership, presence, call, signedIn }
}

/** The two letters the app draws for a name (app/src/elements/atoms/Presence.tsx `monogram`). */
const monogram = async (name: string) => (await import('../../app/src/elements/atoms/Presence.tsx')).monogram(name)

describe('a member signed in by an emailed link, in the one display name (PF-R258)', () => {
  it('reads as their member name in GET /api/actor and /api/session, comments, presence and the history of what they wrote', async () => {
    const h = await house()
    const cookie = await h.signedIn()
    const actor = await (await h.call('GET', '/api/actor', { cookie })).json()
    expect(actor).toMatchObject({ id: ID, name: 'Example Steward', via: 'email' })
    expect(actor).not.toHaveProperty('account')
    const session = await (await h.call('GET', '/api/session', { cookie })).json()
    expect(session).toMatchObject({ signedIn: true, via: 'email', actor: ID, person: { id: ID, name: 'Example Steward' } })

    // A comment: its author by member name, their id the handle.
    expect((await h.call('POST', '/api/comments', { cookie, body: { target: `page:${PAGE}`, body: 'Read by the stewards.' } })).status).toBe(201)
    const [comment] = await (await h.call('GET', `/api/comments?target=page:${PAGE}`, { cookie })).json()
    expect(comment).toMatchObject({ handle: ID, role: 'Example Steward' })

    // Presence: the same name.
    expect((await h.call('POST', '/api/presence', { cookie, body: { target: `page:${PAGE}` } })).status).toBeLessThan(300)
    expect(h.presence.everyone(`page:${PAGE}`)).toEqual([expect.objectContaining({ handle: ID, role: 'Example Steward' })])

    // Proposal heads, approvals and history name an actor id through displayNames: the member name for this person.
    expect(displayNames(h.repo, h.membership)(ID)).toBe('Example Steward')

    // One name, one monogram: the composer's (the actor's name), a comment's, a presence's.
    const two = await monogram('Example Steward')
    expect(await monogram(actor.name)).toBe(two)
    expect(await monogram(comment.role)).toBe(two)
    expect(await monogram(session.person.name)).toBe(two)
  })

  it('a commit they make while the Hub writes is committed by the house, and Org-Actor names them; history reads their member name', async () => {
    const h = await house()
    const cookie = await h.signedIn()
    const res = await h.call('POST', '/api/registries/ideas', { cookie, body: { id: 'idea-1', title: 'An idea' } })
    expect(res.status, await res.clone().text()).toBe(201)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: h.repo }).toString()
    expect(parseTrailers(git('log', '-1', '--format=%B'))).toMatchObject({ actor: ID })
    expect(git('log', '-1', '--format=%an <%ae>|%cn <%ce>').trim())
      .toBe(`${HOUSE_IDENT.name} <${HOUSE_IDENT.email}>|${HOUSE_IDENT.name} <${HOUSE_IDENT.email}>`)
    expect((await entityChanges(h.repo, 'ideas', displayNames(h.repo, h.membership))).get('idea-1')).toMatchObject({ by: 'Example Steward' })
  })

  // T2c (closing review, minor 2), Rule 4: the members file's name is read as the session's viewer may read it. A person
  // with no Role reads as the public, who may not read the members file (members by default): they are named as the Roles
  // table names them.
  it('a person with no Role is named as the public may read: the Roles table\'s name, never the members file\'s', async () => {
    const h = await house()
    const cookie = await h.signedIn(VISITOR_MAIL)
    const session = await (await h.call('GET', '/api/session', { cookie })).json()
    expect(session).toMatchObject({ signedIn: true, via: 'email', actor: VISITOR, viewer: 'public', person: { id: VISITOR, name: 'V. Visitor (roles)' } })
    // T2e I1: the request's actor carries the name others may be told; the members file holds their id, so it is the id.
    const actor = await (await h.call('GET', '/api/actor', { cookie })).json()
    expect(actor).toMatchObject({ id: VISITOR, name: VISITOR })
  })

  // T2d (the T2c review's finding 4), Rule 4: the request's actor is named as any member may read the members file (as the
  // public may, for a person with no Role), since presence falls back to it for everyone on the page. Only GET /api/session
  // tells the person their own name as their own viewer reads it.
  it('a steward whose members-file name only the council may read appears to a plain member in presence by what that member may read', async () => {
    const h = await house({ visibility: 'visibility:\n  collections:\n    members: { fields: { name: "role:council" } }\n' })
    const cookie = await h.signedIn()
    const session = await (await h.call('GET', '/api/session', { cookie })).json()
    expect(session.person).toMatchObject({ id: ID, name: 'Example Steward' })
    expect((await h.call('POST', '/api/presence', { cookie, body: { target: `page:${PAGE}` } })).status).toBeLessThan(300)
    const plain = { kind: 'member' as const, id: 'example-org:person:someone-else', hats: [] as string[], roles: [] as string[] }
    // T2e I1: the members file holds their id, so neither the members row's name nor the Roles table's stands in for the one
    // a plain member may not read: they are shown by their id.
    expect(h.presence.of(`page:${PAGE}`, plain)).toEqual([expect.objectContaining({ handle: ID, role: ID })])
    expect(JSON.stringify(h.presence.everyone(`page:${PAGE}`))).not.toMatch(/Example Steward|E\. Steward/)
    // Their comment's author, as any member reads it; and the composer's actor carries the name others may be told.
    expect((await h.call('POST', '/api/comments', { cookie, body: { target: `page:${PAGE}`, body: 'Kept name.' } })).status).toBe(201)
    const [comment] = await (await h.call('GET', `/api/comments?target=page:${PAGE}`, { cookie })).json()
    expect(comment).toMatchObject({ handle: ID, role: 'Example Steward' }) // they hold council: they may read it
    expect(namesFor(h.repo, h.membership, plain)(ID)).toEqual({ handle: ID, role: ID })
    const actor = await (await h.call('GET', '/api/actor', { cookie })).json()
    expect(actor.name).toBe(ID)
  })
})
