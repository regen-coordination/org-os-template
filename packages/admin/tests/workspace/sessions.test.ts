import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { Hono } from 'hono'
import { makeChangeRepo, git, SOLO } from '../changes/fixtures.ts'
import { startServer } from '../../server/serve.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore } from '../../server/private/store.ts'
import { stateDir } from '../../server/state.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { MOVE_PROPOSED } from '../../server/private/ops.ts'
import { mergeThree } from '../../server/git.ts'
import { joinPage, splitPage } from '../../lib/workspace/pages.mjs'
import { workspaceOf } from '../../server/workspace/routes.ts'
import {
  DRAFT_DEBOUNCE_MS, EditSessions, NEWER_VERSION, NO_CONFLICT, NO_SESSION, PAGE_IDLE_MS, PAGE_MAX_MS, type Schedule,
} from '../../server/workspace/sessions.ts'
import { PAGE_MAX_BYTES } from '../../server/workspace/pages.ts'
import type { WearerReading } from '../../server/systems/hats.ts'
import type { KnownActor } from '../../server/actor.ts'

// DAO-OS L6 §6, Task 8: editing sessions, one commit per session. A git page's draft lives in the admin state directory
// (outside the repository), a private page's in the store's `drafts`; a session ends, and its draft becomes one commit,
// when it is closed, idle PAGE_IDLE_MS, older than PAGE_MAX_MS (the next follows at once), when the server stops, or at
// the next start (reconcile). A newer version is merged three ways (git merge-file -p); a real conflict is Compare. Every
// test builds a fresh temporary repository (makeChangeRepo) and keeps its store in a folder of its own; time is a fake
// clock and a fake scheduler, never a real wait. Locally, git's identity is steward-a, whose wallet A1 wears Ops.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
/** The handbook's tree raised: a page in it is proposed, and approved by steward-a. */
const RAISED = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: handbook, applies_to: ["workspace:tree-handbook-3f2a"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
/** Consensus with no written rule: the workspace is direct (only a rule naming it raises it). */
const OPEN = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules: []
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, role: Contributor }
`

/** Seven lines, so an edit of the first and one of the last are far enough apart to merge cleanly. */
const BODY = 'First line.\n\nSecond line.\n\nThird line.\n\nFourth line.\n'
const page = (id: string, title: string, body = BODY, extra: Record<string, unknown> = {}) =>
  joinPage({ id, title, parent: null, order: 1000, ...extra }, body)

const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }
const STEWARD_B: KnownActor = { id: 'steward-b', name: 'Steward B', kind: 'person', via: 'git' }
const member = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] as string[] }
const plainMember = { kind: 'member' as const, id: 'steward-b', hats: [] as string[], roles: [] as string[] }

const cleanup: string[] = []
const stores: PrivateStore[] = []
const live: EditSessions[] = []
afterEach(() => {
  for (const s of live.splice(0)) s.dispose()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; appWith: (access: () => PrivateStore) => Hono }

async function world(opts: { governance?: string; pages?: Record<string, string> } = {}): Promise<World> {
  const repo = makeChangeRepo(opts.governance ?? GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  for (const [id, text] of Object.entries(opts.pages ?? { 'guide-0001': page('guide-0001', 'Guide') })) writeFileSync(join(repo, 'pages', `${id}.md`), text)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, the pages"')
  const dir = mkdtempSync(join(tmpdir(), 'sessions-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: account.toLowerCase().endsWith('a1') ? [OPS] : [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const appWith = (access: () => PrivateStore) => {
    const app = createApp(repo, undefined, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: access })
    const writers = workspaceOf(app)
    if (writers) live.push(writers.sessions)
    return app
  }
  return { repo, store, app: appWith(() => store), appWith }
}

/** A fake clock and scheduler: `advance` moves the clock and runs what fell due, in order. */
function fakeTime(start = NOW) {
  let t = start.getTime()
  const due: { at: number; fn: () => void; live: boolean }[] = []
  const schedule: Schedule = (fn, ms) => { const e = { at: t + ms, fn, live: true }; due.push(e); return () => { e.live = false } }
  return {
    now: () => new Date(t),
    schedule,
    advance(ms: number) {
      t += ms
      for (const e of due.filter(x => x.live && x.at <= t).sort((a, b) => a.at - b.at)) { e.live = false; e.fn() }
    },
  }
}

function sessionsOf(w: World, clock = fakeTime(), store: PrivateStore | null = w.store): EditSessions {
  const s = new EditSessions(w.repo, { store, now: clock.now, schedule: clock.schedule })
  live.push(s)
  return s
}

const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const lastMessage = (repo: string) => git(repo, 'log -1 --format=%B')
const fileOf = (repo: string, id: string) => readFileSync(join(repo, 'pages', `${id}.md`), 'utf8')
const bodyOf = (repo: string, id: string) => splitPage(fileOf(repo, id)).body
const draftsDir = (repo: string) => join(stateDir(repo), 'drafts')
const draftFiles = (repo: string) => (existsSync(draftsDir(repo)) ? readdirSync(draftsDir(repo)).sort() : [])
const status = (repo: string) => git(repo, 'status --porcelain').trim()

/** Another member's hand commit of the page (a newer version). */
function commitByHand(repo: string, id: string, text: string): void {
  writeFileSync(join(repo, 'pages', `${id}.md`), text)
  git(repo, `add pages/${id}.md`); git(repo, 'commit -qm "page: by hand"')
}

describe('the constants (L6 §6)', () => {
  it('are the spec\'s, exactly', () => {
    expect(DRAFT_DEBOUNCE_MS).toBe(800)
    expect(PAGE_IDLE_MS).toBe(60000)
    expect(PAGE_MAX_MS).toBe(1800000)
    expect(PAGE_MAX_BYTES).toBe(524288)
  })
})

describe('mergeThree (git merge-file -p, in one shape)', () => {
  it('merges edits far apart byte for byte, refuses a real conflict, and leaves no file behind', async () => {
    const w = await world()
    const theirs = BODY.replace('First line.', 'First line, theirs.')
    const mine = BODY.replace('Fourth line.', 'Fourth line, mine.')
    expect(await mergeThree(w.repo, BODY, theirs, mine)).toEqual({ clean: true, text: 'First line, theirs.\n\nSecond line.\n\nThird line.\n\nFourth line, mine.\n' })
    expect(await mergeThree(w.repo, BODY, BODY.replace('Second', 'Other'), BODY.replace('Second', 'Mine'))).toEqual({ clean: false })
    // Whitespace at the end is kept as the texts hold it.
    expect(await mergeThree(w.repo, 'a\n', 'a\n', 'a\n\n\n')).toEqual({ clean: true, text: 'a\n\n\n' })
    expect(readdirSync(join(stateDir(w.repo), 'merge'))).toEqual([])
  })
})

describe('editing sessions (L6 §6, §16)', () => {
  it('saves within a session are one commit at close, with Org-Rule: workspace/direct and Org-Change: ses_…', async () => {
    const w = await world()
    const before = commits(w.repo)
    const open = await call(w.app, '/api/pages/guide-0001/sessions', json('POST'))
    expect(open.status).toBe(200)
    expect(open.body).toEqual({ session: expect.stringMatching(/^ses_[0-9a-f]{16}$/), base: git(w.repo, 'rev-parse HEAD:pages/guide-0001.md').trim(), markdown: BODY })
    const sid = open.body.session as string
    for (const n of [1, 2, 3]) {
      const put = await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: BODY.replace('First line.', `First line, take ${n}.`) }))
      expect(put).toEqual({ status: 200, body: { save: 'direct' } })
    }
    // Durable, outside the repository: the draft is a file of the state directory, and git sees nothing.
    expect(draftFiles(w.repo)).toEqual([`${sid}.json`])
    expect(status(w.repo)).toBe('')
    expect(commits(w.repo)).toBe(before)
    const closed = await call(w.app, `/api/sessions/${sid}/close`, json('POST'))
    expect(closed.status).toBe(200)
    expect(closed.body).toEqual({ commit: git(w.repo, 'rev-parse HEAD').trim() })
    expect(commits(w.repo)).toBe(before + 1)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(BODY.replace('First line.', 'First line, take 3.'))
    const message = lastMessage(w.repo)
    expect(message.split('\n')[0]).toBe('page: Guide')
    expect(message).toContain('Org-Rule: workspace/direct')
    expect(message).toContain(`Org-Change: ${sid}`)
    expect(message).toContain('Org-Actor: steward-a')
    expect(draftFiles(w.repo)).toEqual([])
    // The session is over: a save to it is the 404 of one that is not there.
    expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'Late.\n' }))).toEqual({ status: 404, body: { error: NO_SESSION(sid), code: 'NO_SESSION' } })
  })

  it('a title sent with a save is the page\'s title in the commit, and its front matter keeps its other bytes', async () => {
    const w = await world({ pages: { 'guide-0001': `---\nid: guide-0001\ntitle: Guide\nparent: null\norder: 1000\nkeep: me # a comment\n---\n${BODY}` } })
    const s = sessionsOf(w)
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(session, STEWARD_A, { markdown: BODY, title: 'Field guide' })
    await s.close(session)
    expect(lastMessage(w.repo).split('\n')[0]).toBe('page: Field guide')
    expect(fileOf(w.repo, 'guide-0001')).toContain('keep: me')
    expect(splitPage(fileOf(w.repo, 'guide-0001')).front.title).toBe('Field guide')
  })

  it('60 s idle ends a session (fake clock)', async () => {
    const w = await world()
    const clock = fakeTime()
    const s = sessionsOf(w, clock)
    const before = commits(w.repo)
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(session, STEWARD_A, { markdown: BODY.replace('First', 'Idle') })
    clock.advance(PAGE_IDLE_MS - 1)
    await s.settled()
    expect(commits(w.repo)).toBe(before)
    clock.advance(1)
    await s.settled()
    expect(commits(w.repo)).toBe(before + 1)
    expect(lastMessage(w.repo)).toContain(`Org-Change: ${session}`)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(BODY.replace('First', 'Idle'))
    // The member comes back: a save sent to it opens the next session from where it ended, and says so.
    const back = await s.save(session, STEWARD_A, { markdown: BODY.replace('First', 'Idle').replace('Fourth', 'Back') })
    expect(back).toEqual({ save: 'direct', session: expect.stringMatching(/^ses_/) })
    expect(await s.close(session)).toEqual({ commit: expect.any(String) })
    expect(bodyOf(w.repo, 'guide-0001')).toBe(BODY.replace('First', 'Idle').replace('Fourth', 'Back'))
    expect(commits(w.repo)).toBe(before + 2)
  })

  it('a save resets the idle clock', async () => {
    const w = await world()
    const clock = fakeTime()
    const s = sessionsOf(w, clock)
    const before = commits(w.repo)
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(session, STEWARD_A, { markdown: BODY.replace('First', 'One') })
    clock.advance(50_000)
    await s.save(session, STEWARD_A, { markdown: BODY.replace('First', 'Two') })
    clock.advance(50_000)
    await s.settled()
    expect(commits(w.repo)).toBe(before)
    clock.advance(10_000)
    await s.settled()
    expect(commits(w.repo)).toBe(before + 1)
  })

  it('30 min ends it and opens the next', async () => {
    const w = await world()
    const clock = fakeTime()
    const s = sessionsOf(w, clock)
    const before = commits(w.repo)
    const { session: first } = await s.open(STEWARD_A, member, 'guide-0001')
    // A save every 50 s keeps it from going idle; at 30 min it ends anyway.
    let n = 0
    for (let at = 0; at < PAGE_MAX_MS; at += 50_000) {
      await s.save(first, STEWARD_A, { markdown: BODY.replace('First line.', `First line, ${++n}.`) })
      clock.advance(Math.min(50_000, PAGE_MAX_MS - at))
      await s.settled()
    }
    expect(commits(w.repo)).toBe(before + 1)
    expect(lastMessage(w.repo)).toContain(`Org-Change: ${first}`)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(BODY.replace('First line.', `First line, ${n}.`))
    // The next session follows at once: a save sent to the first lands in it, and says so.
    const next = await s.save(first, STEWARD_A, { markdown: BODY.replace('First line.', `First line, ${n}.`).replace('Fourth line.', 'Fourth line, next.') })
    expect(next).toEqual({ save: 'direct', session: expect.stringMatching(/^ses_/) })
    const second = (next as { session: string }).session
    expect(second).not.toBe(first)
    expect(await s.close(first)).toEqual({ commit: git(w.repo, 'rev-parse HEAD').trim() })
    expect(commits(w.repo)).toBe(before + 2)
    expect(lastMessage(w.repo)).toContain(`Org-Change: ${second}`)
    expect(bodyOf(w.repo, 'guide-0001')).toContain('Fourth line, next.')
  })

  it('a save that lands while the PAGE_MAX_MS end is committing is kept: it waits, lands in the next session, and is committed (review C1)', async () => {
    const w = await world()
    const clock = fakeTime()
    const s = new EditSessions(w.repo, { store: w.store, now: clock.now, schedule: clock.schedule, idleMs: 10 * PAGE_MAX_MS })
    live.push(s)
    const heard: string[] = []
    s.onCommit((_p, base) => { heard.push(base) })
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    const d1 = BODY.replace('First line.', 'First line, d1.')
    await s.save(session, STEWARD_A, { markdown: d1 })
    clock.advance(PAGE_MAX_MS) // the end starts; its commit is in flight
    for (let n = 0; n < 2000 && !fileOf(w.repo, 'guide-0001').includes('d1'); n++) await new Promise(r => setImmediate(r))
    const d2 = d1.replace('Second line.', 'Second line, d2.')
    const during = await s.save(session, STEWARD_A, { markdown: d2 }) // the member typed on
    expect(during).toEqual({ save: 'direct', session: expect.stringMatching(/^ses_/) })
    await s.settled()
    const d3 = d2.replace('Fourth line.', 'Fourth line, d3.')
    await s.save(session, STEWARD_A, { markdown: d3 })
    await s.close(session)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(d3)
    // One commit per session, and the second session's base is a real version: the blob the first one committed.
    expect(heard).toHaveLength(2)
    expect(heard[1]).toBe(git(w.repo, 'rev-parse HEAD~1:pages/guide-0001.md').trim())
  })

  it('a save that lands while an idle end is committing is kept too: it opens the next session (review C1)', async () => {
    const w = await world()
    const clock = fakeTime()
    const s = sessionsOf(w, clock)
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    const d1 = BODY.replace('First line.', 'First line, d1.')
    await s.save(session, STEWARD_A, { markdown: d1 })
    clock.advance(PAGE_IDLE_MS)
    for (let n = 0; n < 2000 && !fileOf(w.repo, 'guide-0001').includes('d1'); n++) await new Promise(r => setImmediate(r))
    const d2 = d1.replace('Fourth line.', 'Fourth line, d2.')
    expect(await s.save(session, STEWARD_A, { markdown: d2 })).toEqual({ save: 'direct', session: expect.stringMatching(/^ses_/) })
    await s.settled()
    expect(draftFiles(w.repo)).toHaveLength(1)
    await s.flushAll()
    expect(bodyOf(w.repo, 'guide-0001')).toBe(d2)
  })

  it('after a rollover, another member\'s commit is merged into the next session, never undone', async () => {
    const w = await world()
    const clock = fakeTime()
    const s = new EditSessions(w.repo, { store: w.store, now: clock.now, schedule: clock.schedule, idleMs: 10 * PAGE_MAX_MS })
    live.push(s)
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    const d1 = BODY.replace('First line.', 'First line, d1.')
    await s.save(session, STEWARD_A, { markdown: d1 })
    clock.advance(PAGE_MAX_MS)
    await s.settled()
    commitByHand(w.repo, 'guide-0001', page('guide-0001', 'Guide', d1.replace('Third line.', 'Third line, theirs.')))
    await s.save(session, STEWARD_A, { markdown: d1.replace('Fourth line.', 'Fourth line, mine.') })
    await s.close(session)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(d1.replace('Third line.', 'Third line, theirs.').replace('Fourth line.', 'Fourth line, mine.'))
  })

  for (const why of ['max', 'idle'] as const) {
    it(`a tree raised mid-session: a ${why} end stages, and the member's next save keeps every edit in the change (re-review N1)`, async () => {
      const w = await world({ governance: OPEN, pages: { 'handbook-3f2a': page('handbook-3f2a', 'Handbook') } })
      const clock = fakeTime()
      const s = new EditSessions(w.repo, { store: w.store, now: clock.now, schedule: clock.schedule, ...(why === 'max' ? { idleMs: 10 * PAGE_MAX_MS } : {}) })
      live.push(s)
      const { session } = await s.open(STEWARD_A, member, 'handbook-3f2a')
      const d1 = BODY.replace('First line.', 'First line, d1.')
      expect(await s.save(session, STEWARD_A, { markdown: d1 })).toEqual({ save: 'direct' })
      writeFileSync(join(w.repo, 'data', 'governance.yaml'), RAISED); git(w.repo, 'add -A'); git(w.repo, 'commit -qm "raise the handbook"')
      const before = commits(w.repo)
      clock.advance(why === 'max' ? PAGE_MAX_MS : PAGE_IDLE_MS)
      await s.settled()
      expect(commits(w.repo)).toBe(before)
      const trayBody = () => splitPage((new ChangeStore(w.repo).load('steward-a')!.ops[0] as { text: string }).text).body
      expect(trayBody()).toBe(d1)
      const d2 = d1.replace('Fourth line.', 'Fourth line, d2.')
      expect(await s.save(session, STEWARD_A, { markdown: d2 })).toEqual({ save: 'staged', session: expect.stringMatching(/^ses_/) })
      expect(new ChangeStore(w.repo).load('steward-a')!.ops).toHaveLength(1)
      expect(trayBody()).toBe(d2)
    })
  }

  it('an unchanged draft commits nothing', async () => {
    const w = await world()
    const s = sessionsOf(w)
    const before = commits(w.repo)
    const a = await s.open(STEWARD_A, member, 'guide-0001')
    expect(await s.close(a.session)).toEqual({ commit: null })
    const b = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(b.session, STEWARD_A, { markdown: BODY.replace('First', 'Changed') })
    await s.save(b.session, STEWARD_A, { markdown: BODY })
    expect(await s.close(b.session)).toEqual({ commit: null })
    expect(commits(w.repo)).toBe(before)
    expect(draftFiles(w.repo)).toEqual([])
  })

  it('a draft left by a crash is committed by reconcile at start', async () => {
    const w = await world()
    const crashed = sessionsOf(w)
    const before = commits(w.repo)
    const { session } = await crashed.open(STEWARD_A, member, 'guide-0001')
    await crashed.save(session, STEWARD_A, { markdown: BODY.replace('Third', 'Recovered') })
    crashed.dispose() // the process went away: timers gone, nothing flushed
    expect(commits(w.repo)).toBe(before)
    expect(draftFiles(w.repo)).toEqual([`${session}.json`])
    const restarted = sessionsOf(w)
    expect(await restarted.reconcile()).toEqual([session])
    expect(commits(w.repo)).toBe(before + 1)
    expect(lastMessage(w.repo)).toContain(`Org-Change: ${session}`)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(BODY.replace('Third', 'Recovered'))
    expect(draftFiles(w.repo)).toEqual([])
    expect(await restarted.reconcile()).toEqual([])
  })

  it('a newer version merges cleanly and is committed', async () => {
    const w = await world()
    const before = commits(w.repo)
    const open = await call(w.app, '/api/pages/guide-0001/sessions', json('POST'))
    const sid = open.body.session as string
    commitByHand(w.repo, 'guide-0001', page('guide-0001', 'Guide', BODY.replace('First line.', 'First line, theirs.')))
    expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: BODY.replace('Fourth line.', 'Fourth line, mine.') })))
      .toEqual({ status: 200, body: { save: 'direct' } })
    const closed = await call(w.app, `/api/sessions/${sid}/close`, json('POST'))
    expect(closed.body).toEqual({ commit: expect.stringMatching(/^[0-9a-f]{40}$/) })
    expect(commits(w.repo)).toBe(before + 2)
    expect(bodyOf(w.repo, 'guide-0001')).toBe('First line, theirs.\n\nSecond line.\n\nThird line.\n\nFourth line, mine.\n')
  })

  it('a real conflict answers 409 CONFLICT with base, theirs, mine; Keep mine commits over theirs; Take theirs drops the draft', async () => {
    const w = await world()
    const theirs = BODY.replace('Second line.', 'Second line, theirs.')
    const mine = BODY.replace('Second line.', 'Second line, mine.')
    // Keep mine.
    const open = await call(w.app, '/api/pages/guide-0001/sessions', json('POST'))
    const sid = open.body.session as string
    commitByHand(w.repo, 'guide-0001', page('guide-0001', 'Guide', theirs))
    const before = commits(w.repo)
    const put = await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: mine }))
    expect(put).toEqual({ status: 409, body: { code: 'CONFLICT', error: NEWER_VERSION, compare: { base: BODY, theirs, mine } } })
    expect(NEWER_VERSION).toBe('Someone saved a newer version.')
    expect(await call(w.app, `/api/sessions/${sid}/compare`)).toEqual({ status: 200, body: { base: BODY, theirs, mine } })
    const closed = await call(w.app, `/api/sessions/${sid}/close`, json('POST'))
    expect(closed).toEqual({ status: 409, body: { code: 'CONFLICT', error: NEWER_VERSION, conflict: { base: BODY, theirs, mine } } })
    expect(commits(w.repo)).toBe(before)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(theirs)
    const kept = await call(w.app, `/api/sessions/${sid}/resolve`, json('POST', { keep: 'mine' }))
    expect(kept).toEqual({ status: 200, body: { commit: git(w.repo, 'rev-parse HEAD').trim() } })
    expect(commits(w.repo)).toBe(before + 1)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(mine)
    expect(lastMessage(w.repo)).toContain(`Org-Change: ${sid}`)
    expect(draftFiles(w.repo)).toEqual([])
    // Take theirs.
    const again = (await call(w.app, '/api/pages/guide-0001/sessions', json('POST'))).body.session as string
    commitByHand(w.repo, 'guide-0001', page('guide-0001', 'Guide', BODY.replace('Second line.', 'Second line, theirs again.')))
    const head = commits(w.repo)
    expect((await call(w.app, `/api/sessions/${again}`, json('PUT', { markdown: BODY.replace('Second line.', 'Second line, mine again.') }))).status).toBe(409)
    expect(await call(w.app, `/api/sessions/${again}/resolve`, json('POST', { keep: 'theirs' }))).toEqual({ status: 200, body: { commit: null } })
    expect(commits(w.repo)).toBe(head)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(BODY.replace('Second line.', 'Second line, theirs again.'))
    expect(draftFiles(w.repo)).toEqual([])
    expect((await call(w.app, `/api/sessions/${again}/compare`)).status).toBe(404)
  })

  it('Keep mine writes over the version Compare showed: a newer commit since is Compare again; a session with no conflict is refused (review I2)', async () => {
    const w = await world()
    const s = sessionsOf(w)
    const fresh = await s.open(STEWARD_A, member, 'guide-0001')
    await expect(s.resolve(fresh.session, 'mine')).rejects.toMatchObject({ status: 409, body: { code: 'NO_CONFLICT', error: NO_CONFLICT } })
    await expect(s.resolve(fresh.session, 'theirs')).rejects.toMatchObject({ status: 409, body: { code: 'NO_CONFLICT' } })
    const mine = BODY.replace('Second line.', 'Second line, mine.')
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(session, STEWARD_A, { markdown: mine })
    const tab2 = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(tab2.session, STEWARD_A, { markdown: BODY.replace('Second line.', 'Second line, tab 2.') })
    await s.close(tab2.session)
    const first = await s.close(session)
    expect(first).toMatchObject({ conflict: { theirs: BODY.replace('Second line.', 'Second line, tab 2.'), mine } })
    // The other tab commits again before Keep mine: that version was never shown, so it is Compare again.
    const tab3 = await s.open(STEWARD_A, member, 'guide-0001')
    const newest = BODY.replace('Second line.', 'Second line, tab 2.').replace('Fourth line.', 'Fourth line, tab 3.')
    await s.save(tab3.session, STEWARD_A, { markdown: newest })
    await s.close(tab3.session)
    const head = commits(w.repo)
    await expect(s.resolve(session, 'mine')).rejects.toMatchObject({ status: 409, body: { code: 'CONFLICT', compare: { theirs: newest, mine } } })
    expect(commits(w.repo)).toBe(head)
    expect(bodyOf(w.repo, 'guide-0001')).toBe(newest)
    // Shown now: Keep mine writes over it.
    expect(await s.resolve(session, 'mine')).toEqual({ commit: expect.any(String) })
    expect(bodyOf(w.repo, 'guide-0001')).toBe(mine)
  })

  it('two sessions of one member on one page never overwrite each other', async () => {
    const w = await world()
    const s = sessionsOf(w)
    const before = commits(w.repo)
    // Two tabs: each session its own base.
    const tab1 = await s.open(STEWARD_A, member, 'guide-0001')
    const tab2 = await s.open(STEWARD_A, member, 'guide-0001')
    expect(tab1.session).not.toBe(tab2.session)
    expect(tab1.base).toBe(tab2.base)
    await s.save(tab1.session, STEWARD_A, { markdown: BODY.replace('First line.', 'First line, tab 1.') })
    await s.save(tab2.session, STEWARD_A, { markdown: BODY.replace('Fourth line.', 'Fourth line, tab 2.') })
    expect(await s.close(tab1.session)).toEqual({ commit: expect.any(String) })
    // The second to end merges three ways: both edits are there.
    expect(await s.close(tab2.session)).toEqual({ commit: expect.any(String) })
    expect(commits(w.repo)).toBe(before + 2)
    expect(bodyOf(w.repo, 'guide-0001')).toBe('First line, tab 1.\n\nSecond line.\n\nThird line.\n\nFourth line, tab 2.\n')
    // On one line: the second reaches Compare, and neither is lost.
    const now = bodyOf(w.repo, 'guide-0001')
    const tab3 = await s.open(STEWARD_A, member, 'guide-0001')
    const tab4 = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(tab3.session, STEWARD_A, { markdown: now.replace('Third line.', 'Third line, tab 3.') })
    await expect(s.save(tab4.session, STEWARD_A, { markdown: now.replace('Third line.', 'Third line, tab 4.') })).resolves.toEqual({ save: 'direct' })
    await s.close(tab3.session)
    const out = await s.close(tab4.session)
    expect(out).toEqual({ conflict: { base: now, theirs: now.replace('Third line.', 'Third line, tab 3.'), mine: now.replace('Third line.', 'Third line, tab 4.') } })
    expect(bodyOf(w.repo, 'guide-0001')).toBe(now.replace('Third line.', 'Third line, tab 3.'))
    // tab 4's draft is still there, for Compare.
    expect(draftFiles(w.repo)).toEqual([`${tab4.session}.json`])
    expect(await s.compare(tab4.session)).toEqual((out as { conflict: unknown }).conflict)
  })

  it('a session is its own member\'s: another member\'s save, close or Compare is the 404 of one that is not there', async () => {
    const w = await world()
    const s = sessionsOf(w)
    const { session } = await s.open(STEWARD_A, member, 'guide-0001')
    await expect(s.save(session, STEWARD_B, { markdown: 'Theirs.\n' })).rejects.toMatchObject({ status: 404, message: NO_SESSION(session) })
    await expect(s.close(session, STEWARD_B)).rejects.toMatchObject({ status: 404 })
    await expect(s.compare(session, STEWARD_B)).rejects.toMatchObject({ status: 404 })
    await expect(s.save('ses_0000000000000000', STEWARD_A, { markdown: 'x' })).rejects.toMatchObject({ status: 404 })
  })

  it('every save passes the page\'s checks: §4.5\'s labels, PAGE_MAX_BYTES, and the body\'s shape', async () => {
    const w = await world()
    await w.store.putRecord({ collection: 'pages', id: 'p-0123456789ab', visibility: `hat:${OPS}`, body: { title: 'Payroll', parent: null, order: 1000, markdown: '' }, rev: '' }, 'steward-a', null)
    const open = await call(w.app, '/api/pages/guide-0001/sessions', json('POST'))
    const sid = open.body.session as string
    // A link to a private page in a members page is labelled ↗: its title never enters git.
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'See [Payroll](./p-0123456789ab.md).\n' }))).status).toBe(200)
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'x'.repeat(PAGE_MAX_BYTES) }))).status).toBe(413)
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { title: 'No body' }))).status).toBe(400)
    await call(w.app, `/api/sessions/${sid}/close`, json('POST'))
    expect(fileOf(w.repo, 'guide-0001')).toContain('[↗](./p-0123456789ab.md)')
    expect(fileOf(w.repo, 'guide-0001')).not.toContain('Payroll')
  })

  it('under a raised tree a save answers staged and the tray holds one file op however many saves', async () => {
    const w = await world({ governance: RAISED, pages: { 'handbook-3f2a': page('handbook-3f2a', 'Handbook') } })
    const before = commits(w.repo)
    const sid = (await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))).body.session as string
    for (const n of [1, 2, 3, 4]) {
      expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: BODY.replace('First', `Staged ${n}`) })))
        .toEqual({ status: 200, body: { save: 'staged' } })
    }
    const tray = (await call(w.app, '/api/changes')).body as { ops: { op: string; path: string; text: string; base: string }[] }
    expect(tray.ops).toHaveLength(1)
    expect(tray.ops[0]).toMatchObject({ op: 'file', path: 'pages/handbook-3f2a.md', base: git(w.repo, 'rev-parse HEAD:pages/handbook-3f2a.md').trim() })
    expect(splitPage(tray.ops[0]!.text).body).toBe(BODY.replace('First', 'Staged 4'))
    expect(await call(w.app, `/api/sessions/${sid}/close`, json('POST'))).toEqual({ status: 200, body: { staged: true } })
    expect(commits(w.repo)).toBe(before)
    expect(draftFiles(w.repo)).toEqual([])
  })

  it('a private page\'s draft lives in the store\'s drafts, never in the state dir, and close writes the record with a history row and no commit', async () => {
    const w = await world()
    const created = await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))
    const id = created.body.id as string
    const before = commits(w.repo)
    const rev = w.store.record('pages', id)!.rev
    const open = await call(w.app, `/api/pages/${id}/sessions`, json('POST'))
    expect(open.body).toEqual({ session: expect.stringMatching(/^ses_/), base: rev, markdown: 'Salaries.\n' })
    const sid = open.body.session as string
    expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'Salaries, revised.\n' }))).toEqual({ status: 200, body: { save: 'direct' } })
    expect(w.store.draft(sid)).toMatchObject({ session: sid, target: `pages/${id}`, actor: 'steward-a', base: rev })
    expect(draftFiles(w.repo)).toEqual([])
    const historyBefore = w.store.history(`pages/${id}`).length
    expect(await call(w.app, `/api/sessions/${sid}/close`, json('POST'))).toEqual({ status: 200, body: { commit: null } })
    expect(commits(w.repo)).toBe(before)
    expect(w.store.record('pages', id)!.body).toMatchObject({ title: 'Payroll plan', markdown: 'Salaries, revised.\n' })
    const history = w.store.history(`pages/${id}`)
    expect(history).toHaveLength(historyBefore + 1)
    expect(history.at(-1)).toMatchObject({ by: 'steward-a', after: { body: { markdown: 'Salaries, revised.\n' } } })
    expect(w.store.draft(sid)).toBeNull()
    expect(status(w.repo)).toBe('')
  })

  // L6 carries K5: while an open proposal holds a move of the private page into the repository, its save would leave the
  // move stale; the close is refused in the move's words, and the record and the draft are as they were.
  it('a private page whose move an open proposal holds: close is refused 409 MOVE_HELD; the record is as it was (K5)', async () => {
    const w = await world()
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const sid = (await call(w.app, `/api/pages/${id}/sessions`, json('POST'))).body.session as string
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'Salaries, revised.\n' }))).status).toBe(200)
    await w.store.tx(t => t.putPending({ ref: 'prv-1', proposal: 'P-2026-11-05-001', salt: 'salt', digest: 'sha256:held',
      ops: [{ op: 'move-to-git', collection: 'pages', id, level: 'members', digest: 'sha256:held' }] }))
    const kept = w.store.record('pages', id)
    expect(await call(w.app, `/api/sessions/${sid}/close`, json('POST'))).toEqual({ status: 409, body: { code: 'MOVE_HELD', error: MOVE_PROPOSED('page', 'P-2026-11-05-001') } })
    expect(w.store.record('pages', id)).toEqual(kept)
  })

  it('a private page has no merge: any change since its rev is a conflict', async () => {
    const w = await world()
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const s = sessionsOf(w)
    const { session } = await s.open(STEWARD_A, member, id)
    const kept = w.store.record('pages', id)!
    const body = { ...kept.body, markdown: 'Theirs.\n' }
    await w.store.putRecord({ ...kept, body, rev: 'other-rev' }, 'steward-a', null)
    await expect(s.save(session, STEWARD_A, { markdown: 'Mine.\n' })).rejects.toMatchObject({ status: 409, body: { code: 'CONFLICT', compare: { base: 'Salaries.\n', theirs: 'Theirs.\n', mine: 'Mine.\n' } } })
    expect(await s.resolve(session, 'mine')).toEqual({ commit: null })
    expect(w.store.record('pages', id)!.body.markdown).toBe('Mine.\n')
    expect(w.store.draft(session)).toBeNull()
  })

  it('two tabs of one private page: their ends never both pass the rev check (review I5)', async () => {
    const w = await world()
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const s = sessionsOf(w)
    const a = await s.open(STEWARD_A, member, id)
    const b = await s.open(STEWARD_A, member, id)
    await s.save(a.session, STEWARD_A, { markdown: 'Tab A.\n' })
    await s.save(b.session, STEWARD_A, { markdown: 'Tab B.\n' })
    const history = w.store.history(`pages/${id}`).length
    const out = await Promise.all([s.close(a.session), s.close(b.session)])
    expect(out.filter(o => 'conflict' in o)).toHaveLength(1)
    expect(w.store.history(`pages/${id}`)).toHaveLength(history + 1)
    const kept = w.store.record('pages', id)!.body.markdown
    const lost = out.find(o => 'conflict' in o) as { conflict: { theirs: string; mine: string } }
    expect(lost.conflict.theirs).toBe(kept)
    expect([kept, lost.conflict.mine].sort()).toEqual(['Tab A.\n', 'Tab B.\n'])
  })

  it('a private page narrowed after open sends nothing of itself to a member no longer admitted, at close or Compare (review I3)', async () => {
    const w = await world()
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const sid = (await call(w.app, `/api/pages/${id}/sessions`, json('POST'))).body.session as string
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'Mine.\n' }))).status).toBe(200)
    // Someone else narrows it to the council and writes in it.
    const kept = w.store.record('pages', id)!
    const body = { ...kept.body, markdown: 'Council-only-zebra-7713.\n' }
    await w.store.putRecord({ ...kept, visibility: `hat:${COUNCIL}`, body, rev: 'council-rev' }, 'steward-a', null)
    const closed = await call(w.app, `/api/sessions/${sid}/close`, json('POST'))
    expect(closed).toEqual({ status: 409, body: { code: 'CONFLICT', error: NEWER_VERSION, conflict: { base: 'Salaries.\n', theirs: '', mine: 'Mine.\n' } } })
    const compare = await call(w.app, `/api/sessions/${sid}/compare`)
    expect(compare).toEqual({ status: 200, body: { base: 'Salaries.\n', theirs: '', mine: 'Mine.\n' } })
    expect(await call(w.app, `/api/sessions/${sid}/resolve`, json('POST', { keep: 'mine' }))).toMatchObject({ status: 409, body: { code: 'GONE' } })
    expect(w.store.record('pages', id)!.body.markdown).toBe('Council-only-zebra-7713.\n')
  })

  it('§3.2: a member not admitted to a private page\'s level cannot open or save it', async () => {
    const w = await world()
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const s = sessionsOf(w)
    await expect(s.open(STEWARD_B, plainMember, id)).rejects.toMatchObject({ status: 404, message: `There is no page ${id}.` })
    const { session } = await s.open(STEWARD_A, member, id)
    // The same member, no longer wearing the hat that admits them.
    await expect(s.save(session, STEWARD_A, { markdown: 'Mine.\n' }, { ...member, hats: [] })).rejects.toMatchObject({ status: 404 })
    expect(w.store.draft(session)).toBeNull()
  })

  it('a store that is down leaves git pages working; a private page\'s open answers L5\'s store sentence and leaves git and the state dir as they were', async () => {
    const w = await world()
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    const before = commits(w.repo)
    // Git pages open, save and commit.
    const sid = (await call(down, '/api/pages/guide-0001/sessions', json('POST'))).body.session as string
    expect(await call(down, `/api/sessions/${sid}`, json('PUT', { markdown: BODY.replace('First', 'Down') }))).toEqual({ status: 200, body: { save: 'direct' } })
    expect((await call(down, `/api/sessions/${sid}/close`, json('POST'))).body).toEqual({ commit: expect.any(String) })
    expect(commits(w.repo)).toBe(before + 1)
    // A private page refuses in L5's words; nothing in git or the state directory moves.
    const head = git(w.repo, 'rev-parse HEAD').trim()
    const drafts = draftFiles(w.repo)
    const refused = await call(down, `/api/pages/${id}/sessions`, json('POST'))
    expect(refused).toEqual({ status: 503, body: { error: 'The private store is down for this test.', code: 'PRIVATE_STORE' } })
    // An id of the private shape that names nothing answers the same: the store is not asked, so nothing is told.
    expect(await call(down, '/api/pages/p-000000000000/sessions', json('POST'))).toEqual(refused)
    expect(git(w.repo, 'rev-parse HEAD').trim()).toBe(head)
    expect(status(w.repo)).toBe('')
    expect(draftFiles(w.repo)).toEqual(drafts)
    expect(w.store.drafts()).toEqual([])
  })

  it('`flushAll` on stop commits every open session', async () => {
    const w = await world({ pages: { 'guide-0001': page('guide-0001', 'Guide'), 'notes-0001': page('notes-0001', 'Notes') } })
    const id = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const s = sessionsOf(w)
    const before = commits(w.repo)
    const a = await s.open(STEWARD_A, member, 'guide-0001')
    const b = await s.open(STEWARD_A, member, 'notes-0001')
    const c = await s.open(STEWARD_A, member, id)
    await s.save(a.session, STEWARD_A, { markdown: BODY.replace('First', 'Flushed A') })
    await s.save(b.session, STEWARD_A, { markdown: BODY.replace('First', 'Flushed B') })
    await s.save(c.session, STEWARD_A, { markdown: 'Flushed C.\n' })
    await s.flushAll()
    expect(commits(w.repo)).toBe(before + 2)
    expect(bodyOf(w.repo, 'guide-0001')).toContain('Flushed A')
    expect(bodyOf(w.repo, 'notes-0001')).toContain('Flushed B')
    expect(w.store.record('pages', id)!.body.markdown).toBe('Flushed C.\n')
    expect(draftFiles(w.repo)).toEqual([])
    expect(w.store.drafts()).toEqual([])
  })

  it('onCommit hears each session\'s commit: the page, its base and the text written', async () => {
    const w = await world()
    const s = sessionsOf(w)
    const heard: [string, string, string][] = []
    s.onCommit((p, base, text) => { heard.push([p, base, text]) })
    const { session, base } = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(session, STEWARD_A, { markdown: BODY.replace('First', 'Heard') })
    await s.close(session)
    expect(heard).toEqual([['guide-0001', base, fileOf(w.repo, 'guide-0001')]])
  })
})

describe('the server\'s stop and start (serve.ts)', () => {
  /** A raw HTTP call to the running server, as serve.test.ts makes one (Host as a browser sends it). */
  function http(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, 'content-type': 'application/json' } }, res => {
        let text = ''
        res.on('data', chunk => { text += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text === '' ? null : JSON.parse(text) }))
      })
      req.on('error', reject)
      req.end(body === undefined ? undefined : JSON.stringify(body))
    })
  }
  function plainRepo(): string {
    const repo = makeChangeRepo(SOLO)
    cleanup.push(repo)
    mkdirSync(join(repo, 'pages'), { recursive: true })
    writeFileSync(join(repo, 'pages', 'guide-0001.md'), page('guide-0001', 'Guide'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a page"')
    return repo
  }

  it('stopping the server commits every open session', async () => {
    const repo = plainRepo()
    const server = await startServer({ repo, port: 0 })
    const before = commits(repo)
    let sid = ''
    try {
      const open = await http(server.port, 'POST', '/api/pages/guide-0001/sessions')
      expect(open.status).toBe(200)
      sid = open.body.session
      expect(await http(server.port, 'PUT', `/api/sessions/${sid}`, { markdown: BODY.replace('First', 'Stopped') })).toEqual({ status: 200, body: { save: 'direct' } })
      expect(commits(repo)).toBe(before)
    } finally { await server.close() }
    expect(commits(repo)).toBe(before + 1)
    expect(lastMessage(repo)).toContain(`Org-Change: ${sid}`)
    expect(bodyOf(repo, 'guide-0001')).toContain('Stopped')
  })

  it('starting the server commits a draft a crash left', async () => {
    const repo = plainRepo()
    const crashed = new EditSessions(repo, { store: null })
    live.push(crashed)
    const { session } = await crashed.open(STEWARD_A, member, 'guide-0001')
    await crashed.save(session, STEWARD_A, { markdown: BODY.replace('First', 'Crashed') })
    crashed.dispose()
    const before = commits(repo)
    const server = await startServer({ repo, port: 0 })
    try {
      expect(commits(repo)).toBe(before + 1)
      expect(lastMessage(repo)).toContain(`Org-Change: ${session}`)
      expect(bodyOf(repo, 'guide-0001')).toContain('Crashed')
    } finally { await server.close() }
    expect(commits(repo)).toBe(before + 1)
  })
})
