import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { Hono } from 'hono'
import * as gitModule from '../../server/git.ts'
import { generatedBehind, mountGenerated, GENERATED_SOURCES } from '../../server/proposals/generated.ts'
import { isMaintainer, type RuleContext } from '../../server/governance/effective.ts'

// "Generated files are behind the data" (0.6 P2 spec 3.8, P2-R20): a ratify merge (Org-Proposal and Org-Decision) that
// changed what .well-known/ is generated from, newer than the newest commit that changed .well-known/. Every test builds
// its own throwaway repository under the OS temp directory.
const ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
}
const sh = (cwd: string, cmd: string): string => execSync(cmd, { cwd, env: ENV, stdio: 'pipe' }).toString()
let repo: string
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'generated-'))
  sh(repo, 'git init -q -b main')
  put('data/projects.yaml', 'projects: []\n'); put('.well-known/projects.json', '{}\n')
  commit('seed')
})
afterEach(() => { rmSync(repo, { recursive: true, force: true }); rmSync(`${repo}.msg`, { force: true }) })

function put(file: string, text: string) { const p = join(repo, file); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
function commit(msg: string) { writeFileSync(`${repo}.msg`, msg); sh(repo, `git add -A && git commit -q --allow-empty -F ${repo}.msg`) }
const RATIFY = (what: string) => `ratify ${what}\n\nOrg-Proposal: p-2026-10-01-001\nOrg-Decision: gov-2026-10-01-001\n`
const head = () => sh(repo, 'git rev-parse HEAD').trim()
/** A ratify as the server makes it: a merge commit of a proposal branch whose commit changed `file`. */
let n = 0
function ratify(file: string) {
  const b = `proposal/p-${++n}`
  sh(repo, `git checkout -q -b ${b}`); put(file, `${Math.random()}\n`); commit('branch content')
  sh(repo, 'git checkout -q main'); sh(repo, `git merge -q --no-ff --no-commit ${b}`); commit(RATIFY(file))
}

describe('generatedBehind', () => {
  it('is not behind on a history with no ratify', async () => {
    put('data/projects.yaml', 'projects: [a]\n'); commit('direct change')
    expect(await generatedBehind(repo)).toEqual({ behind: false })
  })

  it('is behind after a ratify that changed data/projects.yaml, and says which commit', async () => {
    ratify('data/projects.yaml')
    expect(await generatedBehind(repo)).toEqual({ behind: true, since: head() })
  })

  it('is not behind once a later commit changed .well-known/', async () => {
    ratify('data/projects.yaml')
    put('.well-known/projects.json', '{"a":1}\n'); commit('regenerate')
    expect(await generatedBehind(repo)).toEqual({ behind: false })
  })

  it('is behind again after a second ratify, naming that one', async () => {
    ratify('data/projects.yaml'); put('.well-known/projects.json', '{"a":1}\n'); commit('regenerate')
    ratify('federation.yaml')
    expect(await generatedBehind(repo)).toEqual({ behind: true, since: head() })
  })

  it('does not count a ratify that changed nothing the generator reads', async () => {
    ratify('docs/notes.md')
    expect(await generatedBehind(repo)).toEqual({ behind: false })
  })

  it('does not count a plain commit of data/ as a ratify (no trailers)', async () => {
    put('data/projects.yaml', 'projects: [b]\n'); commit('Org-Proposal: only one trailer\n\nOrg-Proposal: p-1')
    expect(await generatedBehind(repo)).toEqual({ behind: false })
  })

  it('reads the generator\'s own inputs: data/, federation.yaml, content/projects and content/meetings', () => {
    expect(GENERATED_SOURCES).toEqual(['data/', 'federation.yaml', 'content/projects/', 'content/meetings/'])
  })
})

describe('the answer is kept per HEAD', () => {
  afterEach(() => vi.restoreAllMocks())
  it('a repeat at the same HEAD does not walk again; a new commit does', async () => {
    ratify('data/projects.yaml')
    const walked = vi.spyOn(gitModule, 'treeDiffNames')
    const first = await generatedBehind(repo)
    const n = walked.mock.calls.length
    expect(n).toBeGreaterThan(0)
    expect(await generatedBehind(repo)).toEqual(first)
    expect(walked.mock.calls.length).toBe(n)
    put('.well-known/projects.json', '{"b":1}\n'); commit('regenerate')
    expect(await generatedBehind(repo)).toEqual({ behind: false })
    expect(walked.mock.calls.length).toBeGreaterThan(n)
  })
})

describe('GET /api/generated', () => {
  it('answers { behind, since } and changes nothing', async () => {
    ratify('data/projects.yaml')
    const before = sh(repo, 'git status --porcelain') + head()
    const app = new Hono(); mountGenerated(app, { repo, maintainer: () => true })
    const res = await app.request('/api/generated')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ behind: true, since: head() })
    expect(sh(repo, 'git status --porcelain') + head()).toBe(before)
  })

  // walk I7, D4: the line is for maintainers; anyone else is told nothing of it
  it('answers { behind: false } to anyone who is not a maintainer', async () => {
    ratify('data/projects.yaml')
    const app = new Hono(); mountGenerated(app, { repo, maintainer: () => false })
    expect(await (await app.request('/api/generated')).json()).toEqual({ behind: false })
  })
})

describe('isMaintainer (walk I7, D4)', () => {
  const ctx = (governance: Record<string, unknown> | null, actor: RuleContext['actor']): RuleContext => ({
    org: 'Test', governance, shape: 'map', problems: [], modelImplied: governance === null, actor,
    members: [{ id: 'steward-a', kind: 'person' }, { id: 'steward-b', kind: 'person' }, { id: 'bot', kind: 'agent' }],
  })
  const person = (id: string) => ({ id, name: id, kind: 'person' }) as RuleContext['actor']
  it('a written maintainer role holds its members only', () => {
    const gov = { model: 'consensus', roles: { maintainer: { members: ['steward-a'] } } }
    expect(isMaintainer(ctx(gov, person('steward-a')))).toBe(true)
    expect(isMaintainer(ctx(gov, person('steward-b')))).toBe(false)
  })
  it('with no maintainer role written, every person is one (F2-R2); an agent and an unknown actor are not', () => {
    expect(isMaintainer(ctx(null, person('steward-b')))).toBe(true)
    expect(isMaintainer(ctx(null, { id: 'bot', name: 'bot', kind: 'agent' } as RuleContext['actor']))).toBe(false)
    expect(isMaintainer(ctx(null, { unknown: 'someone@example.test' } as RuleContext['actor']))).toBe(false)
  })
})
