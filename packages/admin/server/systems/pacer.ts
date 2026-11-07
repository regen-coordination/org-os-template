import type { FetchLike } from './driver.ts'

/** Spaces requests to one host, across every read that is in flight: the keyless Safe API answers
 *  a burst with 429, and several systems are read at once. A request waits its turn in a queue per
 *  host; a read that is cut off while it waits leaves the queue without sending anything. */
export class HostPacer {
  private tail = new Map<string, Promise<void>>()
  private last = new Map<string, number>()

  /** `fetch`, but no two requests to one host start closer than `gapMs`, and one at a time in order.
   *  `onTurn` is called as each request leaves the queue, before it is sent. */
  wrap(fetch: FetchLike, gapMs: number, onTurn?: () => void): FetchLike {
    return async (url, init) => {
      await this.turn(new URL(url).host, gapMs, init.signal)
      onTurn?.()
      return fetch(url, init)
    }
  }

  private turn(host: string, gapMs: number, signal: AbortSignal): Promise<void> {
    const before = this.tail.get(host) ?? Promise.resolve()
    const mine = (async () => {
      await before
      signal.throwIfAborted()
      const wait = (this.last.get(host) ?? -Infinity) + gapMs - Date.now()
      if (wait > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, wait)
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
        })
      }
      this.last.set(host, Date.now())
    })()
    this.tail.set(host, mine.catch(() => {}))
    return mine
  }
}
