// The hosted Hub's entrypoint (L9 spec §6, Task 17), the container's `hub <verb>`:
//
//   hub serve                    (default) every start check, then the server, hosted
//   hub check                    every start check of §5.1 and rule 4, one sentence each, never a value; then exit
//   hub init <remote url>        clone the instance into an empty folder, with the deploy key GIT_SSH_COMMAND names
//   hub backup [--verify <file>] a backup now, sealed to the public key; or everything a restore does but the move
//   hub restore <file>           with the server stopped; the private key named for that run only
//
// The instance is --repo <path>, else /srv/instance. `portal:build` (§4.1) joins once Task 14's portal command exists.
// Exit codes: 0 done; 1 a verb that failed or was used wrongly; 2 a start check that refused.
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { keyModeRefusal, nodeRefusal, readHostedConfig, type HostedConfig } from '../server/hosted/config.ts'
import { publicKeyRefusal } from '../server/private/crypto.ts'
import { checkRemote } from '../server/visibility/remote.ts'
import { cloneInstance } from '../server/git.ts'
import { networkFetch, startServer } from '../server/serve.ts'
import type { FetchLike } from '../server/systems/driver.ts'
import { main as houseBackup } from './house-backup.ts'

export interface HubIo {
  out(t: string): void
  err(t: string): void
  env: NodeJS.ProcessEnv
  /** Tests pass a fake; the default is the server's one network call (`networkFetch`), which rule 4's check uses. */
  fetch?: FetchLike
}

/** Where the container keeps the instance, and the jobs and layouts (`ORG_OS_ADMIN_HOME`), unless told otherwise. */
export const INSTANCE_DIR = '/srv/instance'
export const STATE_DIR = '/srv/state'

const USAGE = 'Use one of: hub serve, hub check, hub init <remote url>, hub backup [--verify <file>], hub restore <file> (each with --repo <path> when the instance is not at /srv/instance).'

/** The folder a path would be made in: the path itself when it exists, else its nearest existing parent. */
function nearestExisting(path: string): string {
  let p = resolve(path)
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p)
  return p
}
const writable = (path: string): boolean => {
  try { accessSync(nearestExisting(path), constants.W_OK); return true } catch { return false }
}

/** Every start check, in §5.1's order, as one sentence each (a passed check says so in fixed words; a refusal is the
 *  check's own §10 sentence). The configuration when every check passed, else null. */
async function check(repo: string, io: HubIo): Promise<HostedConfig | null> {
  let ok = true
  const pass = (t: string) => io.out(t)
  const fail = (t: string) => { ok = false; io.err(t) }

  const old = nodeRefusal(process.versions.node)
  if (old) { fail(old); return null } else pass('Node: this Hub runs on Node 22.13 or later, as the private store needs.')

  const read = readHostedConfig(io.env, repo)
  if ('refuse' in read) { fail(read.refuse); return null }
  const config = read.config
  for (const w of read.warnings) io.err(`Configuration: ${w}`)
  pass('Configuration: the members\' address and every setting read as they should.')

  if (!existsSync(resolve(repo, 'data')) || !existsSync(resolve(repo, 'federation.yaml'))) {
    fail('Instance: there is no org-os instance in the instance folder yet. Clone it with hub init <remote url>, then start again.')
    return null
  }
  pass('Instance: the instance folder holds an org-os instance.')

  // The deploy key and the backup public key: files the Hub's user alone may read, and a public key that is one.
  if (config.deployKeyFile) {
    if (!existsSync(config.deployKeyFile)) fail('Keys: the deploy key GIT_SSH_COMMAND names is not there. Mount it, then start again.')
    else { const bad = keyModeRefusal(config.deployKeyFile, statSync); if (bad) fail(bad) }
  }
  if (config.backupPublicKeyFile && existsSync(config.backupPublicKeyFile)) {
    const bad = publicKeyRefusal(config.backupPublicKeyFile)
    if (bad) fail(bad)
  }
  if (ok) {
    pass(config.deployKeyFile ? 'Keys: the deploy key can be read by the Hub\'s user only.' : 'Keys: no deploy key is named; the Hub reaches its remote without one.')
    pass(config.backupPublicKeyFile && existsSync(config.backupPublicKeyFile)
      ? 'Keys: the backup public key is an X25519 public key.'
      : 'Keys: no backup public key is mounted, so the private store will not be backed up until one is (Home says so).')
  }

  // The folders the Hub writes: each where the Hub's user can write (or make) it. None may be in the repository: the
  // configuration has already refused that.
  const folders: [string, string][] = [
    ['ORG_OS_PRIVATE_DIR', config.privateDir], ['ORG_OS_BACKUP_DIR', config.backupDir], ['ORG_OS_PORTAL_DIR', config.portalDir],
    ['ORG_OS_ADMIN_HOME', io.env.ORG_OS_ADMIN_HOME?.trim() || STATE_DIR],
  ]
  const unwritable = folders.filter(([, dir]) => !writable(dir))
  for (const [name] of unwritable) fail(`Folders: ${name} cannot be written by the Hub's user. Give that user the folder, then start again.`)
  if (unwritable.length === 0) pass('Folders: the private store, backup, portal and state folders can be written.')
  if (!writable(repo)) fail('Folders: the instance folder cannot be written by the Hub\'s user. Give that user the folder, then start again.')

  // Rule 4 (L5 §12, L9 §5.7): last, as at start.
  const remote = await checkRemote(repo, { hosted: true, fetch: io.fetch ?? networkFetch, env: io.env })
  if (remote.refuse) fail(remote.refuse)
  else pass('Rule 4: the repository\'s remote is not public.')

  return ok ? config : null
}

/** The variables `house:backup` reads, for a hosted Hub: the configuration's folders and public key by default (§5.1), and
 *  never the symmetric key (the server must not hold what opens its backups). */
function backupEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  out.ORG_OS_PRIVATE_DIR = env.ORG_OS_PRIVATE_DIR?.trim() || '/srv/private'
  out.ORG_OS_BACKUP_DIR = env.ORG_OS_BACKUP_DIR?.trim() || '/srv/backups'
  out.ORG_OS_BACKUP_PUBLIC_KEY_FILE = env.ORG_OS_BACKUP_PUBLIC_KEY_FILE?.trim() || '/run/secrets/backup.pub'
  delete out.ORG_OS_BACKUP_KEY_FILE
  return out
}

/** The state folder the server's pid file is under: the variable, else the container's. Set in this process too, since
 *  the server and `restore`'s check read it from there. */
function useStateDir(env: NodeJS.ProcessEnv): void {
  const dir = env.ORG_OS_ADMIN_HOME?.trim() || STATE_DIR
  env.ORG_OS_ADMIN_HOME = dir
  process.env.ORG_OS_ADMIN_HOME ??= dir
}

/** Runs one verb; answers the exit code. Everything said goes through `io`. */
export async function main(argv: string[], io: HubIo): Promise<number> {
  const args = [...argv]
  const at = args.indexOf('--repo')
  const repo = resolve(at >= 0 && args[at + 1] ? args.splice(at, 2)[1]! : INSTANCE_DIR)
  const [verb = 'serve', ...rest] = args
  try {
    if (verb === 'check') return (await check(repo, io)) ? 0 : 2

    if (verb === 'serve') {
      const config = await check(repo, io)
      if (!config) return 2
      useStateDir(io.env)
      const appDist = fileURLToPath(new URL('../app/dist', import.meta.url))
      const running = await startServer({ repo, port: config.port, appDist, hosted: true, hostedConfig: config, fetch: io.fetch ?? networkFetch })
      io.out(`The Hub is serving the instance, hosted, on port ${running.port}.`)
      // Ending the server ends its jobs and its push first (close does it). A second signal while that waits: leave.
      return await new Promise<number>(done => {
        let stopping = false
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
          process.on(signal, () => {
            if (stopping) process.exit(1)
            stopping = true
            io.err('The Hub is stopping.')
            running.close().then(() => done(0), () => done(1))
          })
        }
      })
    }

    if (verb === 'init') {
      const url = rest[0]
      if (!url) { io.err('Name the remote to clone: hub init <remote url>'); return 1 }
      if (existsSync(repo) && readdirSync(repo).length > 0) {
        io.err('The instance folder is not empty, so nothing was cloned. Give hub init an empty folder (or one that does not exist yet).')
        return 1
      }
      await cloneInstance(url, repo)
      io.out('The instance was cloned. Check it with hub check, then start the Hub with hub serve.')
      return 0
    }

    if (verb === 'backup' || verb === 'restore') {
      useStateDir(io.env)
      return await houseBackup([verb, ...rest], { repo, out: t => io.out(t), err: t => io.err(t), env: backupEnv(io.env), hosted: true })
    }

    io.err(USAGE)
    return 1
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), { out: t => console.log(t), err: t => console.error(t), env: process.env })
}
