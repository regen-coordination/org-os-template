// The writes-off switch (Lane 3 Task 11, C1): `HOUSE_INSTANCE_WRITES`. While it is off the house writes nothing to the
// instance: every route that commits to the instance's repository, stages for it or ratifies answers 403
// `INSTANCE_READ_ONLY`; a proposal's page visit builds no branch and records no reading; the start-up reconcile does not
// run; and no Pusher is made, whatever `ORG_OS_PUSH` says. Sign-in, sign-out and what is kept per member outside the
// instance (wizard drafts, board layouts) go on. Hosted, it is off unless the environment says on; locally, on.
//
// A hosted house refuses to start with it on while `BEFORE_PILOT_OPEN` names a known defect on a write path. Each entry
// is a ruling of the L5 review that has to be fixed before a pilot Hub writes; the writes lane removes each as it lands.

import type { MiddlewareHandler } from 'hono'
import { answeringRoute } from './writes.ts'

export type InstanceWrites = 'on' | 'off'

export const INSTANCE_WRITES_ENV = 'HOUSE_INSTANCE_WRITES'

/** The answer to every refused write, and the code beside it. */
export const READ_ONLY = 'This Hub is read-only until writes are turned on. Nothing was written.'

/** Ledger 149, 232 M8, 249, 257 (L5 rulings log, "before any pilot Hub"). The Dec–Jan writes lane removes each as it is
 *  fixed; while one is listed, a hosted house does not start with writes on. */
export const BEFORE_PILOT_OPEN: readonly string[] = ['ledger-149', 'ledger-232-M8', 'ledger-249', 'ledger-257']

const pilotRefusal = (open: readonly string[]) =>
  `${INSTANCE_WRITES_ENV} is on, but this org-os still has ${open.length} write ${open.length === 1 ? 'defect' : 'defects'} to fix before a hosted Hub writes (${open.join(', ')}). Set ${INSTANCE_WRITES_ENV}=off, or run a release that fixes them, then start again.`

/** Hosted default `off`; local default `on`. Only `on` or `off` (any case) are read; anything else refuses the start, so a
 *  typo never turns writes on. Hosted with `on` is refused while `open` (BEFORE_PILOT_OPEN) is not empty. */
export function readInstanceWrites(env: Record<string, string | undefined>, hosted: boolean, open: readonly string[] = BEFORE_PILOT_OPEN): InstanceWrites | { refuse: string } {
  const raw = env[INSTANCE_WRITES_ENV]?.trim()
  const mode = raw === undefined || raw === '' ? (hosted ? 'off' : 'on') : raw.toLowerCase()
  if (mode !== 'on' && mode !== 'off') return { refuse: `${INSTANCE_WRITES_ENV} is "${raw}", not on or off.` }
  if (hosted && mode === 'on' && open.length > 0) return { refuse: pilotRefusal(open) }
  return mode
}

/** What the switch does with a write route:
 *  - `instance`: refused while off. It commits to the instance, stages for a commit, ratifies, or (sync, push, the
 *    claim, commands) moves the repository or runs something in it;
 *  - `state`: kept in the admin state folder, per member, never in the instance (drafts, layouts);
 *  - `session`: sign-in and sign-out (the private store's sessions and links, never the instance). */
export type InstanceClass = 'instance' | 'state' | 'session'

export interface InstanceWrite {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  class: InstanceClass
  /** The before-pilot items (BEFORE_PILOT_OPEN) whose code path the route is. */
  pilot?: readonly string[]
}

const w = (cls: InstanceClass) => (method: InstanceWrite['method'], path: string, pilot?: readonly string[]): InstanceWrite =>
  ({ method, path, class: cls, ...(pilot ? { pilot } : {}) })
const instance = w('instance'), state = w('state'), session = w('session')

/** Every non-GET route of the app. A test lists the app's routes and fails on one missing here (the HOSTED_WRITES
 *  pattern); a write route not named is refused while off, failing closed. */
export const INSTANCE_WRITES: readonly InstanceWrite[] = [
  // Records through the routes that predate the change engine: one commit each.
  instance('PUT', '/api/registries/:name/:id'),
  instance('POST', '/api/registries/:name'),
  instance('DELETE', '/api/registries/:name/:id'),
  // The tray only feeds Apply: with Apply off, staging is off too, so nothing is left half-done.
  instance('POST', '/api/changes/ops'),
  // Writes nothing (the rule a staged change would fall under), but it serves only staging, which is off with writes:
  // refused with the rest, failing closed, and the app hides the form that asks it.
  instance('POST', '/api/changes/rule'),
  instance('DELETE', '/api/changes/ops/:n'),
  instance('POST', '/api/changes/ops/:n/rebase'),
  instance('DELETE', '/api/changes'),
  instance('POST', '/api/changes/apply'),
  instance('POST', '/api/library/receipts/:id/remove'),
  instance('POST', '/api/library/:id/add'),
  // Visibility: the narrowing commit (249: nothing reconciles a store that fails after it).
  instance('POST', '/api/visibility/narrow', ['ledger-249']),
  // Proposals: every route writes the ledger or a proposal branch.
  instance('POST', '/api/proposals'),
  instance('POST', '/api/proposals/:id/revise'),
  instance('POST', '/api/proposals/:id/load'),
  instance('POST', '/api/proposals/:id/replay'),
  instance('POST', '/api/proposals/:id/prepare'),
  instance('POST', '/api/proposals/:id/events', ['ledger-149']),
  instance('POST', '/api/proposals/:id/ratify', ['ledger-232-M8', 'ledger-257']),
  instance('POST', '/api/proposals/:id/check', ['ledger-149']),
  instance('POST', '/api/proposals/:id/close'),
  // L9: sync and the push's retry move the repository; hosted, L9 answers sync first (ONE_WRITER).
  instance('POST', '/api/sync'),
  instance('POST', '/api/push/retry'),
  // The claim writes members.yaml; commands run in the instance. Hosted, L9 answers these first (CLAIM_HOSTED, HOSTED_OFF).
  instance('POST', '/api/bootstrap/claim/plan'),
  instance('POST', '/api/bootstrap/claim/confirm'),
  instance('POST', '/api/operations/:op/plan'),
  instance('POST', '/api/jobs'),
  instance('DELETE', '/api/jobs/:id'),
  // The admin state folder, per member: not the instance.
  state('PUT', '/api/wizards/:id/draft'),
  state('DELETE', '/api/wizards/:id/draft'),
  state('PUT', '/api/layout/:board'),
  state('DELETE', '/api/layout/:board'),
  // Sign-in and sign-out, the wallet's and the emailed link's.
  session('POST', '/api/session/nonce'),
  session('POST', '/api/session'),
  session('DELETE', '/api/session'),
  session('POST', '/api/session/email'),
  session('POST', '/api/session/link'),
]

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The switch's middleware. On, it lets everything through. Off, an `instance` route, a route the table does not name
 *  and a write no route answers are 403 `INSTANCE_READ_ONLY`, before the route runs. */
export function instanceWrites(mode: InstanceWrites, table: readonly InstanceWrite[] = INSTANCE_WRITES): MiddlewareHandler {
  const byRoute = new Map(table.map(e => [`${e.method} ${e.path}`, e]))
  return async (c, next) => {
    if (mode === 'on' || READS.has(c.req.method)) return next()
    const path = answeringRoute(c)
    const entry = path === null ? undefined : byRoute.get(`${c.req.method} ${path}`)
    if (!entry || entry.class === 'instance') return c.json({ error: READ_ONLY, code: 'INSTANCE_READ_ONLY' }, 403)
    await next()
  }
}
