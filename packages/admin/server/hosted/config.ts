// The hosted configuration and its start checks (L9 spec §5.1, §10). Read only when the Hub runs hosted; local mode
// never calls `readHostedConfig` and behaves as it always has. Every refusal is a sentence, never a value.
import { isAbsolute, relative, resolve } from 'node:path'
import { parseEvery, MAX_EVERY_MS } from '../private/backup.ts'
import { SIGN_IN_ENV } from '../session/config.ts'

/** The oldest Node the Hub runs on: the private store uses node:sqlite (carry 4). */
export const NODE_FLOOR = '22.13.0'

/** Every variable hosted mode reads (§5.1's table, and the emailed-link sign-in's, Lane 3 Task 4). The deploy
 *  `env.example` is checked against this list. */
export const HOSTED_ENV = [
  'ORG_OS_HOSTED', 'ORG_OS_PUBLIC_ORIGIN', 'ORG_OS_DOOR_ORIGIN', 'ORG_OS_BIND', 'PORT', 'ORG_OS_TRUST_PROXY',
  'ORG_OS_DOOR_DIR', 'ORG_OS_DOOR_EVERY', 'ORG_OS_PUSH', 'ORG_OS_PRIVATE_DIR', 'ORG_OS_BACKUP_DIR',
  'ORG_OS_BACKUP_EVERY', 'ORG_OS_BACKUP_KEEP', 'ORG_OS_BACKUP_PUBLIC_KEY_FILE', 'ORG_OS_ADMIN_HOME',
  'ORG_OS_REMOTE_PRIVATE', 'ORG_OS_RPC', 'GIT_SSH_COMMAND',
  // The writes-off switch (Lane 3 Task 11): read by startServer (hosted/instance-writes.ts), named here for the deploy example.
  'HOUSE_INSTANCE_WRITES',
  ...SIGN_IN_ENV,
] as const

export interface HostedConfig {
  /** `ORG_OS_PUBLIC_ORIGIN`, without a trailing slash, and its host. */
  origin: string
  host: string
  doorOrigin: string | null
  bind: string
  port: number
  trustProxy: boolean
  doorDir: string
  /** null: no timer (the door is refreshed by hand). */
  doorEveryMs: number | null
  push: boolean
  privateDir: string
  backupDir: string
  backupEveryMs: number
  backupKeep: number
  backupPublicKeyFile: string | null
  /** The `-i` of `GIT_SSH_COMMAND`, for the mode check. */
  deployKeyFile: string | null
}

const ADDRESS = 'A hosted Hub needs its address: set ORG_OS_PUBLIC_ORIGIN to https:// and the members\' host, then start again.'
const SAME_HOST = 'The door and the members\' side need two hosts: ORG_OS_DOOR_ORIGIN and ORG_OS_PUBLIC_ORIGIN are the same.'

/** An `https://<host>` origin with no path, query, fragment or credentials; its normal form, or null. */
function httpsOrigin(text: string): { origin: string; host: string } | null {
  let u: URL
  try { u = new URL(text.trim()) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null
  return { origin: u.origin, host: u.host }
}

/** True when `path` (relative ones resolved against the repository) is the repository or anywhere under it. The one
 *  check every hosted folder goes through. */
export function folderInsideRepo(path: string, repo: string): boolean {
  const rel = relative(resolve(repo), resolve(repo, path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const inside = (name: string) => `${name} is inside the repository. Put it on its own volume, then start again.`

/** A switch's words: on (`on`, `1`, `true`, `yes`), off (`off`, `0`, `false`, `no`), in any case; null for anything else. */
const onOff = (text: string): boolean | null =>
  /^(on|1|true|yes)$/i.test(text) ? true : /^(off|0|false|no)$/i.test(text) ? false : null

/** The configuration, or the sentence that stops the start. */
export function readHostedConfig(env: Record<string, string | undefined>, repo: string): { config: HostedConfig } | { refuse: string } {
  const get = (k: string): string | undefined => env[k]?.trim() ? env[k]!.trim() : undefined

  const pub = get('ORG_OS_PUBLIC_ORIGIN') ? httpsOrigin(get('ORG_OS_PUBLIC_ORIGIN')!) : null
  if (!pub) return { refuse: ADDRESS }

  let doorOrigin: string | null = null
  if (get('ORG_OS_DOOR_ORIGIN')) {
    const door = httpsOrigin(get('ORG_OS_DOOR_ORIGIN')!)
    if (!door) return { refuse: 'ORG_OS_DOOR_ORIGIN must be https:// and the door\'s host, with no path, then start again.' }
    if (door.host === pub.host) return { refuse: SAME_HOST }
    doorOrigin = door.origin
  }

  const portText = get('PORT') ?? '4680'
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { refuse: `PORT is "${portText}", not a port number.` }

  const doorEveryText = get('ORG_OS_DOOR_EVERY') ?? '1h'
  let doorEveryMs: number | null = null
  if (!/^(off|0)$/i.test(doorEveryText)) {
    doorEveryMs = parseEvery(doorEveryText)
    if (doorEveryMs === null || doorEveryMs > MAX_EVERY_MS) return { refuse: `ORG_OS_DOOR_EVERY is "${doorEveryText}", not a time such as 1h (or off).` }
  }

  const backupEveryText = get('ORG_OS_BACKUP_EVERY') ?? '6h'
  const backupEveryMs = parseEvery(backupEveryText)
  if (backupEveryMs === null || backupEveryMs > MAX_EVERY_MS) return { refuse: `ORG_OS_BACKUP_EVERY is "${backupEveryText}", not a time such as 6h.` }

  const keepText = get('ORG_OS_BACKUP_KEEP') ?? '14'
  const backupKeep = Number(keepText)
  if (!Number.isInteger(backupKeep) || backupKeep < 1) return { refuse: `ORG_OS_BACKUP_KEEP is "${keepText}", not a whole number of backups to keep.` }

  const doorDir = resolve(repo, get('ORG_OS_DOOR_DIR') ?? '/srv/door')
  const privateDir = resolve(repo, get('ORG_OS_PRIVATE_DIR') ?? '/srv/private')
  const backupDir = resolve(repo, get('ORG_OS_BACKUP_DIR') ?? '/srv/backups')
  for (const [name, dir] of [['ORG_OS_DOOR_DIR', doorDir], ['ORG_OS_PRIVATE_DIR', privateDir], ['ORG_OS_BACKUP_DIR', backupDir]] as const) {
    if (folderInsideRepo(dir, repo)) return { refuse: inside(name) }
  }

  // A switch fails closed: a value that is neither on nor off stops the start, so a typo never leaves the push on, or
  // the client address read from a header the switch meant to ignore (Task 8).
  const push = onOff(get('ORG_OS_PUSH') ?? 'on')
  if (push === null) return { refuse: `ORG_OS_PUSH is "${get('ORG_OS_PUSH')}", not on or off.` }
  const trustProxy = onOff(get('ORG_OS_TRUST_PROXY') ?? 'on')
  if (trustProxy === null) return { refuse: `ORG_OS_TRUST_PROXY is "${get('ORG_OS_TRUST_PROXY')}", not on or off.` }

  const ssh = get('GIT_SSH_COMMAND')
  const deployKeyFile = ssh ? (/(?:^|\s)-i\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(ssh)?.slice(1).find(Boolean) ?? null) : null

  return {
    config: {
      origin: pub.origin, host: pub.host, doorOrigin,
      bind: get('ORG_OS_BIND') ?? '0.0.0.0', port,
      trustProxy,
      doorDir, doorEveryMs,
      push,
      privateDir, backupDir, backupEveryMs, backupKeep,
      backupPublicKeyFile: get('ORG_OS_BACKUP_PUBLIC_KEY_FILE') ?? '/run/secrets/backup.pub',
      deployKeyFile,
    },
  }
}

/** The Node floor's sentence, or null when `version` (e.g. `process.versions.node`) meets it. */
export function nodeRefusal(version: string): string | null {
  const have = version.split('.').map(n => Number.parseInt(n, 10) || 0)
  const need = NODE_FLOOR.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) > need[i]!) return null
    if ((have[i] ?? 0) < need[i]!) return `This Hub needs Node 22.13 or later, and it found ${version}: the private store uses node:sqlite.`
  }
  return null
}

/** The sentence for a key that group or others can read, or null. */
export function keyModeRefusal(path: string, stat: (p: string) => { mode: number }): string | null {
  return (stat(path).mode & 0o077) === 0
    ? null
    : `The key at ${path} can be read by others than the Hub's user. Make it readable by that user only (chmod 400), then start again.`
}
