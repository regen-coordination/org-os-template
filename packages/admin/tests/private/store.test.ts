import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { isIgnored } from '../../server/git.ts'
import { privateDir } from '../../server/private/paths.ts'
import {
  openPrivateStore, StoreUnavailable, type PrivateStore, type PrivateRecord,
  classifyOpenError, LOCK_WAIT_MIN_MS, LOCK_WAIT_MAX_MS, STORE_CANNOT_OPEN, STORE_NEWER, STORE_STUCK, lockWaited, lockWaitRefusal,
} from '../../server/private/store.ts'
import { storeAccess, reach, unavailable, NO_STORE } from '../../server/private/ops.ts'
import { startServer, type Running } from '../../server/serve.ts'

// Every test runs in a fresh temporary repository (makeFixtureRepo) and keeps its store in a folder of its own
// under the temp directory, or under the fixture's `.org-os/private/` once that repository ignores it: no store is
// ever made inside this worktree (L5 constraints).

const SENTENCE = 'The private store would be at .org-os/private/house.db, which git does not ignore. Add `.org-os/private/` to .gitignore first.'

const cleanup: string[] = []
const open: PrivateStore[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const s of open.splice(0)) { try { s.close() } catch { /* already closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

function repo(): string { const r = makeFixtureRepo(); cleanup.push(r); return r }
function storeDir(): string { const d = mkdtempSync(join(tmpdir(), 'private-store-')); cleanup.push(d); return d }
async function opened(r = repo(), dir = storeDir()): Promise<PrivateStore> {
  const s = await openPrivateStore(r, { dir }); open.push(s); return s
}
async function refusal(p: Promise<unknown>): Promise<Error> {
  try { await p } catch (err) { return err as Error }
  throw new Error('expected a refusal, and the store opened')
}
const gitStatus = (r: string) => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: r, encoding: 'utf8' })

const RECORD: PrivateRecord = { collection: 'grievances', id: 'g-1', visibility: 'hat:Ops', body: { title: 'a matter', parties: ['steward-a'] }, rev: 'r1' }

describe('privateDir', () => {
  it('is ORG_OS_PRIVATE_DIR when set, else <repo>/.org-os/private', () => {
    expect(privateDir('/x/repo', { ORG_OS_PRIVATE_DIR: '/vol/house' })).toBe('/vol/house')
    expect(privateDir('/x/repo', {})).toBe('/x/repo/.org-os/private')
    expect(privateDir('/x/repo', { ORG_OS_PRIVATE_DIR: '' })).toBe('/x/repo/.org-os/private')
  })
})

describe('isIgnored (server/git.ts, `check-ignore -q`)', () => {
  it('answers whether git ignores a path, a folder by its trailing slash, and a tracked file is not ignored', async () => {
    const r = repo()
    writeFileSync(join(r, '.gitignore'), '.org-os/private/\nmembers.yaml\n')
    expect(await isIgnored(r, '.org-os/private/')).toBe(true)
    expect(await isIgnored(r, '.org-os/private/house.db-wal')).toBe(true)
    expect(await isIgnored(r, '.org-os/')).toBe(false)
    expect(await isIgnored(r, 'data/members.yaml')).toBe(false) // tracked: no ignore rule applies to it
  })
  it('throws for what git cannot answer', async () => {
    const r = repo()
    await expect(isIgnored(r, '../outside')).rejects.toThrow()
  })
})

describe('where the store may be (spec §10.1)', () => {
  it('creates the file under ORG_OS_PRIVATE_DIR', async () => {
    const r = repo()
    const dir = join(storeDir(), 'nested', 'house')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    const s = await openPrivateStore(r); open.push(s)
    expect(s.file).toBe(join(dir, 'house.db'))
    expect(existsSync(s.file)).toBe(true)
    expect(statSync(s.file).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(existsSync(join(r, '.org-os'))).toBe(false)
    expect(gitStatus(r)).toBe('')
  })

  it('refuses .org-os/private/ in a repo whose .gitignore lacks it, with the §10.1 sentence, and creates nothing', async () => {
    const r = repo()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', '')
    const err = await refusal(openPrivateStore(r))
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toBe(SENTENCE)
    expect(existsSync(join(r, '.org-os'))).toBe(false)
    expect(gitStatus(r)).toBe('')
  })

  it('refuses a folder inside the repository that git ignores only by the file name (its -wal and backups would not be)', async () => {
    const r = repo()
    writeFileSync(join(r, '.gitignore'), 'house.db\n')
    const err = await refusal(openPrivateStore(r, { dir: join(r, '.org-os', 'private') }))
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toBe(SENTENCE)
    expect(existsSync(join(r, '.org-os'))).toBe(false)
  })

  it('names the folder it was given in the sentence', async () => {
    const r = repo()
    const err = await refusal(openPrivateStore(r, { dir: join(r, 'var', 'house') }))
    expect(err.message).toBe('The private store would be at var/house/house.db, which git does not ignore. Add `var/house/` to .gitignore first.')
    expect(existsSync(join(r, 'var'))).toBe(false)
  })

  it('opens it once the line is added, and git sees nothing of it', async () => {
    const r = repo()
    writeFileSync(join(r, '.gitignore'), '.org-os/private/\n')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', '')
    const s = await openPrivateStore(r); open.push(s)
    expect(s.file).toBe(join(r, '.org-os', 'private', 'house.db'))
    await s.putRecord(RECORD, 'steward-a', null)
    expect(readdirSync(join(r, '.org-os', 'private'))).toContain('house.db')
    expect(gitStatus(r)).toBe('?? .gitignore\n')
  })

  it('asks git through server/git.ts, and a git that cannot answer is unavailable, not a crash', async () => {
    const r = repo()
    const asked: string[] = []
    const err = await refusal(openPrivateStore(r, {
      dir: join(r, '.org-os', 'private'),
      git: { isIgnored: async (_repo, path) => { asked.push(path); throw new Error('git is not installed') } },
    }))
    expect(asked).toEqual(['.org-os/private/'])
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toBe('The private store would be at .org-os/private/house.db, and git could not say whether it ignores that folder: git is not installed')
    expect(existsSync(join(r, '.org-os'))).toBe(false)
  })
})

describe('the file (spec §10.1, §10.2)', () => {
  it('holds the tables and columns of §10.2 and schema 2, in WAL, at schema 2', async () => {
    const s = await opened()
    s.close()
    const db = new DatabaseSync(s.file, { readOnly: true })
    try {
      const columns = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name)
      expect(columns('records')).toEqual(['collection', 'id', 'visibility', 'body', 'rev', 'updated_at', 'updated_by'])
      expect(columns('fields')).toEqual(['registry', 'record', 'field', 'visibility', 'value', 'updated_at', 'updated_by'])
      expect(columns('collections')).toEqual(['id', 'visibility', 'definition'])
      expect(columns('history')).toEqual(['seq', 'at', 'by', 'target', 'before', 'after', 'change', 'decision'])
      expect(columns('staged')).toEqual(['change', 'seq', 'actor', 'op'])
      expect(columns('pending')).toEqual(['ref', 'proposal', 'salt', 'ops', 'digest'])
      expect(columns('applied')).toEqual(['proposal', 'commit', 'at'])
      expect(columns('sessions')).toEqual(['token_hash', 'account', 'created', 'expires'])
      expect(columns('roles')).toEqual(['person_id', 'name', 'roles', 'nodes'])
      expect(columns('email_keys')).toEqual(['email_key', 'person_id'])
      expect(columns('roles_meta')).toEqual(['k', 'v'])
      expect(columns('sign_in_links')).toEqual(['token_hash', 'person_id', 'return_to', 'created', 'expires', 'used_at'])
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 })
    } finally { db.close() }
  })

  it('opens again what it made, keeping what it holds', async () => {
    const r = repo(); const dir = storeDir()
    const first = await opened(r, dir)
    await first.putRecord(RECORD, 'steward-a', null)
    first.close()
    const second = await opened(r, dir)
    expect(second.record('grievances', 'g-1')).toEqual(RECORD)
  })

  it('a newer user_version is refused in words', async () => {
    const r = repo(); const dir = storeDir()
    const db = new DatabaseSync(join(dir, 'house.db'))
    db.exec('PRAGMA user_version = 3')
    db.close()
    const err = await refusal(openPrivateStore(r, { dir }))
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toBe('This private store was written by a newer org-os (schema 3); update first.')
  })

  it('a corrupt file throws StoreUnavailable with the file named, not the contents', async () => {
    const r = repo(); const dir = storeDir()
    const file = join(dir, 'house.db')
    writeFileSync(file, 'SENTINEL-PRIVATE-CONTENT steward-a owes 0x00000000000000000000000000000000000000a1\n'.repeat(80))
    const err = await refusal(openPrivateStore(r, { dir }))
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toContain(file)
    expect(err.message).toMatch(/^The private store at .* could not be opened: /)
    expect(err.message).not.toContain('SENTINEL')
    expect(err.message).not.toContain('0x00000000000000000000000000000000000000a1')
  })

  it('a folder that cannot be made is unavailable, not a crash', async () => {
    const r = repo(); const parent = storeDir()
    writeFileSync(join(parent, 'a-file'), '')
    const err = await refusal(openPrivateStore(r, { dir: join(parent, 'a-file', 'house') }))
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toContain(join(parent, 'a-file', 'house'))
  })
})

describe('records and fields', () => {
  it('a put then a get returns the body', async () => {
    const s = await opened()
    await s.putRecord(RECORD, 'steward-a', 'c-1')
    await s.putRecord({ ...RECORD, id: 'g-0', body: { title: 'earlier' } }, 'steward-a', 'c-1')
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
    expect(s.record('grievances', 'nope')).toBeNull()
    expect(s.records('grievances').map(x => x.id)).toEqual(['g-0', 'g-1'])
    expect(s.records('other')).toEqual([])

    await s.putField({ registry: 'members', record: 'steward-a', field: 'wallet', visibility: 'hat:Ops', value: 'eip155:42220:0x00000000000000000000000000000000000000a1' }, 'ops-lead', null)
    await s.putField({ registry: 'members', record: 'steward-a', field: 'phone', visibility: 'role:ops', value: { cc: 34, n: '000' } }, 'ops-lead', null)
    expect(s.fields('members', 'steward-a')).toEqual([
      { registry: 'members', record: 'steward-a', field: 'phone', visibility: 'role:ops', value: { cc: 34, n: '000' } },
      { registry: 'members', record: 'steward-a', field: 'wallet', visibility: 'hat:Ops', value: 'eip155:42220:0x00000000000000000000000000000000000000a1' },
    ])
    expect(s.fields('members', 'steward-b')).toEqual([])
    expect(s.collections()).toEqual([])
  })

  it('every put and delete appends a history row with before and after', async () => {
    const s = await opened()
    await s.putRecord(RECORD, 'steward-a', 'c-1')
    const changed = { ...RECORD, body: { title: 'the matter, revised' }, rev: 'r2' }
    await s.putRecord(changed, 'steward-b', 'c-2')
    await s.deleteRecord('grievances', 'g-1', 'steward-c', null)
    await s.deleteRecord('grievances', 'never-there', 'steward-c', null)
    const wallet = { registry: 'members', record: 'steward-a', field: 'wallet', visibility: 'hat:Ops', value: 'eip155:42220:0x00000000000000000000000000000000000000a2' }
    await s.putField(wallet, 'ops-lead', 'c-3')
    await s.deleteField('members', 'steward-a', 'wallet', 'ops-lead', 'c-4')

    const rows = s.history()
    expect(rows.map(h => [h.target, h.by, h.change, h.before, h.after])).toEqual([
      ['grievances/g-1', 'steward-a', 'c-1', null, RECORD],
      ['grievances/g-1', 'steward-b', 'c-2', RECORD, changed],
      ['grievances/g-1', 'steward-c', null, changed, null],
      ['members/steward-a/wallet', 'ops-lead', 'c-3', null, wallet],
      ['members/steward-a/wallet', 'ops-lead', 'c-4', wallet, null],
    ])
    expect(rows.map(h => h.seq)).toEqual([...rows.map(h => h.seq)].sort((a, b) => a - b))
    for (const h of rows) { expect(Number.isNaN(Date.parse(h.at))).toBe(false); expect(h.decision).toBeNull() }
    expect(s.history('members/steward-a/wallet')).toHaveLength(2)
    expect(s.record('grievances', 'g-1')).toBeNull()
    expect(s.fields('members', 'steward-a')).toEqual([])
  })

  it('history is append only: the file itself refuses to change or drop a row', async () => {
    const s = await opened()
    await s.putRecord(RECORD, 'steward-a', null)
    s.close()
    const db = new DatabaseSync(s.file)
    try {
      expect(() => db.exec("UPDATE history SET \"by\" = 'steward-b'")).toThrow(/append only/)
      expect(() => db.exec('DELETE FROM history')).toThrow(/append only/)
    } finally { db.close() }
  })
})

describe('transactions (spec §10.3; ruling P7)', () => {
  it('tx commits what its function wrote', async () => {
    const s = await opened()
    const out = await s.tx(w => { w.putRecord(RECORD, 'steward-a', 'c-1'); w.putRecord({ ...RECORD, id: 'g-2' }, 'steward-a', 'c-1'); return 7 })
    expect(out).toBe(7)
    expect(s.records('grievances')).toHaveLength(2)
    expect(s.history()).toHaveLength(2)
  })

  it('tx rolls back on a throw', async () => {
    const s = await opened()
    await expect(s.tx(w => { w.putRecord(RECORD, 'steward-a', 'c-1'); throw new Error('the git commit failed') })).rejects.toThrow('the git commit failed')
    expect(s.record('grievances', 'g-1')).toBeNull()
    expect(s.history()).toEqual([])
    await s.putRecord(RECORD, 'steward-a', null) // the store is usable after
    expect(s.history()).toHaveLength(1)
  })

  it('tx refuses a function that returns a promise, and writes nothing', async () => {
    const s = await opened()
    await expect(s.tx(w => { w.putRecord(RECORD, 'steward-a', null); return Promise.resolve() })).rejects.toThrow(/synchronous/)
    expect(s.record('grievances', 'g-1')).toBeNull()
  })

  it('begin().rollback() leaves nothing', async () => {
    const s = await opened()
    const t = await s.begin()
    t.putRecord(RECORD, 'steward-a', 'c-1')
    t.putField({ registry: 'members', record: 'steward-a', field: 'wallet', visibility: 'hat:Ops', value: 'x' }, 'steward-a', 'c-1')
    t.rollback()
    expect(s.record('grievances', 'g-1')).toBeNull()
    expect(s.fields('members', 'steward-a')).toEqual([])
    expect(s.history()).toEqual([])
    expect(() => t.putRecord(RECORD, 'steward-a', null)).toThrow(/finished/)
    expect(() => t.commit()).toThrow(/finished/)
  })

  it('begin() held across an await (a git commit) then commit() keeps the writes', async () => {
    const s = await opened()
    const t = await s.begin()
    t.putRecord(RECORD, 'steward-a', 'c-1')
    await new Promise(resolve => setTimeout(resolve, 5))
    t.commit()
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
  })

  it('a read during an open begin() does not see the uncommitted row', async () => {
    const s = await opened()
    await s.putRecord({ ...RECORD, id: 'g-0' }, 'steward-a', null)
    const t = await s.begin()
    t.putRecord(RECORD, 'steward-a', 'c-1')
    expect(s.record('grievances', 'g-1')).toBeNull()
    expect(s.records('grievances').map(x => x.id)).toEqual(['g-0'])
    expect(s.history()).toHaveLength(1)
    t.commit()
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
  })

  it('a second writer waits for the first to finish', async () => {
    const s = await opened()
    const t = await s.begin()
    t.putRecord(RECORD, 'steward-a', 'c-1')
    let second = false
    const put = s.putRecord({ ...RECORD, rev: 'r2', body: { title: 'second' } }, 'steward-b', 'c-2').then(() => { second = true })
    const tx = s.tx(w => w.deleteRecord('grievances', 'g-0', 'steward-c', 'c-3'))
    let third = false
    const begun = s.begin().then(b => { third = true; b.rollback() })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(second).toBe(false)
    expect(third).toBe(false)
    t.commit()
    await Promise.all([put, tx, begun])
    expect(second && third).toBe(true)
    expect(s.history().map(h => h.change)).toEqual(['c-1', 'c-2'])
    expect(s.record('grievances', 'g-1')?.body).toEqual({ title: 'second' })
  })

  it('a refused write inside begin() writes nothing, so a commit after it keeps the row (and no history is lost)', async () => {
    const s = await opened()
    const wallet = { registry: 'members', record: 'steward-a', field: 'wallet', visibility: 'hat:Ops', value: 'x' }
    await s.putRecord(RECORD, 'steward-a', 'c-1')
    await s.putField(wallet, 'steward-a', 'c-1')
    const t = await s.begin()
    expect(() => t.deleteRecord('grievances', 'g-1', '', null)).toThrow(/who wrote/)
    expect(() => t.deleteField('members', 'steward-a', 'wallet', '', null)).toThrow(/who wrote/)
    expect(() => t.putRecord({ ...RECORD, rev: 'r2' }, '', null)).toThrow(/who wrote/)
    expect(() => t.putField({ ...wallet, value: 'y' }, 'steward-a', '')).toThrow(/change id/)
    t.commit()
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
    expect(s.fields('members', 'steward-a')).toEqual([wallet])
    expect(s.history()).toHaveLength(2)
  })

  it('a write whose history row fails is undone with it, inside an open transaction', async () => {
    const s = await opened()
    const side = new DatabaseSync(s.file)
    side.exec("CREATE TRIGGER no_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'history refused'); END")
    side.close()
    const t = await s.begin()
    expect(() => t.putRecord(RECORD, 'steward-a', null)).toThrow(/history refused/)
    t.commit()
    expect(s.record('grievances', 'g-1')).toBeNull()
  })

  it('within commits when its function resolves, across an await', async () => {
    const s = await opened()
    const out = await s.within(async w => {
      w.putRecord(RECORD, 'steward-a', 'c-1')
      await new Promise(resolve => setTimeout(resolve, 5)) // the git commit
      return 'sha'
    })
    expect(out).toBe('sha')
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
  })

  it('a rejected within rolls back, rethrows, and releases the lock', async () => {
    const s = await opened()
    await expect(s.within(async w => {
      w.putRecord(RECORD, 'steward-a', 'c-1')
      await new Promise(resolve => setTimeout(resolve, 5))
      throw new Error('the git commit failed')
    })).rejects.toThrow('the git commit failed')
    expect(s.record('grievances', 'g-1')).toBeNull()
    await s.putRecord({ ...RECORD, id: 'g-2' }, 'steward-a', null) // would wait forever if the lock were held
    expect(s.records('grievances').map(x => x.id)).toEqual(['g-2'])
  })

  // "a transaction left open makes the next write fail in words after the bound" (50 ms) is replaced by L9 Task 9's
  // lock-refusal test below, at 1 s with fake timers (ruling P4): 1 s is now the floor.

  it('a writer waiting behind a rolled-back one still runs', async () => {
    const s = await opened()
    const t = await s.begin()
    const put = s.putRecord(RECORD, 'steward-b', null)
    t.rollback()
    await put
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
  })
})

// ── L9 Task 9: the single writer and error hygiene (L9 spec §7.4, §7.5; carries 5 and 8) ─────────────────────────
// Stores in folders of their own under the temp directory, fresh temporary repositories, and the one server started is
// local with a fetch that refuses: nothing is made in this worktree and nothing touches the network.

const running: Running[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const s of running.splice(0)) await s.close()
  vi.restoreAllMocks()
})
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const changeRepo = () => { const r = makeChangeRepo(); cleanup.push(r); return r }
async function openedWaiting(lockWaitMs = 1_000): Promise<PrivateStore> {
  const s = await openPrivateStore(repo(), { dir: storeDir(), lockWaitMs }); open.push(s); return s
}

describe('a stuck write (§7.5, carry 5)', () => {
  it('a transaction held past lockWaitMs raises onStuck once and clears on release; the next stuck holder raises again', async () => {
    const s = await openedWaiting(1_000)
    vi.useFakeTimers()
    const stuck = vi.fn(), unstuck = vi.fn()
    s.onStuck = stuck; s.onUnstuck = unstuck
    const t = await s.begin()
    await vi.advanceTimersByTimeAsync(999)
    expect(stuck).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(stuck).toHaveBeenCalledTimes(1)
    expect(stuck.mock.calls[0]![0]).toBeGreaterThanOrEqual(1_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(stuck).toHaveBeenCalledTimes(1) // once per stuck holder
    expect(unstuck).not.toHaveBeenCalled()
    t.commit()
    expect(unstuck).toHaveBeenCalledTimes(1)

    // A holder that finishes in time raises nothing and clears nothing.
    const quick = await s.begin(); quick.rollback()
    await vi.advanceTimersByTimeAsync(2_000)
    expect([stuck.mock.calls.length, unstuck.mock.calls.length]).toEqual([1, 1])

    const again = await s.begin()
    await vi.advanceTimersByTimeAsync(1_001)
    expect(stuck).toHaveBeenCalledTimes(2)
    again.rollback()
    expect(unstuck).toHaveBeenCalledTimes(2)
  })

  it('the stuck sentence names the seconds held', () => {
    expect(STORE_STUCK(31_400)).toBe('A write to the private store has been open for 31 s; writes after it wait.')
  })

  // Replaces store.test.ts "a transaction left open makes the next write fail in words after the bound" (ruling P4):
  // 50 ms there; 1 s with fake timers here, since 1 s is the floor.
  it('the lock refusal says the one before has not finished, slow or left open, and that nothing was written', async () => {
    const s = await openedWaiting(1_000)
    vi.useFakeTimers()
    const t = await s.begin()
    t.putRecord(RECORD, 'steward-a', 'c-1')
    const waiting = refusal(s.putRecord({ ...RECORD, id: 'g-2' }, 'steward-a', null))
    await vi.advanceTimersByTimeAsync(1_000)
    const err = await waiting
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toBe('A write to the private store waited 1000 ms for the one before it, which has not finished (it is slow, or was left open). Nothing was written.')
    expect(err.message).toBe(lockWaited(1_000))
    t.commit()
    vi.useRealTimers()
    await s.putRecord({ ...RECORD, id: 'g-3' }, 'steward-a', null) // the queue moves on past the one that gave up
    expect(s.records('grievances').map(x => x.id)).toEqual(['g-1', 'g-3'])
  })
})

describe('lockWaitMs is validated (§7.5)', () => {
  it('0, 500, 300_001, 1.5 and NaN refuse to open, with the sentence, and nothing is made', async () => {
    expect([LOCK_WAIT_MIN_MS, LOCK_WAIT_MAX_MS]).toEqual([1_000, 300_000])
    for (const v of [0, 500, 300_001, 1.5, Number.NaN]) {
      const dir = join(temp('robust-lock-'), 'store')
      const err = await refusal(openPrivateStore(repo(), { dir, lockWaitMs: v }))
      expect(err).toBeInstanceOf(StoreUnavailable)
      expect(err.message).toBe(lockWaitRefusal(v))
      expect(existsSync(dir)).toBe(false)
    }
    expect(lockWaitRefusal(500)).toBe('The private store\'s write wait (lockWaitMs) is 500, not a whole number of milliseconds from 1000 to 300000, so the store was not opened.')
    for (const v of [1_000, 300_000]) await expect(openPrivateStore(repo(), { dir: temp('robust-lock-'), lockWaitMs: v }).then(s => { open.push(s); return true })).resolves.toBe(true)
  })
})

describe('atomic() (§7.5)', () => {
  it('when the write throws and RELEASE also throws, the write\'s error is the one rethrown; the second is logged', async () => {
    const s = await openedWaiting()
    const db = (s as unknown as { db: DatabaseSync }).db
    const exec = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql: string) => {
      if (sql === 'RELEASE write_and_history') throw new Error('SENTINEL-release-1')
      return exec(sql)
    })
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = await refusal(s.putRecord(RECORD, '', null)) // no "who wrote": the write's own error
    expect(err.message).toBe('the private store needs who wrote as a non-empty string')
    expect(said.mock.calls.map(c => String(c[0])).some(l => l.includes('SENTINEL-release-1'))).toBe(true)
    vi.mocked(db.exec).mockRestore()
    await s.putRecord(RECORD, 'steward-a', null) // the transaction was rolled back and the lock released
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
  })
})

describe('what a store that cannot be opened answers (§7.4, carry 8)', () => {
  /** A store folder whose house.db is not a database: SQLite's own words, and the file's path, in the error. */
  function garbageDir(): string {
    const dir = temp('robust-garbage-')
    writeFileSync(join(dir, 'house.db'), 'SENTINEL-not-a-database-1 '.repeat(200))
    return dir
  }

  it('classifyOpenError: three kinds, three fixed sentences; the raw text is never the sentence', async () => {
    const sqlite = await refusal(openPrivateStore(repo(), { dir: garbageDir() }))
    expect(classifyOpenError(sqlite)).toEqual({ kind: 'cannot-open', sentence: STORE_CANNOT_OPEN })
    expect(STORE_CANNOT_OPEN).toBe('The private store could not be opened. A maintainer can read why in the server\'s log.')

    const r = repo()
    const notIgnored = await refusal(openPrivateStore(r, { dir: join(r, '.org-os', 'private') }))
    expect(classifyOpenError(notIgnored)).toEqual({ kind: 'not-ignored', sentence: notIgnored.message }) // §10.1's copy
    expect(notIgnored.message).toMatch(/^The private store would be at \.org-os\/private\/house\.db, which git does not ignore\./)

    expect(classifyOpenError(new StoreUnavailable('This private store was written by a newer org-os (schema 9); update first.', 'newer')))
      .toEqual({ kind: 'newer', sentence: STORE_NEWER })
    expect(STORE_NEWER).toBe('The private store was written by a newer org-os. Update this Hub first.')
    expect(classifyOpenError(new Error('EACCES: permission denied, open \'/srv/private/house.db\''))).toEqual({ kind: 'cannot-open', sentence: STORE_CANNOT_OPEN })
    expect(classifyOpenError('a string')).toEqual({ kind: 'cannot-open', sentence: STORE_CANNOT_OPEN })
  })

  it('a newer store is classed newer from the store itself', async () => {
    const dir = temp('robust-newer-')
    const first = await openPrivateStore(repo(), { dir }); first.close()
    const raw = new DatabaseSync(join(dir, 'house.db')); raw.exec('PRAGMA user_version = 9'); raw.close()
    expect(classifyOpenError(await refusal(openPrivateStore(repo(), { dir })))).toEqual({ kind: 'newer', sentence: STORE_NEWER })
  })

  it('storeAccess throws the failure\'s sentence, or NO_STORE with none', () => {
    expect(() => storeAccess(null, { sentence: STORE_CANNOT_OPEN })()).toThrow(STORE_CANNOT_OPEN)
    expect(() => storeAccess(null, null)()).toThrow(NO_STORE)
    const { why } = reach(storeAccess(null, { sentence: STORE_CANNOT_OPEN }))
    expect(unavailable(why).body).toEqual({ error: STORE_CANNOT_OPEN, code: 'PRIVATE_STORE' })
  })

  it('a server whose store fails to open with SQLite\'s own text answers 503 with the fixed sentence; the log has the original', async () => {
    const r = changeRepo()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', garbageDir())
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0, fetch: async () => { throw new Error('no network in this test') } })
    running.push(server)
    expect(server.privateStore).toBeNull()
    const logged = said.mock.calls.map(c => String(c[0]))
    expect(logged.some(l => /could not be opened: .*file is not a database/i.test(l))).toBe(true) // the original, to the log

    // A change with a private part needs the store: its answer is the 503.
    // steward-a (git's identity here) holds the role ops by name, so the write is admitted and only the store is missing.
    writeFileSync(join(r, 'data', 'governance.yaml'), 'schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  roles:\n    ops: { members: [steward-a] }\n  decisions: []\n')
    writeFileSync(join(r, 'data', 'visibility.yaml'), 'visibility:\n  collections:\n    members: { default: members, fields: { email: "role:ops" } }\n')
    git(r, 'add -A'); git(r, 'commit -qm "fixture: email is restricted to the role ops"')
    const res = await fetch(`http://localhost:${server.port}/api/changes/ops`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops: [{ op: 'update', record: 'members:steward-a', set: { email: 'steward-a@example.invalid' } }] }),
    })
    const text = await res.text()
    expect(res.status).toBe(503)
    expect(JSON.parse(text)).toEqual({ error: STORE_CANNOT_OPEN, code: 'PRIVATE_STORE' })
    expect(text).not.toMatch(/SQLITE/i)
    expect(text).not.toMatch(/errno/i)
    expect(text).not.toContain('/')
    expect(text).not.toContain('not a database')

    // Home's attention is the class's sentence, not SQLite's words.
    const home = await (await fetch(`http://localhost:${server.port}/api/resources`)).json() as { id: string; attention?: { text: string } }[]
    expect(home.find(n => n.id === 'absent:server:private-store')?.attention?.text).toBe(STORE_CANNOT_OPEN)
  })

  it('a server raises the stuck store as attention and clears it on release', async () => {
    const r = changeRepo()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', temp('robust-ok-'))
    const server = await startServer({ repo: r, port: 0, fetch: async () => { throw new Error('no network in this test') } })
    running.push(server)
    const attention = async () => ((await (await fetch(`http://localhost:${server.port}/api/resources`)).json()) as { id: string; attention?: { text: string } }[])
      .find(n => n.id === 'absent:server:private-store-stuck')?.attention?.text ?? null
    server.privateStore!.onStuck!(31_000)
    expect(await attention()).toBe(STORE_STUCK(31_000))
    server.privateStore!.onUnstuck!()
    expect(await attention()).toBeNull()
  })
})
