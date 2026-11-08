// The deploy files, read as text (L9 Task 17, trimmed for the reference deployment on a container service: no Caddyfile
// and no compose file yet; ruling R-T17-1). Nothing here builds an image or starts a container.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOSTED_ENV } from '../../server/hosted/config.ts'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const DEPLOY = join(ROOT, 'deploy', 'hub')
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')
const dockerfile = () => read('deploy', 'hub', 'Dockerfile')
/** Instructions, with comments and line continuations folded away. */
const instructions = (text: string) => text.replace(/\\\n/g, ' ').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))

describe('deploy/hub/Dockerfile', () => {
  it('every FROM is pinned by an @sha256: digest, the digest a build argument with no default, on Node 22 bookworm-slim', () => {
    const lines = instructions(dockerfile())
    const froms = lines.filter(l => /^FROM\s/i.test(l))
    expect(froms.length).toBe(2) // the build stage and the runtime
    for (const f of froms) expect(f).toMatch(/^FROM node:22-bookworm-slim@sha256:\$\{NODE_BASE_DIGEST\}(\s+AS\s+\w+)?$/)
    expect(lines).toContain('ARG NODE_BASE_DIGEST') // no "=…": a build that names none fails
    expect(lines.findIndex(l => l === 'ARG NODE_BASE_DIGEST')).toBeLessThan(lines.findIndex(l => /^FROM\s/.test(l)))
  })

  it('a USER other than root, a HEALTHCHECK on /api/health, no VOLUME line', () => {
    const lines = instructions(dockerfile())
    const users = lines.filter(l => /^USER\s/.test(l))
    expect(users).toEqual(['USER hub'])
    expect(lines.some(l => /useradd\b.*--uid 10001\b.*\bhub$/.test(l))).toBe(true)
    const health = lines.find(l => /^HEALTHCHECK\s/.test(l))
    expect(health).toMatch(/CMD node -e .*http:\/\/127\.0\.0\.1:'?\+?\(?process\.env\.PORT.*\/api\/health/)
    expect(lines.some(l => /^VOLUME\b/i.test(l))).toBe(false) // the platform mounts the volume; a VOLUME line is refused there
  })

  it('no COPY of *.key, .env or secrets; the build stage runs npm ci and the members\' app build; git and openssh-client installed', () => {
    const lines = instructions(dockerfile())
    for (const l of lines.filter(x => /^(COPY|ADD)\s/.test(x))) expect(l).not.toMatch(/\.key\b|\.env\b|secrets|deploy_key|known_hosts|\.pub\b/)
    expect(lines.some(l => /^ADD\s/.test(l))).toBe(false)
    expect(lines).toContain('RUN npm ci --no-audit --no-fund')
    expect(lines).toContain('RUN npm run build')
    expect(lines.some(l => /apt-get install .*--no-install-recommends.*\bgit\b.*\bopenssh-client\b/.test(l))).toBe(true)
    expect(lines).toContain('ENTRYPOINT ["node", "node_modules/.bin/tsx", "scripts/hub.ts"]')
    expect(lines).toContain('CMD ["serve"]')
    // the portal bundles are later work (Task 14): no portal build here yet
    expect(dockerfile()).not.toMatch(/(door|portal):build/)
  })
})

describe('.dockerignore (an allow-list)', () => {
  it('ignores everything, then lets in packages/admin (without node_modules, tests, app/e2e, app/dist*), root schemas/, scripts/ and package.json', () => {
    const lines = read('.dockerignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    expect(lines[0]).toBe('*')
    for (const allow of ['!packages/admin', '!schemas', '!scripts', '!package.json']) expect(lines).toContain(allow)
    for (const deny of ['packages/admin/node_modules', 'packages/admin/tests', 'packages/admin/app/e2e', 'packages/admin/app/dist*']) expect(lines).toContain(deny)
    expect(lines.indexOf('packages/admin/node_modules')).toBeGreaterThan(lines.indexOf('!packages/admin'))
    for (const l of lines.filter(x => x.startsWith('!'))) expect(l).not.toMatch(/\.env|secrets|\.key/)
  })
})

describe('deploy/hub/env.example', () => {
  it('names every variable readHostedConfig reads, and nothing else; the push off and the proxy trusted', () => {
    const text = read('deploy', 'hub', 'env.example')
    const names = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.split('=')[0]!)
    expect([...names].sort()).toEqual([...HOSTED_ENV].sort())
    expect(text).toMatch(/^ORG_OS_PUSH=off$/m)
    expect(text).toMatch(/^ORG_OS_TRUST_PROXY=on$/m)
    expect(text).toMatch(/X-Forwarded-/)
    // placeholders only (L9 spec §15)
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/)
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    for (const host of text.match(/https:\/\/[^\s"']+/g) ?? []) expect(host).toMatch(/^https:\/\/(hub\.example\.org|example\.org|portal\.example\.test)\/?$/)
  })
})

describe('deploy/hub/RAILWAY.md', () => {
  it('says how the image runs: start command, volume path, the deploy key for a read-only clone, the health path; synthetic values', () => {
    const text = read('deploy', 'hub', 'RAILWAY.md')
    expect(text).toContain('hub serve')
    expect(text).toContain('/api/health')
    expect(text).toMatch(/volume/i)
    expect(text).toMatch(/deploy key/i)
    expect(text).toMatch(/read-only/i)
    expect(text).toContain('NODE_BASE_DIGEST')
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/)
    expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/) // no project or service ids
    // The framework is public: the org's hosts stay in its instance. Every host named is a placeholder or the container
    // service's own.
    const hosts = text.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:org|com|net|io|app|dev)\b/gi) ?? []
    expect(hosts.filter(h => !/(?:^|\.)example\.(?:org|com)$|\.railway\.app$/i.test(h))).toEqual([])
  })
})

describe('host-neutral (the Global Constraints grep, ruling P9)', () => {
  it('no provider name appears in deploy/ or packages/ (whole word, non-test sources, lockfiles excluded)', () => {
    const NAMES = /\b(hetzner|digitalocean|aws|gcp|azure|fly\.io)\b/i
    const skip = new Set(['node_modules', 'dist', 'tests', 'e2e', '.git'])
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name) || name.startsWith('dist')) continue
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) { walk(p); continue }
        if (/lock\.(json|yaml)$|\.lock$|\.(png|jpg|woff2?|ico)$/.test(name) || /\.test\.(ts|tsx|mjs)$/.test(name)) continue
        const text = readFileSync(p, 'utf8')
        if (NAMES.test(text)) hits.push(relative(ROOT, p))
      }
    }
    for (const d of ['deploy', 'packages']) if (existsSync(join(ROOT, d))) walk(join(ROOT, d))
    expect(hits).toEqual([])
    expect(existsSync(DEPLOY)).toBe(true)
  })
})
