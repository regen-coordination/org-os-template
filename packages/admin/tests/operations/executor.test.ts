import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { LocalExecutor, MAX_RUNNING, KILL_GRACE_MS, type Run } from '../../server/operations/executor.ts'
import { JobStore, type JobRecord } from '../../server/state.ts'
import type { Operation } from '../../server/operations/catalogue.ts'
import type { Resource } from '../../server/resources/types.ts'

let repo: string
let jobs: JobStore
let finished: JobRecord[]
let output: string[]
let exec: LocalExecutor
beforeEach(() => {
  repo = makeFixtureRepo()
  jobs = new JobStore(repo)
  finished = []; output = []
  exec = new LocalExecutor(repo, jobs, { started: () => {}, output: (_j, c) => output.push(c), finished: j => finished.push(j) }, { killGraceMs: 200 })
})
afterEach(() => removeFixtureRepo(repo))

const resource = (id = 'module:a'): Resource => ({ id, kind: 'module', board: 'systems', name: id, status: null, attention: null, changed: null, facts: {}, source: null })
const op = (over: Partial<Operation> = {}): Operation => ({
  id: 'test.op', kinds: ['module'], label: () => 'Test op', effect: 'changes', network: false, timeoutMs: 20_000,
  params: { type: 'object', additionalProperties: false }, unavailable: () => null, refreshes: 'modules',
  plan: () => ({ cmd: process.execPath, args: ['-e', ''], writes: [] }), ...over,
})
const node = (code: string, writes: string[] = [], over: Partial<Operation> = {}, id?: string): Run =>
  ({ op: op(over), resource: resource(id), planned: { cmd: process.execPath, args: ['-e', code], writes } })
const ended = (id: string) => expect.poll(() => finished.find(j => j.id === id), { interval: 20, timeout: 15_000 }).toBeTruthy()
const result = (id: string) => finished.find(j => j.id === id)!
const commits = () => execSync('git rev-list --count HEAD', { cwd: repo }).toString().trim()

describe('LocalExecutor', () => {
  it('runs a command, streams its output, keeps its log, and says nothing changed', async () => {
    const job = exec.submit(node('console.log("hello")'))
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'ok', exitCode: 0, changed: [], surprises: [], sentence: 'Done. No file changed.' })
    expect(output.join('')).toBe('hello\n')
    expect(jobs.readLog(job.id)).toBe('hello\n')
    expect(jobs.get(job.id)?.status).toBe('ok')
  })

  it('names the files it changed and commits nothing', async () => {
    const before = commits()
    const job = exec.submit(node('require("fs").mkdirSync("notes");require("fs").writeFileSync("notes/a.md","x")', ['notes/']))
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'ok', changed: ['notes/a.md'], surprises: [],
      sentence: 'Done. It changed notes/a.md; nothing was committed.' })
    expect(commits()).toBe(before)
  })

  it('ends finished-with-surprises when it changes a path it did not declare', async () => {
    const job = exec.submit(node('require("fs").writeFileSync("stray.md","x")', ['notes/']))
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'finished-with-surprises', surprises: ['stray.md'] })
    expect(result(job.id).sentence).toMatch(/does not declare: stray\.md\. Nothing was committed and nothing was put back/)
  })

  it('reports a failure with its exit code and the last lines of output', async () => {
    const job = exec.submit(node('console.error("bad thing"); process.exit(3)'))
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'failed', exitCode: 3 })
    expect(result(job.id).sentence).toMatch(/^Failed with exit code 3\.[\s\S]*bad thing/)
  })

  it('says so when the command does not exist', async () => {
    const job = exec.submit({ op: op(), resource: resource(), planned: { cmd: 'no-such-command-for-org-os', args: [], writes: [] } })
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'failed', sentence: 'Failed: could not start no-such-command-for-org-os: no such command on this machine.' })
  })

  it('stops a job at its time limit', async () => {
    const job = exec.submit(node('setTimeout(() => {}, 30000)', [], { timeoutMs: 300 }))
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'timed-out', sentence: 'Stopped after 0 s without finishing.' })
  })

  it('cancels a running job, and a waiting one', async () => {
    const running = exec.submit(node('setTimeout(() => {}, 30000)', [], {}, 'module:a'))
    expect(exec.cancel(running.id)).toBe(true)
    await ended(running.id)
    expect(result(running.id).status).toBe('cancelled')
    expect(exec.cancel('no-such-job')).toBe(false)
  })

  it('runs one job per resource: a second is refused in words (Review Focus 2)', async () => {
    const first = exec.submit(node('setTimeout(() => {}, 500)', [], {}, 'module:a'))
    expect(() => exec.submit(node('', [], {}, 'module:a'))).toThrow(/already running or waiting on module:a/)
    await ended(first.id)
    expect(result(first.id).status).toBe('ok')
  })

  it(`runs at most ${MAX_RUNNING} at once; the rest wait their turn`, async () => {
    const ids = ['module:a', 'module:b', 'module:c'].map(id => exec.submit(node('setTimeout(() => {}, 400)', [], {}, id)).id)
    expect(ids.map(id => jobs.get(id)!.status)).toEqual(['running', 'running', 'queued'])
    for (const id of ids) await ended(id)
    expect(ids.map(id => result(id).status)).toEqual(['ok', 'ok', 'ok'])
    expect(KILL_GRACE_MS).toBe(5000)
  })

  it('runs in-process work and logs what it answers', async () => {
    const job = exec.submit({ op: op({ effect: 'reads' }), resource: resource(), planned: { inProcess: async () => '✓ a.md\n' } })
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'ok', cmd: null })
    expect(jobs.readLog(job.id)).toBe('✓ a.md\n')
  })

  it('cancels a waiting job before it starts', async () => {
    const a = exec.submit(node('setTimeout(() => {}, 30000)', [], {}, 'module:a'))
    const b = exec.submit(node('setTimeout(() => {}, 30000)', [], {}, 'module:b'))
    const c = exec.submit(node('', [], {}, 'module:c'))
    expect(jobs.get(c.id)!.status).toBe('queued')
    expect(exec.cancel(c.id)).toBe(true)
    expect(result(c.id)).toMatchObject({ status: 'cancelled', sentence: 'Cancelled before it started.' })
    exec.cancel(a.id); exec.cancel(b.id)
    await ended(a.id); await ended(b.id)
  })

  it('cancels a process that is already producing output', async () => {
    const job = exec.submit(node('console.log("go"); setTimeout(() => {}, 30000)'))
    await expect.poll(() => output.join(''), { interval: 20, timeout: 10_000 }).toContain('go')
    expect(exec.cancel(job.id)).toBe(true)
    await ended(job.id)
    expect(result(job.id).status).toBe('cancelled')
  })

  it('ends a job whose process ignores SIGTERM and whose grandchild holds the pipes', async () => {
    const grandchild = 'process.on("SIGTERM",()=>{});setTimeout(()=>{},30000)'
    const code = `process.on("SIGTERM",()=>{});const g=require("child_process").spawn(process.execPath,["-e",${JSON.stringify(grandchild)}],{stdio:"inherit"});console.log("pid="+g.pid);setTimeout(()=>{},30000)`
    const t0 = Date.now()
    const job = exec.submit(node(code, [], { timeoutMs: 300 }))
    await ended(job.id)
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(result(job.id).status).toBe('timed-out')
    const pid = Number(/pid=(\d+)/.exec(jobs.readLog(job.id))![1])
    await expect.poll(() => { try { process.kill(pid, 0); return 'alive' } catch { return 'gone' } }, { interval: 50, timeout: 5000 }).toBe('gone')
  })

  it('a listener that throws cannot strand a job or block the next one', async () => {
    const bad = new LocalExecutor(repo, jobs, { started: () => { throw new Error('boom') }, output: () => { throw new Error('boom') }, finished: j => finished.push(j) }, { killGraceMs: 200 })
    const first = bad.submit(node('console.log("x")', [], {}, 'module:a'))
    const second = bad.submit(node('', [], {}, 'module:b'))
    await ended(first.id); await ended(second.id)
    expect(result(first.id).status).toBe('ok')
    expect(result(second.id).status).toBe('ok')
    const third = bad.submit(node('', [], {}, 'module:a'))
    await ended(third.id)
  })

  it('tells the first job too that another ran at the same time', async () => {
    const a = exec.submit(node('setTimeout(() => {}, 1000)', [], {}, 'module:a'))
    const b = exec.submit(node('require("fs").writeFileSync("stray.md","x")', [], {}, 'module:b'))
    await ended(a.id); await ended(b.id)
    expect(result(a.id).sentence).toMatch(/Another job ran at the same time/)
    expect(result(b.id).sentence).toMatch(/Another job ran at the same time/)
  })

  const holder = `require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},800)"],{stdio:"inherit"}).unref();console.log("pid="+process.pid)`

  it('does not call a job cancelled once its process has already exited', async () => {
    const job = exec.submit(node(holder))
    await expect.poll(() => output.join(''), { interval: 5, timeout: 10_000 }).toMatch(/pid=\d+/)
    const pid = Number(/pid=(\d+)/.exec(output.join(''))![1])
    // ESRCH comes only after Node reaped the child, in the callback that emits its exit.
    await expect.poll(() => { try { process.kill(pid, 0); return 'alive' } catch { return 'gone' } }, { interval: 1, timeout: 10_000 }).toBe('gone')
    expect(exec.cancel(job.id)).toBe(false)
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'ok', exitCode: 0 })
  })

  it('does not call a clean exit a timeout while the pipes are still held open', async () => {
    const job = exec.submit(node(holder, [], { timeoutMs: 300 }))
    await ended(job.id)
    expect(result(job.id)).toMatchObject({ status: 'ok', exitCode: 0 })
  })

  it('stopAll ends running and waiting jobs and their processes', async () => {
    const slow = 'console.log("pid="+process.pid);setTimeout(()=>{},30000)'
    const a = exec.submit(node(slow, [], {}, 'module:a'))
    exec.submit(node(slow, [], {}, 'module:b'))
    const c = exec.submit(node(slow, [], {}, 'module:c'))
    await expect.poll(() => output.join(''), { interval: 20, timeout: 10_000 }).toMatch(/pid=\d+[\s\S]*pid=\d+/)
    const pids = [...output.join('').matchAll(/pid=(\d+)/g)].map(m => Number(m[1]))
    await exec.stopAll()
    expect(result(a.id)).toMatchObject({ status: 'cancelled', sentence: expect.stringMatching(/^Stopped: the server is shutting down\./) })
    expect(result(c.id)).toMatchObject({ status: 'cancelled', sentence: 'Stopped: the server is shutting down.' })
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow()
  })

  it('names the overlap on a job that ended ok, when its declared write was the other job\'s', async () => {
    const a = exec.submit(node('setTimeout(() => {}, 1000)', ['shared.md'], {}, 'module:a'))
    exec.submit(node('require("fs").writeFileSync("shared.md","x")', ['shared.md'], {}, 'module:b'))
    await ended(a.id)
    expect(result(a.id)).toMatchObject({ status: 'ok', surprises: [] })
    expect(result(a.id).sentence).toMatch(/Another job ran at the same time/)
  })

  it('does not claim nothing changed when it could not look', async () => {
    const broken = new LocalExecutor('/no/such/dir/for/org-os', jobs, { started: () => {}, output: () => {}, finished: j => finished.push(j) }, { killGraceMs: 200 })
    const job = broken.submit({ op: op({ effect: 'reads' }), resource: resource(), planned: { inProcess: async () => 'ok\n' } })
    await ended(job.id)
    expect(result(job.id).status).toBe('ok')
    expect(result(job.id).sentence).not.toMatch(/No file changed/)
    expect(result(job.id).sentence).toMatch(/could not check which files changed/)
  })

  it('stops in-process work that ignores its abort signal', async () => {
    const job = exec.submit({ op: op({ effect: 'reads', timeoutMs: 300 }), resource: resource(), planned: { inProcess: () => new Promise<string>(() => {}) } })
    await ended(job.id)
    expect(result(job.id).status).toBe('timed-out')
  })

  it('decodes a multibyte character split across chunks', async () => {
    const job = exec.submit(node('const b=Buffer.from("é");process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),100)'))
    await ended(job.id)
    expect(jobs.readLog(job.id)).toBe('é')
  })

  it('every recorded status is one the job machine reached: queued, then running, then its end', async () => {
    const seen: string[] = []
    const save = jobs.save.bind(jobs)
    jobs.save = (j: JobRecord) => { seen.push(j.status); save(j) }
    const job = exec.submit({ op: op({ effect: 'reads' }), resource: resource(), planned: { inProcess: async () => 'hello\n' } })
    await ended(job.id)
    expect(seen).toEqual(['queued', 'running', 'ok'])
  })
})
