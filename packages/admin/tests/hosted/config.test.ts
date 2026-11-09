// The hosted configuration and the start checks (L9 spec §5.1, §10).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOSTED_ENV, NODE_FLOOR, RENAMED_ENV, folderInsideRepo, keyModeRefusal, nodeRefusal, readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'

const repo = '/work/instance'
const base = { ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org' }
const ok = (env: Record<string, string | undefined>): HostedConfig => {
  const r = readHostedConfig(env, repo)
  if (!('config' in r)) throw new Error(`refused: ${r.refuse}`)
  return r.config
}
const refused = (env: Record<string, string | undefined>): string => {
  const r = readHostedConfig(env, repo)
  if (!('refuse' in r)) throw new Error('expected a refusal')
  return r.refuse
}

describe('readHostedConfig', () => {
  it('refuses without ORG_OS_PUBLIC_ORIGIN', () => {
    expect(refused({})).toBe('A hosted Hub needs its address: set ORG_OS_PUBLIC_ORIGIN to https:// and the members\' host, then start again.')
  })
  it('refuses an http origin, an origin with a path, and one with credentials', () => {
    for (const o of ['http://hub.example.org', 'https://hub.example.org/app', 'https://steward-a:x@hub.example.org', 'not a url']) {
      expect(refused({ ORG_OS_PUBLIC_ORIGIN: o })).toMatch(/^A hosted Hub needs its address: /)
    }
  })
  it('accepts the origin with a trailing slash and keeps its host', () => {
    const c = ok({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org/' })
    expect(c.origin).toBe('https://hub.example.org')
    expect(c.host).toBe('hub.example.org')
  })
  it('refuses a portal origin equal to the members origin', () => {
    expect(refused({ ...base, ORG_OS_PORTAL_ORIGIN: 'https://hub.example.org' })).toBe(
      'The portal and the members\' side need two hosts: ORG_OS_PORTAL_ORIGIN and ORG_OS_PUBLIC_ORIGIN are the same.')
  })
  it('refuses a portal origin that is not an https origin', () => {
    expect(refused({ ...base, ORG_OS_PORTAL_ORIGIN: 'http://portal.example.test' })).toBe(
      'ORG_OS_PORTAL_ORIGIN must be https:// and the portal\'s host, with no path, then start again.')
  })
  it('refuses a backup dir and a portal dir inside the repository', () => {
    expect(refused({ ...base, ORG_OS_BACKUP_DIR: 'backups' })).toBe('ORG_OS_BACKUP_DIR is inside the repository. Put it on its own volume, then start again.')
    expect(refused({ ...base, ORG_OS_PORTAL_DIR: `${repo}/.org-os/portal` })).toBe('ORG_OS_PORTAL_DIR is inside the repository. Put it on its own volume, then start again.')
  })
  it('refuses a private dir inside the repository', () => {
    expect(refused({ ...base, ORG_OS_PRIVATE_DIR: `${repo}/p` })).toMatch(/^ORG_OS_PRIVATE_DIR is inside the repository/)
  })
  it('has the defaults of the spec', () => {
    const c = ok(base)
    expect(c).toMatchObject({
      bind: '0.0.0.0', port: 4680, portalOrigin: null, trustProxy: true, push: true,
      portalDir: '/srv/portal', portalEveryMs: 3_600_000, privateDir: '/srv/private', backupDir: '/srv/backups',
      backupEveryMs: 21_600_000, backupKeep: 14, backupPublicKeyFile: '/run/secrets/backup.pub', deployKeyFile: null,
    })
  })
  it('reads overrides', () => {
    const c = ok({ ...base, ORG_OS_PORTAL_ORIGIN: 'https://portal.example.test', ORG_OS_BIND: '127.0.0.1', PORT: '5000', ORG_OS_TRUST_PROXY: '0',
      ORG_OS_PORTAL_EVERY: '30m', ORG_OS_PUSH: 'off', ORG_OS_BACKUP_EVERY: '2h', ORG_OS_BACKUP_KEEP: '3',
      GIT_SSH_COMMAND: 'ssh -i /run/secrets/deploy_key -o IdentitiesOnly=yes' })
    expect(c).toMatchObject({ portalOrigin: 'https://portal.example.test', bind: '127.0.0.1', port: 5000, trustProxy: false,
      portalEveryMs: 1_800_000, push: false, backupEveryMs: 7_200_000, backupKeep: 3, deployKeyFile: '/run/secrets/deploy_key' })
  })
  it('ORG_OS_PUSH reads on and off words in any case; any other value refuses to start, never pushes (review of Task 7)', () => {
    for (const v of ['off', 'OFF', '0', 'false', 'no', ' Off ']) expect(ok({ ...base, ORG_OS_PUSH: v }).push).toBe(false)
    for (const v of ['on', 'ON', '1', 'true', 'yes']) expect(ok({ ...base, ORG_OS_PUSH: v }).push).toBe(true)
    expect(ok({ ...base, ORG_OS_PUSH: '' }).push).toBe(true) // unset, as the spec's default
    for (const v of ['of', 'disabled', 'none', 'nope', '2']) {
      expect(refused({ ...base, ORG_OS_PUSH: v })).toBe(`ORG_OS_PUSH is "${v}", not on or off.`)
    }
  })
  it('ORG_OS_TRUST_PROXY fails closed like ORG_OS_PUSH: on and off words only; any other value refuses to start (Task 8)', () => {
    for (const v of ['off', 'OFF', '0', 'false', 'no', ' Off ']) expect(ok({ ...base, ORG_OS_TRUST_PROXY: v }).trustProxy).toBe(false)
    for (const v of ['on', 'ON', '1', 'true', 'yes']) expect(ok({ ...base, ORG_OS_TRUST_PROXY: v }).trustProxy).toBe(true)
    expect(ok({ ...base, ORG_OS_TRUST_PROXY: '' }).trustProxy).toBe(true) // unset, as the spec's default
    for (const v of ['of', 'disabled', 'none', 'X-Real-IP', '2']) {
      expect(refused({ ...base, ORG_OS_TRUST_PROXY: v })).toBe(`ORG_OS_TRUST_PROXY is "${v}", not on or off.`)
    }
  })
  it('ORG_OS_REFRESH_EVERY: 15 min by default; a time, or off / 0 for none; anything else refuses to start (C1, C2)', () => {
    expect(ok(base).refreshEveryMs).toBe(900_000)
    expect(ok({ ...base, ORG_OS_REFRESH_EVERY: '1h' }).refreshEveryMs).toBe(3_600_000)
    for (const v of ['off', 'OFF', '0']) expect(ok({ ...base, ORG_OS_REFRESH_EVERY: v }).refreshEveryMs).toBeNull()
    for (const v of ['soon', '15 minutes', '-5m']) {
      expect(refused({ ...base, ORG_OS_REFRESH_EVERY: v })).toBe(`ORG_OS_REFRESH_EVERY is "${v}", not a time such as 15m (or off).`)
    }
  })
  it('portal every "off" means no timer', () => {
    expect(ok({ ...base, ORG_OS_PORTAL_EVERY: 'off' }).portalEveryMs).toBeNull()
  })
  it('refuses malformed numbers and durations with a sentence', () => {
    expect(refused({ ...base, PORT: 'x' })).toMatch(/PORT/)
    expect(refused({ ...base, ORG_OS_BACKUP_EVERY: 'soon' })).toMatch(/ORG_OS_BACKUP_EVERY/)
    expect(refused({ ...base, ORG_OS_BACKUP_KEEP: '0' })).toMatch(/ORG_OS_BACKUP_KEEP/)
    expect(refused({ ...base, ORG_OS_PORTAL_EVERY: 'soon' })).toBe('ORG_OS_PORTAL_EVERY is "soon", not a time such as 1h (or off).')
  })
})

describe('the settings named for the door until 0.6.2', () => {
  const warningsOf = (env: Record<string, string | undefined>): string[] => {
    const r = readHostedConfig(env, repo)
    if (!('config' in r)) throw new Error(`refused: ${r.refuse}`)
    return r.warnings
  }
  it('maps each old name to its new one', () => {
    expect(RENAMED_ENV).toEqual({
      ORG_OS_DOOR_ORIGIN: 'ORG_OS_PORTAL_ORIGIN', ORG_OS_DOOR_DIR: 'ORG_OS_PORTAL_DIR', ORG_OS_DOOR_EVERY: 'ORG_OS_PORTAL_EVERY',
    })
    for (const [old, now] of Object.entries(RENAMED_ENV)) {
      expect(HOSTED_ENV).toContain(now)
      expect(HOSTED_ENV).not.toContain(old)
    }
  })
  it('the new names alone: no warning', () => {
    expect(warningsOf({ ...base, ORG_OS_PORTAL_ORIGIN: 'https://portal.example.test', ORG_OS_PORTAL_DIR: '/srv/p', ORG_OS_PORTAL_EVERY: '2h' })).toEqual([])
    expect(warningsOf(base)).toEqual([])
  })
  it('an old name alone is read, with a warning naming its new one', () => {
    const env = { ...base, ORG_OS_DOOR_ORIGIN: 'https://portal.example.test', ORG_OS_DOOR_DIR: '/srv/door', ORG_OS_DOOR_EVERY: '30m' }
    expect(ok(env)).toMatchObject({ portalOrigin: 'https://portal.example.test', portalDir: '/srv/door', portalEveryMs: 1_800_000 })
    expect(warningsOf(env)).toEqual([
      'ORG_OS_DOOR_ORIGIN is the old name of ORG_OS_PORTAL_ORIGIN. This Hub reads it until org-os 0.7: rename it to ORG_OS_PORTAL_ORIGIN.',
      'ORG_OS_DOOR_DIR is the old name of ORG_OS_PORTAL_DIR. This Hub reads it until org-os 0.7: rename it to ORG_OS_PORTAL_DIR.',
      'ORG_OS_DOOR_EVERY is the old name of ORG_OS_PORTAL_EVERY. This Hub reads it until org-os 0.7: rename it to ORG_OS_PORTAL_EVERY.',
    ])
  })
  it('an old name\'s refusal names the old name, as set', () => {
    expect(refused({ ...base, ORG_OS_DOOR_ORIGIN: 'https://hub.example.org' })).toBe(
      'The portal and the members\' side need two hosts: ORG_OS_DOOR_ORIGIN and ORG_OS_PUBLIC_ORIGIN are the same.')
    expect(refused({ ...base, ORG_OS_DOOR_EVERY: 'soon' })).toBe('ORG_OS_DOOR_EVERY is "soon", not a time such as 1h (or off).')
    expect(refused({ ...base, ORG_OS_DOOR_DIR: `${repo}/.org-os/door` })).toBe('ORG_OS_DOOR_DIR is inside the repository. Put it on its own volume, then start again.')
  })
  it('both names with the same value: the value, and the warning', () => {
    const env = { ...base, ORG_OS_DOOR_EVERY: '2h', ORG_OS_PORTAL_EVERY: '2h' }
    expect(ok(env).portalEveryMs).toBe(7_200_000)
    expect(warningsOf(env)).toHaveLength(1)
  })
  it('both names with different values stop the start', () => {
    expect(refused({ ...base, ORG_OS_DOOR_ORIGIN: 'https://a.example.test', ORG_OS_PORTAL_ORIGIN: 'https://b.example.test' })).toBe(
      'ORG_OS_DOOR_ORIGIN and ORG_OS_PORTAL_ORIGIN are both set, to different values. ORG_OS_PORTAL_ORIGIN is the name now: remove ORG_OS_DOOR_ORIGIN, then start again.')
  })
})

describe('folderInsideRepo', () => {
  it('is true for the repository and what is under it, false beside it', () => {
    expect(folderInsideRepo(repo, repo)).toBe(true)
    expect(folderInsideRepo(`${repo}/a/b`, repo)).toBe(true)
    expect(folderInsideRepo('a', repo)).toBe(true)
    expect(folderInsideRepo(`${repo}-other`, repo)).toBe(false)
    expect(folderInsideRepo('/srv/backups', repo)).toBe(false)
    expect(folderInsideRepo('../beside', repo)).toBe(false)
  })
})

describe('keyModeRefusal', () => {
  const at = (mode: number) => () => ({ mode })
  it('refuses a key readable by group or others', () => {
    expect(keyModeRefusal('/run/secrets/deploy_key', at(0o100644))).toBe(
      'The key at /run/secrets/deploy_key can be read by others than the Hub\'s user. Make it readable by that user only (chmod 400), then start again.')
    expect(keyModeRefusal('/k', at(0o100640))).not.toBeNull()
  })
  it('passes 0400 and 0600', () => {
    expect(keyModeRefusal('/k', at(0o100400))).toBeNull()
    expect(keyModeRefusal('/k', at(0o100600))).toBeNull()
  })
})

describe('nodeRefusal', () => {
  it('refuses below the floor with the sentence', () => {
    expect(NODE_FLOOR).toBe('22.13.0')
    expect(nodeRefusal('22.12.0')).toBe('This Hub needs Node 22.13 or later, and it found 22.12.0: the private store uses node:sqlite.')
    expect(nodeRefusal('20.19.0')).not.toBeNull()
  })
  it('passes the floor and above', () => {
    expect(nodeRefusal('22.13.0')).toBeNull()
    expect(nodeRefusal('24.0.0')).toBeNull()
    expect(nodeRefusal('22.20.1')).toBeNull()
  })
})

describe('HOSTED_ENV', () => {
  it('lists the spec table, the sign-in variables (Lane 3 Task 4), the writes-off switch (Task 11) and the refresh (C1, C2), each name once', () => {
    expect([...HOSTED_ENV].sort()).toEqual([
      'GIT_SSH_COMMAND', 'ORG_OS_ADMIN_HOME', 'ORG_OS_BACKUP_DIR', 'ORG_OS_BACKUP_EVERY', 'ORG_OS_BACKUP_KEEP', 'ORG_OS_BACKUP_PUBLIC_KEY_FILE',
      'ORG_OS_BIND', 'ORG_OS_PORTAL_DIR', 'ORG_OS_PORTAL_EVERY', 'ORG_OS_PORTAL_ORIGIN', 'ORG_OS_HOSTED', 'ORG_OS_PRIVATE_DIR', 'ORG_OS_PUBLIC_ORIGIN',
      'ORG_OS_PUSH', 'ORG_OS_REFRESH_EVERY', 'ORG_OS_REMOTE_PRIVATE', 'ORG_OS_RPC', 'ORG_OS_TRUST_PROXY', 'PORT', 'HOUSE_INSTANCE_WRITES',
      'HOUSE_EMAIL_PEPPER', 'HOUSE_SESSION_PRIVATE_JWK', 'SESSION_COOKIE_NAME', 'SESSION_COOKIE_DOMAIN', 'RESEND_API_KEY', 'MAIL_FROM',
    ].sort())
    expect(new Set(HOSTED_ENV).size).toBe(HOSTED_ENV.length)
  })
})

describe('engines and host neutrality', () => {
  const adminRoot = fileURLToPath(new URL('../..', import.meta.url))
  const repoRoot = join(adminRoot, '..', '..')
  it('the engines fields read >=22.13.0', () => {
    for (const p of [join(repoRoot, 'package.json'), join(adminRoot, 'package.json')]) {
      expect(JSON.parse(readFileSync(p, 'utf8')).engines.node).toBe('>=22.13.0')
    }
  })
  it('no provider name appears in non-test sources of packages/ or deploy/', () => {
    const re = /\b(hetzner|digitalocean|aws|gcp|azure|fly\.io)\b/i
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git', 'tests', 'package-lock.json'].includes(name) || /\.(test|spec)\./.test(name)) continue
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) walk(p)
        else if (st.size < 2_000_000 && /\.(ts|tsx|mjs|js|json|ya?ml|sh|md|html|css|toml|conf|example)$|Dockerfile|Caddyfile/.test(name) && re.test(readFileSync(p, 'utf8'))) hits.push(p)
      }
    }
    for (const d of [join(repoRoot, 'packages'), join(repoRoot, 'deploy')]) { try { walk(d) } catch { /* no such folder yet */ } }
    expect(hits).toEqual([])
  })
})
