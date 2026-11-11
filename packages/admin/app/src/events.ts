import { emitJobOutput } from './jobLogs.ts'

export type ServerEvent =
  | { type: 'registry-changed'; registry: string }
  | { type: 'resources-changed'; ids: string[] }
  | { type: 'job-started'; job: { id: string; resource: string } }
  | { type: 'job-finished'; job: { id: string; resource: string } }
  | { type: 'job-output'; job: string; resource: string; chunk: string }
  | { type: 'decisions-changed' }
  | { type: 'changes' }
  // DAO-OS L6 §8.5 (Task 9): pages, presence and conversation; the last two only to connections admitted to the target.
  | { type: 'pages-changed'; ids?: string[] }
  | { type: 'presence'; target: string; people: { handle: string; role: string; editing?: boolean }[] }
  | { type: 'conversation'; target: string }

/** What a message from the server makes stale. Kept apart from the socket so it can be tested.
 *  A registry change can make a staged op stale, so the change is re-read with it. */
export function handleEvent(msg: ServerEvent, qc: { invalidateQueries: (filters: { queryKey: unknown[] }) => unknown }): void {
  const stale = (...keys: unknown[][]) => { for (const queryKey of keys) void qc.invalidateQueries({ queryKey }) }
  switch (msg.type) {
    case 'registry-changed':
      // T19 review I3: ['file'], every file the source editor read — a registry's file, or one an apply wrote beside it.
      stale(['registry', msg.registry], ['registries'], ['status'], ['changes'], ['file'], ...(msg.registry === 'governance' ? [['governance']] : []), ...(msg.registry === 'boards' ? [['boards']] : []), ...(msg.registry === 'proposals' ? [['proposals'], ['proposal']] : []),
        // A narrowing (data/visibility.yaml, or the store alone): the levels, and any record a level moved (Task 16).
        ...(msg.registry === 'visibility' ? [['visibility'], ['registry']] : []),
        // DAO-OS L6 Task 17: data/collections.yaml holds the definitions and saved views GET /api/collections reads.
        ...(msg.registry === 'collections' ? [['collections']] : []),
        // DAO-OS L7 Task 11: the deployment is planned on the committed Systems.
        ...(msg.registry === 'systems' ? [['deploy']] : []))
      break
    case 'resources-changed': stale(['graph'], ['resource'], ['operations'], ['resources'], ['allOperations']); break
    case 'job-started': stale(['jobs']); break
    case 'job-finished': stale(['jobs'], ['job', msg.job.id], ['graph'], ['resource', msg.job.resource]); break
    case 'job-output': emitJobOutput(msg.job, msg.chunk); break
    case 'decisions-changed': stale(['governance'], ['decision'], ['file']); break
    case 'changes': stale(['changes']); break
    // DAO-OS L6 Task 9: what the workspace's events make stale.
    case 'pages-changed': stale(['pages'], ['page'], ['file']); break
    case 'presence': stale(['presence', msg.target]); break
    case 'conversation': stale(['comments', msg.target], ['notifications'], ['mentionables', msg.target]); break
  }
}
