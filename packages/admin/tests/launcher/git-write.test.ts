import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gitUrlProblem, launcherGit, LAUNCHER_GIT_VERBS } from '../../launcher/git-write.ts'

// Code that runs git is tried in a fresh repository of its own under the temp directory, never in a real one.
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-git-'))
  execFileSync('git', ['init', '-q', dir])
  return dir
}

describe('gitUrlProblem', () => {
  it('refuses option, transport and credential tricks', () => {
    for (const bad of ['-uhttps://x', 'ext::sh -c id', 'fd::3', 'https://tok@github.com/a/b', 'https://github.com/a b', 'http://github.com/a/b'])
      expect(gitUrlProblem(bad)).not.toBeNull()
    for (const ok of ['https://github.com/a/b', 'https://github.com/a/b.git', 'ssh://git@github.com/a/b', 'git@github.com:a/b.git', 'file:///tmp/x.git'])
      expect(gitUrlProblem(ok)).toBeNull()
  })
  it('refuses an empty address, a scp path starting with a dash, a relative file address and a double colon', () => {
    for (const bad of ['', '  ', 'git@github.com:-x', 'file://relative', 'git@host::a', 'ftp://x/y', 'https://', '/tmp/x'])
      expect(gitUrlProblem(bad), bad).not.toBeNull()
  })
  it('says in one sentence what to paste instead', () => {
    expect(gitUrlProblem('http://github.com/a/b')).toMatch(/^Paste an https:\/\/ address, such as [^ ]+\.$/)
  })
})

describe('launcherGit', () => {
  it('runs only its own verbs', async () => {
    const tmp = fresh()
    await expect(launcherGit(tmp, 'push' as never, [])).rejects.toThrow(/not something the launcher does/)
    await expect(launcherGit(tmp, 'push' as never, [])).rejects.toThrow('git push is not something the launcher does')
  })
  it('names exactly the verbs of the brief', () => {
    expect([...LAUNCHER_GIT_VERBS]).toEqual(['clone', 'status', 'rev-parse', 'show-ref', 'switch', 'add', 'commit'])
  })
  it('runs an allowed verb in the folder given and returns code, stdout and stderr', async () => {
    const tmp = fresh()
    const ok = await launcherGit(tmp, 'status', ['--porcelain'])
    expect(ok).toEqual({ code: 0, stdout: '', stderr: '' })
    const bad = await launcherGit(tmp, 'rev-parse', ['--verify', 'refs/heads/nope'])
    expect(bad.code).not.toBe(0)
  })
})
