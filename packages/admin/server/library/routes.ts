import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { isKnown } from '../actor.ts'
import { knownActorOf, readerOf } from '../request.ts'
import { ChangeStore, newChangeId } from '../changes/store.ts'
import { stage, changeView } from '../changes/stage.ts'
import type { Change, StageOp } from '../changes/types.ts'
import { noStore, stagedView, type PrivateAccess } from '../private/ops.ts'
import { loadLibrary } from './read.ts'
import { listEntries, previewEntry } from './preview.ts'
import { addOps } from './add.ts'
import { findReceipt, listReceipts, removalPreview, removeOps } from './remove.ts'

export interface LibraryRoutesDeps {
  repo: string
  /** The repository's one write lock (app.ts): an add loads, stages and saves the actor's change inside it. */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after an add or a removal changes the actor's change, so every open tab refreshes its tray. */
  notify: (msg: { type: 'changes' }) => void
  /** The private store, so the tray this answers shows a staged private op as staged (Task 14 M6). Absent: none. */
  privateStore?: PrivateAccess
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const BODY = 'The body must be {} or {"config": {...}}, the values the entry asks for.'

/** The config of POST /api/library/:id/add: an empty body is no config; anything but an object, or a `config` that is
 *  not one, is a 400. */
function readAddBody(text: string): unknown {
  if (text.trim() === '') return undefined
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new HttpError(400, BODY) }
  if (!isObject(body) || (body.config !== undefined && !isObject(body.config))) throw new HttpError(400, BODY)
  return body.config
}

const TAKE = 'The body must be {} or {"take": [...]}, the records edited since the add that the removal deletes with their edits.'

/** The `take` of POST /api/library/receipts/:id/remove: an empty body takes nothing; anything but an object whose
 *  `take`, when present, is a list of record names is a 400. */
function readRemoveBody(text: string): string[] {
  if (text.trim() === '') return []
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new HttpError(400, TAKE) }
  if (!isObject(body)) throw new HttpError(400, TAKE)
  if (body.take === undefined) return []
  if (!Array.isArray(body.take) || !body.take.every(t => typeof t === 'string')) throw new HttpError(400, TAKE)
  return body.take as string[]
}

/** The library: its list, an entry, a preview (which writes nothing), and Add, which stages the entry's records and
 *  its receipt in the actor's change, the way POST /api/changes/ops stages ops; its receipts, a removal's preview
 *  (which writes nothing), and Remove, which stages a receipt's deletes and its removal the same way. Every other
 *  verb is the API's own "no such address". */
export function mountLibrary(app: Hono, { repo, withLock, notify, privateStore = noStore }: LibraryRoutesDeps): void {
  const store = new ChangeStore(repo)
  const find = (id: string) => {
    const entry = loadLibrary(repo).entries.find(e => e.id === id)
    if (!entry) throw new HttpError(404, `No library entry "${id}". GET /api/library lists the entries.`)
    return entry
  }
  // Reading the actor's own change writes nothing; a reader who is no member has none.
  const stagedBy = (c: Context) => {
    const actor = readerOf(c)
    return { actor, staged: isKnown(actor) ? store.load(actor.id)?.ops ?? [] : [] }
  }
  // Inside the lock with no `await` between the load and the save, as every change route (changes/routes.ts).
  // A Refusal (403, 409) and a StageRefusal (422 { errors }) reach the app's error handler as they are.
  const stageInto = (c: Context, opsFor: (staged: StageOp[]) => StageOp[]) => withLock(async () => {
    const actor = knownActorOf(c)
    const now = new Date().toISOString()
    const change: Change = store.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: now, updated: now, ops: [] }
    const { ops, errors } = stage(repo, change.ops, opsFor(change.ops))
    if (errors.length > 0) return Response.json({ errors }, { status: 422 })
    const next: Change = { ...change, ops, updated: new Date().toISOString() }
    store.save(next)
    notify({ type: 'changes' })
    return Response.json(changeView(repo, actor, next, stagedView(privateStore, next)))
  })

  app.get('/api/library', async c => c.json(await listEntries(repo)))
  // The receipts' routes come before /api/library/:id, which would otherwise take "receipts" for an entry id.
  app.get('/api/library/receipts', c => c.json(listReceipts(repo)))
  app.get('/api/library/receipts/:id/removal', async c => {
    const { actor, staged } = stagedBy(c)
    return c.json(removalPreview(repo, actor, c.req.param('id'), staged))
  })
  app.post('/api/library/receipts/:id/remove', async c => {
    const take = readRemoveBody(await c.req.text())
    const id = c.req.param('id')
    findReceipt(repo, id) // the 404 comes before the lock and the 403, as Add's does
    return stageInto(c, staged => removeOps(repo, id, take, staged))
  })

  app.get('/api/library/:id', c => c.json(find(c.req.param('id'))))
  app.get('/api/library/:id/preview', async c => {
    const entry = find(c.req.param('id'))
    // Needs and ids are read through the actor's own change.
    const { actor, staged } = stagedBy(c)
    return c.json(await previewEntry(repo, entry, actor, staged))
  })
  app.post('/api/library/:id/add', async c => {
    const config = readAddBody(await c.req.text())
    const entry = find(c.req.param('id'))
    return stageInto(c, staged => addOps(repo, entry, config, staged).ops)
  })
}
