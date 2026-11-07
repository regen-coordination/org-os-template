/** After a refresh that left a system unread, ask once more in `delayMs`: the page would otherwise
 *  show the failure until the next five-minute tick. At most one retry is pending at a time. */
export function failedReadRetry(opts: { delayMs: number; hasFailed: () => boolean; retry: () => void }) {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  return {
    /** Call when a refresh has finished. */
    afterRefresh(): void {
      if (stopped || timer || !opts.hasFailed()) return
      timer = setTimeout(() => { timer = null; opts.retry() }, opts.delayMs)
    },
    stop(): void { stopped = true; if (timer) clearTimeout(timer); timer = null },
  }
}
