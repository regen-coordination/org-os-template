// The hub entrypoint (L9 spec §6, Task 17 as trimmed for the reference deployment on a container service): check, init,
// backup and restore. Fresh fixture repositories and temporary folders; no network (ruling S13): rule 4's check gets a
// fetch that refuses, and the fixtures have no remote, so it asks nothing.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo } from '../fixtures.ts'
import { main } from '../../scripts/hub.ts'
import { createKeyPair } from '../../server/private/crypto.ts'
import { serverPidFile, stateDir } from '../../server/state.ts'

const cleanup: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  for (const c of children.splice(0)) { try { if (c.pid) process.kill(c.pid) } catch { /* gone */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const repo = () => { const r = makeFixtureRepo(); cleanup.push(r); return r }
const noNetwork = async () => { throw new Error('no network in this test') }

function run(argv: string[], env: NodeJS.ProcessEnv) {
  const out: string[] = [], err: string[] = []
  return main(argv, { out: t => out.push(t), err: t => err.push(t), env, fetch: noNetwork }).then(code => ({ code, out, err }))
}

/** A good hosted configuration, every folder and key under `root`, the names holding sentinels. */
function goodEnv(root: string): NodeJS.ProcessEnv {
  const keys = join(root, 'SENTINEL-secrets-1'); mkdirSync(keys)
  const deployKey = join(keys, 'SENTINEL-deploy-key-1'); writeFileSync(deployKey, 'not a real key'); chmodSync(deployKey, 0o400)
  const pub = join(keys, 'SENTINEL-backup-pub-1'); createKeyPair(join(temp('maintainer-'), 'backup.key'), pub)
  return {
    ORG_OS_PUBLIC_ORIGIN: 'https://sentinel-origin-1.example.org',
    ORG_OS_PRIVATE_DIR: join(root, 'SENTINEL-private-1'), ORG_OS_BACKUP_DIR: join(root, 'SENTINEL-backups-1'),
    ORG_OS_PORTAL_DIR: join(root, 'SENTINEL-portal-1'), ORG_OS_ADMIN_HOME: join(root, 'SENTINEL-state-1'),
    ORG_OS_BACKUP_PUBLIC_KEY_FILE: pub, ORG_OS_PUSH: 'off', ORG_OS_TRUST_PROXY: 'on', PORT: '4681',
    GIT_SSH_COMMAND: `ssh -i ${deployKey} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes`,
  }
}

const PASSED = [
  'Node: this Hub runs on Node 22.13 or later, as the private store needs.',
  'Configuration: the members\' address and every setting read as they should.',
  'Instance: the instance folder holds an org-os instance.',
  'Keys: the deploy key can be read by the Hub\'s user only.',
  'Keys: the backup public key is an X25519 public key.',
  'Folders: the private store, backup, portal and state folders can be written.',
  'Rule 4: the repository\'s remote is not public.',
]

describe('hub check', () => {
  it('with a good configuration prints each check passed and exits 0; with a missing origin, exits 2 with the sentence', async () => {
    const r = repo(), env = goodEnv(temp('hub-'))
    expect(await run(['check', '--repo', r], env)).toEqual({ code: 0, out: PASSED, err: [] })
    const { ORG_OS_PUBLIC_ORIGIN: _, ...noOrigin } = env
    expect(await run(['check', '--repo', r], noOrigin)).toEqual({
      code: 2, out: [PASSED[0]],
      err: ['A hosted Hub needs its address: set ORG_OS_PUBLIC_ORIGIN to https:// and the members\' host, then start again.'],
    })
  })

  it('check output holds no env value (the values are sentinels; none is printed)', async () => {
    const r = repo(), env = goodEnv(temp('hub-'))
    const { out, err } = await run(['check', '--repo', r], env)
    const said = [...out, ...err].join('\n')
    expect(said.toLowerCase()).not.toContain('sentinel')
    for (const v of Object.values(env)) if (v && v.length > 3) expect(said).not.toContain(v)
    // and with no backup key mounted, still no value
    const { out: out2 } = await run(['check', '--repo', r], { ...env, ORG_OS_BACKUP_PUBLIC_KEY_FILE: join(temp('k-'), 'SENTINEL-missing-1') })
    expect(out2).toContain('Keys: no backup public key is mounted, so the private store will not be backed up until one is (Home says so).')
    expect(out2.join('\n').toLowerCase()).not.toContain('sentinel')
  })

  it('refuses an instance folder with no instance, a deploy key others can read, and a private key as the backup key', async () => {
    const root = temp('hub-'), env = goodEnv(root)
    const empty = join(root, 'instance'); mkdirSync(empty)
    const none = await run(['check', '--repo', empty], env)
    expect(none.code).toBe(2)
    expect(none.err).toEqual(['Instance: there is no org-os instance in the instance folder yet. Clone it with hub init <remote url>, then start again.'])
    const r = repo()
    const loose = join(root, 'loose_key'); writeFileSync(loose, 'x'); chmodSync(loose, 0o644)
    const bad = await run(['check', '--repo', r], { ...env, GIT_SSH_COMMAND: `ssh -i ${loose}` })
    expect(bad.code).toBe(2)
    expect(bad.err).toEqual([`The key at ${loose} can be read by others than the Hub's user. Make it readable by that user only (chmod 400), then start again.`])
    const priv = join(temp('k-'), 'backup.key'); createKeyPair(priv, join(temp('k-'), 'backup.pub'))
    const swapped = await run(['check', '--repo', r], { ...env, ORG_OS_BACKUP_PUBLIC_KEY_FILE: priv })
    expect(swapped.code).toBe(2)
    expect(swapped.err[0]).toMatch(/is a private key\. Only the public key goes to the server/)
    const typo = await run(['check', '--repo', r], { ...env, ORG_OS_TRUST_PROXY: 'X-Real-IP' })
    expect(typo).toMatchObject({ code: 2, err: ['ORG_OS_TRUST_PROXY is "X-Real-IP", not on or off.'] })
  })

  it('serve runs every check first: a missing origin stops it with exit 2 before anything listens', async () => {
    const r = repo()
    const res = await run(['serve', '--repo', r], {})
    expect(res.code).toBe(2)
    expect(res.err[0]).toMatch(/^A hosted Hub needs its address/)
  })
})

describe('hub init', () => {
  it('init refuses a non-empty folder', async () => {
    const dir = temp('instance-'); writeFileSync(join(dir, 'something'), 'x')
    const res = await run(['init', '/srv/remote.git', '--repo', dir], {})
    expect(res).toEqual({ code: 1, out: [], err: ['The instance folder is not empty, so nothing was cloned. Give hub init an empty folder (or one that does not exist yet).'] })
    expect(readdirSync(dir)).toEqual(['something'])
    expect(await run(['init', '--repo', dir], {})).toMatchObject({ code: 1, err: ['Name the remote to clone: hub init <remote url>'] })
  })

  it('init clones a local bare remote into an empty folder', async () => {
    const src = repo(), root = temp('remotes-')
    const bare = join(root, 'instance.git')
    execFileSync('git', ['clone', '-q', '--bare', src, bare])
    const target = join(root, 'srv', 'instance')
    const res = await run(['init', bare, '--repo', target], { ...process.env })
    expect(res).toEqual({ code: 0, out: ['The instance was cloned. Check it with hub check, then start the Hub with hub serve.'], err: [] })
    expect(existsSync(join(target, 'data', 'members.yaml'))).toBe(true)
    expect(existsSync(join(target, 'federation.yaml'))).toBe(true)
    // and an empty folder that exists is taken too
    const empty = join(root, 'empty'); mkdirSync(empty)
    expect((await run(['init', bare, '--repo', empty], { ...process.env })).code).toBe(0)
    // a url git would read as an option is refused by the vocabulary, before git runs
    const flag = await run(['init', '--upload-pack=touch', '--repo', join(root, 'other')], { ...process.env })
    expect(flag.code).toBe(1)
    expect(flag.err[0]).toMatch(/^git guardrail: refusing to run git clone/)
  })
})

describe('hub backup and restore', () => {
  it('restore refuses while a server\'s pid is live', async () => {
    const r = repo(), root = temp('hub-')
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    children.push(child)
    mkdirSync(stateDir(r), { recursive: true })
    writeFileSync(serverPidFile(r), String(child.pid))
    const res = await run(['restore', join(root, 'house-20261104T120000Z.db.enc'), '--repo', r], {
      ...process.env, ORG_OS_PRIVATE_DIR: join(root, 'private'), ORG_OS_BACKUP_PRIVATE_KEY_FILE: join(root, 'backup.key'),
    })
    expect(res).toEqual({ code: 1, out: [], err: ['Stop the server for this repository first.'] })
  })

  it('backup seals to the public key into the backup folder; the symmetric key is never used; verify needs the private key', async () => {
    const r = repo(), root = temp('hub-')
    const priv = join(temp('maintainer-'), 'backup.key'), pub = join(root, 'backup.pub')
    createKeyPair(priv, pub)
    const env = { ...process.env, ORG_OS_PRIVATE_DIR: join(root, 'private'), ORG_OS_BACKUP_DIR: join(root, 'backups'), ORG_OS_BACKUP_PUBLIC_KEY_FILE: pub, ORG_OS_BACKUP_KEY_FILE: join(root, 'unused.key') }
    const made = await run(['backup', '--repo', r], env)
    expect(made.code).toBe(0)
    const file = join(root, 'backups', readdirSync(join(root, 'backups')).find(f => f.endsWith('.db.enc'))!)
    expect(made.out[0]!.split('\n')[0]).toBe(`Backed up to ${file}`)
    expect(await run(['backup', '--verify', file, '--repo', r], env)).toMatchObject({ code: 1, err: ['Name the private key: set ORG_OS_BACKUP_PRIVATE_KEY_FILE to it for this run.'] })
    const verified = await run(['backup', '--verify', file, '--repo', r], { ...env, ORG_OS_BACKUP_PRIVATE_KEY_FILE: priv })
    expect(verified.code).toBe(0)
    // a backup folder inside the repository is refused, hosted
    expect(await run(['backup', '--repo', r], { ...env, ORG_OS_BACKUP_DIR: join(r, 'backups') }))
      .toMatchObject({ code: 1, err: ['ORG_OS_BACKUP_DIR is inside the repository. Put it on its own volume, then start again.'] })
  })

  it('an unknown verb names the verbs', async () => {
    const res = await run(['portal:build'], {})
    expect(res.code).toBe(1)
    expect(res.err[0]).toMatch(/^Use one of: hub serve, hub check, hub init <remote url>, hub backup \[--verify <file>\], hub restore <file>/)
  })
})
