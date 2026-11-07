import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

// Final review I7: a fetch or a push that needs credentials must fail in words, never wait on a prompt at the server's
// terminal. Whatever the shell that started the tests says, this file starts with prompts allowed: the setting under
// test must come from server/git.ts itself. (vi.hoisted runs before the imports below.)
vi.hoisted(() => { delete process.env.GIT_TERMINAL_PROMPT })

import { fetchRemote, gitVersion } from '../../server/git.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** Runs `fn` with a `git` first on PATH that writes the GIT_TERMINAL_PROMPT it was started with (or "unset") and its
 *  subcommand to a marker, one line per start, then passes everything to the real git. Only this file sees the PATH. */
async function withPromptTrace(fn: () => Promise<void>): Promise<string[]> {
  const real = execSync('command -v git', { shell: '/bin/sh' }).toString().trim()
  const dir = mkdtempSync(join(tmpdir(), 'git-prompt-'))
  dirs.push(dir)
  const marker = join(dir, 'seen')
  writeFileSync(join(dir, 'git'), `#!/bin/sh\necho "\${GIT_TERMINAL_PROMPT-unset} $1" >> "${marker}"\nexec "${real}" "$@"\n`, { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = `${dir}:${path ?? ''}`
  try { await fn() } finally { process.env.PATH = path }
  return readFileSync(marker, 'utf8').trim().split('\n')
}

describe('git never prompts on the server\'s terminal', () => {
  it('the module sets GIT_TERMINAL_PROMPT=0 when it loads', () => {
    expect(process.env.GIT_TERMINAL_PROMPT).toBe('0')
  })
  it('every git it starts, a fetch among them, sees GIT_TERMINAL_PROMPT=0', async () => {
    const root = mkdtempSync(join(tmpdir(), 'git-prompt-repo-'))
    dirs.push(root)
    const env = { ...process.env, GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'ana@example.test', GIT_COMMITTER_NAME: 'ana', GIT_COMMITTER_EMAIL: 'ana@example.test' }
    execSync('git init -q --bare -b main remote.git && git init -q -b main mine', { cwd: root, env, stdio: 'pipe' })
    const mine = join(root, 'mine')
    writeFileSync(join(mine, 'a.txt'), 'a\n')
    execSync(`git add a.txt && git commit -qm a && git remote add origin ${join(root, 'remote.git')} && git push -q origin main`, { cwd: mine, env, stdio: 'pipe' })
    const seen = await withPromptTrace(async () => { await gitVersion(); await fetchRemote(mine, 'origin') })
    expect(seen.some(l => l.endsWith(' fetch')), 'control: the trace saw the fetch').toBe(true)
    for (const line of seen) expect(line.split(' ')[0], line).toBe('0')
  })
})
