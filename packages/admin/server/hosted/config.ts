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
  'ORG_OS_HOSTED', 'ORG_OS_PUBLIC_ORIGIN', 'ORG_OS_PORTAL_ORIGIN', 'ORG_OS_BIND', 'PORT', 'ORG_OS_TRUST_PROXY',
  'ORG_OS_PORTAL_DIR', 'ORG_OS_PORTAL_EVERY', 'ORG_OS_PUSH', 'ORG_OS_REFRESH_EVERY', 'ORG_OS_PRIVATE_DIR', 'ORG_OS_BACKUP_DIR',
  'ORG_OS_BACKUP_EVERY', 'ORG_OS_BACKUP_KEEP', 'ORG_OS_BACKUP_PUBLIC_KEY_FILE', 'ORG_OS_ADMIN_HOME',
  'ORG_OS_REMOTE_PRIVATE', 'ORG_OS_RPC', 'GIT_SSH_COMMAND',
  // The writes-off switch (Lane 3 Task 11): read by startServer (hosted/instance-writes.ts), named here for the deploy example.
  'HOUSE_INSTANCE_WRITES',
  ...SIGN_IN_ENV,
] as const

/** The public site's settings were named for the door until 0.6.2, when the door became the portal. A Hub still reads
 *  each old name, with a warning at start, until 0.7; set beside its new name with another value, it stops the start. */
export const RENAMED_ENV = {
  ORG_OS_DOOR_ORIGIN: 'ORG_OS_PORTAL_ORIGIN',
  ORG_OS_DOOR_DIR: 'ORG_OS_PORTAL_DIR',
  ORG_OS_DOOR_EVERY: 'ORG_OS_PORTAL_EVERY',
} as const

export interface HostedConfig {
  /** `ORG_OS_PUBLIC_ORIGIN`, without a trailing slash, and its host. */
  origin: string
  host: string
  /** `ORG_OS_PORTAL_ORIGIN`: the portal's own host, or null when the portal is built but not served. */
  portalOrigin: string | null
  bind: string
  port: number
  trustProxy: boolean
  portalDir: string
  /** null: no timer (the portal is refreshed by hand). */
  portalEveryMs: number | null
  push: boolean
  /** How often a Hub whose writes are off takes new commits from its remote (convergence C1, C2: 15 min); null: never. */
  refreshEveryMs: number | null
  privateDir: string
  backupDir: string
  backupEveryMs: number
  backupKeep: number
  backupPublicKeyFile: string | null
  /** The `-i` of `GIT_SSH_COMMAND`, for the mode check. */
  deployKeyFile: string | null
}

const ADDRESS = 'A hosted Hub needs its address: set ORG_OS_PUBLIC_ORIGIN to https:// and the members\' host, then start again.'
const SAME_HOST = (name: string) => `The portal and the members' side need two hosts: ${name} and ORG_OS_PUBLIC_ORIGIN are the same.`
const OLD_NAME = (old: string, now: string) => `${old} is the old name of ${now}. This Hub reads it until org-os 0.7: rename it to ${now}.`
const TWO_NAMES = (old: string, now: string) => `${old} and ${now} are both set, to different values. ${now} is the name now: remove ${old}, then start again.`

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

/** The configuration and its warnings (an old setting name read), or the sentence that stops the start. */
export function readHostedConfig(env: Record<string, string | undefined>, repo: string): { config: HostedConfig; warnings: string[] } | { refuse: string } {
  const get = (k: string): string | undefined => env[k]?.trim() ? env[k]!.trim() : undefined

  // The renamed settings: the new name, else the old one with a warning; both with different values stop the start.
  const warnings: string[] = []
  const renamed: Partial<Record<string, { name: string; value: string }>> = {}
  for (const [old, now] of Object.entries(RENAMED_ENV)) {
    const o = get(old), n = get(now)
    if (o !== undefined && n !== undefined && o !== n) return { refuse: TWO_NAMES(old, now) }
    if (o !== undefined) warnings.push(OLD_NAME(old, now))
    if (n !== undefined) renamed[now] = { name: now, value: n }
    else if (o !== undefined) renamed[now] = { name: old, value: o }
  }
  const setting = (now: (typeof RENAMED_ENV)[keyof typeof RENAMED_ENV]) => renamed[now]

  const pub = get('ORG_OS_PUBLIC_ORIGIN') ? httpsOrigin(get('ORG_OS_PUBLIC_ORIGIN')!) : null
  if (!pub) return { refuse: ADDRESS }

  let portalOrigin: string | null = null
  const portalSet = setting('ORG_OS_PORTAL_ORIGIN')
  if (portalSet) {
    const portal = httpsOrigin(portalSet.value)
    if (!portal) return { refuse: `${portalSet.name} must be https:// and the portal's host, with no path, then start again.` }
    if (portal.host === pub.host) return { refuse: SAME_HOST(portalSet.name) }
    portalOrigin = portal.origin
  }

  const portText = get('PORT') ?? '4680'
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { refuse: `PORT is "${portText}", not a port number.` }

  const everySet = setting('ORG_OS_PORTAL_EVERY')
  const portalEveryText = everySet?.value ?? '1h'
  let portalEveryMs: number | null = null
  if (!/^(off|0)$/i.test(portalEveryText)) {
    portalEveryMs = parseEvery(portalEveryText)
    if (portalEveryMs === null || portalEveryMs > MAX_EVERY_MS) return { refuse: `${everySet?.name ?? 'ORG_OS_PORTAL_EVERY'} is "${portalEveryText}", not a time such as 1h (or off).` }
  }

  const refreshEveryText = get('ORG_OS_REFRESH_EVERY') ?? '15m'
  let refreshEveryMs: number | null = null
  if (!/^(off|0)$/i.test(refreshEveryText)) {
    refreshEveryMs = parseEvery(refreshEveryText)
    if (refreshEveryMs === null || refreshEveryMs > MAX_EVERY_MS) return { refuse: `ORG_OS_REFRESH_EVERY is "${refreshEveryText}", not a time such as 15m (or off).` }
  }

  const backupEveryText = get('ORG_OS_BACKUP_EVERY') ?? '6h'
  const backupEveryMs = parseEvery(backupEveryText)
  if (backupEveryMs === null || backupEveryMs > MAX_EVERY_MS) return { refuse: `ORG_OS_BACKUP_EVERY is "${backupEveryText}", not a time such as 6h.` }

  const keepText = get('ORG_OS_BACKUP_KEEP') ?? '14'
  const backupKeep = Number(keepText)
  if (!Number.isInteger(backupKeep) || backupKeep < 1) return { refuse: `ORG_OS_BACKUP_KEEP is "${keepText}", not a whole number of backups to keep.` }

  const dirSet = setting('ORG_OS_PORTAL_DIR')
  const portalDir = resolve(repo, dirSet?.value ?? '/srv/portal')
  const privateDir = resolve(repo, get('ORG_OS_PRIVATE_DIR') ?? '/srv/private')
  const backupDir = resolve(repo, get('ORG_OS_BACKUP_DIR') ?? '/srv/backups')
  for (const [name, dir] of [[dirSet?.name ?? 'ORG_OS_PORTAL_DIR', portalDir], ['ORG_OS_PRIVATE_DIR', privateDir], ['ORG_OS_BACKUP_DIR', backupDir]] as const) {
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
      origin: pub.origin, host: pub.host, portalOrigin,
      bind: get('ORG_OS_BIND') ?? '0.0.0.0', port,
      trustProxy,
      portalDir, portalEveryMs,
      push,
      refreshEveryMs,
      privateDir, backupDir, backupEveryMs, backupKeep,
      backupPublicKeyFile: get('ORG_OS_BACKUP_PUBLIC_KEY_FILE') ?? '/run/secrets/backup.pub',
      deployKeyFile,
    },
    warnings,
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
