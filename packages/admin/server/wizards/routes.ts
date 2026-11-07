import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { stateDir } from '../state.ts'
import { knownActorOf } from '../request.ts'
import { actorTrailer } from '../actor.ts'
import { actorKey } from '../hosted/writes.ts'
import { loadWizards, type WizardDef } from '../../lib/wizards.mjs'

export interface WizardDeps {
  repo: string; dir?: string
  /** Hosted mode: each member keeps their own draft (L9 §5.4, Q-L9-4). Absent or false: one draft, as before. */
  hosted?: boolean
}

/** A draft is a few answers, never a document. */
export const DRAFT_MAX_BYTES = 16_384

/** Wizards are data (wizards/*.yaml); a draft is the answers so far and the step, kept beside the
 *  Changes tray's own state and outside any repository. Discarding deletes only that file. The
 *  draft number is reserved (`<id>-<n>.json`); one is kept for now. Hosted, a draft is the member's own
 *  (`<id>-<actor key>.json`): one member never reads or discards another's. */
export function mountWizards(app: Hono, { repo, dir, hosted = false }: WizardDeps): void {
  const read = () => loadWizards(dir)
  const named = (id: string): WizardDef => {
    const w = read().wizards.find(x => x.id === id)
    if (!w) throw new HttpError(404, `No wizard "${id}". GET /api/wizards lists them.`)
    return w
  }
  const file = (c: Context) => {
    const id = named(c.req.param('id')!).id
    return join(stateDir(repo), 'wizards', `${id}-${hosted ? actorKey(actorTrailer(knownActorOf(c))) : '1'}.json`)
  }

  app.get('/api/wizards', c => c.json(read().wizards.map(({ id, title, summary }) => ({ id, title, summary }))))
  app.get('/api/wizards/:id', c => c.json(named(c.req.param('id'))))

  // No saved draft is the ordinary first visit: an empty answer (null), not a 404 the console would show red.
  app.get('/api/wizards/:id/draft', c => {
    const path = file(c)
    if (!existsSync(path)) return c.json(null)
    try { return c.json(JSON.parse(readFileSync(path, 'utf8'))) } catch { return c.json(null) }
  })

  app.put('/api/wizards/:id/draft', async c => {
    const path = file(c)
    let body: unknown
    try { body = await c.req.json() } catch { body = undefined }
    const o = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
    const answers = o?.answers
    if (!o || !Number.isInteger(o.index) || (o.index as number) < 0 || (o.index as number) > 99 ||
      !answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new HttpError(400, 'A draft is {"index": <the step, from 0>, "answers": {...}}.')
    }
    const saved = { index: o.index as number, answers: answers as Record<string, unknown>, saved: new Date().toISOString() }
    const text = JSON.stringify(saved)
    if (Buffer.byteLength(text) > DRAFT_MAX_BYTES) throw new HttpError(413, `A draft is at most ${DRAFT_MAX_BYTES} bytes; it holds answers, not documents.`)
    mkdirSync(join(stateDir(repo), 'wizards'), { recursive: true })
    writeFileSync(`${path}.tmp`, text)
    renameSync(`${path}.tmp`, path) // a reader never sees half a draft
    return c.json(saved)
  })

  app.delete('/api/wizards/:id/draft', c => {
    rmSync(file(c), { force: true })
    return c.json({ discarded: true })
  })
}
