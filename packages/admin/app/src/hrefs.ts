import type { Board, Resource } from './api.ts'
import { KIND_OF_REGISTRY, splitId } from './kinds.ts'

const enc = encodeURIComponent

/** A resource's record page: `/r/<kind>/<id>`, each part encoded on its own. */
export function recordHref(resourceId: string): string {
  const { kind, id } = splitId(resourceId)
  return `/r/${enc(kind)}/${enc(id)}`
}

/** A registry entry's page: its kind's page when the registry backs a kind, else the registry's own. */
export const entryHref = (registry: string, id: string): string => `/r/${enc(KIND_OF_REGISTRY[registry] ?? registry)}/${enc(id)}`

/** Where adding a record to a registry starts: its New page. The one place every Add goes through (a section's
 *  head, its plate, Home's setup checklist). `steps` asks for the stepped form (spec 2026-11-04 §3, Option B: the
 *  setup checklist's, for someone's first record); a narrow screen gets it whatever the address says. */
export const newRecordHref = (registry: string, o: { steps?: boolean } = {}): string =>
  `/new/${enc(registry)}${o.steps === true ? '?steps=1' : ''}`

/** The change engine's address for a record: `<registry>:<id>`. */
export const changeKey = (registry: string, id: string): string => `${registry}:${id}`

export function splitChangeKey(key: string): { registry: string; id: string } {
  const at = key.indexOf(':')
  return at < 0 ? { registry: key, id: '' } : { registry: key.slice(0, at), id: key.slice(at + 1) }
}

export function changeKeyHref(key: string): string {
  const { registry, id } = splitChangeKey(key)
  return entryHref(registry, id)
}

/** The change key of a resource read from a registry; null for one that is not (a module, a seat). */
export function changeKeyOf(r: Resource): string | null {
  return r.source?.registry && r.source.entityId ? changeKey(r.source.registry, r.source.entityId) : null
}

/** A map board with records selected, and optionally an operation to open on the first. */
export function selectHref(board: Board, ids: string[], op?: { id: string; label: string }): string {
  const q = new URLSearchParams()
  for (const id of ids) q.append('select', id)
  if (op) { q.set('op', op.id); q.set('opLabel', op.label) }
  const s = q.toString()
  return s ? `/b/${board}?${s}` : `/b/${board}`
}

/** A record page that opens one operation's confirm box (the ⌘K and inspector path). */
export function opHref(resourceId: string, op: { id: string; label: string }): string {
  return `${recordHref(resourceId)}?${new URLSearchParams({ op: op.id, opLabel: op.label }).toString()}`
}

/** A path segment back to its text; a malformed escape is left as it was. */
export function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}
