import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

/** How the shimmed `git commit` fails, always with exit 128 and git's own words:
 *  - `after-landing`: the real commit runs and lands, then it fails, as git does when it cannot
 *    write the new index after the ref update ("unable to write new index file");
 *  - `someone-else`: another commit lands instead of this one, then it fails. */
export type CommitFailure = 'after-landing' | 'someone-else'

/** Runs `fn` with a `git` first on PATH that passes every command to the real git, except that
 *  `commit` fails as `mode` says. Only this process (one test file) sees the changed PATH. */
export async function withFailingCommit<T>(mode: CommitFailure, fn: () => Promise<T>): Promise<T> {
  const real = execSync('command -v git', { shell: '/bin/sh' }).toString().trim()
  const dir = mkdtempSync(join(tmpdir(), 'git-shim-'))
  writeFileSync(join(dir, 'git'), `#!/bin/sh
# The subcommand: the first word that is neither an option nor the value of -c or -C.
sub= skip=
for arg in "$@"; do
  if [ -n "$skip" ]; then skip=; continue; fi
  case "$arg" in -c|-C) skip=1 ;; -*) ;; *) sub=$arg; break ;; esac
done
[ "$sub" = commit ] || exec "${real}" "$@"
if [ "${mode}" = someone-else ]; then
  "${real}" commit -q --only --allow-empty -m "someone else's commit" || exit $?
else
  "${real}" "$@" || exit $?
fi
echo "fatal: unable to write new index file" >&2
exit 128
`, { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = `${dir}:${path ?? ''}`
  try { return await fn() } finally {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Runs `fn` with a `git` first on PATH that writes its arguments to a marker file, one line per
 *  start, and then passes them to the real git. `started()` reads that file: it is how a test sees
 *  that a process began (simple-git does not go through any property of `child_process` a spy could
 *  watch). Only this process (one test file) sees the changed PATH. */
export async function withGitTrace<T>(fn: (started: () => string[]) => Promise<T>): Promise<T> {
  const real = execSync('command -v git', { shell: '/bin/sh' }).toString().trim()
  const dir = mkdtempSync(join(tmpdir(), 'git-trace-'))
  const marker = join(dir, 'started')
  writeFileSync(join(dir, 'git'), `#!/bin/sh
echo "$*" >> "${marker}"
exec "${real}" "$@"
`, { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = `${dir}:${path ?? ''}`
  try { return await fn(() => (existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(l => l !== '') : [])) } finally {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  }
}
