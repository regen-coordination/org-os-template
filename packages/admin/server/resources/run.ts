import { execFile } from 'node:child_process'
import type { Runner } from './types.ts'

/** Runs a command without a shell and always resolves: an adapter turns a failure into a
 *  sentence, never into an exception. `timedOut` is true when the time limit killed it. */
export const runCommand: Runner = (cmd, args, { cwd, timeoutMs }) => new Promise(resolve => {
  execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, shell: false, encoding: 'utf8' }, (err, stdout, stderr) => {
    const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }) | null
    resolve({
      code: e === null ? 0 : typeof e.code === 'number' ? e.code : null,
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? '') || (e && typeof e.code === 'string' ? e.message : ''),
      timedOut: Boolean(e?.killed && e.signal === 'SIGTERM'),
    })
  })
})
