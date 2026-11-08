// Pushing to the remote (L9 spec §5.6, Q72, carry 10). The hosted server is the only writer to the trunk; its clone is
// canonical, and the remote is where maintainers clone and back up from. After the server's own commits (`onCommit`) the
// Pusher sends the trunk there, fast-forward only, 5 s after the last commit of a burst, and once at start. It never
// merges, never forces and never fetches: a remote with commits the Hub did not make refuses the push, and the Pusher
// stops with the §5.6 alert until a maintainer asks again (`POST /api/push/retry`) or the server starts again. Rule 4 is
// read through `RemoteWatch.isPublic()`: anything but a plain `false` (public, or an answer that cannot be read) holds the
// push. The push runs outside the repository's write lock; it reads refs only. Proposal branches are never pushed.

import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Hono } from 'hono'
import { GitExit, onCommit, pushTrunk, remoteUrl, type CommitEvent } from '../git.ts'
import type { ServerAttention } from '../attention.ts'
import type { RemoteWatch } from '../visibility/remote.ts'
import { Refusal } from '../changes/apply.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { MAINTAINERS } from '../visibility/gate.ts'
import { admits } from '../../lib/visibility.mjs'

/** §5.6's alert, verbatim. */
export const PUSH_REJECTED = 'The remote has commits the Hub did not make, so the Hub stopped sending its own there. The Hub keeps working and keeps its commits here. A maintainer decides what to do with the remote\'s commits; the Hub never merges them or writes over them.'
/** The push could not be made for another reason (the remote unreachable, the key refused): git's words are not repeated,
 *  since they can name the remote's address. */
export const PUSH_FAILED = 'The Hub could not send its commits to the remote, and it tries again in a minute. Its commits are kept here.'
/** No remote to send to. */
export const PUSH_NO_REMOTE = 'This Hub has no remote called origin, so its commits are kept here only. Add the remote, then start the Hub again.'
/** Retry while rule 4 holds the push. */
export const PUSH_HELD = 'Nothing was sent: the remote is public, or whether it is private could not be read, and it must not receive what only members may read. Make it private; the Hub asks again every hour.'
/** Retry asked of a Hub that does not push (local, or `ORG_OS_PUSH=off`). */
export const PUSH_OFF = 'This Hub does not send its commits to a remote (it is not hosted, or ORG_OS_PUSH is off), so there is nothing to try again.'
/** Retry by someone who is not a maintainer (C9-22). */
export const PUSH_MAINTAINERS = 'Only a maintainer can ask the Hub to send its commits to the remote again. Nothing was sent.'
/** Retry while the server closes. */
export const PUSH_CLOSING = 'The Hub is stopping, so nothing was sent.'

/** §5.6: the push runs this long after the last commit of a burst. */
export const PUSH_DEBOUNCE_MS = 5_000
/** After a failure that is not a rejection, the push is tried again this much later. */
export const PUSH_RETRY_MS = 60_000

/** The attention key the Pusher raises and clears. */
const KEY = 'push'
const NAME = 'Sending commits to the remote'

type Outcome = 'pushed' | 'held' | 'rejected' | 'failed' | 'no-remote' | 'closed'

/** The same directory, however it was written (a symlinked temp directory, a trailing slash). */
function samePath(a: string, b: string): boolean {
  const real = (p: string) => { try { return realpathSync(p) } catch { return resolve(p) } }
  return resolve(a) === resolve(b) || real(a) === real(b)
}

/** git's own mark for a push the remote refused as not a fast-forward (`! [rejected] … (fetch first)` or
 *  `(non-fast-forward)`). It is not translated, whatever the locale. */
const REJECTED = /\[rejected\]/

export class Pusher {
  private status: 'idle' | 'pending' | 'stopped' = 'idle'
  /** Rejected: stopped until `retry()` or the next start. */
  private rejected = false
  private closed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<Outcome> | null = null
  /** A commit came while a push was running: another push follows it. */
  private again = false
  private unsubscribe: (() => void) | null = null
  private readonly remote: string
  private readonly debounceMs: number
  private readonly retryMs: number

  constructor(private readonly o: {
    repo: string
    trunk: () => Promise<string>
    remote?: string
    debounceMs?: number
    /** After a failure that is not a rejection; tests make it small. Default `PUSH_RETRY_MS`. */
    retryMs?: number
    /** How long a push may say nothing before it is ended (a failure, tried again). Tests make it small; default 2 min. */
    pushBlockMs?: number
    watch: Pick<RemoteWatch, 'isPublic'>
    attention: ServerAttention
  }) {
    this.remote = o.remote ?? 'origin'
    this.debounceMs = o.debounceMs ?? PUSH_DEBOUNCE_MS
    this.retryMs = o.retryMs ?? PUSH_RETRY_MS
  }

  /** Listens to the server's commits and pushes once now (§5.6: "and at start"). */
  start(): void {
    if (this.closed || this.unsubscribe) return
    this.unsubscribe = onCommit(e => this.heard(e))
    this.status = 'pending'
    this.arm(0)
  }

  /** Stops listening, clears its timer and waits for a push under way. The Pusher then sends nothing more. */
  async stop(): Promise<void> {
    this.closed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.disarm()
    this.status = 'stopped'
    try { await this.running } catch { /* its outcome no longer matters */ }
  }

  state(): 'idle' | 'pending' | 'stopped' { return this.status }

  /** A maintainer's ask (`POST /api/push/retry`): clears a rejection and pushes now, rule 4 permitting. */
  async retry(): Promise<{ pushed: boolean; sentence?: string }> {
    if (this.closed) return { pushed: false, sentence: PUSH_CLOSING }
    if (this.running) { try { await this.running } catch { /* the push below answers */ } }
    if (this.closed) return { pushed: false, sentence: PUSH_CLOSING }
    this.disarm()
    this.rejected = false
    this.status = 'pending'
    const outcome = await this.flush()
    switch (outcome) {
      case 'pushed': return { pushed: true }
      case 'held': return { pushed: false, sentence: PUSH_HELD }
      case 'rejected': return { pushed: false, sentence: PUSH_REJECTED }
      case 'no-remote': return { pushed: false, sentence: PUSH_NO_REMOTE }
      case 'closed': return { pushed: false, sentence: PUSH_CLOSING }
      default: return { pushed: false, sentence: PUSH_FAILED }
    }
  }

  /** A commit of this repository (a build's commit, in its worktree, is a proposal branch's and is not pushed). */
  private heard(e: CommitEvent): void {
    if (this.closed || this.rejected || !samePath(e.repo, this.o.repo)) return
    this.status = 'pending'
    if (this.running) { this.again = true; return }
    this.arm(this.debounceMs)
  }

  private arm(ms: number): void {
    this.disarm()
    this.timer = setTimeout(() => { this.timer = null; void this.flush() }, ms)
    this.timer.unref?.()
  }
  private disarm(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }

  /** One push at a time; a commit heard while one runs is pushed after it, debounced again. */
  private async flush(): Promise<Outcome> {
    if (this.running) { this.again = true; return this.running }
    this.again = false
    const run = this.attempt()
    this.running = run
    let outcome: Outcome
    try { outcome = await run } finally { this.running = null }
    this.settle(outcome)
    return outcome
  }

  private async attempt(): Promise<Outcome> {
    if (this.closed) return 'closed'
    if (this.rejected) return 'rejected'
    // Rule 4 (§5.7): only a remote known not to be public receives the trunk. Unknown counts as public.
    let open: unknown
    try { open = this.o.watch.isPublic() } catch { open = undefined }
    if (open !== false) return 'held'
    try {
      if ((await remoteUrl(this.o.repo)) === null) return 'no-remote'
      if (this.closed) return 'closed'
      const trunk = await this.o.trunk()
      await pushTrunk(this.o.repo, this.remote, trunk, { blockMs: this.o.pushBlockMs })
      return 'pushed'
    } catch (err) {
      return err instanceof GitExit && REJECTED.test(err.message) ? 'rejected' : 'failed'
    }
  }

  /** What an outcome leaves: the state, the attention, and the next push, if any. */
  private settle(outcome: Outcome): void {
    if (this.closed) { this.status = 'stopped'; return }
    switch (outcome) {
      case 'pushed':
        this.o.attention.clear(KEY)
        this.status = this.again ? 'pending' : 'idle'
        if (this.again) this.arm(this.debounceMs)
        return
      case 'rejected':
        this.rejected = true
        this.again = false
        this.disarm()
        this.status = 'stopped'
        this.o.attention.raise(KEY, NAME, { level: 'alert', text: PUSH_REJECTED })
        return
      case 'held':
        // RemoteWatch says why, as its own alert; the commits wait and the push is asked again.
        this.status = 'pending'
        this.arm(this.debounceMs)
        return
      case 'no-remote':
        this.status = 'idle'
        this.o.attention.raise(KEY, NAME, { level: 'warn', text: PUSH_NO_REMOTE })
        return
      case 'failed':
        this.status = 'pending'
        this.o.attention.raise(KEY, NAME, { level: 'warn', text: PUSH_FAILED })
        this.arm(this.again ? this.debounceMs : this.retryMs)
        return
      case 'closed':
        this.status = 'stopped'
    }
  }
}

/** `POST /api/push/retry` (§5.6, C9-22): for the governance role `maintainer`. Hosted it is an `actor` route of
 *  `HOSTED_WRITES`: it asks for its actor first. The Pusher is made once the server listens, so it is read when asked. */
export function mountPush(app: Hono, o: { pusher: () => Pusher | null }): void {
  app.post('/api/push/retry', async c => {
    knownActorOf(c)
    if (!admits(MAINTAINERS, viewerOf(c))) throw new Refusal(403, { code: 'MAINTAINERS_ONLY', error: PUSH_MAINTAINERS })
    const pusher = o.pusher()
    if (!pusher) return c.json({ error: PUSH_OFF, code: 'PUSH_OFF' }, 409)
    return c.json(await pusher.retry())
  })
}
