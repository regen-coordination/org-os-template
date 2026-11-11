import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { fileSafe, stateDir } from '../state.ts'
import { actorOf, knownActorOf, SIGN_IN } from '../request.ts'
import { Refusal } from '../changes/apply.ts'
import { actorTrailer } from '../actor.ts'
import { actorKey } from '../hosted/writes.ts'
import { loadWizards, type WizardDef } from '../../lib/wizards.mjs'
import { shelfWizards } from '../library/read.ts'

export interface WizardDeps {
  repo: string; dir?: string
  /** Hosted mode: each member keeps their own draft (L9 §5.4, Q-L9-4). Absent or false: one draft, as before. */
  hosted?: boolean
}

/** A draft is a few answers, never a document. */
export const DRAFT_MAX_BYTES = 16_384

/** Wizards are data: the framework's (wizards/*.yaml), then every wizard a registered shelf serves (DAO-OS L7 §5.1),
 *  whose id is `<shelf>/<slug>` (sent with the slash encoded, `%2F`). A draft is the answers so far and the step, kept
 *  beside the Changes tray's own state and outside any repository. Discarding deletes only that file. A draft is the
 *  actor's own (L7 Tasks 19/17 review, M3): kept per wizard and actor (a member by id, an address git names that no
 *  member holds as `unknown:<address>`), never offered to another. The draft number is reserved (`<id>.<actor>-<n>.json`,
 *  a shelf wizard's `/` written `__`, the actor file-safe); one is kept for now. Hosted (L9 §5.4, Q-L9-4), a draft is the
 *  member's own by their actor key (`<id>-<actor key>.json`), and a request with no session is refused 401. */
export function mountWizards(app: Hono, { repo, dir, hosted = false }: WizardDeps): void {
  const read = (): WizardDef[] => [...loadWizards(dir).wizards, ...shelfWizards(repo)]
  const named = (id: string): WizardDef => {
    const w = read().find(x => x.id === id)
    if (!w) throw new HttpError(404, `No wizard "${id}". GET /api/wizards lists them.`)
    return w
  }
  /** Whose drafts a request reads and writes, or null when no one asks. */
  const whose = (c: Context): string | null => {
    const a = actorOf(c)
    return a === null ? null : 'id' in a ? a.id : `unknown:${a.unknown}`
  }
  // A framework id is [a-z0-9-] and a shelf's name holds no "/", so "__" names one shelf wizard's file and no other; the
  // actor's part is file-safe (letters, digits, '.', '_', '-' and a hash) and follows a '.', which no wizard id holds.
  // Hosted, the file is named by the member's actor key, and knownActorOf refuses a request with no session (401).
  const file = (c: Context, who: string) => {
    const id = named(c.req.param('id')!).id.replaceAll('/', '__')
    return join(stateDir(repo), 'wizards', hosted ? `${id}-${actorKey(actorTrailer(knownActorOf(c)))}.json` : `${id}.${fileSafe(who)}-1.json`)
  }
  const writer = (c: Context): string => {
    const who = whose(c)
    if (who === null) throw new Refusal(401, { error: SIGN_IN, code: 'SIGN_IN' })
    return who
  }

  app.get('/api/wizards', c => c.json(read().map(({ id, title, summary }) => ({ id, title, summary }))))
  app.get('/api/wizards/:id', c => c.json(named(c.req.param('id'))))

  // No saved draft is the ordinary first visit: an empty answer (null), not a 404 the console would show red.
  app.get('/api/wizards/:id/draft', c => {
    named(c.req.param('id'))
    if (hosted) knownActorOf(c) // hosted: no session is refused, 401, as before
    const who = whose(c)
    if (who === null) return c.json(null)
    const path = file(c, who)
    if (!existsSync(path)) return c.json(null)
    try {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as { by?: unknown }
      return c.json(saved.by === who ? saved : null) // never another actor's
    } catch { return c.json(null) }
  })

  app.put('/api/wizards/:id/draft', async c => {
    named(c.req.param('id'))
    const who = writer(c)
    const path = file(c, who)
    let body: unknown
    try { body = await c.req.json() } catch { body = undefined }
    const o = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
    const answers = o?.answers
    if (!o || !Number.isInteger(o.index) || (o.index as number) < 0 || (o.index as number) > 99 ||
      !answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new HttpError(400, 'A draft is {"index": <the step, from 0>, "answers": {...}}.')
    }
    const saved = { index: o.index as number, answers: answers as Record<string, unknown>, saved: new Date().toISOString(), by: who }
    const text = JSON.stringify(saved)
    if (Buffer.byteLength(text) > DRAFT_MAX_BYTES) throw new HttpError(413, `A draft is at most ${DRAFT_MAX_BYTES} bytes; it holds answers, not documents.`)
    mkdirSync(join(stateDir(repo), 'wizards'), { recursive: true })
    writeFileSync(`${path}.tmp`, text)
    renameSync(`${path}.tmp`, path) // a reader never sees half a draft
    return c.json(saved)
  })

  app.delete('/api/wizards/:id/draft', c => {
    named(c.req.param('id'))
    rmSync(file(c, writer(c)), { force: true })
    return c.json({ discarded: true })
  })
}
