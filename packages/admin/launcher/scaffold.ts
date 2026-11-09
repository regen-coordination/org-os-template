import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneConfigText, type Answers } from '../lib/open-instance.mjs'

export interface ScaffoldResult { code: number; log: string }

/** The arguments the framework's clone command is given. Never `--force` (it refuses a folder that holds files, and that
 *  refusal is kept) and never `--dry` (that would write nothing). */
export function scaffoldArgs(frameworkDir: string, target: string, config: string, opts: { git: boolean }): string[] {
  return [join(frameworkDir, 'scripts', 'clone-framework.mjs'), '--target', target, '--config', config, ...(opts.git ? [] : ['--no-git'])]
}

/** Runs `clone:framework` for `answers` into `target` (absolute). The config goes in a temp file that is removed after.
 *  `log` is the last 20 lines of what the command printed. */
export async function scaffold(answers: Answers, target: string, opts: { git: boolean }, frameworkDir: string): Promise<ScaffoldResult> {
  const dir = mkdtempSync(join(tmpdir(), 'org-os-scaffold-'))
  const config = join(dir, 'config.yaml')
  try {
    writeFileSync(config, cloneConfigText(answers))
    const args = scaffoldArgs(frameworkDir, target, config, opts)
    return await new Promise<ScaffoldResult>(resolve => {
      let out = ''
      const child = spawn(process.execPath, args, { cwd: frameworkDir, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', d => { out += d })
      child.stderr.on('data', d => { out += d })
      const done = (code: number) => resolve({ code, log: out.trim().split('\n').slice(-20).join('\n') })
      child.on('error', err => { out += `\n${err.message}`; done(1) })
      child.on('close', code => done(code ?? 1))
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
