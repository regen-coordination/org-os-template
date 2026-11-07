import { describe, it, expect, afterEach, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo, MEMBERS_YAML } from '../fixtures.ts'
import { createSession } from '../../server/session/sessions.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { backup, BACKUP_EVERY_MS, BACKUP_KEEP, createKey, prune, restore, verifyBackup } from '../../server/private/backup.ts'
import { stateDir } from '../../server/state.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { main } from '../../scripts/house-backup.ts'

// Every test runs against a fresh temporary repository and keeps its store, its backups and its key in folders of its
// own under the temp directory: nothing is written inside this worktree (L5 constraints). Keys are made here.

const WRONG_KEY = 'This backup cannot be read with that key.'
const DAMAGED = 'This backup has been changed or is damaged; it was not restored.'
const KEY_IN_STORE = "Keep the key outside the private store's folder, or one copy loses both."
const SENTINEL = 'sentinel-7f3a9c1e-not-for-anyone'
const NOW = new Date('2026-10-29T12:00:00Z')
const TABLES = ['applied', 'collections', 'fields', 'history', 'pending', 'records', 'sessions', 'staged']

const cleanup: string[] = []
const open: PrivateStore[] = []
const running: Running[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const r of running.splice(0)) await r.close()
  for (const s of open.splice(0)) { try { s.close() } catch { /* already closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

function temp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
function repo(): string { const r = makeFixtureRepo(); cleanup.push(r); return r }
function keyFile(): string { const f = join(temp('backup-key-'), 'house.key'); createKey(f); return f }
async function opened(r: string, dir: string): Promise<PrivateStore> {
  const s = await openPrivateStore(r, { dir }); open.push(s); return s
}
function closeAll(): void { for (const s of open.splice(0)) s.close() }

/** Every row of every table in a store file, as text: what a round trip must keep. */
function dump(file: string): Record<string, unknown[]> {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return Object.fromEntries(TABLES.map(t => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()]))
  } finally { db.close() }
}

/** A store with a row in each of the §10.2 tables: records, fields and history through the store; the tables no
 *  task writes yet straight into the file, as Tasks 6, 14 and 15 will through the store. */
async function filled(r: string, dir: string): Promise<PrivateStore> {
  const s = await opened(r, dir)
  await s.putRecord({ collection: 'grievances', id: 'g-1', visibility: 'hat:Ops', body: { note: SENTINEL }, rev: 'r1' }, 'steward-a', null)
  await s.putField({ registry: 'members', record: 'steward-b', field: 'wallet', visibility: 'members', value: 'eip155:42220:0x00000000000000000000000000000000000000a2' }, 'steward-b', 'c-1')
  const raw = new DatabaseSync(s.file)
  raw.exec(`INSERT INTO collections VALUES ('grievances', 'hat:Ops', '{"fields":["note"]}');
    INSERT INTO staged VALUES ('c-1', 1, 'steward-a', '{"op":"put"}');
    INSERT INTO pending VALUES ('p-1', 'prop-1', 'salt', '[]', 'd1');
    INSERT INTO applied VALUES ('prop-0', 'abc123', '2026-10-28T10:00:00.000Z');
    INSERT INTO sessions VALUES ('h1', 'eip155:42220:0x00000000000000000000000000000000000000a1', '2026-10-29T11:00:00.000Z', '2026-10-30T11:00:00.000Z');`)
  raw.close()
  return s
}

describe('backup and restore (L5 spec §10.4, Q3)', () => {
  it('backup then restore round-trips every table', async () => {
    const r = repo(), from = temp('private-a-'), to = temp('private-b-'), backups = temp('backups-'), key = keyFile()
    const s = await filled(r, from)
    const made = await backup(s, { dir: backups, keyFile: key, now: NOW })
    expect(made.file).toBe(join(backups, 'house-20261029T120000Z.db.enc'))
    expect(made.counts).toEqual({ applied: 1, collections: 1, fields: 1, history: 2, pending: 1, records: 1, sessions: 1, staged: 1 })
    expect(statSync(made.file).mode & 0o777).toBe(0o600)
    const line = JSON.parse(readFileSync(join(backups, 'manifest.jsonl'), 'utf8').trim()) as Record<string, unknown>
    expect(line).toEqual({ file: 'house-20261029T120000Z.db.enc', at: NOW.toISOString(), sha256: made.sha256, version: 1, counts: made.counts })

    const before = dump(s.file)
    closeAll()
    const done = await restore(r, made.file, key, { dir: to, now: NOW })
    expect(done).toEqual({ restored: join(to, 'house.db'), kept: null })
    expect(statSync(done.restored).mode & 0o777).toBe(0o600)
    expect(dump(done.restored)).toEqual(before)
    const back = await opened(r, to)
    expect(back.record('grievances', 'g-1')?.body).toEqual({ note: SENTINEL })
    expect(readdirSync(to).filter(f => !f.startsWith('house.db'))).toEqual([]) // no temporary left behind
  })

  it('the copy waits for a transaction left open by another writer, and holds what it committed', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const s = await filled(r, dir)
    const t = await s.begin()
    t.putRecord({ collection: 'grievances', id: 'g-3', visibility: 'hat:Ops', body: { note: 'in a transaction' }, rev: 'r1' }, 'steward-a', null)
    let settled = false
    const made = backup(s, { dir: backups, keyFile: key, now: NOW }).finally(() => { settled = true })
    await new Promise(res => setTimeout(res, 50))
    expect(settled).toBe(false)
    t.commit()
    expect((await made).counts.records).toBe(2)
  })

  it('the backup file holds none of a planted sentinel value in clear', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const s = await filled(r, dir)
    const made = await backup(s, { dir: backups, keyFile: key, now: NOW })
    const bytes = readFileSync(made.file)
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('ORGOSPS1')
    expect(bytes.includes(Buffer.from(SENTINEL))).toBe(false)
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false)
    expect(readFileSync(join(backups, 'manifest.jsonl'), 'utf8')).not.toContain(SENTINEL)
    // and nothing in clear is left beside it, in the backup folder or the store's own
    expect(readdirSync(backups).sort()).toEqual(['house-20261029T120000Z.db.enc', 'manifest.jsonl'])
    expect(readdirSync(dir).filter(f => !f.startsWith('house.db'))).toEqual([])
    expect(verifyBackup(made.file, key, { dir })).toEqual({ ok: true, version: 1, counts: made.counts })
  })

  it('a wrong key: "This backup cannot be read with that key."', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    const other = keyFile()
    expect(verifyBackup(made.file, other, { dir })).toEqual({ ok: false, error: WRONG_KEY })
    // away from its manifest too (a copy brought back from off the machine)
    const away = join(temp('elsewhere-'), basename(made.file))
    copyFileSync(made.file, away)
    expect(verifyBackup(away, other, { dir })).toEqual({ ok: false, error: WRONG_KEY })
    closeAll()
    const to = temp('private-b-')
    await expect(restore(r, made.file, other, { dir: to })).rejects.toThrow(WRONG_KEY)
    expect(readdirSync(to)).toEqual([])
  })

  it('a flipped byte: "This backup has been changed or is damaged; it was not restored."', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    const away = join(temp('elsewhere-'), basename(made.file))
    const bytes = readFileSync(made.file)
    for (const at of [8 /* the IV */, bytes.length >> 1 /* the ciphertext */, bytes.length - 1 /* the tag */]) {
      const flipped = Buffer.from(bytes)
      flipped[at] = flipped[at]! ^ 0x01
      writeFileSync(made.file, flipped)
      expect(verifyBackup(made.file, key, { dir }), `byte ${at}, beside its manifest`).toEqual({ ok: false, error: DAMAGED })
    }
    // away from its manifest, a byte flipped in the ciphertext or the tag is still told from a wrong key
    for (const at of [bytes.length >> 1, bytes.length - 1]) {
      const flipped = Buffer.from(bytes)
      flipped[at] = flipped[at]! ^ 0x01
      writeFileSync(away, flipped)
      expect(verifyBackup(away, key, { dir }), `byte ${at}, away from its manifest`).toEqual({ ok: false, error: DAMAGED })
    }
    writeFileSync(away, bytes.subarray(0, 20))
    expect(verifyBackup(away, key, { dir })).toEqual({ ok: false, error: DAMAGED })
    closeAll()
    const to = temp('private-b-')
    await expect(restore(r, made.file, key, { dir: to })).rejects.toThrow(DAMAGED)
    expect(readdirSync(to)).toEqual([])
  })

  it('restore refuses while the pid file names a live process, with "Stop the server for this repository first."', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    closeAll()
    mkdirSync(stateDir(r), { recursive: true })
    writeFileSync(join(stateDir(r), 'server.pid'), String(process.ppid)) // the test runner: alive, and not this process
    const before = readFileSync(join(dir, 'house.db'))
    await expect(restore(r, made.file, key, { dir })).rejects.toThrow('Stop the server for this repository first.')
    expect(readFileSync(join(dir, 'house.db')).equals(before)).toBe(true)
    expect(readdirSync(dir).filter(f => f.includes('restore'))).toEqual([])
    // a pid file left by a server that has ended does not stand in the way
    writeFileSync(join(stateDir(r), 'server.pid'), '999999999')
    await expect(restore(r, made.file, key, { dir, now: NOW })).resolves.toMatchObject({ restored: join(dir, 'house.db') })
  })

  it('restore keeps the old file as house.db.before-restore-<time>', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const s = await filled(r, dir)
    const made = await backup(s, { dir: backups, keyFile: key, now: NOW })
    await s.putRecord({ collection: 'grievances', id: 'g-2', visibility: 'hat:Ops', body: { note: 'after the backup' }, rev: 'r1' }, 'steward-a', null)
    closeAll()
    const later = new Date('2026-10-30T08:15:00Z')
    const done = await restore(r, made.file, key, { dir, now: later })
    expect(done.kept).toBe(join(dir, 'house.db.before-restore-20261030T081500Z'))
    const old = new DatabaseSync(done.kept!, { readOnly: true })
    expect(old.prepare("SELECT id FROM records WHERE collection = 'grievances' ORDER BY id").all().map(x => x.id)).toEqual(['g-1', 'g-2'])
    old.close()
    const back = await opened(r, dir)
    expect(back.records('grievances').map(x => x.id)).toEqual(['g-1'])
  })

  it('a backup of a newer schema is refused in words, and nothing is moved', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const s = await filled(r, dir)
    const raw = new DatabaseSync(s.file); raw.exec('PRAGMA user_version = 9'); raw.close()
    const made = await backup(s, { dir: backups, keyFile: key, now: NOW })
    const newer = 'This backup was written by a newer org-os (schema 9); update first. It was not restored.'
    expect(verifyBackup(made.file, key, { dir })).toEqual({ ok: false, error: newer })
    closeAll()
    const to = temp('private-b-')
    await expect(restore(r, made.file, key, { dir: to })).rejects.toThrow(newer)
    expect(readdirSync(to)).toEqual([])
  })

  it('verify opens the backup inside the store\'s folder and leaves nothing there', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    const before = readdirSync(dir).sort()
    expect(verifyBackup(made.file, key, { dir })).toMatchObject({ ok: true })
    expect(readdirSync(dir).sort()).toEqual(before)
    // a folder that cannot take it: refused, never put elsewhere
    const blocked = join(temp('blocked-'), 'a-file')
    writeFileSync(blocked, 'not a folder')
    const read = verifyBackup(made.file, key, { dir: blocked })
    expect(read.ok).toBe(false)
    expect(read.ok ? '' : read.error).toMatch(new RegExp(`^The private store's folder ${blocked} could not take a backup to check: `))
  })

  it('a good backup opens even when a manifest line disagrees with it', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    const manifest = join(backups, 'manifest.jsonl')
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(made.sha256, '0'.repeat(64)))
    expect(verifyBackup(made.file, key, { dir })).toMatchObject({ ok: true, version: 1 })
  })

  it('restore leaves alone a restoring file it did not make', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    closeAll()
    const left = join(dir, 'house.db.restoring-20261029T120000Z')
    writeFileSync(left, 'another restore')
    await expect(restore(r, made.file, key, { dir, now: NOW })).rejects.toThrow(
      `A restore begun at 20261029T120000Z did not finish: ${left} is still there. Move it away and restore again; nothing was changed.`)
    expect(readFileSync(left, 'utf8')).toBe('another restore')
    expect(existsSync(join(dir, 'house.db'))).toBe(true)
  })

  it('the suite never opens the caller\'s own store: ORG_OS_PRIVATE_DIR is a fresh temp folder (tests/setup.ts)', () => {
    expect(basename(process.env.ORG_OS_PRIVATE_DIR ?? '')).toMatch(/^admin-private-/)
  })

  it('prune keeps the newest 14', () => {
    const dir = temp('backups-')
    const names: string[] = []
    for (let day = 1; day <= 16; day++) {
      const name = `house-202610${String(day).padStart(2, '0')}T030000Z.db.enc`
      writeFileSync(join(dir, name), 'x'); names.push(name)
    }
    writeFileSync(join(dir, 'manifest.jsonl'), '')
    writeFileSync(join(dir, 'notes.txt'), 'not a backup')
    expect(BACKUP_KEEP).toBe(14)
    expect(BACKUP_EVERY_MS).toBe(86_400_000)
    expect(prune(dir, BACKUP_KEEP)).toEqual([join(dir, names[1]!), join(dir, names[0]!)])
    expect(readdirSync(dir).sort()).toEqual([...names.slice(2), 'manifest.jsonl', 'notes.txt'].sort())
    expect(prune(dir, BACKUP_KEEP)).toEqual([])
  })

  it('createKey refuses an existing file', () => {
    const f = join(temp('backup-key-'), 'house.key')
    createKey(f)
    const key = readFileSync(f)
    expect(key.length).toBe(32)
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(() => createKey(f)).toThrow(`There is already a key at ${f}; it was left as it is.`)
    expect(readFileSync(f).equals(key)).toBe(true)
    const g = join(temp('backup-key-'), 'house.key')
    createKey(g)
    expect(readFileSync(g).equals(key)).toBe(false)
  })

  it('the key file outside the store folder is enforced: a key inside the private dir is refused', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-')
    const s = await filled(r, dir)
    const inside = join(dir, 'house.key')
    createKey(inside)
    await expect(backup(s, { dir: backups, keyFile: inside, now: NOW })).rejects.toThrow(KEY_IN_STORE)
    expect(readdirSync(backups)).toEqual([])
    // and inside the repository: a commit could carry it
    const inRepo = join(r, 'house.key')
    createKey(inRepo)
    await expect(backup(s, { dir: backups, keyFile: inRepo, now: NOW, repo: r })).rejects.toThrow('Keep the key outside the repository, or a commit can carry it.')
    // the command refuses to make one there in the first place
    const said: string[] = []
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    const code = await main(['key', join(dir, 'another.key')], { repo: r, out: t => said.push(t), err: t => said.push(t) })
    expect(code).toBe(1)
    expect(said).toEqual([KEY_IN_STORE])
    expect(existsSync(join(dir, 'another.key'))).toBe(false)
  })
})

describe('the commands (npm run house:backup, house:backup:key, house:restore)', () => {
  it('key, backup, --verify and restore, as a maintainer runs them', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-')
    const s = await filled(r, dir); s.close(); open.splice(0)
    const key = join(temp('backup-key-'), 'house.key')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_DIR', backups)
    const out: string[] = [], err: string[] = []
    const io = { repo: r, out: (t: string) => out.push(t), err: (t: string) => err.push(t) }
    expect(await main(['key', key], io)).toBe(0)
    expect(out.pop()).toBe(`A key was made at ${key}.\nKeep a copy of this key away from this machine. Without it no backup can be read.`)
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', key)
    expect(await main(['backup'], io)).toBe(0)
    const made = readdirSync(backups).find(f => f.endsWith('.db.enc'))!
    expect(out.pop()).toMatch(new RegExp(`^Backed up to ${join(backups, made)}\\nsha256 [0-9a-f]{64}\\nrows: applied 1, collections 1, fields 1, history 2, pending 1, records 1, sessions 1, staged 1$`))
    expect(await main(['backup', '--verify', join(backups, made)], io)).toBe(0)
    expect(out.pop()).toBe(`${join(backups, made)} can be restored: schema 1; rows: applied 1, collections 1, fields 1, history 2, pending 1, records 1, sessions 1, staged 1.`)
    expect(await main(['restore', join(backups, made)], io)).toBe(0)
    expect(out.pop()).toMatch(/^Restored .*house\.db; the file it replaced is kept as .*house\.db\.before-restore-\d{8}T\d{6}Z\.$/)
    expect(err).toEqual([])
    expect(await main(['backup', '--verify'], io)).toBe(1)
    expect(err.pop()).toBe('Name the backup to verify: npm run house:backup -- --verify <file>')
  })
})

/** GET /api/resources from a running server, with a session's cookie when one is given. */
function resources(port: number, cookie?: string): Promise<{ id: string; name: string; attention: { level: string; text: string } | null }[]> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: `localhost:${port}`, ...(cookie ? { cookie } : {}) }
    const req = request({ host: '127.0.0.1', port, method: 'GET', path: '/api/resources', headers }, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => { try { resolve(JSON.parse(text)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.end()
  })
}
async function attentionOf(port: number, id: string, until: (t: string | null) => boolean, cookie?: string): Promise<string | null> {
  for (let i = 0; i < 200; i++) {
    const found = (await resources(port, cookie)).find(n => n.id === id)
    const text = found?.attention?.text ?? null
    if (until(text)) return text
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error(`${id} never reached the state looked for`)
}

describe('house:backup -- --verify, where the store may not be', () => {
  it('refuses with the §10.1 sentence in a repository whose .gitignore lacks the line, and writes nothing', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), key = keyFile()
    const made = await backup(await filled(r, dir), { dir: backups, keyFile: key, now: NOW })
    closeAll()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', '')
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', key)
    const out: string[] = [], err: string[] = []
    expect(await main(['backup', '--verify', made.file], { repo: r, out: t => out.push(t), err: t => err.push(t) })).toBe(1)
    expect(err).toEqual(['The private store would be at .org-os/private/house.db, which git does not ignore. Add `.org-os/private/` to .gitignore first.'])
    expect(out).toEqual([])
    expect(existsSync(join(r, '.org-os'))).toBe(false)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf8' })).toBe('')
  })
})

describe('the server (startServer): one private store, and its backups on a schedule', () => {
  it('a failed backup becomes the §10.4 attention item; a good one clears it', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = repo(), dir = temp('private-')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', join(dir, 'house.key'))
    createKey(join(dir, 'house.key'))
    const server = await startServer({ repo: r, port: 0, backupEveryMs: 40 })
    running.push(server)
    const text = await attentionOf(server.port, 'absent:server:backup', t => t !== null)
    expect(text).toBe(`The private store was not backed up: ${KEY_IN_STORE}`)
    await new Promise(res => setTimeout(res, 120)) // several ticks fail: the operator is told once
    expect(said.mock.calls).toEqual([[`org-os admin: The private store was not backed up: ${KEY_IN_STORE}`]])
    await server.close(); running.splice(0)

    const key = keyFile()
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', key)
    const good = await startServer({ repo: r, port: 0, backupEveryMs: 40 })
    running.push(good)
    await attentionOf(good.port, 'absent:server:backup', t => t === null)
    const backups = join(dir, 'backups')
    for (let i = 0; i < 200 && !existsSync(join(backups, 'manifest.jsonl')); i++) await new Promise(res => setTimeout(res, 25))
    const files = readdirSync(backups).filter(f => f.endsWith('.db.enc'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(verifyBackup(join(backups, files[0]!), key, { dir })).toMatchObject({ ok: true, version: 1 })
  })

  it('an interval longer than a timer can wait is attention, not a backup every millisecond', async () => {
    const r = repo(), dir = temp('private-'), key = keyFile()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', key)
    vi.stubEnv('ORG_OS_BACKUP_EVERY', '30d')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0 })
    running.push(server)
    expect(await attentionOf(server.port, 'absent:server:backup', t => t !== null))
      .toBe('The private store was not backed up: ORG_OS_BACKUP_EVERY is "30d", longer than the server can wait (24 days at most).')
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('a prune that fails after a good backup is said as such, not as a backup not taken', async () => {
    const r = repo(), dir = temp('private-'), key = keyFile()
    const backups = join(dir, 'backups')
    mkdirSync(join(backups, 'house-20200101T000000Z.db.enc'), { recursive: true }) // a folder by a backup's name
    writeFileSync(join(backups, 'house-20200101T000000Z.db.enc', 'x'), 'x')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', key)
    vi.stubEnv('ORG_OS_BACKUP_KEEP', '1')
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0, backupEveryMs: 1_100 })
    running.push(server)
    expect(await attentionOf(server.port, 'absent:server:backup-prune', t => t !== null)).toMatch(/^Old backups of the private store were not removed: /)
    // a second good backup a tick later fails its prune the same way: the operator is told once
    const taken = () => readFileSync(join(backups, 'manifest.jsonl'), 'utf8').trim().split('\n').length
    for (let i = 0; i < 200 && taken() < 2; i++) await new Promise(res => setTimeout(res, 25))
    expect(taken()).toBeGreaterThanOrEqual(2)
    await new Promise(res => setTimeout(res, 50))
    expect(said.mock.calls.filter(c => String(c[0]).includes('Old backups'))).toHaveLength(1)
    expect((await resources(server.port)).some(n => n.id === 'absent:server:backup')).toBe(false)
    expect(readdirSync(backups).filter(f => f.endsWith('.db.enc') && f !== 'house-20200101T000000Z.db.enc').length).toBeGreaterThanOrEqual(1)
  })

  it('hosted with no key, too: said to maintainers, never to the public (Task 13)', async () => {
    const r = repo(), dir = temp('private-')
    // steward-a, a person (so a maintainer: the org defines no maintainer role), signs in with this address.
    const A1 = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    writeFileSync(join(r, 'data', 'members.yaml'), MEMBERS_YAML.replace('git: ["admin-test@local"]', `git: ["admin-test@local"]\n      wallet: ["${A1}"]`))
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', '')
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0, hosted: true, backupEveryMs: 40 })
    running.push(server)
    const { token } = await createSession(server.privateStore!, A1, () => new Date())
    expect(await attentionOf(server.port, 'absent:server:backup', t => t !== null, `house_session=${token}`))
      .toBe('The private store was not backed up: no key is set. Make one with npm run house:backup:key -- <file> and set ORG_OS_BACKUP_KEY_FILE to it.')
    expect((await resources(server.port)).some(n => n.id.startsWith('absent:server:'))).toBe(false)
    // locally, no key means no backups and nothing said
    await server.close(); running.splice(0)
    const local = await startServer({ repo: r, port: 0, backupEveryMs: 40 })
    running.push(local)
    await new Promise(res => setTimeout(res, 120))
    expect((await resources(local.port)).some(n => n.id.startsWith('absent:server:'))).toBe(false)
    expect(said).toHaveBeenCalledTimes(1)
  })

  it('a store that cannot be opened is attention with the §10.1 sentence; the git side keeps serving and nothing is made in the repository', async () => {
    const r = repo()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', '')
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0 })
    expect(said.mock.calls).toEqual([['org-os admin: The private store would be at .org-os/private/house.db, which git does not ignore. Add `.org-os/private/` to .gitignore first.']])
    running.push(server)
    expect(await attentionOf(server.port, 'absent:server:private-store', t => t !== null))
      .toBe('The private store would be at .org-os/private/house.db, which git does not ignore. Add `.org-os/private/` to .gitignore first.')
    expect((await resources(server.port)).some(n => n.id.startsWith('project:'))).toBe(true)
    expect(server.privateStore).toBeNull()
    expect(existsSync(join(r, '.org-os'))).toBe(false)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf8' })).toBe('')
  })

  it('opens the one private store under ORG_OS_PRIVATE_DIR and closes it with the server', async () => {
    const r = repo(), dir = temp('private-')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    const server = await startServer({ repo: r, port: 0 })
    running.push(server)
    expect(server.privateStore?.file).toBe(join(dir, 'house.db'))
    expect((await resources(server.port)).some(n => n.id.startsWith('absent:server:'))).toBe(false)
    const store = server.privateStore!
    await server.close(); running.splice(0)
    expect(() => store.records('grievances')).toThrow()
  })
})
