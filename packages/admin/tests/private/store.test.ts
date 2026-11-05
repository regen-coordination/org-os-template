import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo } from '../fixtures.ts'
import { isIgnored } from '../../server/git.ts'
import { privateDir } from '../../server/private/paths.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore, type PrivateRecord } from '../../server/private/store.ts'

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
  it('holds the tables and columns of §10.2, in WAL, at schema 1', async () => {
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
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
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
    db.exec('PRAGMA user_version = 2')
    db.close()
    const err = await refusal(openPrivateStore(r, { dir }))
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toBe('This private store was written by a newer org-os (schema 2); update first.')
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

  it('a transaction left open makes the next write fail in words after the bound, not wait forever', async () => {
    const r = repo(); const dir = storeDir()
    const s = await openPrivateStore(r, { dir, lockWaitMs: 50 }); open.push(s)
    const t = await s.begin()
    t.putRecord(RECORD, 'steward-a', 'c-1')
    const err = await refusal(s.putRecord({ ...RECORD, id: 'g-2' }, 'steward-a', null)) // the holder's own put, too
    expect(err).toBeInstanceOf(StoreUnavailable)
    expect(err.message).toMatch(/a transaction was left open/)
    t.commit()
    await s.putRecord({ ...RECORD, id: 'g-3' }, 'steward-a', null) // the queue moves on past the one that gave up
    expect(s.records('grievances').map(x => x.id)).toEqual(['g-1', 'g-3'])
  })

  it('a writer waiting behind a rolled-back one still runs', async () => {
    const s = await opened()
    const t = await s.begin()
    const put = s.putRecord(RECORD, 'steward-b', null)
    t.rollback()
    await put
    expect(s.record('grievances', 'g-1')).toEqual(RECORD)
  })
})
