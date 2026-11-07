import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { stateDir, JobStore, newJobId, readLayout, writeLayout, clearLayout, validPositions, moveJob, type JobRecord } from '../server/state.ts'

let repo: string
let home: string
const before = process.env.ORG_OS_ADMIN_HOME
beforeEach(() => { repo = makeFixtureRepo(); home = mkdtempSync(join(tmpdir(), 'state-')); process.env.ORG_OS_ADMIN_HOME = home })
afterEach(() => { removeFixtureRepo(repo); rmSync(home, { recursive: true, force: true }); process.env.ORG_OS_ADMIN_HOME = before })

const job = (over: Partial<JobRecord> = {}): JobRecord => ({
  id: newJobId(), op: 'module.checks', resource: 'module:a', label: 'Re-run checks', cmd: null, args: [], writes: [],
  status: 'queued', created: new Date().toISOString(), started: null, ended: null, exitCode: null, changed: [], surprises: [], sentence: null, ...over,
})

describe('stateDir', () => {
  it('lives outside the repository, named after the instance', () => {
    expect(stateDir(repo).startsWith(home)).toBe(true)
    expect(stateDir(repo)).toMatch(/fixture-org-[0-9a-f]{6}$/)
    delete process.env.ORG_OS_ADMIN_HOME
    expect(stateDir(repo).startsWith(join(homedir(), '.org-os', 'admin'))).toBe(true)
    process.env.ORG_OS_ADMIN_HOME = home
  })
})

describe('JobStore', () => {
  it('saves, reads, lists newest first, and keeps a log', () => {
    const store = new JobStore(repo)
    const a = job({ created: '2026-10-15T10:00:00.000Z' }), b = job({ created: '2026-10-15T11:00:00.000Z', resource: 'module:b' })
    store.save(a); store.save(b)
    store.appendLog(a.id, 'one\n'); store.appendLog(a.id, 'two\n')
    expect(store.get(a.id)).toEqual(a)
    expect(store.readLog(a.id)).toBe('one\ntwo\n')
    expect(store.list().map(j => j.id)).toEqual([b.id, a.id])
    expect(store.list('module:a').map(j => j.id)).toEqual([a.id])
    expect(store.get('no-such-job')).toBeNull()
    expect(() => store.get('../escape')).toThrow(/No job/)
  })

  it('passes over a stray file among the records instead of failing on it, and still starts (markInterrupted)', () => {
    const store = new JobStore(repo)
    const real = job({ status: 'queued' })
    store.save(real)
    const dir = join(stateDir(repo), 'jobs')
    for (const name of ['Notes.json', 'a_b.json', 'x.y.json']) writeFileSync(join(dir, name), '{}')
    expect(store.list().map(j => j.id)).toEqual([real.id])
    expect(() => store.markInterrupted()).not.toThrow()
    expect(store.get(real.id)?.status).toBe('interrupted')
  })

  it('lastOk answers when an operation last ended ok on a resource', () => {
    const store = new JobStore(repo)
    store.save(job({ status: 'ok', ended: '2026-10-01T00:00:00.000Z' }))
    store.save(job({ status: 'failed', ended: '2026-10-10T00:00:00.000Z' }))
    store.save(job({ status: 'ok', ended: '2026-10-05T00:00:00.000Z' }))
    expect(store.lastOk('module.checks', 'module:a')).toBe('2026-10-05T00:00:00.000Z')
    expect(store.lastOk('module.checks', 'module:z')).toBeNull()
  })

  it('marks jobs a dead server left running as interrupted, keeps their log, re-runs nothing (Review Focus 4)', () => {
    const first = new JobStore(repo)
    const running = job({ status: 'running', started: new Date().toISOString() }), waiting = job({ status: 'queued' }), done = job({ status: 'ok' })
    for (const j of [running, waiting, done]) first.save(j)
    first.appendLog(running.id, 'half a log\n')
    const second = new JobStore(repo)
    expect(second.markInterrupted()).toBe(2)
    expect(second.get(running.id)).toMatchObject({ status: 'interrupted', sentence: expect.stringMatching(/server stopped while this job was running/) })
    expect(second.get(waiting.id)?.status).toBe('interrupted')
    expect(second.get(done.id)?.status).toBe('ok')
    expect(second.readLog(running.id)).toBe('half a log\n')
  })
})

describe('layouts', () => {
  it('round-trip per board, and clear', () => {
    expect(readLayout(repo, 'systems')).toEqual({})
    writeLayout(repo, 'systems', { 'module:a': { x: 10, y: 20 } })
    expect(readLayout(repo, 'systems')).toEqual({ 'module:a': { x: 10, y: 20 } })
    expect(readLayout(repo, 'organization')).toEqual({})
    expect(existsSync(join(stateDir(repo), 'layout-systems.json'))).toBe(true)
    clearLayout(repo, 'systems')
    expect(readLayout(repo, 'systems')).toEqual({})
    expect(existsSync(join(stateDir(repo), 'layout-systems.json'))).toBe(false)
  })

  it('validPositions refuses what is not a map of finite x and y', () => {
    expect(validPositions({ a: { x: 1, y: 2 } })).toEqual({ a: { x: 1, y: 2 } })
    expect(validPositions([])).toMatch(/object/)
    expect(validPositions({ a: { x: '1', y: 2 } })).toMatch(/"a"/)
    expect(validPositions({ a: { x: Infinity, y: 2 } })).toMatch(/"a"/)
    expect(validPositions(Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`n${i}`, { x: 0, y: 0 }])))).toMatch(/5000/)
  })
})

describe('moveJob', () => {
  const rec = (status: JobRecord['status']): JobRecord => ({ id: 'j1', op: 'x', resource: 'project:p', label: 'X', cmd: null, args: [], writes: [],
    status, created: '2026-10-17T10:00:00Z', started: null, ended: null, exitCode: null, changed: [], surprises: [], sentence: null })

  it('moves a job along the job machine', () => {
    const j = rec('queued')
    moveJob(j, { type: 'START' })
    expect(j.status).toBe('running')
    moveJob(j, { type: 'FINISH', status: 'timed-out' })
    expect(j.status).toBe('timed-out')
  })

  it('a job that has ended cannot end again: the move throws and the record keeps its end (Review Focus 2)', () => {
    const j = rec('ok')
    expect(() => moveJob(j, { type: 'FINISH', status: 'failed' })).toThrow("job j1: That can't be done now: Done.")
    expect(j.status).toBe('ok')
  })

  it('a queued job is cancelled, not finished', () => {
    expect(() => moveJob(rec('queued'), { type: 'FINISH', status: 'ok' })).toThrow(/^job j1: /)
  })

  it('a status the machine does not know is named, not blamed on ok', () => {
    const j = rec('running')
    expect(() => moveJob(j, { type: 'FINISH', status: 'bogus' })).toThrow('job j1: unknown status "bogus"')
    expect(j.status).toBe('running')
  })
})
