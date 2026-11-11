/** The knowledge routes: the collection, one entry, the peers and the runs. Reads only — the gate preview (T2) and
 *  prepared edits (T3) mount from their own files, so a reader can see that this file writes nothing. */
import type { Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { JobStore, type JobRecord } from '../state.ts'
import { dryRead, previewEntry, publishPlan } from './gate.ts'
import { readEntry, readKnowledge } from './read.ts'
import { applyEdit, prepareEdit, type EditRequest } from './write.ts'
import { knownActorOf, readerOf } from '../request.ts'
import type { RunRow } from './types.ts'

export interface KnowledgeRoutesDeps {
  repo: string
  /** The repository's one write lock: an apply writes a file and makes a commit. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>
  /** The app's own job records — the runs that touched the commons, with their receipts (§4.5). */
  jobs?: JobStore
  /** The clock, for tests. */
  now?: () => string
}

/** Which runs are the commons': this lane's own operations, and the connector ingest that feeds the canon. */
const isKnowledgeRun = (op: string): boolean => op.startsWith('knowledge.') || op === 'connector.ingest'

/** A job record as the row the page draws: the house's own sentence, and what it changed. */
export const runRow = (job: JobRecord): RunRow => ({
  id: job.id,
  op: job.op,
  label: job.op === 'connector.ingest' ? 'ingest' : job.op.replace(/^knowledge\./, ''),
  status: job.status,
  at: job.created,
  sentence: job.sentence ?? '',
  changed: job.changed ?? [],
})

const BODY = 'The body must be {"fields": {…}} — the entry’s fields, with the values to set.'

/** An edit's body: `{ fields }`, and for an apply the `base` the prepare answered with. */
async function readEdit(c: { req: { json: () => Promise<unknown> } }): Promise<EditRequest> {
  let body: unknown
  try { body = await c.req.json() } catch { throw new HttpError(400, BODY) }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, BODY)
  const { fields, base } = body as { fields?: unknown; base?: unknown }
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new HttpError(400, BODY)
  return { fields: fields as EditRequest['fields'], ...(typeof base === 'string' ? { base } : {}) }
}

export function mountKnowledge(app: Hono, { repo, jobs, withLock = fn => fn(), now = () => new Date().toISOString() }: KnowledgeRoutesDeps): void {
  const runs = (): RunRow[] => (jobs ? jobs.list(undefined, 50).filter(j => isKnowledgeRun(j.op)).slice(0, 8).map(runRow) : [])

  // The canon's slash in `<type>/<slug>` is encoded by the client; Hono decodes each segment.
  app.get('/api/knowledge/entry/:type/:slug', async c => {
    const { type, slug } = c.req.param()
    return c.json(await readEntry(repo, type, slug, { now: now() }))
  })

  app.get('/api/knowledge', async c => c.json(await readKnowledge(repo, { now: now(), runs: runs() })))

  /* ── the gate, read-only (T2): the app plans and previews; only the CLI writes (K-1) ─────────────────────────── */

  // What the commons shows for one entry: the projected face, and the API object beside it (K-5, K-7).
  app.get('/api/knowledge/entry/:type/:slug/preview', async c => {
    const { type, slug } = c.req.param()
    return c.json(await previewEntry(repo, type, slug, { now: now() }))
  })

  // The dry read: the selection run in memory. It writes nothing, and says so in its own answer.
  app.post('/api/knowledge/dry-read', async c => c.json(await dryRead(repo, { now: now() })))

  // The preparation a run would make: joins, leaves, and the command that writes it.
  app.get('/api/knowledge/plan', async c => c.json(await publishPlan(repo, { now: now() })))

  /* ── a prepared edit, and its apply (T3, R-32): the canon's one write ──────────────────────────────────────── */

  // Nothing is written here: the answer is the change, and the base it must still match.
  app.post('/api/knowledge/entry/:type/:slug/prepare', async c => {
    const { type, slug } = c.req.param()
    const edit = await readEdit(c)
    return c.json(await prepareEdit(repo, type, slug, edit, { now: now() }, readerOf(c)))
  })

  // One file, one commit, the house's trailers, judged by the house's rules. A reader writes nothing: a git identity no
  // member holds is refused 403 with the house's sentence, and a hosted request with no session 401 (knownActorOf).
  app.post('/api/knowledge/entry/:type/:slug/apply', async c => {
    const { type, slug } = c.req.param()
    const edit = await readEdit(c)
    const actor = knownActorOf(c)
    return c.json(await withLock(() => applyEdit(repo, type, slug, edit, actor)))
  })
}
