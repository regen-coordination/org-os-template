import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { instanceSlug } from './resources/util.ts'
import { HttpError } from './errors.ts'
import type { Board } from './resources/types.ts'
import { transition, type MachineEvent } from '../lib/machines/run.mjs'
import { job as jobMachine, jobGuards } from '../lib/machines/job.mjs'

/** Where this instance's job records and layouts live: outside the repository, so that running
 *  the board never leaves a file for git to see and no instance needs a new ignore rule. */
export function stateDir(repo: string): string {
  const home = process.env.ORG_OS_ADMIN_HOME ?? join(homedir(), '.org-os', 'admin')
  const tag = createHash('sha1').update(repo).digest('hex').slice(0, 6)
  return join(home, `${instanceSlug(repo)}-${tag}`)
}

/** Where a listening server of `repo` records its pid; it removes the file when it closes. */
export const serverPidFile = (repo: string): string => join(stateDir(repo), 'server.pid')

/** A process that is alive and is not this one. `kill(pid, 0)` sends nothing; EPERM still means the process exists. */
export function otherLive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false
  try { process.kill(pid, 0); return true } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM' }
}

/** The pid of another live process that the pid file of `repo` names (a server of this repository), or null. */
export function runningServer(repo: string): number | null {
  let pid = NaN
  try { pid = Number(readFileSync(serverPidFile(repo), 'utf8').trim()) } catch { /* none recorded */ }
  return otherLive(pid) ? pid : null
}

export type JobStatus = 'queued' | 'running' | 'ok' | 'failed' | 'timed-out' | 'cancelled' | 'finished-with-surprises' | 'interrupted'
export const FINAL: JobStatus[] = ['ok', 'failed', 'timed-out', 'cancelled', 'finished-with-surprises', 'interrupted']

/** Moves a job along the job machine (lib/machines/job.mjs). An illegal move is a programming
 *  error, so it throws, and the record keeps the status it had. */
export function moveJob(job: JobRecord, event: MachineEvent): void {
  if (event.type === 'FINISH' && ![...FINAL, 'queued', 'running'].includes(event.status as JobStatus)) {
    throw new Error(`job ${job.id}: unknown status "${String(event.status)}"`)
  }
  const r = transition(jobMachine, jobGuards, job.status, event, job)
  if (!r.ok) throw new Error(`job ${job.id}: ${r.reason}`)
  job.status = r.state as JobStatus
}

export interface JobRecord {
  id: string; op: string; resource: string; label: string
  cmd: string | null; args: string[]; writes: string[]
  status: JobStatus; created: string; started: string | null; ended: string | null
  exitCode: number | null; changed: string[]; surprises: string[]; sentence: string | null
}

export const newJobId = (): string => `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`

/** What a job id may look like. Ids arrive in URLs, and file names in the jobs folder are
 *  read back as ids, so both are checked against this one pattern. */
const JOB_ID = /^[a-z0-9-]+$/

export class JobStore {
  private dir: string
  constructor(repo: string) {
    this.dir = join(stateDir(repo), 'jobs')
    mkdirSync(this.dir, { recursive: true })
  }

  /** A job's file. The id is checked, because it arrives in URLs. */
  private file(id: string, ext: 'json' | 'log'): string {
    if (!JOB_ID.test(id)) throw new HttpError(404, `No job "${id}".`)
    return join(this.dir, `${id}.${ext}`)
  }

  save(job: JobRecord): void {
    const file = this.file(job.id, 'json')
    writeFileSync(`${file}.tmp`, JSON.stringify(job, null, 2))
    renameSync(`${file}.tmp`, file) // a reader never sees half a record
  }

  get(id: string): JobRecord | null {
    const file = this.file(id, 'json')
    if (!existsSync(file)) return null
    try { return JSON.parse(readFileSync(file, 'utf8')) as JobRecord } catch { return null }
  }

  appendLog(id: string, chunk: string): void { appendFileSync(this.file(id, 'log'), chunk) }

  readLog(id: string): string {
    const file = this.file(id, 'log')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }

  list(resource?: string, limit = 50): JobRecord[] {
    // A stray file here (a note, a leftover .tmp) is passed over: one bad name must not stop the
    // list, or the server at startup.
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.json') && JOB_ID.test(f.slice(0, -'.json'.length)))
      .map(f => this.get(f.slice(0, -'.json'.length)))
      .filter((j): j is JobRecord => j !== null && (!resource || j.resource === resource))
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, limit)
  }

  lastOk(op: string, resource: string): string | null {
    const ends = this.list(resource, Number.MAX_SAFE_INTEGER)
      .filter(j => j.op === op && j.status === 'ok' && j.ended).map(j => j.ended!).sort()
    return ends.at(-1) ?? null
  }

  /** At startup: a job the records call queued or running belonged to a server that is gone.
   *  It is marked, never started again — re-running a seat or an ingest unasked is worse than
   *  saying it was cut short. */
  markInterrupted(): number {
    let n = 0
    for (const j of this.list(undefined, Number.MAX_SAFE_INTEGER)) {
      if (j.status !== 'queued' && j.status !== 'running') continue
      const next = { ...j }
      moveJob(next, { type: 'INTERRUPT' })
      this.save({ ...next, ended: new Date().toISOString(),
        sentence: 'The server stopped while this job was running or waiting. It was not run again; its log is what it wrote before that.' })
      n++
    }
    return n
  }
}

export type Positions = Record<string, { x: number; y: number }>
const layoutFile = (repo: string, board: Board) => join(stateDir(repo), `layout-${board}.json`)

export function readLayout(repo: string, board: Board): Positions {
  try { return JSON.parse(readFileSync(layoutFile(repo, board), 'utf8')) as Positions } catch { return {} }
}
export function writeLayout(repo: string, board: Board, positions: Positions): void {
  mkdirSync(stateDir(repo), { recursive: true })
  writeFileSync(layoutFile(repo, board), JSON.stringify(positions))
}
export function clearLayout(repo: string, board: Board): void { rmSync(layoutFile(repo, board), { force: true }) }

/** The positions, or the sentence saying what is wrong with them. */
export function validPositions(v: unknown): Positions | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'A layout is a JSON object of card ids to {"x": number, "y": number}.'
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length > 5000) return 'A layout holds at most 5000 cards.'
  for (const [id, p] of entries) {
    const o = p as { x?: unknown; y?: unknown } | null
    if (!o || typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) {
      return `The position of "${id}" must be {"x": number, "y": number}.`
    }
  }
  return v as Positions
}

/** A name safe as one file name anywhere that still tells two names apart: the readable part keeps
 *  letters, digits, '.', '_' and '-'; the hash keeps `a:b` and `a_b` apart. */
export function fileSafe(name: string): string {
  return `${name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)}-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`
}
