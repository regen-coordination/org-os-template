// Write routes when hosted (L9 spec §5.4, carry 1, Q-L9-4). Every non-GET route of the app is named here, by method
// and Hono route path, with what a hosted Hub does with it. The middleware is mounted by createApp after the request
// middleware and `publicReads`, only when hosted: a write with no session has already been answered 401 there, so what
// reaches it is a signed-in member's write (or sign-in and sign-out). A write route the table does not name is refused,
// failing closed. Locally nothing here runs.

import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { matchedRoutes, routePath } from 'hono/route'

/** What a hosted Hub does with a write route:
 *  - `actor`: the route itself calls `knownActorOf` (or `actorOf` and its own refusal) before it writes;
 *  - `off`: refused with the entry's code and sentence, before the route runs;
 *  - `per-member`: kept apart per member by the route (drafts, layouts);
 *  - `session`: sign-in and sign-out, as L5. */
export type WriteClass = 'actor' | 'off' | 'per-member' | 'session'

export interface HostedWrite {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** The route's path as Hono registers it (`/api/jobs/:id`). */
  path: string
  class: WriteClass
  /** For `off` only. */
  code?: 'HOSTED_OFF' | 'ONE_WRITER' | 'CLAIM_HOSTED'
  sentence?: string
}

// §10's sentences, verbatim.
export const HOSTED_OFF = 'This runs a command on the server, which a hosted Hub does not do for anyone. Run it from a maintainer\'s clone of the repository.'
export const ONE_WRITER = 'The Hub is the only writer to this repository, so there is nothing to sync. Its commits reach the remote by themselves.'
export const CLAIM_HOSTED = 'A claim ties this machine\'s git identity to a member, and a hosted Hub has none. Members sign in with their wallet.'
export const HOSTED_UNLISTED = 'This change cannot be made on a hosted Hub yet. Nothing was written.'

/** The status each refusal answers with. */
const STATUS = { HOSTED_OFF: 403, ONE_WRITER: 409, CLAIM_HOSTED: 403 } as const

const off = (method: HostedWrite['method'], path: string, code: NonNullable<HostedWrite['code']>): HostedWrite =>
  ({ method, path, class: 'off', code, sentence: { HOSTED_OFF, ONE_WRITER, CLAIM_HOSTED }[code] })
const as = (cls: Exclude<WriteClass, 'off'>) => (method: HostedWrite['method'], path: string): HostedWrite => ({ method, path, class: cls })
const actor = as('actor'), perMember = as('per-member'), session = as('session')

/** Every non-GET route of the app (§5.4's table). A test lists the app's routes and fails on one missing here. */
export const HOSTED_WRITES: readonly HostedWrite[] = [
  // The executor spawns commands on the server: a hosted Hub runs no command for anyone (Q-L9-4).
  off('POST', '/api/operations/:op/plan', 'HOSTED_OFF'),
  off('POST', '/api/jobs', 'HOSTED_OFF'),
  off('DELETE', '/api/jobs/:id', 'HOSTED_OFF'),
  // There is one writer (house spec §6): "Sync first" does not apply.
  off('POST', '/api/sync', 'ONE_WRITER'),
  // The claim ties this machine's git address to a member; hosted actors sign in.
  off('POST', '/api/bootstrap/claim/plan', 'CLAIM_HOSTED'),
  off('POST', '/api/bootstrap/claim/confirm', 'CLAIM_HOSTED'),
  // Kept apart per member by their routes (wizards/routes.ts, resources/routes.ts).
  perMember('PUT', '/api/wizards/:id/draft'),
  perMember('DELETE', '/api/wizards/:id/draft'),
  perMember('PUT', '/api/layout/:board'),
  perMember('DELETE', '/api/layout/:board'),
  // Sign-in and sign-out, as L5.
  session('POST', '/api/session/nonce'),
  session('POST', '/api/session'),
  session('DELETE', '/api/session'),
  // The emailed link (Lane 3): asking for one, and using it.
  session('POST', '/api/session/email'),
  session('POST', '/api/session/link'),
  // Every other write: the route asks for its actor before it writes.
  actor('PUT', '/api/registries/:name/:id'),
  actor('POST', '/api/registries/:name'),
  actor('DELETE', '/api/registries/:name/:id'),
  actor('POST', '/api/changes/ops'),
  // Read only (the new-record form's governance line), but it asks for its actor as staging does.
  actor('POST', '/api/changes/rule'),
  actor('DELETE', '/api/changes/ops/:n'),
  actor('POST', '/api/changes/ops/:n/rebase'),
  actor('DELETE', '/api/changes'),
  actor('POST', '/api/changes/apply'),
  actor('POST', '/api/library/receipts/:id/remove'),
  actor('POST', '/api/library/:id/add'),
  actor('POST', '/api/visibility/narrow'),
  actor('POST', '/api/proposals'),
  actor('POST', '/api/proposals/:id/revise'),
  actor('POST', '/api/proposals/:id/load'),
  actor('POST', '/api/proposals/:id/replay'),
  actor('POST', '/api/proposals/:id/prepare'),
  actor('POST', '/api/proposals/:id/events'),
  actor('POST', '/api/proposals/:id/ratify'),
  actor('POST', '/api/proposals/:id/check'),
  actor('POST', '/api/proposals/:id/close'),
  // The push's retry (§5.6): the route asks for its actor, then for the role maintainer (C9-22).
  actor('POST', '/api/push/retry'),
]

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The path of the route that answers this request, as Hono registered it. Inside a middleware `c.req.routePath` is the
 *  middleware's own path, and the last matched route (`routePath(c, -1)`) is a catch-all mounted after the routes (the
 *  API's 404, the UI's static files), so the answering route is the first one matched that was registered for this
 *  request's method: middleware and catch-alls are registered for every method (`ALL`). Null when no route answers.
 *  Ruling P2a; the rate limits and the access log read the route the same way (Task 8). */
export function answeringRoute(c: Context): string | null {
  const index = matchedRoutes(c).findIndex(r => r.method === c.req.method)
  return index < 0 ? null : routePath(c, index)
}

/** The hosted write middleware (§5.4): `off` routes answer their status and sentence; a write route the table does not
 *  name, or a write no route answers, 403 `HOSTED_UNLISTED`. Reads, and every other class, go on to their route. */
export function hostedWrites(table: readonly HostedWrite[] = HOSTED_WRITES): MiddlewareHandler {
  const byRoute = new Map(table.map(w => [`${w.method} ${w.path}`, w]))
  return async (c, next) => {
    if (READS.has(c.req.method)) return next()
    const path = answeringRoute(c)
    const write = path === null ? undefined : byRoute.get(`${c.req.method} ${path}`)
    if (!write) return c.json({ error: HOSTED_UNLISTED, code: 'HOSTED_UNLISTED' }, 403)
    if (write.class === 'off') {
      const code = write.code ?? 'HOSTED_OFF'
      return c.json({ error: write.sentence ?? HOSTED_OFF, code }, STATUS[code])
    }
    await next()
  }
}

/** The key a member's own files are kept under (drafts, layouts): the SHA-256 of the actor id, its first 16 hex digits. */
export const actorKey = (actorId: string): string => createHash('sha256').update(actorId).digest('hex').slice(0, 16)
