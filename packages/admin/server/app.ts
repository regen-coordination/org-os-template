import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { registryDef } from './registries.ts'
import { readRegistry, type Entity } from './registry.ts'
import { loadSchema } from './schema.ts'
import { repoStatus } from './git.ts'
import { refusal, type GuardScope } from './guard.ts'
import { HttpError } from './errors.ts'
import { orgName } from './resources/util.ts'
import { mountChanges, applyAs } from './changes/routes.ts'
import { knownActorOf, viewerOf, withRequest } from './request.ts'
import { gateRecord, gateRegistry, gateRegistryList, Levels, publicReads, publicStatus, withoutEcho } from './visibility/gate.ts'
import { noStore, splitOps, type PrivateAccess } from './private/ops.ts'
import { privateReads } from './private/reads.ts'
import { hostedWrites } from './hosted/writes.ts'
import { instanceWrites, type InstanceWrites } from './hosted/instance-writes.ts'
import { readConfig } from './visibility/config.ts'
import { mountGovernance } from './governance/routes.ts'
import { mountBoards } from './boards/routes.ts'
import { mountLibrary } from './library/routes.ts'
import { StageRefusal, Refusal } from './changes/apply.ts'
import { newChangeId } from './changes/store.ts'
import { LEDGER_SENTENCE } from './changes/stage.ts'
import type { StageOp } from './changes/types.ts'

/** Map thrown service errors to HTTP statuses. */
function status(err: unknown): number {
  if (err instanceof HttpError) return err.status
  const msg = err instanceof Error ? err.message : String(err)
  if (/unknown registry|not found|file missing/i.test(msg)) return 404
  if (/already exists/i.test(msg)) return 409
  if (/document registry/i.test(msg)) return 403
  return 500
}

/** Serialize every mutating operation on the repository. One queue for the
 *  whole repo, not one per registry: each save runs `git add` and `git commit`,
 *  and two git processes in one repository collide on `.git/index.lock`
 *  whichever files they touch. Single process, so an in-memory promise chain
 *  is sufficient. */
function makeLock() {
  let chain: Promise<unknown> = Promise.resolve()
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
}

export interface AppOptions {
  /** Called with every server event the app's own routes raise (today: `{ type: 'changes' }`). */
  notify?: (msg: { type: string }) => void
  /** The request middleware (request.ts `withRequest`), mounted on /api/* before every route, app.ts's own included, so
   *  all of them read the same actor and viewer. Absent: git's identity, locally, as 0.6 (no sessions, no hats). */
  request?: MiddlewareHandler
  /** The one private store (L5 spec §10), or why it is not open: private records and restricted fields are read from it
   *  and written only to it. Absent: none (the git side serves; a private write is refused with `NO_STORE`). */
  privateStore?: PrivateAccess
  /** Where the guard stands (guard.ts): hosted at the configured host and origin (L9 §5.2), or, absent, this machine. */
  guard?: GuardScope
  /** Hosted mode (L5 spec §3): every write route is then classified (hosted/writes.ts, L9 §5.4); one the table does not
   *  name is refused. Absent or false: local, every route as before. */
  hosted?: boolean
  /** Middleware mounted on every path before the guard, in this order (L9 §5.9, §5.10, §7.4: hosted with its
   *  configuration, the access log, the security headers and the rate limits). Absent: none, as locally. */
  edge?: MiddlewareHandler[]
  /** The writes-off switch (Lane 3 Task 11, C1): `off` refuses every write to the instance, 403 INSTANCE_READ_ONLY, after
   *  the hosted table. Absent: `on`, as before. */
  instanceWrites?: InstanceWrites
}

/** What `extend` is given besides the app: the repository's one write lock, for a route whose write
 *  must not run beside another (each runs `git add` and `git commit`). */
export interface ExtendContext {
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** The one private store (`AppOptions.privateStore`, or none), for routes that keep private data beside git (L5 §10). */
  privateStore: PrivateAccess
}

/** `extend` mounts more routes. It runs before the `/api/*` catch-all, so the routes it adds
 *  answer instead of the 404 that unknown addresses get. */
export function createApp(repo: string, extend?: (app: Hono, ctx: ExtendContext) => void, opts: AppOptions = {}): Hono {
  const app = new Hono()
  const withLock = makeLock()
  const privateStore = opts.privateStore ?? noStore
  const reads = privateReads(privateStore)
  const levels = () => new Levels(repo, undefined, undefined, reads)

  app.onError((err, c) => {
    // A refusal from the change engine is its own answer: 403 { reason, error }, 409 { error, code, paths }, 400 { error, code }.
    if (err instanceof Refusal) return c.json(err.body, err.status)
    const errors = (err as { errors?: unknown }).errors
    if (err instanceof HttpError && Array.isArray(errors)) return c.json({ errors }, err.status as 422)
    const code = err instanceof HttpError ? err.code : undefined
    return c.json(code ? { error: err.message, code } : { error: err.message }, status(err) as 404)
  })

  // Hosted, first of all: the access line, the headers on every answer, the rate limits (L9 Task 8).
  for (const m of opts.edge ?? []) app.use('*', m)

  // Before any route: is this caller one the server answers? (see guard.ts)
  app.use('*', async (c, next) => {
    const refused = refusal({
      method: c.req.method,
      host: c.req.header('host') ?? new URL(c.req.url).host,
      origin: c.req.header('origin'),
      contentType: c.req.header('content-type'),
      path: c.req.path,
    }, opts.guard)
    if (refused) return c.json({ error: refused.error }, refused.status)
    await next()
  })

  // Then, for the API: who is asking (L5 spec §6.5). Hosted, a write with no session ends here, 401.
  app.use('/api/*', opts.request ?? withRequest({ repo, hosted: false, membership: null }))
  // And who may ask what (L5 spec §9.5): the public is refused the members' side here, before any route; every route the
  // public may ask answers its items through the gate (visibility/gate.ts).
  app.use('/api/*', publicReads)
  // Hosted, every write is one the table names (L9 §5.4): commands, sync and the claim are off; the rest go on to their
  // route, which asks for its actor or keeps the member's files apart.
  if (opts.hosted) app.use('/api/*', hostedWrites())
  // While writes are off (C1), nothing reaches the instance: every write route that commits, stages or ratifies is
  // refused here, before it runs (hosted/instance-writes.ts).
  if (opts.instanceWrites === 'off') app.use('/api/*', instanceWrites('off'))

  app.get('/api/status', async c => {
    if (viewerOf(c).kind === 'public') return c.json(publicStatus(repo))
    const s = await repoStatus(repo)
    // While writes are off (Lane 3 Task 11) the client hides every write control; on, the answer is as before.
    return c.json({ org: orgName(repo), ...s, ...(opts.instanceWrites === 'off' ? { instanceWrites: 'off' as const } : {}) })
  })

  app.get('/api/registries', c => c.json(gateRegistryList(viewerOf(c), repo, levels())))
  app.get('/api/registries/:name', c => c.json(gateRegistry(viewerOf(c), repo, c.req.param('name'), levels())))
  app.get('/api/schemas/:name', c => c.json(loadSchema(c.req.param('name'))))

  const guardCollection = (name: string) => {
    if (registryDef(name).kind !== 'collection') {
      throw new Error(`${name} is a document registry (read-only in M1)`)
    }
    // A ledger (proposals) is written only by its own routes: these old routes answer the sentence the tray does.
    if (registryDef(name).ledger) throw new HttpError(403, LEDGER_SENTENCE(name), 'LEDGER')
  }

  /** The body of a write, or a 400 that says what a body must be. */
  const readEntity = async (c: { req: { json: () => Promise<unknown> } }): Promise<Entity> => {
    let body: unknown
    let why = ''
    try { body = await c.req.json() } catch (err) { why = ` (${err instanceof Error ? err.message : String(err)})` }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400,
        `The request body must be a JSON object holding the entity's fields, for example {"id": "my-id"}${why}.`)
    }
    return body as Entity
  }

  /** A write through the routes that predate the change engine: one op on a private change that is
   *  never stored (the actor's tray is not touched), applied at once with exactly the checks of the
   *  tray's Apply: a known actor (403), the file guards (409), the rule (403), validation (422), one
   *  commit with the three trailers (503, and every file put back, if it fails). Its private part (L5 §10.3) is split
   *  off as staging splits it and written to the private store in the same act. */
  const writeNow = (c: Context, op: StageOp, message: string) =>
    withLock(async () => {
      const actor = knownActorOf(c)
      try {
        const split = splitOps(repo, [op], privateStore, viewerOf(c))
        const priv = { store: split.store, ops: split.private, staged: false, viewer: viewerOf(c) }
        return await applyAs(repo, actor, split.git, { change: newChangeId(), message, private: priv })
      } catch (err) {
        if (err instanceof StageRefusal) {
          // The old routes' 422 names the field, not the record.
          throw Object.assign(new HttpError(422, 'invalid'), { errors: err.errors.map(({ field, message: m }) => ({ field, message: m })) })
        }
        throw err // a Referred is the reviewed 409 sentence; the rest are Refusals, 503s, YAML 409s
      }
    })

  app.put('/api/registries/:name/:id', async c => {
    const name = c.req.param('name'); const id = c.req.param('id')
    guardCollection(name)
    const entity = await readEntity(c)
    if (typeof entity.id === 'string' && entity.id !== id) {
      // id is immutable through this endpoint — renaming would strand inbound references.
      return c.json({ errors: [{ field: 'id', message: `id "${entity.id}" does not match the URL id "${id}"` }] }, 422)
    }
    let current: Entity | null = null
    try { current = readRegistry(repo, name).entries?.find(e => e.id === id) ?? null } catch { /* the write says why */ }
    await writeNow(c, { op: 'replace', record: `${name}:${id}`, value: withoutEcho(repo, name, current, entity) }, `admin(${name}): update ${id}`)
    const saved = readRegistry(repo, name).entries!.find(e => e.id === id)!
    // Fails closed: a record the writer may not see is not answered, though the write was made.
    const gated = gateRecord(viewerOf(c), name, saved, readConfig(repo), undefined, reads.fields(name, id))
    return gated ? c.json(gated) : c.body(null, 204)
  })

  app.post('/api/registries/:name', async c => {
    const name = c.req.param('name')
    guardCollection(name)
    const entity = await readEntity(c)
    if (entity.id === undefined || entity.id === null || entity.id === '') {
      return c.json({ errors: [{ field: 'id', message: 'a new entry needs an `id`' }] }, 422)
    }
    await writeNow(c, { op: 'create', record: `${name}:${String(entity.id)}`, value: entity }, `admin(${name}): create ${entity.id}`)
    return c.json(entity, 201)
  })

  app.delete('/api/registries/:name/:id', async c => {
    const name = c.req.param('name'); const id = c.req.param('id')
    guardCollection(name)
    await writeNow(c, { op: 'delete', record: `${name}:${id}` }, `admin(${name}): delete ${id}`)
    return c.json({ deleted: id })
  })

  mountChanges(app, { repo, withLock, notify: msg => opts.notify?.(msg), privateStore })
  mountGovernance(app, repo)
  mountBoards(app, repo)
  mountLibrary(app, { repo, withLock, notify: msg => opts.notify?.(msg), privateStore })
  extend?.(app, { withLock, privateStore })

  // An address under /api/ that no route above answers. Without this, the UI's
  // catch-all (serve.ts) answers it with 200 and the app's HTML page.
  const noSuchAddress = (c: Context) => c.json({
    error: `No such API address: ${c.req.method} ${c.req.path}. ` +
      `GET /api/registries lists what this server holds; the routes are in packages/admin/README.md.`,
  }, 404)
  app.all('/api', noSuchAddress)
  app.all('/api/*', noSuchAddress)

  return app
}
