import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { opById, needsConfirm, type Planned } from '../../server/operations/catalogue.ts'
import type { Resource } from '../../server/resources/types.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const sys = (facts: Record<string, unknown>): Resource =>
  ({ id: 'system:s', kind: 'system', board: 'systems', name: 's', status: null, attention: null, changed: null, facts, source: null })
const good = { kind: 'repo', cloneUrl: 'https://github.com/x/s', mount: { path: 'repos/s', cloned: false } }
const op = () => opById('system.clone')!

describe('system.clone', () => {
  it('is a confirmed network change that refreshes records', () => {
    expect(op()).toMatchObject({ kinds: ['system'], effect: 'changes', network: true, refreshes: 'records' })
    expect(needsConfirm(op())).toBe(true)
  })
  it('is available for a repo mounted under repos/', () => {
    expect(op().unavailable(sys(good), repo)).toBeNull()
  })
  it('gives a sentence for each refusal', () => {
    const u = (f: Record<string, unknown>) => op().unavailable(sys(f), repo)
    expect(u({ ...good, kind: 'safe' })).toMatch(/repo/)
    expect(u({ kind: 'repo', cloneUrl: good.cloneUrl })).toMatch(/mount/)
    expect(u({ ...good, mount: { path: 'elsewhere/s', cloned: false } })).toBe('Clone works for mounts under repos/, which the instance ignores in git.')
    expect(u({ ...good, mount: { path: 'repos/../x', cloned: false } })).toBe('Clone works for mounts under repos/, which the instance ignores in git.')
    expect(u({ ...good, cloneUrl: undefined })).toMatch(/address/)
    expect(u({ ...good, cloneUrl: '-oProxyCommand=x' })).toBeTruthy()
    expect(u({ ...good, cloneUrl: 'ext::sh -c x' })).toBeTruthy()
  })
  it('refuses a folder that is there and not empty, but allows an empty one', () => {
    mkdirSync(join(repo, 'repos', 's'), { recursive: true })
    expect(op().unavailable(sys(good), repo)).toBeNull()
    writeFileSync(join(repo, 'repos', 's', 'f'), 'x')
    expect(op().unavailable(sys(good), repo)).toMatch(/already/)
  })
  it('plans the exact clone', () => {
    const p = op().plan(sys(good), {}, repo) as Planned
    expect(p).toEqual({ cmd: 'git', args: ['-c', 'protocol.ext.allow=never', 'clone', '--branch', 'main', '--', good.cloneUrl, join(repo, 'repos/s')], writes: ['repos/s'] })
    const q = op().plan(sys({ ...good, branch: 'dev' }), {}, repo) as Planned
    expect(q.args.slice(3, 5)).toEqual(['--branch', 'dev'])
  })
})
