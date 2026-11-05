import { emitJobOutput } from './jobLogs.ts'

export type ServerEvent =
  | { type: 'registry-changed'; registry: string }
  | { type: 'resources-changed'; ids: string[] }
  | { type: 'job-started'; job: { id: string; resource: string } }
  | { type: 'job-finished'; job: { id: string; resource: string } }
  | { type: 'job-output'; job: string; resource: string; chunk: string }
  | { type: 'decisions-changed' }
  | { type: 'changes' }

/** What a message from the server makes stale. Kept apart from the socket so it can be tested.
 *  A registry change can make a staged op stale, so the change is re-read with it. */
export function handleEvent(msg: ServerEvent, qc: { invalidateQueries: (filters: { queryKey: unknown[] }) => unknown }): void {
  const stale = (...keys: unknown[][]) => { for (const queryKey of keys) void qc.invalidateQueries({ queryKey }) }
  switch (msg.type) {
    case 'registry-changed':
      stale(['registry', msg.registry], ['registries'], ['status'], ['changes'], ...(msg.registry === 'governance' ? [['governance']] : []), ...(msg.registry === 'boards' ? [['boards']] : []), ...(msg.registry === 'proposals' ? [['proposals'], ['proposal']] : []),
        // A narrowing (data/visibility.yaml, or the store alone): the levels, and any record a level moved (Task 16).
        ...(msg.registry === 'visibility' ? [['visibility'], ['registry']] : []))
      break
    case 'resources-changed': stale(['graph'], ['resource'], ['operations'], ['resources'], ['allOperations']); break
    case 'job-started': stale(['jobs']); break
    case 'job-finished': stale(['jobs'], ['job', msg.job.id], ['graph'], ['resource', msg.job.resource]); break
    case 'job-output': emitJobOutput(msg.job, msg.chunk); break
    case 'decisions-changed': stale(['governance'], ['decision']); break
    case 'changes': stale(['changes']); break
  }
}
