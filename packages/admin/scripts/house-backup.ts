// The private store's backup, from the command line (L5 spec §10.4):
//
//   npm run house:backup:keypair -- <private file> <public file>   make a maintainer's key pair, once (L9 §7.1)
//   npm run house:backup:key -- <file>        make a symmetric key file (mode 600), once (L5, local)
//   npm run house:backup                      take a backup now
//   npm run house:backup -- --verify <file>   everything a restore does but the move
//   npm run house:restore -- <file>           restore, with the server for this repository stopped
//
// The repository is --repo <path>, else the folder npm was run from. A backup is sealed to ORG_OS_BACKUP_PUBLIC_KEY_FILE
// when it is set, else under ORG_OS_BACKUP_KEY_FILE. --verify and restore open it with ORG_OS_BACKUP_PRIVATE_KEY_FILE
// (set for that one run; the server never reads it), else ORG_OS_BACKUP_KEY_FILE. Backups go to ORG_OS_BACKUP_DIR, else
// <private dir>/backups.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backup, checkBackupPlace, checkKeyPlace, createKey, createKeyPair, restore, verifyBackup } from '../server/private/backup.ts'
import { privateDir } from '../server/private/paths.ts'
import { checkStorePlace, openPrivateStore } from '../server/private/store.ts'

/** `hosted`: run for a hosted Hub (`hub backup`, `hub restore`): the backup folder may not be inside the repository at all
 *  (L9 §7.1). */
export interface Io { repo: string; out: (text: string) => void; err: (text: string) => void; env?: NodeJS.ProcessEnv; hosted?: boolean }

const rows = (counts: Record<string, number>) => Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')

/** Runs one verb; answers the exit code. Everything said goes through `io`. */
export async function main(argv: string[], io: Io): Promise<number> {
  const env = io.env ?? process.env
  const repo = resolve(io.repo)
  const store = privateDir(repo, env)
  const backupDir = env.ORG_OS_BACKUP_DIR?.trim() ? resolve(repo, env.ORG_OS_BACKUP_DIR) : resolve(store, 'backups')
  const named = (k: string) => env[k]?.trim() ? resolve(repo, env[k]!) : null
  const keyFromEnv = named('ORG_OS_BACKUP_KEY_FILE')
  const publicKey = named('ORG_OS_BACKUP_PUBLIC_KEY_FILE')
  const privateKey = named('ORG_OS_BACKUP_PRIVATE_KEY_FILE')
  const noKey = 'Name the key: set ORG_OS_BACKUP_PUBLIC_KEY_FILE to the public key (make a pair with npm run house:backup:keypair -- <private file> <public file>), or ORG_OS_BACKUP_KEY_FILE to a key file.'
  // What opens a backup: the private key, for this run only; else L5's key file. With a public key set and neither, the
  // private key is what is missing.
  const opening = privateKey ?? keyFromEnv
  const noOpening = publicKey && !keyFromEnv
    ? 'Name the private key: set ORG_OS_BACKUP_PRIVATE_KEY_FILE to it for this run.'
    : 'Name the key that opens the backup: set ORG_OS_BACKUP_PRIVATE_KEY_FILE to the private key for this run, or ORG_OS_BACKUP_KEY_FILE to the key file.'
  const [verb, ...rest] = argv
  try {
    if (verb === 'keypair') {
      if (!rest[0] || !rest[1]) { io.err('Name both files: npm run house:backup:keypair -- <private file> <public file>'); return 1 }
      const priv = resolve(repo, rest[0]), pub = resolve(repo, rest[1])
      checkKeyPlace(priv, { storeDir: store, backupDir, repo })
      createKeyPair(priv, pub)
      io.out(`A key pair was made: the private key at ${priv}, the public key at ${pub}.\nOnly the public key goes to the server. Keep the private key, and a copy of it, away from the server: without it no backup can be read.`)
      return 0
    }
    if (verb === 'key') {
      const file = rest[0] ? resolve(repo, rest[0]) : keyFromEnv
      if (!file) { io.err('Name the file for the key: npm run house:backup:key -- <file>'); return 1 }
      checkKeyPlace(file, { storeDir: store, backupDir, repo })
      createKey(file)
      io.out(`A key was made at ${file}.\nKeep a copy of this key away from this machine. Without it no backup can be read.`)
      return 0
    }
    if (verb === 'backup' && rest[0] === '--verify') {
      if (!rest[1]) { io.err('Name the backup to verify: npm run house:backup -- --verify <file>'); return 1 }
      if (!opening) { io.err(noOpening); return 1 }
      const file = resolve(repo, rest[1])
      // The check opens the backup in the store's folder: only where §10.1 lets a store be, or nothing is written.
      await checkStorePlace(repo, store)
      const read = verifyBackup(file, opening, { dir: store })
      if (!read.ok) { io.err(read.error); return 1 }
      io.out(`${file} can be restored: schema ${read.version}; rows: ${rows(read.counts)}.`)
      return 0
    }
    if (verb === 'backup') {
      if (!publicKey && !keyFromEnv) { io.err(noKey); return 1 }
      await checkBackupPlace(repo, backupDir, io.hosted ?? false)
      const opened = await openPrivateStore(repo, { dir: store })
      try {
        const key = publicKey ? { publicKeyFile: publicKey } : { keyFile: keyFromEnv! }
        const made = await backup(opened, { dir: backupDir, ...key, now: new Date(), repo })
        io.out(`Backed up to ${made.file}\nsha256 ${made.sha256}\nrows: ${rows(made.counts)}`)
      } finally { opened.close() }
      return 0
    }
    if (verb === 'restore') {
      if (!rest[0]) { io.err('Name the backup to restore: npm run house:restore -- <file>'); return 1 }
      if (!opening) { io.err(noOpening); return 1 }
      const done = await restore(repo, resolve(repo, rest[0]), opening, { dir: store })
      io.out(done.kept
        ? `Restored ${done.restored}; the file it replaced is kept as ${done.kept}.`
        : `Restored ${done.restored}; there was no store before it.`)
      return 0
    }
    io.err('Use one of: npm run house:backup:keypair -- <private file> <public file>, npm run house:backup:key -- <file>, npm run house:backup [-- --verify <file>], npm run house:restore -- <file>')
    return 1
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--repo')
  const repo = at >= 0 && args[at + 1] ? args.splice(at, 2)[1]! : process.env.INIT_CWD ?? process.cwd()
  process.exitCode = await main(args, { repo, out: t => console.log(t), err: t => console.error(t) })
}
