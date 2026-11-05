import { spawn } from 'node:child_process'
import { HttpError } from '../errors.ts'
import { JobStore, newJobId, moveJob, type JobRecord } from '../state.ts'
import { snapshot, changedBetween, outside, type Snapshot } from './changes.ts'
import type { InProcess, Operation, Planned } from './catalogue.ts'
import type { Resource } from '../resources/types.ts'

export const MAX_RUNNING = 2
export const KILL_GRACE_MS = 5000

export interface Run { op: Operation; resource: Resource; planned: Planned | InProcess }
export interface ExecutorEvents {
  started(job: JobRecord): void
  output(job: JobRecord, chunk: string): void
  finished(job: JobRecord): void
}
/** Hosted mode adds a second executor that turns a run into a request to an agent (spec §5.3). */
export interface Executor { submit(run: Run): JobRecord; cancel(id: string): boolean }

export const tail = (log: string, n = 20): string => log.trimEnd().split('\n').slice(-n).join('\n')

interface Outcome {
  exitCode: number | null; failure: string | null; cancelled: boolean; timedOut: boolean
  changed: string[]; surprises: string[]; overlapped: boolean; log: string; timeoutMs: number
  /** Why the changed files could not be worked out, when a snapshot failed. */
  unchecked?: string | null
}

/** How a job ended, as a status and a sentence. Nothing is ever committed (spec §12.1), so every
 *  sentence that names changed files says so. */
export function decide(o: Outcome): Pick<JobRecord, 'status' | 'exitCode' | 'changed' | 'surprises' | 'sentence'> {
  const changed = o.changed.length ? ` It changed ${o.changed.join(', ')}; nothing was committed.`
    : o.unchecked ? ` It could not check which files changed (${o.unchecked}), so do not assume none did.` : ''
  const also = o.overlapped && o.changed.length ? ' Another job ran at the same time, so some of these may be its.' : ''
  const base = { exitCode: o.exitCode, changed: o.changed, surprises: o.surprises }
  if (o.cancelled) return { ...base, status: 'cancelled', sentence: `Cancelled.${changed}${also}` }
  if (o.timedOut) return { ...base, status: 'timed-out', sentence: `Stopped after ${Math.floor(o.timeoutMs / 1000)} s without finishing.${changed}${also}` }
  if (o.failure) return { ...base, status: 'failed', sentence: `Failed: ${o.failure}.${changed}${also}` }
  if (o.exitCode !== 0) return { ...base, status: 'failed', sentence: `Failed with exit code ${o.exitCode}.${changed}${also}\n${tail(o.log)}` }
  if (o.surprises.length) {
    return { ...base, status: 'finished-with-surprises',
      sentence: `Finished, and changed files it does not declare: ${o.surprises.join(', ')}. Nothing was committed and nothing was put back; look at them before you commit.${also}` }
  }
  return { ...base, status: 'ok', sentence: o.changed.length || o.unchecked ? `Done.${changed}${also}` : 'Done. No file changed.' }
}

interface Live { job: JobRecord; stop: () => void; cancelled: boolean; timedOut: boolean; exited: boolean; overlapped: boolean; shutdown?: boolean }

/** How long to wait for the output pipes to close once the process itself has exited: a
 *  grandchild that inherited them can hold them open long after. */
const CLOSE_WAIT_MS = 2000

/** Process groups of every live job, across executors: the synchronous backstop below needs them
 *  when the server dies without getting to stopAll(). Jobs run detached, so nothing else would end them. */
const livePids = new Set<number>()
let backstop = false
function armBackstop(): void {
  if (backstop) return
  backstop = true
  process.on('exit', () => {
    for (const pid of livePids) { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }
  })
}

const message = (err: unknown): string => err instanceof Error ? err.message : String(err)

export class LocalExecutor implements Executor {
  private queue: { job: JobRecord; run: Run }[] = []
  private running = new Map<string, Live>()
  private maxRunning: number
  private killGraceMs: number

  constructor(private repo: string, private jobs: JobStore, private events: ExecutorEvents,
    opts: { maxRunning?: number; killGraceMs?: number } = {}) {
    this.maxRunning = opts.maxRunning ?? MAX_RUNNING
    this.killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS
    armBackstop()
  }

  /** For the server's shutdown: end everything that is waiting or running, and wait (a bounded time)
   *  for the processes to go. */
  async stopAll(): Promise<void> {
    for (const q of this.queue.splice(0)) {
      this.finish(q.job, { status: 'cancelled', exitCode: null, changed: [], surprises: [], sentence: 'Stopped: the server is shutting down.' })
    }
    for (const live of this.running.values()) {
      if (live.exited) continue
      live.shutdown = true
      live.cancelled = true
      live.stop()
    }
    const deadline = Date.now() + this.killGraceMs + 500
    while (this.running.size > 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
  }

  submit(run: Run): JobRecord {
    const id = run.resource.id
    if ([...this.running.values()].some(r => r.job.resource === id) || this.queue.some(q => q.job.resource === id)) {
      throw new HttpError(409, `A job is already running or waiting on ${run.resource.name}. Wait for it to end, or cancel it, then run this again.`)
    }
    const p = run.planned
    const job: JobRecord = {
      id: newJobId(), op: run.op.id, resource: id, label: run.op.label(run.resource),
      cmd: 'cmd' in p ? p.cmd : null, args: 'cmd' in p ? p.args : [], writes: 'cmd' in p ? p.writes : [],
      status: 'queued', created: new Date().toISOString(), started: null, ended: null,
      exitCode: null, changed: [], surprises: [], sentence: null,
    }
    this.jobs.save(job)
    this.queue.push({ job, run })
    this.pump()
    return job
  }

  cancel(id: string): boolean {
    const waiting = this.queue.findIndex(q => q.job.id === id)
    if (waiting >= 0) {
      const [{ job }] = this.queue.splice(waiting, 1)
      this.finish(job, { status: 'cancelled', exitCode: null, changed: [], surprises: [], sentence: 'Cancelled before it started.' })
      return true
    }
    const live = this.running.get(id)
    // Once the work is over there is nothing left to cancel; saying so would relabel a finished run.
    if (!live || live.exited) return false
    live.cancelled = true
    live.stop()
    return true
  }

  /** A listener is someone else's code: if it throws it must not strand the job it was told about. */
  private emit(what: string, fn: () => void): void {
    try { fn() } catch (err) { console.error(`org-os executor: the ${what} listener threw (${message(err)}); the job goes on.`) }
  }

  private pump(): void {
    while (this.running.size < this.maxRunning && this.queue.length > 0) {
      const next = this.queue.shift()!
      this.start(next.job, next.run).catch(err => console.error(`org-os executor: could not end job ${next.job.id}: ${message(err)}`))
    }
  }

  private async start(job: JobRecord, run: Run): Promise<void> {
    const live: Live = { job, stop: () => {}, cancelled: false, timedOut: false, exited: false, overlapped: this.running.size > 0 }
    // The caveat is mutual: whoever is already running shares the tree with this job too.
    for (const other of this.running.values()) other.overlapped = true
    this.running.set(job.id, live)
    try {
      await this.work(job, run, live)
    } catch (err) {
      live.stop()
      this.running.delete(job.id)
      try {
        this.finish(job, { status: 'failed', exitCode: null, changed: [], surprises: [], sentence: `Failed: ${message(err)}.` })
      } catch (again) { console.error(`org-os executor: could not record the end of job ${job.id}: ${message(again)}`) }
    } finally {
      this.running.delete(job.id)
      this.pump()
    }
  }

  private async work(job: JobRecord, run: Run, live: Live): Promise<void> {
    moveJob(job, { type: 'START' })
    job.started = new Date().toISOString()
    this.jobs.save(job)
    this.emit('started', () => this.events.started(job))
    const out = (chunk: string) => {
      try { this.jobs.appendLog(job.id, chunk) } catch (err) { console.error(`org-os executor: could not log output of ${job.id}: ${message(err)}`) }
      this.emit('output', () => this.events.output(job, chunk))
    }

    let unchecked: string | null = null
    const look = () => snapshot(this.repo).catch((err: unknown) => { unchecked = message(err); return null })
    const before: Snapshot | null = await look()
    let exitCode: number | null = null
    let failure: string | null = null
    try {
      // A cancel can arrive while the first snapshot is taken, before there is a process to stop.
      if (live.cancelled) { /* nothing was started */ }
      else if ('inProcess' in run.planned) {
        const ctl = new AbortController()
        live.stop = () => ctl.abort()
        const timer = setTimeout(() => { live.timedOut = true; ctl.abort() }, run.op.timeoutMs)
        // Work that ignores the signal must still end on time, so the abort is raced against it.
        const aborted = new Promise<never>((_, reject) => {
          ctl.signal.addEventListener('abort', () => reject(new Error('stopped before it finished')), { once: true })
        })
        aborted.catch(() => {})
        const work = run.planned.inProcess(this.repo, ctl.signal)
        work.catch(() => {})
        try { out(await Promise.race([work, aborted])); exitCode = 0 } finally { clearTimeout(timer); live.exited = true }
      } else {
        exitCode = await this.spawn(run.planned, live, out, run.op.timeoutMs)
      }
    } catch (err) { failure = message(err) }
    live.exited = true

    const after: Snapshot | null = await look()
    const changed = before && after ? changedBetween(before, after) : []
    const writes = 'cmd' in run.planned ? run.planned.writes : []
    this.running.delete(job.id)
    const end = decide({ exitCode, failure, cancelled: live.cancelled, timedOut: live.timedOut,
      changed, surprises: outside(changed, writes), overlapped: live.overlapped, log: this.jobs.readLog(job.id),
      timeoutMs: run.op.timeoutMs, unchecked })
    if (live.shutdown) end.sentence = (end.sentence ?? '').replace(/^Cancelled\./, 'Stopped: the server is shutting down.')
    this.finish(job, end)
  }

  private spawn(p: Planned, live: Live, out: (chunk: string) => void, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
      // Its own process group, so a stop reaches the grandchildren (npm -> sh -> script) too.
      const child = spawn(p.cmd, p.args, { cwd: this.repo, shell: false, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      const signal = (sig: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, sig)
          else child.kill(sig)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') { try { child.kill(sig) } catch { /* already gone */ } }
        }
      }
      if (child.pid) livePids.add(child.pid)
      const pid = child.pid
      let kill: NodeJS.Timeout | undefined
      let closeWait: NodeJS.Timeout | undefined
      let settled = false
      const settle = (code: number | null) => {
        if (settled) return
        settled = true
        if (pid) livePids.delete(pid)
        clearTimeout(limit); clearTimeout(kill); clearTimeout(closeWait)
        resolve(code)
      }
      live.stop = () => {
        if (live.exited) return
        signal('SIGTERM')
        kill = setTimeout(() => signal('SIGKILL'), this.killGraceMs)
      }
      if (live.cancelled) live.stop() // cancelled between the snapshot and the spawn
      const limit = setTimeout(() => { if (live.exited) return; live.timedOut = true; live.stop() }, timeoutMs)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d: string) => out(d))
      child.stderr.on('data', (d: string) => out(d))
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        if (pid) livePids.delete(pid)
        clearTimeout(limit); clearTimeout(kill); clearTimeout(closeWait)
        reject(new Error(`could not start ${p.cmd}: ${err.code === 'ENOENT' ? 'no such command on this machine' : err.message}`))
      })
      child.on('exit', code => {
        live.exited = true
        // A clean exit is not a timeout, even if the pipes stay open a while longer.
        clearTimeout(limit); clearTimeout(kill)
        // Anything left in the group after the process is gone is a stray: end it, then stop waiting
        // for pipes it may still hold.
        if (live.cancelled || live.timedOut) signal('SIGKILL')
        closeWait = setTimeout(() => { signal('SIGKILL'); settle(code) }, CLOSE_WAIT_MS)
      })
      child.on('close', code => settle(code))
    })
  }

  private finish(job: JobRecord, end: Pick<JobRecord, 'status' | 'exitCode' | 'changed' | 'surprises' | 'sentence'>): void {
    const { status, ...rest } = end
    // A queued job only ever ends cancelled; a running one ends however its run did (job machine).
    moveJob(job, job.status === 'queued' && status === 'cancelled' ? { type: 'CANCEL' } : { type: 'FINISH', status })
    Object.assign(job, rest, { ended: new Date().toISOString() })
    this.jobs.save(job)
    this.emit('finished', () => this.events.finished(job))
  }
}
