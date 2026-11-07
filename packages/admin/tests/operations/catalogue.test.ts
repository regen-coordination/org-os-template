import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { CATALOGUE, opById, needsConfirm, commandArgv, safeId, type Planned, type InProcess } from '../../server/operations/catalogue.ts'
import { HttpError } from '../../server/errors.ts'
import type { Resource } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => {
  repo = makeFixtureRepo()
  for (const dir of ['scripts', 'memory/crew', 'packages/org-os-kms/src']) mkdirSync(join(repo, dir), { recursive: true })
  for (const file of ['scripts/crew.mjs', 'scripts/doctor.mjs', 'scripts/analyze-instances.mjs', 'packages/org-os-kms/src/cli.mjs', 'present.md']) writeFileSync(join(repo, file), '')
  writeFileSync(join(repo, 'data', 'instances.yaml'), 'instances: []\n')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { 'buzz:doctor': 'node x' } }))
  writeFileSync(join(repo, 'memory', 'crew', 's1.md'), '---\nid: s1\n---\n## Report\nAll done.\n')
})
afterEach(() => removeFixtureRepo(repo))

const res = (id: string, kind: Resource['kind'], facts: Record<string, unknown> = {}): Resource =>
  ({ id, kind, board: 'systems', name: id, status: null, attention: null, changed: null, facts, source: null })
const plan = (op: string, r: Resource, params: Record<string, unknown> = {}) => opById(op)!.plan(r, params, repo) as Planned
const crew = () => join(repo, 'scripts', 'crew.mjs')

describe('the catalogue', () => {
  it('has unique ids, and asks for confirmation exactly for what changes or reaches out', () => {
    expect(new Set(CATALOGUE.map(o => o.id)).size).toBe(CATALOGUE.length)
    expect(CATALOGUE.filter(needsConfirm).map(o => o.id).sort()).toEqual([
      'connector.ingest', 'fetch', 'instance.analyze', 'module.command-check', 'module.doctor', 'role.seat', 'seat.nudge', 'seat.release', 'share',
    ])
    for (const op of CATALOGUE) expect(['records', 'modules', 'crew', 'fleet', 'sources']).toContain(op.refreshes)
  })

  it('seats a role with the brief as one argument after --, whatever it holds', () => {
    const brief = '-x; rm -rf ~ && echo "$HOME" `id`'
    expect(plan('role.seat', res('role:platform', 'role'), { brief, title: 'write path', task: 'task-1', base: 'feat/crew' })).toEqual({
      cmd: process.execPath,
      args: [crew(), 'seat', 'platform', '--title', 'write path', '--task', 'task-1', '--base', 'feat/crew', '--', brief],
      writes: ['memory/crew/'],
    })
    expect(plan('role.seat', res('role:platform', 'role'), { brief: 'b', title: 't' }).args).toEqual([crew(), 'seat', 'platform', '--title', 't', '--', 'b'])
  })

  it('nudges and releases a seat through crew', () => {
    const seat = res('seat:s1', 'seat', { state: 'idle', pane: 'w1:p1', workspace: 'w1' })
    expect(plan('seat.nudge', seat)).toEqual({ cmd: process.execPath, args: [crew(), 'nudge', 's1'], writes: ['memory/crew/'] })
    expect(plan('seat.release', seat, { outcome: 'abandoned' }).args).toEqual([crew(), 'release', 's1', '--outcome', 'abandoned'])
    expect(plan('seat.read-pane', seat)).toEqual({ cmd: 'herdr', args: ['pane', 'read', 'w1:p1', '--source', 'recent', '--lines', '80', '--format', 'text'], writes: [] })
    expect(plan('seat.focus', seat)).toEqual({ cmd: 'herdr', args: ['workspace', 'focus', 'w1'], writes: [] })
    expect(opById('seat.nudge')!.unavailable(res('seat:s1', 'seat', { state: null }), repo)).toBe('the seat has no live agent')
    expect(opById('seat.read-pane')!.unavailable(res('seat:s1', 'seat', { state: 'idle' }), repo)).toBe('this seat records no herdr pane')
  })

  it('reads a seat report in process', async () => {
    const op = opById('seat.report')!.plan(res('seat:s1', 'seat'), {}, repo) as InProcess
    expect(await op.inProcess(repo, new AbortController().signal)).toContain('All done.')
  })

  it('runs a module doctor only when its npm script exists', () => {
    expect(plan('module.doctor', res('module:org-os-buzz', 'module'))).toEqual({ cmd: 'npm', args: ['run', 'buzz:doctor'], writes: [] })
    expect(opById('module.doctor')!.unavailable(res('module:org-os-paper', 'module'), repo)).toBe('no "paper:doctor" script in package.json')
  })

  it('re-runs file checks in process, line by line', async () => {
    const op = opById('module.checks')!.plan(res('module:m', 'module', { fileChecks: ['present.md', 'gone.md'] }), {}, repo) as InProcess
    expect(await op.inProcess(repo, new AbortController().signal)).toBe('✓ present.md\n✗ gone.md missing\n')
  })

  it('offers each command check as its own variant, and refuses one with a shell character', () => {
    const mod = res('module:m', 'module', { commandChecks: ['npm run doctor -- --help', 'npm test | tee log'] })
    const variants = opById('module.command-check')!.variants!(mod)
    expect(variants).toEqual([
      { label: 'Run check: npm run doctor -- --help', params: { index: 0 }, unavailable: null },
      { label: 'Run check: npm test | tee log', params: { index: 1 }, unavailable: expect.stringMatching(/shell character/) },
    ])
    expect(plan('module.command-check', mod, { index: 0 })).toEqual({ cmd: 'npm', args: ['run', 'doctor', '--', '--help'], writes: [] })
    expect(() => plan('module.command-check', mod, { index: 1 })).toThrow(/shell character/)
    expect(commandArgv('  node  x.mjs --check ')).toEqual({ cmd: 'node', args: ['x.mjs', '--check'] })
  })

  it('refuses a command check that names an operation the spec rules out, and says which', () => {
    const ruledOut: Array<[string, string]> = [
      ['git stash', 'stash'],
      ['git clean -fdx', 'clean'],
      ['git reset --hard', 'reset'],
      ['git push --force', 'push'],
      ['node scripts/crew.mjs clean-worktrees --yes', 'clean-worktrees'],
      ['git push --force-with-lease', 'push'],
      ['git push origin +main', 'push'],
      ['git push --mirror origin', 'push'],
      ['node x.mjs --mirror', '--mirror'],
      ['node x.mjs --delete', '--delete'],
      ['node x.mjs --force-with-lease', '--force-with-lease'],
      ['node x.mjs -f', '-f'],
      ['git branch -D old', '-D'],
    ]
    const mod = res('module:m', 'module', { commandChecks: [...ruledOut.map(([text]) => text), 'npm run doctor -- --help'] })
    const variants = opById('module.command-check')!.variants!(mod)
    ruledOut.forEach(([text, token], index) => {
      const sentence = `"${text}" names ${token}, which the platform never runs (spec §5.1: stash, clean, reset and force are left out); run it in a terminal if you mean it`
      expect(variants[index].unavailable).toBe(sentence)
      expect(() => plan('module.command-check', mod, { index })).toThrow(HttpError)
      expect(() => plan('module.command-check', mod, { index })).toThrow(sentence)
    })
    expect(variants[ruledOut.length].unavailable).toBeNull()
    expect(plan('module.command-check', mod, { index: ruledOut.length })).toEqual({ cmd: 'npm', args: ['run', 'doctor', '--', '--help'], writes: [] })
  })

  it('accepts only ids crew can take as a plain positional', () => {
    expect(safeId('platform')).toBe('platform')
    expect(safeId('task-1.x_y')).toBe('task-1.x_y')
    expect(safeId('--handoff=/etc/hosts')).toBeNull()
    expect(safeId('../x')).toBeNull()
    expect(safeId('')).toBeNull()
  })

  it('refuses a role or seat id that crew would read as an option or a path', () => {
    const unsafe = (id: string) => `this id cannot be passed to crew safely: "${id}"`
    const role = res('role:--handoff=/etc/hosts', 'role')
    expect(opById('role.seat')!.unavailable(role, repo)).toBe(unsafe('--handoff=/etc/hosts'))
    expect(() => opById('role.seat')!.plan(role, { brief: 'b', title: 't' }, repo)).toThrow(HttpError)
    const seat = res('seat:../x', 'seat', { state: 'idle', pane: 'w1:p1', workspace: 'w1' })
    for (const id of ['seat.nudge', 'seat.release', 'seat.report']) {
      expect(opById(id)!.unavailable(seat, repo)).toBe(unsafe('../x'))
      expect(() => opById(id)!.plan(seat, { outcome: 'done' }, repo)).toThrow(HttpError)
    }
  })

  it('assesses a cloned instance, and re-analyzes the fleet only from this instance\'s card', () => {
    const self = res('instance:me', 'instance', { self: true, localPath: repo })
    const peer = res('instance:peer', 'instance', { localPath: '/somewhere/peer' })
    expect(plan('instance.assess', peer)).toEqual({ cmd: process.execPath, args: [join(repo, 'scripts', 'doctor.mjs'), 'assess', '--dir', '/somewhere/peer'], writes: [] })
    expect(opById('instance.assess')!.unavailable(res('instance:far', 'instance', { localPath: null }), repo)).toBe('no clone of this instance on this machine')
    expect(plan('instance.analyze', self)).toEqual({ cmd: process.execPath, args: [join(repo, 'scripts', 'analyze-instances.mjs')], writes: ['memory/reports/'] })
    expect(opById('instance.analyze')!.unavailable(peer, repo)).toBe("offered on this instance's own card")
  })

  it('ingests one connector, declaring the store and the cursor file it writes', () => {
    const cli = join(repo, 'packages', 'org-os-kms', 'src', 'cli.mjs')
    expect(plan('connector.ingest', res('connector:example-commons', 'connector', { target: 'knowledge/' }))).toEqual({
      cmd: process.execPath, args: [cli, 'ingest', '--connector', 'example-commons', '--dir', repo], writes: ['knowledge/', 'data/kms-cursors.json'] })
    expect(plan('connector.ingest', res('connector:x', 'connector', { target: '.' })).writes).toEqual(['.'])
  })

  it('says crew is missing in words', () => {
    const bare = makeFixtureRepo()
    try { expect(opById('role.seat')!.unavailable(res('role:x', 'role'), bare)).toBe("crew isn't installed here (no scripts/crew.mjs)") }
    finally { removeFixtureRepo(bare) }
  })
})
