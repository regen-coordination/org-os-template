// packages/admin/server/workspace/written.ts
//
// The conversation floor (PR7-R45): every comment, reply, mention and notification keeps the level its target had when it
// was written (`written_level`). A row is read only by a viewer admitted to both its target's level now and that written
// level, so a widening, made in the Hub or outside it, never shows earlier talk to anyone it did not admit then, and a page
// deleted and made again shows its old talk only to those who could read it before. A reply is read only with every
// comment above it. Invisible means absent: a row that fails is not listed, counted or named. Read marks hold no content
// and have no floor. Conversation is the members' side: the public reads none of it (L6 §8.5).

import { admits, parseLevel, type ParsedLevel, type Viewer } from '../../lib/visibility.mjs'
import { WRITTEN_UNFILLED } from '../private/store.ts'

/** A written level as a level; one that does not parse admits nobody (no hat ref, so nobody wears it), as the store's levels
 *  read (private/reads.ts `levelOfToken`; not imported, so the store's own modules may read this one). */
export const writtenLevelOf = (token: string): ParsedLevel => parseLevel(token) ?? { level: 'hat', hat: token }
const levelOf = writtenLevelOf

/** What a row written before the column existed holds until the start fills it (schema 3's migration, PR7-R45). */
export const UNFILLED = WRITTEN_UNFILLED
/** What such a row is filled with when its target was not there to read a level from: a level nobody is admitted to. */
export const NOBODY_WRITTEN = 'nobody'

/** Whether `viewer` may read a row written at `written` on a target at `current` now: a member admitted to both. A target
 *  that is not there (null), or a written level that is missing or does not parse, admits nobody. */
export function mayRead(viewer: Viewer, current: ParsedLevel | null, written: string | null | undefined): boolean {
  if (viewer.kind !== 'member' || current === null || typeof written !== 'string' || written === '') return false
  return admits(current, viewer) && admits(levelOf(written), viewer)
}

/** The rows of one target `viewer` may read (`mayRead`), a reply only with every comment above it that the store still
 *  holds. Order kept. */
export function readableRows<R extends { id: string; parent: string | null; writtenLevel?: string | null }>(rows: readonly R[], viewer: Viewer,
  current: ParsedLevel | null): R[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const memo = new Map<string, boolean>()
  const ok = (r: R, seen: Set<string>): boolean => {
    const hit = memo.get(r.id)
    if (hit !== undefined) return hit
    let out = mayRead(viewer, current, r.writtenLevel)
    if (out && r.parent !== null && !seen.has(r.id)) {
      const up = byId.get(r.parent)
      seen.add(r.id)
      if (up) out = ok(up, seen)
    }
    memo.set(r.id, out)
    return out
  }
  return rows.filter(r => ok(r, new Set()))
}

/** The written levels of the comments above `parent` (itself first), for who a reply may tell: a reply is read only with
 *  them. */
export function floorsAbove<R extends { id: string; parent: string | null; writtenLevel?: string | null }>(rows: readonly R[], parent: string | null): (string | null)[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const out: (string | null)[] = []
  const seen = new Set<string>()
  for (let at = parent === null ? undefined : byId.get(parent); at && !seen.has(at.id); at = at.parent === null ? undefined : byId.get(at.parent)) {
    seen.add(at.id)
    out.push(at.writtenLevel ?? null)
  }
  return out
}
