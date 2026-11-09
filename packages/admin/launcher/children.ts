import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { AdminChild, Assess, DoctorSummary, StartAdmin } from './serve.ts'

const unavailable = (message: string): DoctorSummary =>
  ({ status: 'unknown', blockers: 0, warnings: 1, findings: [{ level: 'WARN', code: 'doctor-unavailable', message }] })

/** The instance doctor's JSON (`toJson`) as the launcher keeps it: the totals, and the WARN and BLOCKER findings only. */
export function doctorSummaryOf(json: any): DoctorSummary {
  const findings: DoctorSummary['findings'] = []
  for (const check of Array.isArray(json?.checks) ? json.checks : []) {
    for (const f of Array.isArray(check?.findings) ? check.findings : []) {
      if (f?.level !== 'WARN' && f?.level !== 'BLOCKER') continue
      findings.push({ level: f.level, code: String(f.code), message: String(f.message), ...(f.hint ? { hint: String(f.hint) } : {}) })
    }
  }
  const count = (level: string) => findings.filter(f => f.level === level).length
  return {
    status: typeof json?.status === 'string' ? json.status : 'unknown',
    blockers: Number(json?.summary?.blockers ?? count('BLOCKER')),
    warnings: Number(json?.summary?.warnings ?? count('WARN')),
    findings,
  }
}

/** Runs the instance doctor on `repo`. Exit 1 (blockers) is still a result; anything else that is not JSON is "unavailable". */
export function defaultAssess(frameworkDir: string): Assess {
  return repo => new Promise<DoctorSummary>(resolve => {
    let out = ''
    let err = ''
    const child = spawn(process.execPath, [join(frameworkDir, 'scripts', 'doctor.mjs'), 'assess', '--dir', repo, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', e => resolve(unavailable(`The doctor could not run: ${e.message}`)))
    child.on('close', code => {
      if (code === 0 || code === 1) {
        try { resolve(doctorSummaryOf(JSON.parse(out))); return } catch { /* fall through */ }
      }
      resolve(unavailable(`The doctor gave no result${err.trim() ? `: ${err.trim().split('\n').slice(-2).join(' ')}` : '.'}`))
    })
  })
}

const free = (port: number) => new Promise<boolean>(resolve => {
  const s = createServer()
  s.once('error', () => resolve(false))
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
})

async function firstFreePort(from: number): Promise<number> {
  for (let p = from; p < from + 200; p++) if (await free(p)) return p
  throw new Error('No free port to start the admin on.')
}

/** Starts one admin server per instance, as a child process. `close` (on the returned function) stops every child it started. */
export function defaultStartAdmin(frameworkDir: string): StartAdmin & { closeAll: () => Promise<void> } {
  const children = new Set<ChildProcess>()
  const start = (async (repo: string) => {
    const port = await firstFreePort(4680)
    const child = spawn(process.execPath, ['--import', 'tsx', join(frameworkDir, 'packages', 'admin', 'server', 'index.ts'), '--repo', repo, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.add(child)
    const exited = new Promise<void>(res => child.on('exit', () => { children.delete(child); res() }))
    const stop = () => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    })
    return new Promise<AdminChild>((resolve, reject) => {
      let out = ''
      const lastErr: string[] = []
      const timer = setTimeout(() => { void stop(); reject(new Error(`The admin did not start in 30 seconds.${lastErr.length ? ` ${lastErr.join(' ')}` : ''}`)) }, 30_000)
      child.stdout!.on('data', d => {
        out += d
        const m = out.match(/org-os admin → (http:\/\/localhost:\d+)/)
        if (m) { clearTimeout(timer); resolve({ url: m[1]!, stop, exited }) }
      })
      child.stderr!.on('data', d => { lastErr.push(...String(d).trim().split('\n')); lastErr.splice(0, Math.max(0, lastErr.length - 5)) })
      child.on('error', e => { clearTimeout(timer); reject(e) })
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`The admin stopped (exit ${code}).${lastErr.length ? ` ${lastErr.join(' ')}` : ''}`)) })
    })
  }) as StartAdmin & { closeAll: () => Promise<void> }
  start.closeAll = async () => { await Promise.all([...children].map(c => new Promise<void>(resolve => {
    if (c.exitCode !== null || c.signalCode !== null) { resolve(); return }
    c.once('exit', () => resolve()); c.kill('SIGTERM')
  }))) }
  return start
}
