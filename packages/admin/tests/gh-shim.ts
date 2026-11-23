import { existsSync, readFileSync } from 'node:fs'
import type { Runner } from '../server/resources/types.ts'

export interface GhReply { stdout?: string; code?: number }

/** A fake `gh` for the injected runner (`ctx.run`): nothing real is started, nothing reaches GitHub.
 *  `script` is keyed by the subcommand pair (`issue create`, `auth status`, `--version`, ...); a pair with no
 *  entry exits 1. Every call's argv is recorded, and a `--body-file` is read at call time (the transport
 *  removes it afterwards), so a test can see what was sent without the body ever being on the command line. */
export async function withFakeGh<T>(
  script: Record<string, GhReply>,
  fn: (run: Runner) => Promise<T>,
): Promise<{ result: T; calls: string[][]; bodies: string[] }> {
  const calls: string[][] = []
  const bodies: string[] = []
  const run: Runner = async (cmd, args) => {
    if (cmd !== 'gh') return { code: 127, stdout: '', stderr: `unexpected command ${cmd}`, timedOut: false }
    calls.push(args)
    const at = args.indexOf('--body-file')
    if (at >= 0 && existsSync(args[at + 1] ?? '')) bodies.push(readFileSync(args[at + 1], 'utf8'))
    const key = args[0]?.startsWith('-') ? args[0] : `${args[0]} ${args[1]}`
    const reply = script[key]
    if (!reply) return { code: 1, stdout: '', stderr: 'no such fake', timedOut: false }
    return { code: reply.code ?? 0, stdout: reply.stdout ?? '', stderr: reply.code ? 'failed' : '', timedOut: false }
  }
  const result = await fn(run)
  return { result, calls, bodies }
}
