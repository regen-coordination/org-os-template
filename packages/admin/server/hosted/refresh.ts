// Following the remote (convergence C1, C2): a hosted Hub whose writes are off (`HOUSE_INSTANCE_WRITES=off`) is a reader
// of its instance, and the instance's commits are made elsewhere and reach the remote. The Refresher brings them in:
// once at start, then every `ORG_OS_REFRESH_EVERY` (15 min by default), it fetches `origin` and moves the trunk forward,
// fast-forward only. It never merges, never writes over a commit and never pushes. A copy that is not on its trunk, a
// history that diverged from the remote's (the copy holds commits the remote does not), or a fast-forward git refuses
// stops it with an alert until the Hub starts again; a remote it cannot read is a warning, and it asks again at the next
// refresh. While writes are on there is no Refresher: the Hub is then the one writer, and the Pusher sends its commits.
// What it last did is a row on the Sources page (`state()`, read by the sources adapter) and server attention.

import { fetchRemote, isAncestor, mergeFfOnly, remoteUrl, repoStatus, resolveRev } from '../git.ts'
import type { ServerAttention } from '../attention.ts'

/** The refresh runs this often unless `ORG_OS_REFRESH_EVERY` says otherwise. */
export const REFRESH_EVERY_MS = 15 * 60_000
/** A fetch that says nothing for this long is ended, and tried again at the next refresh. */
export const REFRESH_FETCH_BLOCK_MS = 120_000

export const REFRESH_NO_REMOTE = 'This Hub\'s copy of the instance has no remote called origin, so it cannot take new commits. Pages show the copy as it is. Add the remote; the Hub asks again at the next refresh.'
/** git's words are not repeated: they can name the remote's address. */
export const REFRESH_FAILED = 'The Hub could not read the remote, and it asks again at the next refresh. Pages show the copy as it was at the last refresh.'
export const REFRESH_NO_TRUNK = (trunk: string) => `The remote has no branch called ${trunk}, so the Hub has nothing to take from it. It asks again at the next refresh.`
export const REFRESH_NOT_ON_TRUNK = (trunk: string) => `This Hub's copy of the instance is not on its trunk (${trunk}), so the Hub stopped taking the remote's new commits. Pages show the copy as it is. Put the copy back on ${trunk}, then start the Hub again.`
export const REFRESH_DIVERGED = 'This Hub\'s copy of the instance has commits the remote does not, so the Hub stopped taking the remote\'s new commits. Pages show the copy as it was at the last refresh. A maintainer decides which commits to keep; the Hub never merges them or writes over either side. Start the Hub again once the copy and the remote agree.'
export const REFRESH_REFUSED = 'git would not move this Hub\'s copy of the instance forward (a change in the copy is in the way), so the Hub stopped taking the remote\'s new commits. Pages show the copy as it was at the last refresh. Clear the change, then start the Hub again.'

/** The attention key the Refresher raises and clears. */
const KEY = 'refresh'
const NAME = 'Taking new commits from the remote'

export interface RefreshState {
  /** `starting`: no refresh has ended yet. `following`: the last one ended with the copy at the remote's commit.
   *  `retrying`: the last one could not read the remote. `stopped`: it ended for good, until the Hub starts again. */
  state: 'starting' | 'following' | 'retrying' | 'stopped'
  trunk: string | null
  everyMs: number
  /** When a refresh last ended with the copy at the remote's commit (ISO), or null. */
  lastRefresh: string | null
  /** The copy's trunk commit after the last refresh that read it, or null. */
  commit: string | null
  /** Why it is retrying or stopped; null while it follows. */
  sentence: string | null
}

type Outcome =
  | { kind: 'current'; trunk: string; commit: string }
  | { kind: 'advanced'; trunk: string; commit: string }
  | { kind: 'retry'; trunk: string | null; sentence: string }
  | { kind: 'stop'; trunk: string | null; sentence: string }
  | { kind: 'closed' }

export class Refresher {
  private status: RefreshState
  private closed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<Outcome> | null = null
  private readonly everyMs: number
  private readonly lock: <T>(fn: () => Promise<T>) => Promise<T>

  constructor(private readonly o: {
    repo: string
    trunk: () => Promise<string>
    everyMs?: number
    attention: ServerAttention
    /** The server's write lock: the fast-forward moves the working tree under it. Default: none. */
    withLock?: <T>(fn: () => Promise<T>) => Promise<T>
    /** Called after the copy moved forward: the server re-reads what it shows. */
    onAdvance?: () => void
    /** Called after every refresh that ended: the Sources row is read again. */
    onState?: () => void
    /** How long a fetch may say nothing; tests make it small. Default `REFRESH_FETCH_BLOCK_MS`. */
    fetchBlockMs?: number
    now?: () => Date
  }) {
    this.everyMs = o.everyMs ?? REFRESH_EVERY_MS
    this.lock = o.withLock ?? (fn => fn())
    this.status = { state: 'starting', trunk: null, everyMs: this.everyMs, lastRefresh: null, commit: null, sentence: null }
  }

  /** Refreshes once now, then every `everyMs` after each refresh ends. */
  start(): void {
    if (this.closed || this.timer || this.running) return
    this.arm(0)
  }

  /** Clears its timer and waits for a refresh under way. The Refresher then runs nothing more. */
  async stop(): Promise<void> {
    this.closed = true
    this.disarm()
    try { await this.running } catch { /* its outcome no longer matters */ }
  }

  state(): RefreshState { return { ...this.status } }

  /** One refresh now (the timer's, and the tests'). A refresh under way is waited for, not doubled. */
  async refresh(): Promise<RefreshState> {
    if (this.running) { await this.running.catch(() => {}); return this.state() }
    if (this.closed || this.status.state === 'stopped') return this.state()
    this.disarm()
    const run = this.attempt().catch((): Outcome => ({ kind: 'retry', trunk: this.status.trunk, sentence: REFRESH_FAILED }))
    this.running = run
    let outcome: Outcome
    try { outcome = await run } finally { this.running = null }
    this.settle(outcome)
    return this.state()
  }

  private arm(ms: number): void {
    this.disarm()
    this.timer = setTimeout(() => { this.timer = null; void this.refresh() }, ms)
    this.timer.unref?.()
  }
  private disarm(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }

  private async attempt(): Promise<Outcome> {
    const { repo } = this.o
    if (this.closed) return { kind: 'closed' }
    if ((await remoteUrl(repo)) === null) return { kind: 'retry', trunk: null, sentence: REFRESH_NO_REMOTE }
    try { await fetchRemote(repo, 'origin', { blockMs: this.o.fetchBlockMs ?? REFRESH_FETCH_BLOCK_MS }) } catch {
      return { kind: 'retry', trunk: this.status.trunk, sentence: REFRESH_FAILED }
    }
    if (this.closed) return { kind: 'closed' }
    const trunk = await this.o.trunk()
    if ((await repoStatus(repo)).branch !== trunk) return { kind: 'stop', trunk, sentence: REFRESH_NOT_ON_TRUNK(trunk) }
    const remoteRef = `refs/remotes/origin/${trunk}`
    const theirs = await resolveRev(repo, remoteRef)
    if (theirs === null) return { kind: 'retry', trunk, sentence: REFRESH_NO_TRUNK(trunk) }
    const ours = await resolveRev(repo, `refs/heads/${trunk}`)
    if (ours === theirs) return { kind: 'current', trunk, commit: ours }
    // Only a copy that is an ancestor of the remote's trunk moves. A copy ahead of it, or beside it, holds commits the
    // remote does not: that is a non-fast-forward, and it stops the refresh.
    if (ours === null || !(await isAncestor(repo, ours, theirs))) return { kind: 'stop', trunk, sentence: REFRESH_DIVERGED }
    if (this.closed) return { kind: 'closed' }
    try {
      await this.lock(async () => {
        // Under the lock the trunk is read again: the copy is moved only from the commit that was checked.
        if ((await resolveRev(repo, `refs/heads/${trunk}`)) !== ours) throw new Error('moved')
        await mergeFfOnly(repo, remoteRef)
      })
    } catch {
      return { kind: 'stop', trunk, sentence: REFRESH_REFUSED }
    }
    return { kind: 'advanced', trunk, commit: (await resolveRev(repo, `refs/heads/${trunk}`)) ?? theirs }
  }

  /** What an outcome leaves: the state, the attention and the next refresh, if any. */
  private settle(outcome: Outcome): void {
    if (outcome.kind === 'closed' || this.closed) return
    this.apply(outcome)
    this.o.onState?.()
  }

  private apply(outcome: Exclude<Outcome, { kind: 'closed' }>): void {
    const now = (this.o.now ?? (() => new Date()))().toISOString()
    switch (outcome.kind) {
      case 'current':
      case 'advanced':
        this.status = { ...this.status, state: 'following', trunk: outcome.trunk, commit: outcome.commit, lastRefresh: now, sentence: null }
        this.o.attention.clear(KEY)
        if (outcome.kind === 'advanced') this.o.onAdvance?.()
        this.arm(this.everyMs)
        return
      case 'retry':
        this.status = { ...this.status, state: 'retrying', trunk: outcome.trunk ?? this.status.trunk, sentence: outcome.sentence }
        this.o.attention.raise(KEY, NAME, { level: 'warn', text: outcome.sentence })
        this.arm(this.everyMs)
        return
      case 'stop':
        this.status = { ...this.status, state: 'stopped', trunk: outcome.trunk ?? this.status.trunk, sentence: outcome.sentence }
        this.o.attention.raise(KEY, NAME, { level: 'alert', text: outcome.sentence })
        this.disarm()
    }
  }
}
