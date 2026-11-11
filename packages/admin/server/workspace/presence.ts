// packages/admin/server/workspace/presence.ts
//
// Presence (DAO-OS L6 spec §8.4): who has a page or a record open, in the server's memory only, never in the store (§20
// Q9: a call that departs from ADR 0001's wording) — a restart clears it. A client beats `POST /api/presence` every
// PRESENCE_BEAT_MS; an entry lapses PRESENCE_TTL_MS after its last beat. Only for a target the actor may see; shown only
// to viewers who may see it, each entry judged again against the target's level now (a page narrowed since drops the
// wearers it no longer admits); never to the public (rule 7). The server hears each change (`onChange`) and sends
// `{ type: 'presence', target, people }` through the gate (serve.ts, §8.5).

import type { Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import type { KnownActor } from '../actor.ts'
import type { Membership } from '../session/membership.ts'
import type { PrivateAccess } from '../private/ops.ts'
import { reach } from '../private/ops.ts'
import { admits, type ParsedLevel, type Viewer } from '../../lib/visibility.mjs'
import { parseTarget, visibleTarget, type Target } from './conversation.ts'

/** How often an open page says it is still open (§8.4). */
export const PRESENCE_BEAT_MS = 20000
/** How long after its last beat an entry lapses (§8.4). */
export const PRESENCE_TTL_MS = 45000

/** One person on a target, as L4a's `Presence` takes them (§8.4). */
export interface Present { handle: string; role: string; editing: boolean }

interface Entry extends Present { actor: string; at: number; viewer: Viewer }

export interface PresenceDeps {
  /** A target's level now; null when there is no such thing (then nobody is shown on it). */
  level: (target: Target) => ParsedLevel | null
  /** How a person is shown (§8.4: a CAIP-10 actor's handle is their short address, their role the lowest worn hat's name).
   *  Left out: their id and their name. */
  names?: (actor: KnownActor) => { handle: string; role: string }
  /** Milliseconds; injectable in tests. */
  now?: () => number
}

export class Presence {
  private readonly on = new Map<Target, Map<string, Entry>>()
  private readonly listeners: ((target: Target) => void)[] = []
  private readonly level: PresenceDeps['level']
  private readonly names: NonNullable<PresenceDeps['names']>
  private readonly now: () => number

  constructor(deps: PresenceDeps) {
    this.level = deps.level
    this.names = deps.names ?? (a => ({ handle: a.id, role: a.name }))
    this.now = deps.now ?? (() => Date.now())
  }

  /** `actor` has `target` open (`editing`: in an editing session). `viewer`: who they read as, so their entry is judged again
   *  as the target's level moves; left out, a member with no hats or roles. The caller has judged that they may see it. A
   *  beat that only renews tells nobody; a new entry, or `editing` changed, is heard by `onChange`. */
  beat(actor: KnownActor, target: Target, editing: boolean, viewer?: Viewer): void {
    let here = this.on.get(target)
    if (!here) { here = new Map(); this.on.set(target, here) }
    const was = here.get(actor.id)
    const lapsed = was !== undefined && this.lapsed(was)
    const { handle, role } = this.names(actor)
    here.set(actor.id, {
      actor: actor.id, handle, role, editing, at: this.now(),
      viewer: viewer ?? { kind: 'member', id: actor.id, hats: 'hats' in actor ? actor.hats : [], roles: [] },
    })
    if (!was || lapsed || was.editing !== editing || was.handle !== handle || was.role !== role) this.tell(target)
  }

  /** Who else has `target` open, as `viewer` may be shown them: nobody for the public, nobody when the viewer may not see
   *  the target, and never the viewer themself. */
  of(target: Target, viewer: Viewer): Present[] {
    if (viewer.kind !== 'member') return []
    const level = this.level(target)
    if (!level || !admits(level, viewer)) return []
    return this.admitted(target, level).filter(e => e.actor !== viewer.id).map(shown)
  }

  /** Everyone on `target` whom its level admits now: the event's `people`, sent only to connections admitted to it. */
  everyone(target: Target): Present[] {
    const level = this.level(target)
    return level ? this.admitted(target, level).map(shown) : []
  }

  /** Drops every lapsed entry, telling `onChange` of each target that lost someone. The server runs it on a timer. */
  sweep(): void {
    for (const [target, here] of this.on) {
      let lost = false
      for (const [id, e] of here) if (this.lapsed(e)) { here.delete(id); lost = true }
      if (here.size === 0) this.on.delete(target)
      if (lost) this.tell(target)
    }
  }

  /** Heard when who is on a target changes. */
  onChange(fn: (target: Target) => void): void { this.listeners.push(fn) }

  private admitted(target: Target, level: ParsedLevel): Entry[] {
    return [...(this.on.get(target)?.values() ?? [])]
      .filter(e => !this.lapsed(e) && admits(level, e.viewer))
      .sort((a, b) => a.handle.localeCompare(b.handle))
  }

  private lapsed(e: Entry): boolean { return this.now() - e.at >= PRESENCE_TTL_MS }

  private tell(target: Target): void {
    for (const fn of this.listeners) {
      try { fn(target) } catch (err) { console.error(`org-os admin: a listener of presence failed: ${err instanceof Error ? err.message : String(err)}`) }
    }
  }
}

const shown = (e: Entry): Present => ({ handle: e.handle, role: e.role, editing: e.editing })

export interface PresenceRoutesDeps {
  repo: string
  /** Not read yet: the names come from the Presence the server made (serve.ts, `actorNames`). */
  membership?: Membership | null
  privateStore: PrivateAccess
  presence: Presence
}

const PRESENCE_BODY = 'The body must be {"target": "page:<id>" or "record:<collection>:<id>", "editing"?: true or false}.'

/** `POST /api/presence { target, editing }` and `GET /api/presence?targets=<t>,<t>` (§16). A target kept in the store while
 *  it is down refuses with L5's sentence; a git page's presence still works (Review Focus 5). */
export function mountPresence(app: Hono, deps: PresenceRoutesDeps): void {
  const { repo, presence } = deps

  app.post('/api/presence', async c => {
    let raw: unknown
    try { raw = await c.req.json() } catch { raw = undefined }
    const r = raw as { target?: unknown; editing?: unknown } | undefined
    const target = typeof r?.target === 'string' ? parseTarget(r.target) : null
    if (!target || (r!.editing !== undefined && typeof r!.editing !== 'boolean')) throw new HttpError(400, PRESENCE_BODY)
    const actor = knownActorOf(c)
    const viewer = viewerOf(c)
    const { store, why } = reach(deps.privateStore)
    visibleTarget(repo, target, store, why, viewer)
    presence.beat(actor, target, r!.editing === true, viewer)
    return c.json({ target, people: presence.of(target, viewer) })
  })

  app.get('/api/presence', c => {
    const viewer = viewerOf(c)
    const { store } = reach(deps.privateStore)
    const out: Record<string, Present[]> = {}
    for (const t of (c.req.query('targets') ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
      const target = parseTarget(t)
      if (!target) continue
      // What the viewer may not see, and what the store cannot say while it is down, is absent (rule 7).
      try { visibleTarget(repo, target, store, null, viewer) } catch { continue }
      out[target] = presence.of(target, viewer)
    }
    return c.json(out)
  })
}

