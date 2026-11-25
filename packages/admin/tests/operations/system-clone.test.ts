import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { opById, needsConfirm, type Planned } from '../../server/operations/catalogue.ts'
import type { Resource } from '../../server/resources/types.ts'

let repo: string
let outside: string
beforeEach(() => { repo = makeFixtureRepo(); ignore(); outside = mkdtempSync(join(tmpdir(), 'clone-out-')) })
afterEach(() => { removeFixtureRepo(repo); rmSync(outside, { recursive: true, force: true }) })

const URL_OK = 'https://github.com/x/s'
const ignore = (text = 'repos/\n') => writeFileSync(join(repo, '.gitignore'), text)
const entry = (e: Record<string, unknown> = {}) => {
  const o = { id: 's', kind: 'repo', name: 'S', url: URL_OK, mount: 'repos/s', ...e }
  const lines = Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`)
  writeFileSync(join(repo, 'data', 'systems.yaml'), `schema_version: "1.0"\nsystems:\n  -${lines.join('\n   ').slice(3)}\n`)
}
const sys = (facts: Record<string, unknown>): Resource =>
  ({ id: 'system:s', kind: 'system', board: 'systems', name: 's', status: null, attention: null, changed: null, facts, source: null })
const good = { kind: 'repo', mount: { path: 'repos/s', cloned: false } }
const op = () => opById('system.clone')!

describe('system.clone', () => {
  it('is a confirmed network change that refreshes records', () => {
    expect(op()).toMatchObject({ kinds: ['system'], effect: 'changes', network: true, refreshes: 'records' })
    expect(needsConfirm(op())).toBe(true)
  })
  it('is available for a repo mounted under repos/', () => {
    entry()
    expect(op().unavailable(sys(good), repo)).toBeNull()
  })
  it('gives a sentence for each refusal', () => {
    const NOT_UNDER = 'Clone works for mounts under repos/, which the instance ignores in git.'
    entry()
    const u = (f: Record<string, unknown>) => op().unavailable(sys(f), repo)
    expect(u({ ...good, kind: 'safe' })).toMatch(/repo/)
    expect(u({ kind: 'repo' })).toMatch(/mount/)
    expect(u({ ...good, mount: { path: 'elsewhere/s', cloned: false } })).toBe(NOT_UNDER)
    expect(u({ ...good, mount: { path: 'repos/../x', cloned: false } })).toBe(NOT_UNDER)
    expect(u({ ...good, mount: { path: 'repos/', cloned: false } })).toBe(NOT_UNDER)
    expect(u({ ...good, mount: { path: 'repos', cloned: false } })).toBe(NOT_UNDER)
    entry({ url: undefined })
    expect(u(good)).toMatch(/address/)
    entry({ url: '-oProxyCommand=x' })
    expect(u(good)).toBeTruthy()
    entry({ url: 'ext::sh -c x' })
    expect(u(good)).toBeTruthy()
  })
  it('refuses a folder that is there and not empty, but allows an empty one', () => {
    entry()
    mkdirSync(join(repo, 'repos', 's'), { recursive: true })
    expect(op().unavailable(sys(good), repo)).toBeNull()
    writeFileSync(join(repo, 'repos', 's', 'f'), 'x')
    expect(op().unavailable(sys(good), repo)).toMatch(/already/)
  })
  it('refuses a mount that is a symlink to a folder outside the instance', () => {
    entry()
    mkdirSync(join(repo, 'repos'), { recursive: true })
    symlinkSync(outside, join(repo, 'repos', 's'))
    expect(op().unavailable(sys(good), repo)).toBe('repos/s leads outside this instance.')
    rmSync(join(repo, 'repos', 's'))
    symlinkSync(outside, join(repo, 'repos', 'x'))
    expect(op().unavailable(sys({ ...good, mount: { path: 'repos/x/deep', cloned: false } }), repo)).toMatch(/leads outside/)
  })
  it('is unavailable until the instance ignores repos/, whatever rule says so', () => {
    const SENTENCE = "Add repos/ to this instance's .gitignore first, so the clone stays out of its history."
    entry()
    for (const rule of ['', 'node_modules/\n', '# repos/\n', 'repos-old/\n']) { ignore(rule); expect(op().unavailable(sys(good), repo)).toBe(SENTENCE) }
    rmSync(join(repo, '.gitignore'))
    expect(op().unavailable(sys(good), repo)).toBe(SENTENCE)
    for (const rule of ['repos/', 'repos', '/repos/', 'repos/*', '/repos/*', 'repos/s/', 'x\r\nrepos/\r\n']) { ignore(rule + '\n'); expect(op().unavailable(sys(good), repo)).toBeNull() }
  })
  it('plans the exact clone, reading url and branch from the registry', async () => {
    entry({ branch: 'main' })
    const p = await op().plan(sys(good), {}, repo) as Planned
    expect(p).toEqual({ cmd: 'git', args: ['-c', 'protocol.ext.allow=never', 'clone', '--branch', 'main', '--', URL_OK, join(repo, 'repos/s')], writes: ['repos/s/'] })
    entry({ branch: 'dev' })
    const q = await op().plan(sys(good), {}, repo) as Planned
    expect(q.args.slice(3, 5)).toEqual(['--branch', 'dev'])
  })
  it('names no branch when the entry names none, so git takes the default', async () => {
    entry()
    const p = await op().plan(sys(good), {}, repo) as Planned
    expect(p.args).toEqual(['-c', 'protocol.ext.allow=never', 'clone', '--', URL_OK, join(repo, 'repos/s')])
  })
  it('refuses a branch git would take for an option', async () => {
    entry({ branch: '-evil' })
    await expect(Promise.resolve(op().plan(sys(good), {}, repo))).rejects.toThrow(/not a branch name/)
  })
})
