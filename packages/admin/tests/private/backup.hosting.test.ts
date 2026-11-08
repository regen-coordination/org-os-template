import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo, MEMBERS_YAML } from '../fixtures.ts'
import { createSession } from '../../server/session/sessions.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { backup, checkBackupPlace, cleanLeftovers, createKey, restore, verifyBackup } from '../../server/private/backup.ts'
import { createKeyPair, DAMAGED, MAGIC, MAGIC_PK, publicKeyRefusal, readOpeningKey, sealTo, unseal, WRONG_KEY } from '../../server/private/crypto.ts'
import { runningServer, serverPidFile, stateDir } from '../../server/state.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { main } from '../../scripts/house-backup.ts'

// L9 Task 10 (carry 6; Q51, Q-L9-2, Q-L9-14): hosted backups sealed to a maintainer's X25519 public key, taken without
// the write lock, leftovers removed at start, the backup folder's place, and the pid file through a link. Every test
// works in fresh temporary folders; keys are made here and are never real.

const NOW = new Date('2026-11-04T12:00:00Z')
const SENTINEL = 'SENTINEL-backup-1'
const TABLES = ['applied', 'collections', 'fields', 'history', 'pending', 'records', 'sessions', 'staged']
const INSIDE = 'ORG_OS_BACKUP_DIR is inside the repository. Put it on its own volume, then start again.'
const NO_PUBLIC_KEY = 'The private store was not backed up: no public key is set. Make a key pair on a maintainer\'s machine with npm run house:backup:keypair -- <private file> <public file>, and set ORG_OS_BACKUP_PUBLIC_KEY_FILE to the public one.'

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
function keyPair(): { priv: string; pub: string } {
  const d = temp('backup-keys-')
  const priv = join(d, 'backup.key'), pub = join(d, 'backup.pub')
  createKeyPair(priv, pub)
  return { priv, pub }
}
async function opened(r: string, dir: string, lockWaitMs?: number): Promise<PrivateStore> {
  const s = await openPrivateStore(r, { dir, ...(lockWaitMs !== undefined ? { lockWaitMs } : {}) }); open.push(s); return s
}
async function filled(r: string, dir: string): Promise<PrivateStore> {
  const s = await opened(r, dir)
  await s.putRecord({ collection: 'grievances', id: 'g-1', visibility: 'hat:Ops', body: { note: SENTINEL }, rev: 'r1' }, 'steward-a', null)
  await s.putField({ registry: 'members', record: 'steward-b', field: 'wallet', visibility: 'members', value: 'eip155:42220:0x00000000000000000000000000000000000000a2' }, 'steward-b', 'c-1')
  return s
}
function dump(file: string): Record<string, unknown[]> {
  const db = new DatabaseSync(file, { readOnly: true })
  try { return Object.fromEntries(TABLES.map(t => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])) } finally { db.close() }
}

describe('sealed to a public key (ORGOSPK1, §7.1)', () => {
  it('a backup sealed to a public key restores with the private key: rows equal', async () => {
    const r = repo(), from = temp('private-a-'), to = temp('private-b-'), backups = temp('backups-'), { priv, pub } = keyPair()
    const s = await filled(r, from)
    const made = await backup(s, { dir: backups, publicKeyFile: pub, now: NOW })
    const sealed = readFileSync(made.file)
    expect(sealed.subarray(0, 8).equals(MAGIC_PK)).toBe(true)
    expect(sealed.includes(Buffer.from(SENTINEL))).toBe(false)
    expect(verifyBackup(made.file, priv, { dir: to })).toMatchObject({ ok: true, version: 2 })
    const before = dump(s.file)
    await restore(r, made.file, priv, { dir: to })
    expect(dump(join(to, 'house.db'))).toEqual(before)
  })

  it('the key pair: X25519 in PEM, the private file mode 600, never overwritten', () => {
    const { priv, pub } = keyPair()
    expect(statSync(priv).mode & 0o777).toBe(0o600)
    expect(readFileSync(priv, 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----/)
    expect(readFileSync(pub, 'utf8')).toMatch(/^-----BEGIN PUBLIC KEY-----/)
    expect(publicKeyRefusal(pub)).toBeNull()
    const before = readFileSync(priv)
    expect(() => createKeyPair(priv, join(temp('k-'), 'other.pub'))).toThrow(`There is already a key at ${priv}; it was left as it is.`)
    expect(() => createKeyPair(join(temp('k-'), 'other.key'), pub)).toThrow(`There is already a key at ${pub}; it was left as it is.`)
    expect(readFileSync(priv).equals(before)).toBe(true)
  })

  it('the server side cannot open it: unseal with the public key file is refused with WRONG_KEY\'s sentence', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), { pub } = keyPair()
    const made = await backup(await filled(r, dir), { dir: backups, publicKeyFile: pub, now: NOW })
    expect(verifyBackup(made.file, pub, { dir })).toEqual({ ok: false, error: WRONG_KEY })
    expect(() => unseal(readOpeningKey(pub), readFileSync(made.file), () => null)).toThrow(WRONG_KEY)
  })

  it('a wrong private key and a flipped byte are refused in words (L5\'s two sentences)', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), { pub } = keyPair(), other = keyPair()
    const made = await backup(await filled(r, dir), { dir: backups, publicKeyFile: pub, now: NOW })
    expect(verifyBackup(made.file, other.priv, { dir })).toEqual({ ok: false, error: WRONG_KEY })
    // A symmetric key against a sealed-to-public file, and the reverse, are wrong keys too.
    const sym = join(temp('sym-'), 'house.key'); createKey(sym)
    expect(verifyBackup(made.file, sym, { dir })).toEqual({ ok: false, error: WRONG_KEY })
  })

  it('a flipped byte with the right private key is DAMAGED, with or without a manifest line', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), { priv, pub } = keyPair()
    const made = await backup(await filled(r, dir), { dir: backups, publicKeyFile: pub, now: NOW })
    const flipped = Buffer.from(readFileSync(made.file))
    flipped[Math.floor(flipped.length / 2)]! ^= 0x01
    writeFileSync(made.file, flipped) // the manifest's line now disagrees
    expect(verifyBackup(made.file, priv, { dir })).toEqual({ ok: false, error: DAMAGED })
    const alone = join(temp('alone-'), 'house-20261104T120000Z.db.enc')
    writeFileSync(alone, flipped) // no manifest beside it
    expect(verifyBackup(alone, priv, { dir })).toEqual({ ok: false, error: DAMAGED })
  })

  it('an ORGOSPS1 backup from L5 still restores with its symmetric key', async () => {
    const r = repo(), from = temp('private-a-'), to = temp('private-b-'), backups = temp('backups-')
    const sym = join(temp('sym-'), 'house.key'); createKey(sym)
    const s = await filled(r, from)
    const made = await backup(s, { dir: backups, keyFile: sym, now: NOW })
    expect(readFileSync(made.file).subarray(0, 8).equals(MAGIC)).toBe(true)
    const before = dump(s.file)
    await restore(r, made.file, sym, { dir: to })
    expect(dump(join(to, 'house.db'))).toEqual(before)
    // and a private key against it is a wrong key
    expect(verifyBackup(made.file, keyPair().priv, { dir: to })).toEqual({ ok: false, error: WRONG_KEY })
  })

  it('sealTo: HKDF salt is ephemeral ‖ recipient, info names the format, MAGIC_PK is the additional data', () => {
    const { priv, pub } = keyPair()
    const sealed = sealTo(readFileSync(pub, 'utf8'), Buffer.from('SQLite format 3\0 and the rest'))
    expect(sealed.subarray(0, 8).equals(MAGIC_PK)).toBe(true)
    expect(sealed.length).toBe(8 + 32 + 12 + 29 + 16)
    expect(unseal(readOpeningKey(priv), sealed, () => null).toString('latin1')).toBe('SQLite format 3\0 and the rest')
    // A file that claims the other magic fails as damaged, never as opened.
    const relabelled = Buffer.concat([MAGIC, sealed.subarray(8)])
    expect(() => unseal(readOpeningKey(priv), relabelled, () => false)).toThrow()
  })

  it('a backup public key that is not one is refused in words; a private key in its place too', () => {
    const { priv } = keyPair()
    const junk = join(temp('junk-'), 'backup.pub'); writeFileSync(junk, 'not a key')
    expect(publicKeyRefusal(junk)).toBe(`The backup public key at ${junk} is not an X25519 public key. Make a key pair with npm run house:backup:keypair -- <private file> <public file>, then start again.`)
    expect(publicKeyRefusal(priv)).toBe(`The backup public key at ${priv} is a private key. Only the public key goes to the server; keep the private one on a maintainer's machine, then start again.`)
  })
})

describe('the copy holds no write lock (carry 5, §7.1)', () => {
  it('a backup taken while a write is held open finishes without waiting, and holds only what was committed', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), { pub } = keyPair()
    const s = await filled(r, dir)
    const stuck = vi.fn()
    s.onStuck = stuck
    const t = await s.begin()
    t.putRecord({ collection: 'grievances', id: 'g-3', visibility: 'hat:Ops', body: { note: 'in a transaction' }, rev: 'r1' }, 'steward-a', null)
    const made = await Promise.race([
      backup(s, { dir: backups, publicKeyFile: pub, now: NOW }),
      new Promise<never>((_, no) => setTimeout(() => no(new Error('the backup waited for the open write')), 2_000)),
    ])
    expect(made.counts.records).toBe(1)
    t.commit()
    expect(s.records('grievances').map(x => x.id)).toEqual(['g-1', 'g-3'])
    expect(stuck).not.toHaveBeenCalled()
  })

  it('a write queued during a slow backup (a large store) completes within lockWaitMs', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), { pub } = keyPair()
    const s = await opened(r, dir, 1_000)
    const raw = new DatabaseSync(s.file)
    raw.exec('BEGIN')
    const ins = raw.prepare("INSERT INTO records VALUES ('bulk', ?, 'hat:Ops', ?, 'r1', '2026-11-04T12:00:00.000Z', 'steward-a')")
    const body = JSON.stringify({ note: 'x'.repeat(2_000) })
    for (let i = 0; i < 5_000; i++) ins.run(`b-${i}`, body)
    raw.exec('COMMIT'); raw.close()
    const taking = backup(s, { dir: backups, publicKeyFile: pub, now: NOW })
    const started = Date.now()
    await s.putRecord({ collection: 'grievances', id: 'g-9', visibility: 'hat:Ops', body: { note: 'queued' }, rev: 'r1' }, 'steward-a', null)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect((await taking).counts.records).toBeGreaterThanOrEqual(5_000)
  })
})

describe('leftovers and places (carry 6)', () => {
  it('cleanLeftovers removes .backup-* folders and house.db.restoring-* files, naming each in the log', () => {
    const dir = temp('private-')
    mkdirSync(join(dir, '.backup-x')); writeFileSync(join(dir, '.backup-x', 'house.db'), 'half a copy')
    writeFileSync(join(dir, 'house.db.restoring-y'), 'half a restore')
    writeFileSync(join(dir, 'house.db'), 'the store')
    writeFileSync(join(dir, 'house.db.before-restore-20261101T000000Z'), 'kept on purpose')
    const said: string[] = []
    const gone = cleanLeftovers(dir, l => said.push(l))
    expect(gone.sort()).toEqual([join(dir, '.backup-x'), join(dir, 'house.db.restoring-y')].sort())
    expect(said.sort()).toEqual([
      `Removed ${join(dir, '.backup-x')}, left by a backup that did not finish.`,
      `Removed ${join(dir, 'house.db.restoring-y')}, left by a restore that did not finish.`,
    ].sort())
    expect(readdirSync(dir).sort()).toEqual(['house.db', 'house.db.before-restore-20261101T000000Z'])
    expect(cleanLeftovers(join(dir, 'absent'), l => said.push(l))).toEqual([])
  })

  it('leftovers go at start, and each is logged', async () => {
    const r = repo(), dir = temp('private-')
    mkdirSync(join(dir, '.backup-x'))
    writeFileSync(join(dir, 'house.db.restoring-y'), 'half a restore')
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0 })
    running.push(server)
    expect(existsSync(join(dir, '.backup-x'))).toBe(false)
    expect(existsSync(join(dir, 'house.db.restoring-y'))).toBe(false)
    const lines = log.mock.calls.map(c => String(c[0]))
    expect(lines).toContain(`org-os admin: Removed ${join(dir, '.backup-x')}, left by a backup that did not finish.`)
    expect(lines).toContain(`org-os admin: Removed ${join(dir, 'house.db.restoring-y')}, left by a restore that did not finish.`)
  })

  it('a backup dir inside the repository is refused hosted, and allowed locally only when ignored', async () => {
    const r = repo()
    await expect(checkBackupPlace(r, join(r, 'backups'), true)).rejects.toThrow(INSIDE)
    await expect(checkBackupPlace(r, join(r, 'backups'), false)).rejects.toThrow('The backups would be in backups, which git does not ignore. Add `backups/` to .gitignore first.')
    writeFileSync(join(r, '.gitignore'), 'backups/\n')
    await expect(checkBackupPlace(r, join(r, 'backups'), false)).resolves.toBeUndefined()
    await expect(checkBackupPlace(r, join(r, 'backups'), true)).rejects.toThrow(INSIDE)
    await expect(checkBackupPlace(r, r, false)).rejects.toThrow(/at the root of the repository/)
    const outside = temp('backups-')
    await expect(checkBackupPlace(r, outside, true)).resolves.toBeUndefined()
    await expect(checkBackupPlace(r, outside, false)).resolves.toBeUndefined()
  })

  it('the server refuses to back up into a folder inside the repository that git does not ignore', async () => {
    const r = repo(), dir = temp('private-'), { pub } = keyPair()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_PUBLIC_KEY_FILE', pub)
    vi.stubEnv('ORG_OS_BACKUP_DIR', join(r, 'backups'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0, backupEveryMs: 60_000 })
    running.push(server)
    expect(await attentionOf(server.port, 'absent:server:backup', t => t !== null))
      .toBe('The private store was not backed up: The backups would be in backups, which git does not ignore. Add `backups/` to .gitignore first.')
    expect(existsSync(join(r, 'backups'))).toBe(false)
  })

  it('the pid file is found through a symlink', async () => {
    const r = repo(), dir = temp('private-'), links = temp('links-')
    const link = join(links, 'link')
    symlinkSync(r, link)
    expect(stateDir(link)).toBe(stateDir(r))
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    const server = await startServer({ repo: link, port: 0 })
    running.push(server)
    expect(readFileSync(serverPidFile(r), 'utf8').trim()).toBe(String(process.pid))
    // a path that does not exist still has a state folder (its string, as before)
    expect(stateDir(join(links, 'absent'))).toMatch(/absent-[0-9a-f]{6}$/)
    // runningServer never names this process: through either path it reads the same file
    expect(runningServer(r)).toBeNull()
    expect(serverPidFile(link)).toBe(serverPidFile(r))
  })
})

describe('the server: hosted backups need a public key (§7.1 attention)', () => {
  it('hosted with no public key: Home\'s attention "The private store was not backed up: …", a symmetric key notwithstanding', async () => {
    const r = repo(), dir = temp('private-')
    const A1 = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    writeFileSync(join(r, 'data', 'members.yaml'), MEMBERS_YAML.replace('git: ["admin-test@local"]', `git: ["admin-test@local"]\n      wallet: ["${A1}"]`))
    const sym = join(temp('sym-'), 'house.key'); createKey(sym)
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_KEY_FILE', sym) // the server never holds what opens its backups
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const server = await startServer({ repo: r, port: 0, hosted: true, backupEveryMs: 40 })
    running.push(server)
    const { token } = await createSession(server.privateStore!, A1, () => new Date())
    expect(await attentionOf(server.port, 'absent:server:backup', t => t !== null, `house_session=${token}`)).toBe(NO_PUBLIC_KEY)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('hosted with a public key: the backups are sealed to it', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), { priv, pub } = keyPair()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_DIR', backups)
    vi.stubEnv('ORG_OS_BACKUP_PUBLIC_KEY_FILE', pub)
    const server = await startServer({ repo: r, port: 0, hosted: true, backupEveryMs: 60_000 })
    running.push(server)
    for (let i = 0; i < 200 && !existsSync(join(backups, 'manifest.jsonl')); i++) await new Promise(res => setTimeout(res, 25))
    const file = readdirSync(backups).find(f => f.endsWith('.db.enc'))!
    expect(readFileSync(join(backups, file)).subarray(0, 8).equals(MAGIC_PK)).toBe(true)
    expect(verifyBackup(join(backups, file), priv, { dir: temp('verify-') })).toMatchObject({ ok: true })
  })
})

describe('the commands: keypair, and the two key variables', () => {
  it('keypair, backup to the public key, --verify and restore with the private key', async () => {
    const r = repo(), dir = temp('private-'), backups = temp('backups-'), keys = temp('keys-')
    await filled(r, dir)
    for (const s of open.splice(0)) s.close()
    vi.stubEnv('ORG_OS_PRIVATE_DIR', dir)
    vi.stubEnv('ORG_OS_BACKUP_DIR', backups)
    const out: string[] = [], err: string[] = []
    const io = { repo: r, out: (t: string) => out.push(t), err: (t: string) => err.push(t) }
    const priv = join(keys, 'backup.key'), pub = join(keys, 'backup.pub')
    expect(await main(['keypair', priv, pub], io)).toBe(0)
    expect(out.pop()).toBe(`A key pair was made: the private key at ${priv}, the public key at ${pub}.\nOnly the public key goes to the server. Keep the private key, and a copy of it, away from the server: without it no backup can be read.`)
    expect(await main(['keypair', priv, pub], io)).toBe(1)
    expect(err.pop()).toBe(`There is already a key at ${priv}; it was left as it is.`)
    expect(await main(['keypair', priv], io)).toBe(1)
    expect(err.pop()).toBe('Name both files: npm run house:backup:keypair -- <private file> <public file>')

    vi.stubEnv('ORG_OS_BACKUP_PUBLIC_KEY_FILE', pub)
    expect(await main(['backup'], io)).toBe(0)
    const made = join(backups, readdirSync(backups).find(f => f.endsWith('.db.enc'))!)
    expect(readFileSync(made).subarray(0, 8).equals(MAGIC_PK)).toBe(true)
    expect(await main(['backup', '--verify', made], io)).toBe(1)
    expect(err.pop()).toBe('Name the private key: set ORG_OS_BACKUP_PRIVATE_KEY_FILE to it for this run.')
    vi.stubEnv('ORG_OS_BACKUP_PRIVATE_KEY_FILE', priv)
    expect(await main(['backup', '--verify', made], io)).toBe(0)
    expect(out.pop()).toMatch(/can be restored: schema 2; rows: /)
    expect(await main(['restore', made], io)).toBe(0)
    expect(out.pop()).toMatch(/^Restored .*house\.db; the file it replaced is kept as /)
    expect(err).toEqual([])
  })

  it('keypair refuses a private key inside the repository', async () => {
    const r = repo()
    const err: string[] = []
    const io = { repo: r, out: () => {}, err: (t: string) => err.push(t) }
    expect(await main(['keypair', join(r, 'backup.key'), join(temp('k-'), 'backup.pub')], io)).toBe(1)
    expect(err.pop()).toBe('Keep the key outside the repository, or a commit can carry it.')
    expect(existsSync(join(r, 'backup.key'))).toBe(false)
  })
})

function resources(port: number, cookie?: string): Promise<{ id: string; attention: { level: string; text: string } | null }[]> {
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
