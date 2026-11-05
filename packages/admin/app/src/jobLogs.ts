type Listener = (chunk: string) => void
const listeners = new Map<string, Set<Listener>>()

/** Output of a running job, as the server streams it. The panel showing that job listens. */
export function onJobOutput(jobId: string, fn: Listener): () => void {
  let set = listeners.get(jobId)
  if (!set) { set = new Set(); listeners.set(jobId, set) }
  set.add(fn)
  return () => { set!.delete(fn); if (set!.size === 0) listeners.delete(jobId) }
}

export function emitJobOutput(jobId: string, chunk: string): void {
  for (const fn of listeners.get(jobId) ?? []) fn(chunk)
}
