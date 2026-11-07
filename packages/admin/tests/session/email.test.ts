import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { mountEmailSignIn, LINK_TTL_MS, type EmailSignIn } from '../../server/session/email.ts'
import { recordingMailer, type Mailer } from '../../server/session/mail.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { emailKey } from '../../lib/session-token.mjs'

// Lane 3 Task 7: POST /api/session/email. The same answer for every address (Review Focus 1, 2); a link only for a known
// person within the limits; the address kept nowhere. Synthetic values only; the mailer records and sends nothing.

const HOST = 'localhost:4680'
const T0 = new Date('2026-11-18T10:00:00.000Z')
const PEPPER = '0f'.repeat(32)
const ADDRESS = 'steward@example.org'
const SENTENCE = { sent: true, sentence: "If this address is on Fixture Org's records, a link is on its way." }
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex')

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

function configOf(o: { hosted?: boolean; origin?: string; domain?: string } = {}): SignInConfig {
  const read = readSignInConfig({ HOUSE_EMAIL_PEPPER: PEPPER, ...(o.domain ? { SESSION_COOKIE_DOMAIN: o.domain } : {}) },
    { hosted: false, origin: o.origin ?? `http://${HOST}` })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}

async function house(o: { mailer?: Mailer; hosted?: Pick<HostedConfig, 'origin' | 'trustProxy'>; domain?: string } = {}) {
  const repo = makeFixtureRepo(); cleanup.push(repo)
  const dir = mkdtempSync(join(tmpdir(), 'email-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  await store.replaceRoles({
    roles_version: '2026-11-18',
    people: [
      { id: 'refidao:person:example-steward', name: 'Example Steward', email_keys: [emailKey(ADDRESS, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
    ],
  })
  const state = { clock: T0 }
  const mailer = o.mailer ?? recordingMailer()
  const config = configOf({ ...(o.hosted ? { origin: o.hosted.origin } : {}), ...(o.domain ? { domain: o.domain } : {}) })
  let signIn: EmailSignIn | undefined
  const app = createApp(repo, a => {
    signIn = mountEmailSignIn(a, { repo, store, config, mailer, now: () => state.clock, ...(o.hosted ? { hosted: o.hosted as HostedConfig } : {}) })
  })
  return { app, repo, store, state, mailer: mailer as ReturnType<typeof recordingMailer>, dir, settled: () => signIn!.settled() }
}

function askOnly(app: Hono, body: unknown, o: { ip?: string } = {}) {
  const headers: Record<string, string> = { host: HOST, 'content-type': 'application/json' }
  if (o.ip) headers['x-real-ip'] = o.ip
  return app.request(`http://${HOST}/api/session/email`, { method: 'POST', headers, body: JSON.stringify(body) })
}
/** Asks, then waits for the work done after the answer (the lookup, the link, the hand-off to the mailer). */
async function ask(h: { app: Hono; settled(): Promise<void> }, body: unknown, o: { ip?: string } = {}) {
  const res = await askOnly(h.app, body, o)
  await h.settled()
  return res
}
const answerOf = async (res: Response) => ({ status: res.status, body: await res.json() })
const tokenOf = (link: string) => new URL(link).searchParams.get('token')!

describe('POST /api/session/email (Lane 3 Task 7)', () => {
  it('unknown address: same response, no send', async () => {
    const h = await house()
    const known = await answerOf(await ask(h, { email: ADDRESS }))
    const unknown = await answerOf(await ask(h, { email: 'nobody@example.org' }))
    expect(unknown).toEqual({ status: 202, body: SENTENCE })
    expect(unknown).toEqual(known)
    expect(h.mailer.sent.map(m => m.to)).toEqual([ADDRESS])
  })

  it('known address: one mail; the link expires in 15 min', async () => {
    const h = await house()
    expect(await answerOf(await ask(h, { email: ADDRESS }))).toEqual({ status: 202, body: SENTENCE })
    expect(h.mailer.sent).toHaveLength(1)
    const link = new URL(h.mailer.sent[0]!.link)
    expect(`${link.origin}${link.pathname}`).toBe(`http://${HOST}/sign-in/link`)
    const token = tokenOf(h.mailer.sent[0]!.link)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await h.store.takeLink(sha256(token), new Date(T0.getTime() + LINK_TTL_MS))).toBe('expired')
    expect(LINK_TTL_MS).toBe(15 * 60_000)
    // A second link, taken a moment before its 15 minutes are up, works.
    await ask(h, { email: ADDRESS })
    const second = tokenOf(h.mailer.sent[1]!.link)
    expect(await h.store.takeLink(sha256(second), new Date(T0.getTime() + LINK_TTL_MS - 1000))).toMatchObject({ personId: 'refidao:person:example-steward' })
  })

  it('" Steward@Example.org " finds steward@example.org', async () => {
    const h = await house()
    expect(await answerOf(await ask(h, { email: ' Steward@Example.org ' }))).toEqual({ status: 202, body: SENTENCE })
    expect(h.mailer.sent).toHaveLength(1)
    expect(h.mailer.sent[0]!.to).toBe('Steward@Example.org')
  })

  it('does not fold plus-addresses', async () => {
    const h = await house()
    await ask(h, { email: 'steward+hub@example.org' })
    expect(h.mailer.sent).toEqual([])
  })

  it('rate limited: same response, no send', async () => {
    const h = await house()
    for (let i = 0; i < 3; i++) await ask(h, { email: ADDRESS })
    expect(h.mailer.sent).toHaveLength(3)
    // The fourth ask for the same address in 15 minutes: answered alike, nothing sent.
    expect(await answerOf(await ask(h, { email: ` ${ADDRESS.toUpperCase()}` }))).toEqual({ status: 202, body: SENTENCE })
    expect(h.mailer.sent).toHaveLength(3)
    // 15 minutes on, the key's places are back.
    h.state.clock = new Date(T0.getTime() + LINK_TTL_MS)
    await ask(h, { email: ADDRESS })
    expect(h.mailer.sent).toHaveLength(4)
  })

  it('rate limited per client: ten asks from one address in 15 min, whatever they ask for', async () => {
    const h = await house({ hosted: { origin: 'https://hub.example.org', trustProxy: true } })
    for (let i = 0; i < 10; i++) await ask(h, { email: `someone${i}@example.org` }, { ip: '192.0.2.7' })
    expect(await answerOf(await ask(h, { email: ADDRESS }, { ip: '192.0.2.7' }))).toEqual({ status: 202, body: SENTENCE })
    expect(h.mailer.sent).toEqual([])
    // Another client is not held by the first one's asks.
    await ask(h, { email: ADDRESS }, { ip: '192.0.2.8' })
    expect(h.mailer.sent).toHaveLength(1)
    // Hosted, the link is built on the configured origin, never on the request's Host.
    expect(h.mailer.sent[0]!.link.startsWith('https://hub.example.org/sign-in/link?token=')).toBe(true)
  })

  it('the answer does not wait for the mail', async () => {
    const never: Mailer = { send: () => new Promise<void>(() => { /* never settles */ }) }
    const h = await house({ mailer: never })
    const res = await Promise.race([ask(h, { email: ADDRESS }), new Promise<'waited'>(r => setTimeout(() => r('waited'), 2000))])
    expect(res).not.toBe('waited')
    expect(await answerOf(res as Response)).toEqual({ status: 202, body: SENTENCE })
  })

  it('answers before any store call, known or unknown (S7-4)', async () => {
    // A store that records every call and never finishes a write: the answer for both addresses comes while nothing has
    // been asked of it, so a known address's lookup and link writes cannot lengthen its answer (Review Focus 2).
    const real = await house()
    const calls: string[] = []
    const blocking = new Proxy(real.store, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver)
        if (typeof v !== 'function') return v
        return (...args: unknown[]) => {
          calls.push(String(prop))
          if (prop === 'deleteLinksExpired' || prop === 'putLink') return new Promise(() => { /* never settles */ })
          return v.apply(target, args)
        }
      },
    }) as PrivateStore
    const mailer = recordingMailer()
    const config = configOf()
    const app = createApp(real.repo, a => { mountEmailSignIn(a, { repo: real.repo, store: blocking, config, mailer, now: () => T0 }) })
    for (const email of [ADDRESS, 'nobody@example.org']) {
      const before = calls.length
      const res = await askOnly(app, { email })
      expect([email, calls.slice(before)]).toEqual([email, []])
      expect(await answerOf(res)).toEqual({ status: 202, body: SENTENCE })
    }
    // After the answers, the same lookup for both; only the known one goes on to write, and that write still hangs.
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))
    expect([...calls].sort()).toEqual(['deleteLinksExpired', 'personByEmailKey', 'personByEmailKey'])
    expect(mailer.sent).toEqual([])
  })

  it('a mail that fails is logged without the address, and the answer is the same', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing: Mailer = { send: async () => { throw new Error('The sign-in mail was not sent: the mail provider answered 500.') } }
    const h = await house({ mailer: failing })
    expect(await answerOf(await ask(h, { email: ADDRESS }))).toEqual({ status: 202, body: SENTENCE })
    await new Promise(r => setTimeout(r, 10))
    const logged = errors.mock.calls.flat().join('\n')
    expect(logged).toContain('the mail provider answered 500')
    expect(logged).not.toContain('example.org')
  })

  it('the address is never stored or logged', async () => {
    const lines: string[] = []
    for (const k of ['log', 'error', 'warn', 'info', 'debug'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')) })
    const h = await house()
    await ask(h, { email: ` ${ADDRESS} `, return: '/registries' })
    await ask(h, { email: 'nobody@example.org' })
    await ask(h, { email: 'Steward@Example.org' })
    expect(h.mailer.sent).toHaveLength(2)
    for (const f of [h.store.file, `${h.store.file}-wal`]) {
      if (!existsSync(f)) continue
      const text = readFileSync(f).toString('latin1').toLowerCase()
      expect(text).not.toContain('example.org')
      expect(text).not.toContain('steward@')
    }
    expect(existsSync(`${h.store.file}-wal`)).toBe(true)
    expect(lines.join('\n').toLowerCase()).not.toContain('example.org')
    expect([...h.store.allStrings()].some(s => s.includes('@'))).toBe(false)
  })

  it('return is stored through safeReturn', async () => {
    const h = await house({ domain: 'localhost' })
    const cases: [unknown, string][] = [
      ['/registries/projects?x=1', '/registries/projects?x=1'],
      ['https://evil.example/x', `http://${HOST}/`],
      ['//evil.example', `http://${HOST}/`],
      ['javascript:alert(1)', `http://${HOST}/`],
      [undefined, `http://${HOST}/`],
    ]
    for (const [given, kept] of cases) {
      const before = h.mailer.sent.length
      h.state.clock = new Date(h.state.clock.getTime() + LINK_TTL_MS) // a fresh window for each ask
      await ask(h, { email: ADDRESS, ...(given === undefined ? {} : { return: given }) })
      const token = tokenOf(h.mailer.sent[before]!.link)
      const link = await h.store.takeLink(sha256(token), h.state.clock)
      expect([given, typeof link === 'string' ? link : link.returnTo]).toEqual([given, kept])
    }
  })

  it('a malformed ask is 400, and says nothing of any address', async () => {
    const h = await house()
    for (const body of [{}, { email: 42 }, { email: 'not-an-address' }, { email: ADDRESS, return: 7 }, [ADDRESS]]) {
      const res = await ask(h, body)
      expect(res.status).toBe(400)
      expect(JSON.stringify(await res.json())).not.toContain('example.org')
    }
    expect(h.mailer.sent).toEqual([])
  })
})
