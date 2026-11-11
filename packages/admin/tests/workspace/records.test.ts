import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { stateDir } from '../../server/state.ts'
import { currentEntries } from '../../server/changes/stage.ts'
import { workspaceOf } from '../../server/workspace/routes.ts'
import { NOT_WORKSPACE, RECORD_IDLE_MS, RecordBatches } from '../../server/workspace/records.ts'
import type { Schedule } from '../../server/workspace/sessions.ts'
import type { WearerReading } from '../../server/systems/hats.ts'
import type { KnownActor } from '../../server/actor.ts'
import { gateRegistry, Levels, MAINTAINERS } from '../../server/visibility/gate.ts' // DAO-OS L6 Task 17 fix round 1
import { privateReads } from '../../server/private/reads.ts' // DAO-OS L6 Task 17 fix round 1
import { readConfig } from '../../server/visibility/config.ts' // DAO-OS L6 Task 17 fix round 1

// DAO-OS L6 §6 (Records), Task 8: workspace records saved in a view are batched per actor and collection and flushed after
// RECORD_IDLE_MS without a write, so a burst of inline edits is one commit (Org-Rule: workspace/direct, Org-Change: the
// batch's ses_ id). A stale op at the flush goes to the actor's change, 0.6's stale path (Keep mine / Take theirs). Fresh
// temporary repositories; the store in a temp folder of its own; a fake clock and scheduler. Placeholders only.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    ops: { hat: "${OPS}" }
  decisions: []
`
const RAISED = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: tasks, applies_to: ["workspace:tasks"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
/** A rule naming `workspace` itself: it reaches a private collection's records (judged at `workspace` alone, Task 1). */
const RAISED_ALL = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: all-workspace, applies_to: ["workspace"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
`
const TASKS = `tasks:
  - { id: t-1, title: Write the brief, status: todo }
  - { id: t-2, title: Read the brief, status: todo }
  - { id: t-3, title: Sign off, status: todo }
`
const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }
const member = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] as string[] }
const plainMember = { kind: 'member' as const, id: 'steward-b', hats: [] as string[], roles: [] as string[] }

const cleanup: string[] = []
const stores: PrivateStore[] = []
const live: RecordBatches[] = []
afterEach(() => {
  for (const b of live.splice(0)) b.dispose()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function world(governance = GOVERNANCE): Promise<{ repo: string; store: PrivateStore; app: Hono }> {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: tasks"')
  const dir = mkdtempSync(join(tmpdir(), 'records-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: account.toLowerCase().endsWith('a1') ? [OPS] : [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, undefined, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  const writers = workspaceOf(app)
  if (writers) live.push(writers.records)
  return { repo, store, app }
}

function fakeTime(start = NOW) {
  let t = start.getTime()
  const due: { at: number; fn: () => void; live: boolean }[] = []
  const schedule: Schedule = (fn, ms) => { const e = { at: t + ms, fn, live: true }; due.push(e); return () => { e.live = false } }
  return {
    now: () => new Date(t), schedule,
    advance(ms: number) { t += ms; for (const e of due.filter(x => x.live && x.at <= t).sort((a, b) => a.at - b.at)) { e.live = false; e.fn() } },
  }
}
function batchesOf(repo: string, store: PrivateStore, clock = fakeTime()): RecordBatches {
  const b = new RecordBatches(repo, { now: clock.now, schedule: clock.schedule, privateStore: () => store })
  live.push(b)
  return b
}

const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const task = (repo: string, id: string) => currentEntries(repo, 'tasks').find(e => e.id === id)

describe('batched record writes (L6 §6)', () => {
  it('RECORD_IDLE_MS is the spec\'s', () => {
    expect(RECORD_IDLE_MS).toBe(10000)
  })

  it('ten inline task edits within 10 s are one commit', async () => {
    const w = await world()
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    const before = commits(w.repo)
    const statuses = ['doing', 'done']
    for (let n = 0; n < 10; n++) {
      const id = n % 2 === 0 ? 't-1' : 't-2'
      expect(await b.write(STEWARD_A, [{ op: 'update', record: `tasks:${id}`, set: { status: statuses[n % 4 < 2 ? 0 : 1], priority: n } }], member))
        .toEqual({ save: 'direct' })
      clock.advance(900)
      await b.settled()
    }
    expect(commits(w.repo)).toBe(before)
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(commits(w.repo)).toBe(before + 1)
    const message = git(w.repo, 'log -1 --format=%B')
    expect(message.split('\n')[0]).toBe('tasks: 2 records')
    expect(message).toContain('Org-Rule: workspace/direct')
    expect(message).toMatch(/Org-Change: ses_[0-9a-f]{16}/)
    expect(task(w.repo, 't-1')).toMatchObject({ priority: 8 })
    expect(task(w.repo, 't-2')).toMatchObject({ priority: 9 })
    expect(git(w.repo, 'status --porcelain').trim()).toBe('')
  })

  it('one record\'s batch is subject `tasks: <title>`', async () => {
    const w = await world()
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-3', set: { status: 'done' } }], member)
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(git(w.repo, 'log -1 --format=%s').trim()).toBe('tasks: Sign off')
  })

  it('a stale record op in a batch takes 0.6\'s stale path', async () => {
    const w = await world()
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { status: 'doing' } }], member)
    // Someone else's commit of the same task, by hand, before the batch flushes.
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), TASKS.replace('Write the brief, status: todo', 'Write the brief, status: blocked'))
    git(w.repo, 'add data/tasks.yaml'); git(w.repo, 'commit -qm "tasks: by hand"')
    const before = commits(w.repo)
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(commits(w.repo)).toBe(before)
    // The op is in the actor's change, stale: the tray offers Keep mine / Take theirs.
    expect(new ChangeStore(w.repo).load('steward-a')?.ops).toEqual([expect.objectContaining({ op: 'update', record: 'tasks:t-1', set: { status: 'doing' } })])
    const view = await call(w.app, '/api/changes')
    expect(view.body.stale).toEqual([0])
    expect(view.body.state).toBe('stale')
    const kept = await call(w.app, '/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))
    expect(kept.status).toBe(200)
    expect(kept.body.stale).toEqual([])
    expect((await call(w.app, '/api/changes/apply', json('POST'))).status).toBe(200)
    expect(task(w.repo, 't-1')).toMatchObject({ status: 'doing' })
  })

  it('through the route: POST /api/workspace/records answers { save } and flushAll commits the batch', async () => {
    const w = await world()
    const before = commits(w.repo)
    const r = await call(w.app, '/api/workspace/records', json('POST', { ops: [{ op: 'update', record: 'tasks:t-2', set: { status: 'doing' } }] }))
    expect(r).toEqual({ status: 200, body: { save: 'direct' } })
    expect(commits(w.repo)).toBe(before)
    await workspaceOf(w.app)!.records.flushAll()
    expect(commits(w.repo)).toBe(before + 1)
    expect(task(w.repo, 't-2')).toMatchObject({ status: 'doing' })
    expect((await call(w.app, '/api/workspace/records', json('POST', { ops: [] }))).status).toBe(400)
  })

  it('a record that is not a workspace record is refused in words, nothing written', async () => {
    const w = await world()
    const b = batchesOf(w.repo, w.store)
    await expect(b.write(STEWARD_A, [{ op: 'update', record: 'projects:proj-001', set: { status: 'paused' } }], member))
      .rejects.toMatchObject({ status: 422, errors: [{ record: 'projects:proj-001', field: '', message: NOT_WORKSPACE('projects:proj-001', 'records') }] })
    expect(NOT_WORKSPACE('projects:proj-001', 'records'))
      .toBe('Not saved: projects:proj-001 is class records, not a workspace record: stage it in the change tray instead. Nothing was written.')
  })

  it('under a raised collection each write stages, merged into one op per record', async () => {
    const w = await world(RAISED)
    const b = batchesOf(w.repo, w.store)
    const before = commits(w.repo)
    expect(await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { status: 'doing' } }], member)).toEqual({ save: 'staged' })
    expect(await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { status: 'done' } }], member)).toEqual({ save: 'staged' })
    await b.flushAll()
    expect(commits(w.repo)).toBe(before)
    expect(new ChangeStore(w.repo).load('steward-a')?.ops).toEqual([expect.objectContaining({ record: 'tasks:t-1', set: { status: 'done' } })])
  })

  it('§3.2: a record of a private collection is written only by a member admitted to its level', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { name: 'Grants' } }, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 'Seed grant' }, rev: '' }, 'steward-a', null)
    const b = batchesOf(w.repo, w.store)
    const before = commits(w.repo)
    await expect(b.write({ id: 'steward-b', name: 'Steward B', kind: 'person', via: 'git' }, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'Taken' } }], plainMember))
      // Rule 7: answered as a collection that is not there.
      .rejects.toMatchObject({ status: 422, errors: [{ record: 'grants-private:g-1', message: expect.stringContaining('names no registry') }] })
    expect(w.store.record('grants-private', 'g-1')!.body.title).toBe('Seed grant')
    expect(await b.write(STEWARD_A, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'Seed grant, revised' } }], member)).toEqual({ save: 'direct' })
    expect(w.store.record('grants-private', 'g-1')!.body.title).toBe('Seed grant, revised')
    // R-8a: written to the store at once, with its history row, and no commit at all.
    expect(commits(w.repo)).toBe(before)
    expect(w.store.history('grants-private/g-1').at(-1)).toMatchObject({ by: 'steward-a' })
  })

  it('R-8a: ten inline edits of a private collection\'s record are ten store writes and no commit', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { name: 'Grants' } }, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 'Seed grant' }, rev: '' }, 'steward-a', null)
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    const before = commits(w.repo)
    for (let n = 0; n < 10; n++) {
      expect(await b.write(STEWARD_A, [{ op: 'update', record: 'grants-private:g-1', set: { amount: n } }], member)).toEqual({ save: 'direct' })
      clock.advance(900)
    }
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(commits(w.repo)).toBe(before)
    expect(w.store.record('grants-private', 'g-1')!.body.amount).toBe(9)
  })

  it('R-8a: a task with a restricted field: its git part is one commit per batch, the field goes to the store at once', async () => {
    const w = await world()
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), `visibility:\n  collections:\n    tasks: { default: members, fields: { budget: "hat:${OPS}" } }\n`)
    git(w.repo, 'add data/visibility.yaml'); git(w.repo, 'commit -qm "visibility: budget kept by Ops"')
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    const before = commits(w.repo)
    for (const [n, status] of [[1, 'doing'], [2, 'done']] as const) {
      expect(await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { status, budget: n * 100 } }], member)).toEqual({ save: 'direct' })
    }
    expect(w.store.fields('tasks', 't-1')).toEqual([expect.objectContaining({ field: 'budget', value: 200 })])
    expect(commits(w.repo)).toBe(before)
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(commits(w.repo)).toBe(before + 1)
    expect(task(w.repo, 't-1')).toMatchObject({ status: 'done' })
    expect(task(w.repo, 't-1')).not.toHaveProperty('budget')
    expect(git(w.repo, 'show HEAD')).not.toContain('budget')
  })

  // DAO-OS L6 Task 17 fix round 1 (rule 7): what the Hub's collection views rely on the server for.
  it('a field kept from a member is never read to them, and a write to it by them is refused, nothing written', async () => {
    const w = await world()
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), `visibility:\n  collections:\n    tasks: { default: members, fields: { budget: "hat:${OPS}" } }\n`)
    git(w.repo, 'add data/visibility.yaml'); git(w.repo, 'commit -qm "visibility: budget kept by Ops"')
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    expect(await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { budget: 'Budget-quartz' } }], member)).toEqual({ save: 'direct' })
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    const levels = () => new Levels(w.repo, readConfig(w.repo), MAINTAINERS, privateReads(() => w.store))
    // read: the admitted member has the value; the plain member has the marker only, no value, anywhere in the answer
    const ops = gateRegistry(member, w.repo, 'tasks', levels())
    expect(ops.entries!.find(e => e.id === 't-1')).toMatchObject({ budget: 'Budget-quartz' })
    const plain = gateRegistry(plainMember, w.repo, 'tasks', levels())
    const t1 = plain.entries!.find(e => e.id === 't-1')!
    expect(t1).not.toHaveProperty('budget')
    expect(t1).toMatchObject({ restricted: { budget: `hat:${OPS}` } })
    expect(JSON.stringify(plain)).not.toContain('Budget-quartz')
    // write: refused in words, the store's value and git as they were
    const before = commits(w.repo)
    await expect(b.write({ id: 'steward-b', name: 'Steward B', kind: 'person', via: 'git' },
      [{ op: 'update', record: 'tasks:t-1', set: { budget: 'Taken' } }], plainMember)).rejects.toMatchObject({ status: 422,
      errors: [{ record: 'tasks:t-1', field: 'budget', message: `budget of tasks:t-1 would be kept at hat:${OPS}, which you are not admitted to, so you cannot write it here.` }] })
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(w.store.fields('tasks', 't-1')).toEqual([expect.objectContaining({ field: 'budget', value: 'Budget-quartz' })])
    expect(commits(w.repo)).toBe(before)
    expect(git(w.repo, 'grep -c Taken HEAD -- data || true').trim()).toBe('')
  })

  it('R-8a: under a raised rule, a private part is staged through L5\'s staging, beside the git part', async () => {
    const w = await world(RAISED_ALL)
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { name: 'Grants' } }, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 'Seed grant' }, rev: '' }, 'steward-a', null)
    const b = batchesOf(w.repo, w.store)
    const before = commits(w.repo)
    expect(await b.write(STEWARD_A, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'Seed grant, raised' } },
      { op: 'update', record: 'tasks:t-1', set: { status: 'doing' } }], member)).toEqual({ save: 'staged' })
    const change = new ChangeStore(w.repo).load('steward-a')!
    expect(change.ops).toEqual([expect.objectContaining({ record: 'tasks:t-1' })])
    expect(change.private).toEqual([expect.objectContaining({ op: 'private', class: 'workspace' })])
    expect(w.store.staged(change.id)).toHaveLength(1)
    expect(w.store.record('grants-private', 'g-1')!.body.title).toBe('Seed grant')
    expect(commits(w.repo)).toBe(before)
    // The tray shows it, as a private entry its own member may read.
    expect((await call(w.app, '/api/changes')).body.private).toEqual([expect.objectContaining({ class: 'workspace' })])
  })

  it('rule 4: a field narrowed after the write never reaches git; the batch goes to the tray, whose Apply refuses it in words', async () => {
    const w = await world()
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { budget: 'Budget-quartz-4411' } }], member)
    // Narrowed before the flush: budget is kept by Ops from now on.
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), `visibility:\n  collections:\n    tasks: { default: members, fields: { budget: "hat:${OPS}" } }\n`)
    git(w.repo, 'add data/visibility.yaml'); git(w.repo, 'commit -qm "visibility: budget kept by Ops"')
    const before = commits(w.repo)
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(commits(w.repo)).toBe(before)
    expect(git(w.repo, 'grep -c Budget-quartz HEAD -- data || true').trim()).toBe('')
    expect(new ChangeStore(w.repo).load('steward-a')?.ops).toEqual([expect.objectContaining({ record: 'tasks:t-1', set: { budget: 'Budget-quartz-4411' } })])
    const applied = await call(w.app, '/api/changes/apply', json('POST'))
    expect(applied.status).toBe(409)
    expect(applied.body.code).toBe('NARROWED')
    expect(commits(w.repo)).toBe(before)
  })

  it('a batch whose commit cannot be made now is kept, tried again, and folds later writes; nothing is lost (review I1)', async () => {
    const w = await world()
    const clock = fakeTime()
    const b = batchesOf(w.repo, w.store, clock)
    const before = commits(w.repo)
    await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-1', set: { status: 'doing' } }], member)
    // Someone's uncommitted edit of the file: the commit is refused (409 DIRTY), not the batch.
    const head = readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8')
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), `${head}# a note, not committed\n`)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(errors.mock.calls.flat().join(' ')).toContain('has changes that are not committed yet')
    errors.mockRestore()
    expect(commits(w.repo)).toBe(before)
    expect(new ChangeStore(w.repo).load('steward-a')).toBeNull()
    const files = readdirSync(join(stateDir(w.repo), 'batches')).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    const id = (JSON.parse(readFileSync(join(stateDir(w.repo), 'batches', files[0]!), 'utf8')) as { id: string }).id
    // A later write folds into the same batch, under the same id.
    await b.write(STEWARD_A, [{ op: 'update', record: 'tasks:t-2', set: { status: 'done' } }], member)
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), head)
    clock.advance(RECORD_IDLE_MS)
    await b.settled()
    expect(commits(w.repo)).toBe(before + 1)
    expect(git(w.repo, 'log -1 --format=%B')).toContain(`Org-Change: ${id}`)
    expect(task(w.repo, 't-1')).toMatchObject({ status: 'doing' })
    expect(task(w.repo, 't-2')).toMatchObject({ status: 'done' })
    expect(readdirSync(join(stateDir(w.repo), 'batches')).filter(f => f.endsWith('.json'))).toEqual([])
  })
})
