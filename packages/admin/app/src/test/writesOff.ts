// The Hub's writes switch as the client reads it (Lane 3 Task 11, plan D-6): `GET /api/status` says `instanceWrites:
// 'off'` while the Hub's writes are off, and says nothing of it while they are on. A test draws a control both ways:
// the status in the query client's cache (as the frame holds it) and the same status as the route answers.
import { QueryClient } from '@tanstack/react-query'

const BASE = { org: 'Fixture Org', branch: 'main', dirty: false }

/** The status a Hub answers with its writes off (`off`) or on. */
export const statusOf = (off: boolean) => (off ? { ...BASE, instanceWrites: 'off' as const } : { ...BASE })

/** A query client (no retries) that already holds that status. */
export function clientWith(off: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['status'], statusOf(off))
  return qc
}

/** The route that answers the same status, to spread over a test's routes. */
export const statusRoute = (off: boolean) => ({ 'GET /api/status': statusOf(off) })
