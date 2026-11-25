import { describe, it, expect, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../server/app.ts'
import { openPrivateStore } from '../../server/private/store.ts'
import { mountEmailSignIn, type EmailSignIn } from '../../server/session/email.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { Membership } from '../../server/session/membership.ts'
import { withRequest } from '../../server/request.ts'
import { mountFederation } from '../../server/federation/routes.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { DOC, HOST, HUB, MAIL, T0, repoWith, signInConfig } from '../workspace/file-reads.fixtures.ts'

// Replay M3 (0.7.3's `files` section on the network's writes): a member that data/visibility.yaml keeps from
// data/federation-requests.yaml receives nothing into it and decides nothing in it, and one kept from data/invites.yaml
// makes no invite. The refusal is the 422 every kept file answers (`refuseUnreadRegistry`), before any id is read and before
// anything is written. A Hub on this machine whose people sign in by emailed link (the hosted Hub refuses these routes
// before they run: NETWORK_HOSTED). A fresh temp repository each; synthetic values only.

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["example-dao:person:steward"] }
`
const POLICY = `visibility:
  files:
    default: members
    paths:
      data/federation-requests.yaml: role:steward
      data/invites.yaml: role:steward
`
const REQUESTS = `schema_version: "2.0"\nrequests:\n  - { id: req-1, from: "Valley Node", network: Mesh, outcome: held, received: "2026-11-18" }\n`
const UNREAD = (path: string) => ({ errors: [{ record: path, field: 'path', message: `${path} is not a governed file, so it has no editor here. Nothing was staged.` }] })

async function house() {
  const repo = repoWith(GOVERNANCE)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), POLICY)
  writeFileSync(join(repo, 'data', 'federation-requests.yaml'), REQUESTS)
  execSync('git add -A && git commit -qm "fixture: the policy, a held request"', { cwd: repo, stdio: 'pipe' })
  const dir = mkdtempSync(join(tmpdir(), 'fed-file-reads-store-'))
  const store = await openPrivateStore(repo, { dir })
  await store.replaceRoles(DOC)
  const now = () => T0
  const reader = {
    wearer: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const signIn = signInConfig()
  const mailer = recordingMailer()
  let email: EmailSignIn | undefined
  const app = createApp(repo, (a, ctx) => {
    email = mountEmailSignIn(a, { repo, store, config: signIn, mailer, now, hosted: { origin: HUB, trustProxy: false } as HostedConfig })
    mountFederation(a, { repo, withLock: ctx.withLock, startBranch: 'main', now })
  }, { request: withRequest({ repo, hosted: false, membership, store, signIn, now }) })
  const post = (path: string, body: unknown, cookie: string) => app.request(`http://${HOST}${path}`, {
    method: 'POST', headers: { host: HOST, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const cookieFor = async (address: string) => {
    const before = mailer.sent.length
    await app.request(`http://${HOST}/api/session/email`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ email: address }) })
    await email!.settled()
    const token = new URL(mailer.sent[before]!.link).searchParams.get('token')!
    const res = await app.request(`http://${HOST}/api/session/link`, { method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    expect(res.status).toBe(200)
    return `${signIn.cookie.name}=${res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined)!}`
  }
  const head = () => execSync('git rev-parse HEAD', { cwd: repo }).toString().trim()
  const close = () => { store.close(); rmSync(dir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }) }
  return { post, cookieFor, head, close }
}

describe('the network\'s writes and the files section (replay M3)', () => {
  it('a member kept from the requests file is refused receive and decide, alike for a request that exists and one that does not', async () => {
    const h = await house()
    try {
      const member = await h.cookieFor(MAIL.member)
      const before = h.head()
      const receive = await h.post('/api/federation/requests/receive', { text: 'spec: org-os/federation-request/1\nid: abc\n' }, member)
      expect([receive.status, await receive.json()]).toEqual([422, UNREAD('data/federation-requests.yaml')])
      const drain = await h.post('/api/federation/requests/receive', {}, member)
      expect([drain.status, await drain.json()]).toEqual([422, UNREAD('data/federation-requests.yaml')])
      const hit = await h.post('/api/federation/requests/req-1/decide', { accept: true }, member)
      const miss = await h.post('/api/federation/requests/req-9/decide', { accept: true }, member)
      expect([hit.status, await hit.json()]).toEqual([422, UNREAD('data/federation-requests.yaml')])
      expect([miss.status, await miss.json()]).toEqual([422, UNREAD('data/federation-requests.yaml')])
      expect(h.head()).toBe(before)
    } finally { h.close() }
  })

  it('a member kept from the invites file makes no invite', async () => {
    const h = await house()
    try {
      const member = await h.cookieFor(MAIL.member)
      const before = h.head()
      const made = await h.post('/api/federation/invites', { name: 'Valley Node', type: 'LocalNode', network: 'Mesh', days: 30 }, member)
      expect([made.status, await made.json()]).toEqual([422, UNREAD('data/invites.yaml')])
      expect(h.head()).toBe(before)
    } finally { h.close() }
  })

  it('a steward, who may read both files, goes on to the route (its own answer, never the files refusal)', async () => {
    const h = await house()
    try {
      const steward = await h.cookieFor(MAIL.steward)
      for (const [path, body] of [
        ['/api/federation/requests/receive', { text: 'not a request' }],
        ['/api/federation/requests/req-9/decide', { accept: true }],
        ['/api/federation/invites', { name: 'Valley Node', type: 'LocalNode', network: 'Mesh', days: 30 }],
      ] as const) {
        const r = await h.post(path, body, steward)
        const text = await r.text()
        expect(r.status, `${path}: ${text}`).not.toBe(422)
        expect(text, path).not.toContain('is not a governed file')
      }
    } finally { h.close() }
  })
})
