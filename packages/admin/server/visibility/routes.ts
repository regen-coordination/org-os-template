// packages/admin/server/visibility/routes.ts
//
// GET /api/visibility (L5 spec §11.2, §13): what the client's `VisibilitySource` is built from — the membership tree's hats
// with their names and the hats above each, the hats the session wears, the levels this member may give a thing, and the
// policy. POST /api/visibility/narrow (§9.7, §13): a narrowing, applied at once (narrow.ts). And the viewer of a WebSocket
// connection, asked exactly as a request's is (§9.5: events are gated per connection).

import { Hono, type Context } from 'hono'
import { HttpError } from '../errors.ts'
import { readRegistryOrEmpty } from '../registry.ts'
import { knownActorOf, readerOf, viewerOf, withRequest, type RequestDeps } from '../request.ts'
import { noStore, reach, type PrivateAccess } from '../private/ops.ts'
import { levelOfToken } from '../private/reads.ts'
import { REGISTRIES } from '../registries.ts'
import { mayWrite, readRuleContext } from '../governance/effective.ts'
import { narrow, readNarrowBody } from './narrow.ts'
import type { Membership } from '../session/membership.ts'
import type { SystemReader } from '../systems/reader.ts'
import { readConfig, type VisibilityPolicy } from './config.ts'
import { isObj, MEMBERS_ONLY, PUBLIC_VIEWER } from './gate.ts'
import { admits, hatsAbove, parseLevel, type Viewer } from '../../lib/visibility.mjs'
import { hatRef, inTree, parseHatRef, parseTreeRef } from '../../lib/hats.mjs'

export interface VisibilityAnswer {
  /** The membership tree's hats in tree order (as the tree is read; else the hats the house knows of, by id), each with the
   *  house's name for it and the hats above it, nearest first. [] for an org without a tree. */
  tree: { hat: string; name: string; above: string[] }[]
  /** The hats the asking member wears (their last good reading). */
  worn: string[]
  /** The levels this member may give a thing: public, members, each hat of the tree they wear or wear a hat above
   *  (L4a-R19), each role they hold. */
  levels: string[]
  config: VisibilityPolicy
  /** The collections this member may write, the ones in git and the private ones they are admitted to: who is drawn a
   *  thing's visibility control (§9.8), by the predicate that judges a narrowing (`mayWrite`, Q77). */
  writable: string[]
}

export interface VisibilityDeps {
  repo: string
  /** Membership from the Hats tree; null when the server has none (no tree is then listed). */
  membership: Membership | null
  /** Reads the tree's hats; absent: the hats the house knows of. */
  systems?: Pick<SystemReader, 'read'>
  /** The repository's one write lock (app.ts): a narrowing commits. Absent: none (a test that narrows once). */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>
  /** The private store a narrowing writes what leaves git to; absent: none (`noStore`). */
  privateStore?: PrivateAccess
  /** Tells the open pages (the WebSocket, serve.ts) that a narrowing committed: levels and records may have changed, also
   *  when only the store did (an empty commit gives the file watcher nothing to see; Task 16). */
  notify?: (msg: { type: 'registry-changed'; registry: string }) => void
}

/** The tree's hats: read from the tree when it answers (it is the reader's cache, read at most every few minutes), else
 *  the hats the house knows of — the roles' hats, the hats the viewer wears and the hats data/visibility.yaml names —
 *  that lie in the tree. */
async function treeHats(d: VisibilityDeps, viewer: Extract<Viewer, { kind: 'member' }>, config: VisibilityPolicy): Promise<string[]> {
  const tree = d.membership?.tree()
  const ref = tree ? parseTreeRef(tree.ref) : null
  if (!tree || !ref) return []
  const canon = (h: unknown) => { const p = parseHatRef(h); return p && p.chain === ref.chain && inTree(p.hatId, ref.treeId) ? hatRef(p.chain, p.hatId) : null }
  let read: string[] = []
  try {
    const got = d.systems ? await d.systems.read(tree.system) : null
    const hats = got?.ok && Array.isArray(got.facts.hats) ? got.facts.hats : []
    read = hats.map(h => canon(isObj(h) ? h.id : null)).filter((h): h is string => h !== null)
  } catch { read = [] }
  if (read.length > 0) return [...new Set(read)]
  const known: unknown[] = [...viewer.hats]
  const roles = readGovernanceRoles(d.repo)
  for (const def of Object.values(roles)) if (isObj(def)) known.push(def.hat)
  const tokens = [...Object.values(config.defaults), ...Object.values(config.collections).flatMap(c => Object.values(c.fields))]
  for (const t of tokens) if (typeof t === 'string' && t.startsWith('hat:')) known.push(t.slice(4))
  return [...new Set(known.map(canon).filter((h): h is string => h !== null))].sort()
}

const GIT_COLLECTIONS = REGISTRIES.filter(r => r.kind === 'collection' && !r.ledger).map(r => r.name)

/** The collections `viewer` may write (Q77's one predicate, `mayWrite`): git's, then the private store's they are admitted
 *  to. A store that cannot be reached lists none of its own. */
function writableBy(d: VisibilityDeps, c: Context, viewer: Viewer): string[] {
  const ctx = readRuleContext(d.repo, readerOf(c))
  let kept: string[] = []
  try {
    const { store } = reach(d.privateStore ?? noStore)
    kept = store ? store.collections().filter(k => admits(levelOfToken(k.visibility), viewer)).map(k => k.id) : []
  } catch { kept = [] }
  return [...GIT_COLLECTIONS, ...kept].filter(r => mayWrite(ctx, r) === true)
}

/** data/governance.yaml's roles; {} when it cannot be read. */
function readGovernanceRoles(repo: string): Record<string, unknown> {
  try {
    const roles = readRegistryOrEmpty(repo, 'governance').document?.roles
    return isObj(roles) ? roles : {}
  } catch { return {} }
}

export function mountVisibility(app: Hono, d: VisibilityDeps): void {
  app.get('/api/visibility', async c => {
    const viewer = viewerOf(c)
    // The public is refused before any route (gate.ts publicReads); said again here so the route holds on its own.
    if (viewer.kind === 'public') throw new HttpError(401, MEMBERS_ONLY, 'SIGN_IN')
    const config = readConfig(d.repo)
    const hats = await treeHats(d, viewer, config)
    const tree = hats.map(hat => ({ hat, name: d.membership?.hatName(hat) ?? hat, above: hatsAbove(hat) }))
    const mine = hats.filter(h => admits(parseLevel(`hat:${h}`)!, viewer)).map(h => `hat:${h}`)
    const answer: VisibilityAnswer = {
      tree, worn: viewer.hats, levels: ['public', 'members', ...mine, ...viewer.roles.map(r => `role:${r}`)], config,
      writable: writableBy(d, c, viewer),
    }
    return c.json(answer)
  })

  // A narrowing (§9.7): applied at once, inside the write lock; refusals are the app's (Refusal → its own body).
  app.post('/api/visibility/narrow', async c => {
    let body: unknown
    try { body = await c.req.json() } catch { body = undefined }
    const input = readNarrowBody(body)
    const lock = d.withLock ?? (<T>(fn: () => Promise<T>) => fn())
    return lock(async () => {
      const actor = knownActorOf(c)
      const out = await narrow(d.repo, actor, input, { viewer: viewerOf(c), privateStore: d.privateStore ?? noStore })
      d.notify?.({ type: 'registry-changed', registry: 'visibility' })
      return c.json(out)
    })
  })
}

/**
 * The viewer of a WebSocket connection, from its upgrade's cookie: asked through the same middleware every request is
 * (request.ts `withRequest`), so a connection sees what a page load would. Fails closed: anything that goes wrong is the
 * public.
 */
export function connectionViewer(d: RequestDeps): (cookie: string | undefined) => Promise<Viewer> {
  const probe = new Hono()
  probe.use('*', withRequest(d))
  probe.get('*', (c: Context) => c.json(viewerOf(c)))
  return async cookie => {
    try {
      const res = await probe.request('http://localhost/api/events', { headers: cookie ? { cookie } : {} })
      return res.ok ? (await res.json()) as Viewer : PUBLIC_VIEWER
    } catch { return PUBLIC_VIEWER }
  }
}
