import { simpleGit } from 'simple-git'
import type { FetchLike } from '../systems/driver.ts'
import type { ServerAttention } from '../attention.ts'

/** Rule 4 (house spec §11, L5 spec §12): a governed repository must be private. The host is asked without a key; a
 *  private repository is invisible without one, so a 404 means not public. */

export type Visibility = 'public' | 'not-public' | 'unknown'

interface Where { host: string; path: string[] }

/** `https://host/owner/repo(.git)`, `ssh://git@host/owner/repo.git` and `git@host:owner/repo.git`. Anything in the
 *  address before the host (a user, a token) is dropped here and never reaches a request or a sentence. */
function parseRemote(url: string): Where | null {
  const text = url.trim()
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try { const u = new URL(text); host = u.hostname; path = u.pathname } catch { return null }
  } else if (scp) { host = scp[1]!; path = scp[2]! } else return null
  const segments = path.replace(/\.git$/, '').split('/').filter(s => s !== '')
  if (host === '' || segments.length < 2) return null
  return { host: host.toLowerCase(), path: segments }
}

const PUBLIC_WHEN: Record<string, (body: unknown) => boolean> = {
  'github.com': b => (b as { private?: unknown } | null)?.private === false,
  'codeberg.org': b => (b as { private?: unknown } | null)?.private === false,
  'gitlab.com': b => (b as { visibility?: unknown } | null)?.visibility === 'public',
}

function apiUrl(where: Where): string | null {
  const [owner, repo] = where.path
  switch (where.host) {
    case 'github.com': return where.path.length === 2 ? `https://api.github.com/repos/${owner}/${repo}` : null
    case 'codeberg.org': return where.path.length === 2 ? `https://codeberg.org/api/v1/repos/${owner}/${repo}` : null
    case 'gitlab.com': return `https://gitlab.com/api/v4/projects/${encodeURIComponent(where.path.join('/'))}`
    default: return null
  }
}

/** The sentence raised when a remote turns public while a hosted Hub runs (L9 spec §5.7). */
export const REMOTE_TURNED_PUBLIC = (label: string): string =>
  `The repository at ${label} is now public, and it holds what only members may read. The Hub stopped sending commits there. Make it private; the Hub asks again every hour.`

/** One call, never following a redirect by itself: the caller decides whether the `Location` is acceptable. */
async function ask(api: string, fetch: FetchLike) {
  // No credentials, ever: the only header is what kind of answer is wanted.
  return fetch(api, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8_000) })
}

export async function remoteVisibility(url: string, fetch: FetchLike): Promise<Visibility> {
  const where = parseRemote(url)
  const api = where ? apiUrl(where) : null
  if (!where || !api) return 'unknown'
  try {
    let res = await ask(api, fetch)
    if (res.status === 301 || res.status === 302) {
      // A renamed repository: one redirect, to the same API host, over https. Anything else fails closed.
      const location = res.headers?.get('location') ?? null
      if (location === null) return 'unknown'
      let target: URL
      try { target = new URL(location, api) } catch { return 'unknown' }
      if (target.protocol !== 'https:' || target.host !== new URL(api).host || target.username !== '' || target.password !== '') return 'unknown'
      res = await ask(target.href, fetch)
    }
    if (res.status === 404) return 'not-public'
    if (res.status !== 200 || !res.ok) return 'unknown'
    return PUBLIC_WHEN[where.host]!(await res.json()) ? 'public' : 'not-public'
  } catch { return 'unknown' }
}

/** A hosted Hub asks again while it runs. A remote seen public stays public until a later answer says otherwise; an
 *  unknown answer changes nothing, since the start settled it. The Pusher reads `isPublic()` and sends nothing while true. */
export class RemoteWatch {
  private timer: ReturnType<typeof setInterval> | null = null
  private publicNow = false
  private busy = false
  /** Set by `stop()`: a check still under way then changes nothing (no attention raised or cleared, so no refresh). */
  private stopped = false
  constructor(private readonly o: { repo: string; fetch: FetchLike; everyMs: number; attention: ServerAttention }) {}

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => {
      void this.check().catch(err => console.error(`org-os admin: the remote's privacy could not be asked again: ${err instanceof Error ? err.message : String(err)}`))
    }, this.o.everyMs)
    this.timer.unref?.()
  }
  stop(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null }
  isPublic(): boolean { return this.publicNow }

  async check(): Promise<void> {
    if (this.busy || this.stopped) return
    this.busy = true
    try {
      let url: string | null = null
      try { url = (await simpleGit(this.o.repo).getConfig('remote.origin.url')).value } catch { /* no remote */ }
      if (url === null || url.trim() === '') return
      const seen = await remoteVisibility(url, this.o.fetch)
      if (this.stopped) return // the server closed while it asked: nothing is raised or cleared after that
      const where = parseRemote(url)
      const label = where ? `${where.host}/${where.path.join('/')}` : 'the origin'
      if (seen === 'public') {
        this.publicNow = true
        this.o.attention.raise('public-remote', 'Public repository', { level: 'alert', text: REMOTE_TURNED_PUBLIC(label) })
      } else if (seen === 'not-public') {
        this.publicNow = false
        this.o.attention.clear('public-remote')
      }
    } finally { this.busy = false }
  }
}

export interface RemoteCheck {
  /** The sentence the server stops with, or null. */
  refuse: string | null
  /** The alert text to raise on Home, or null. */
  attention: string | null
}

export async function checkRemote(
  repo: string,
  { hosted, fetch, env }: { hosted: boolean; fetch: FetchLike; env: Record<string, string | undefined> },
): Promise<RemoteCheck> {
  let url: string | null = null
  try { url = (await simpleGit(repo).getConfig('remote.origin.url')).value } catch { /* not a repository: no remote */ }
  if (url === null || url.trim() === '') return { refuse: null, attention: null }
  const seen = await remoteVisibility(url, fetch)
  const where = parseRemote(url)
  const label = where ? `${where.host}/${where.path.join('/')}` : 'the origin'
  if (seen === 'public') {
    const sentence = `The repository at ${label} is public, and it holds what only members may read. Make it private, then start again.`
    return hosted ? { refuse: sentence, attention: null } : { refuse: null, attention: sentence }
  }
  if (seen === 'unknown' && hosted && env.ORG_OS_REMOTE_PRIVATE !== 'confirmed') {
    return {
      refuse: `Whether the repository at ${label} is private could not be read, and it holds what only members may read. ` +
        'Make sure it is private, then start again with ORG_OS_REMOTE_PRIVATE=confirmed.',
      attention: null,
    }
  }
  return { refuse: null, attention: null }
}
