import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { crew, CREW_TIMEOUT_MS } from '../../server/resources/adapters/crew.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { AdapterContext, Graph, Runner } from '../../server/resources/types.ts'

const BOARD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'crew-board.json'), 'utf8')

let repo: string
let calls: { cmd: string; args: string[]; timeoutMs: number }[]
beforeEach(() => {
  repo = makeFixtureRepo()
  calls = []
  mkdirSync(join(repo, 'scripts'))
  writeFileSync(join(repo, 'scripts', 'crew.mjs'), '// stands in for crew; the runner below answers for it\n')
  mkdirSync(join(repo, 'roles'))
  writeFileSync(join(repo, 'roles', 'README.md'), '# roles\n')
  writeFileSync(join(repo, 'roles', 'platform.md'), '---\nid: platform\ncircle: engineering\nkind: claude\nmodel: claude-opus-5-5\n---\n# Platform\n')
  writeFileSync(join(repo, 'roles', 'reviewer.md'), '---\nid: reviewer\ncircle: engineering\n---\n')
  mkdirSync(join(repo, 'memory', 'crew'), { recursive: true })
  writeFileSync(join(repo, 'memory', 'crew', '2026-10-11-platform-write-path.md'),
    "---\nid: 2026-10-11-platform-write-path\nrole: platform\npane: 'w24:p1'\nworkspace: w24\ntask: null\n---\n## Brief\n")
  writeFileSync(join(repo, 'memory', 'crew', '2026-10-10-lead-first-cycle.md'),
    "---\nid: 2026-10-10-lead-first-cycle\nrole: lead\ntitle: First cycle\nagent: lead\nupdated: '2026-10-10T21:00:00-03:00'\n---\n")
})
afterEach(() => removeFixtureRepo(repo))

const ctx = (run: Runner, r = repo): AdapterContext => ({ repo: r, now: () => new Date(), run, lastOk: () => null })
const answering = (stdout: string, extra: Partial<{ code: number | null; stderr: string; timedOut: boolean }> = {}): Runner =>
  async (cmd, args, opts) => { calls.push({ cmd, args, timeoutMs: opts.timeoutMs }); return { code: 0, stdout, stderr: '', timedOut: false, ...extra } }

describe('crew adapter', () => {
  it('calls crew board --json with node, from the repository, with a 5 s limit', async () => {
    await crew.read(ctx(answering(BOARD)))
    expect(calls).toEqual([{ cmd: process.execPath, args: [join(repo, 'scripts', 'crew.mjs'), 'board', '--json'], timeoutMs: CREW_TIMEOUT_MS }])
    expect(CREW_TIMEOUT_MS).toBe(5000)
  })

  it('draws roles, seats and the seats whose agent is gone', async () => {
    const g = (await crew.read(ctx(answering(BOARD)))) as Graph
    expect(g.nodes.find(n => n.id === 'role:platform')).toMatchObject({ kind: 'role', status: '1 seated',
      attention: { level: 'warn', text: '1 open handoff' }, facts: expect.objectContaining({ circle: 'engineering', handoffs: ['website: Labels overlap on the map.'] }) })
    expect(g.nodes.find(n => n.id === 'role:reviewer')).toMatchObject({ status: '1 seated', attention: null })
    expect(g.nodes.find(n => n.id === 'seat:2026-10-11-platform-write-path')).toMatchObject({ kind: 'seat', board: 'systems',
      name: 'write path', status: 'seated', attention: null,
      changed: { at: '2026-10-11T02:00:00-03:00', by: 'platform' },
      facts: expect.objectContaining({ role: 'platform', state: 'working', pane: 'w24:p1', workspace: 'w24', branch: 'crew/a-platform' }) })
    expect(g.nodes.find(n => n.id === 'seat:2026-10-11-reviewer-review')).toMatchObject({
      name: 'reviewer · Review the write path.', attention: { level: 'warn', text: 'waiting at a dialog' } })
    expect(g.nodes.find(n => n.id === 'seat:2026-10-10-lead-first-cycle')).toMatchObject({ name: 'First cycle', status: 'seated',
      attention: { level: 'alert', text: 'agent gone while seated' }, facts: expect.objectContaining({ state: null }) })
    expect(g.edges).toEqual(expect.arrayContaining([
      { from: 'seat:2026-10-11-platform-write-path', to: 'role:platform', kind: 'seat-of' },
      { from: 'seat:2026-10-10-lead-first-cycle', to: 'role:lead', kind: 'seat-of' },
    ]))
  })

  it('says why when crew is absent, slow or broken', async () => {
    expect(await crew.read(ctx(answering('', { timedOut: true, code: null })))).toEqual({ absent: "crew didn't answer in 5 s" })
    expect(await crew.read(ctx(answering('not json', { code: 1, stderr: 'herdr is not running\nmore' })))).toEqual({ absent: 'crew board failed: herdr is not running' })
    expect(await crew.read(ctx(answering('', { code: 2 })))).toEqual({ absent: 'crew board failed: exit code 2' })
  })

  it('never quotes a stack frame: a board that crashes before it speaks reads as one plain sentence (LOW 1)', async () => {
    const crash = 'node:internal/modules/package_json_reader:301\n  throw error;\n  ^\n\nError: Cannot find package \'yaml\' imported from /x/scripts/crew/state.mjs\n    at packageResolve (node:internal/modules/esm/resolve:873:9)\n'
    const r = await crew.read(ctx(answering('', { code: 1, stderr: crash })))
    expect(r).toEqual({ absent: "crew's board can't run in this checkout" })
    for (const frame of ['    at run (/x/y.mjs:3:9)\nmore', '/x/y.mjs:12\nboom']) {
      expect(await crew.read(ctx(answering('', { code: 1, stderr: frame })))).toEqual({ absent: "crew's board can't run in this checkout" })
    }
    const bare = makeFixtureRepo()
    try { expect(await crew.read(ctx(answering(BOARD), bare))).toEqual({ absent: "Crew isn't installed here (no scripts/crew.mjs)" }) }
    finally { removeFixtureRepo(bare) }
  })

  it.skipIf(!existsSync(join(REAL_REPO, 'scripts', 'crew.mjs')))('reads the real crew on this machine', async () => {
    const result = await crew.read(ctx(runCommand, REAL_REPO))
    expect('absent' in result ? result.absent : 'read').toMatch(/read|didn't answer|failed/)
  })
})
