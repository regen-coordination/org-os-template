import { execFile } from 'node:child_process'

/** The whole git vocabulary of the launcher is the list below and nothing else: it clones, reads state, switches to
 *  the adopt branch, adds and commits there. It never pushes, fetches or rewrites history.
 *  tests/launcher/git-write.vocabulary.test.ts reads this file: adding a verb is an edit of both. */
export const LAUNCHER_GIT_VERBS = ['clone', 'status', 'rev-parse', 'show-ref', 'switch', 'add', 'commit'] as const
export type LauncherVerb = (typeof LAUNCHER_GIT_VERBS)[number]

/** Why `url` is not a git address the launcher will clone from, in one sentence that says what to paste instead; or null. */
export function gitUrlProblem(url: string): string | null {
  if (!url.trim()) return 'Paste the git address of the repo, such as https://github.com/owner/name.'
  if (/\s/.test(url)) return 'Paste the address on its own, without spaces, such as https://github.com/owner/name.'
  if (url.startsWith('-')) return 'Paste a git address that starts with https://, such as https://github.com/owner/name.'
  if (url.includes('::')) return 'Paste an https:// or ssh address, such as https://github.com/owner/name.'
  if (url.startsWith('https://')) {
    const authority = url.slice('https://'.length).split('/')[0] ?? ''
    if (!authority) return 'Paste the full address, such as https://github.com/owner/name.'
    if (authority.includes('@')) return 'Paste the address without a token or password in it, such as https://github.com/owner/name.'
    return null
  }
  if (url.startsWith('ssh://')) {
    const authority = url.slice('ssh://'.length).split('/')[0] ?? ''
    if (!authority) return 'Paste the full ssh address, such as ssh://git@github.com/owner/name.'
    const userinfo = authority.includes('@') ? authority.slice(0, authority.lastIndexOf('@')) : ''
    if (userinfo.includes(':')) return 'Paste the address without a token or password in it, such as ssh://git@github.com/owner/name.'
    return null
  }
  if (url.startsWith('file:///')) return null
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^-]/.test(url)) return null
  return 'Paste an https:// address, such as https://github.com/owner/name.'
}

/** Runs one of the launcher's own git verbs in `cwd`. A verb off the list throws before any process starts. A git that
 *  exits non-zero is a result, not an exception. It never asks for credentials and never uses the ext:: or fd:: transports. */
export function launcherGit(cwd: string, verb: LauncherVerb, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!(LAUNCHER_GIT_VERBS as readonly string[]).includes(verb)) {
    return Promise.reject(new Error(`git ${String(verb)} is not something the launcher does`))
  }
  return new Promise((done, fail) => {
    execFile(
      'git',
      ['-c', 'protocol.ext.allow=never', '-c', 'protocol.fd.allow=never', verb, ...args],
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return fail(error)
        done({ code: error ? (error.code as number) : 0, stdout, stderr })
      },
    )
  })
}
