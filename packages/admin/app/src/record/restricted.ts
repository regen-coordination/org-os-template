import type { VisibilitySource } from '../viewAs/visibility.ts'

/** The fields of an entry its viewer is not admitted to, as the gate marks them (R-L5-14.5, L5 spec §11.5):
 *  `restricted: { <field>: "<level that keeps them out>" }`, with no value. Only string levels are read; an entry
 *  with no marker has none. */
export function restrictedOf(entry: unknown): Record<string, string> {
  const r = entry !== null && typeof entry === 'object' ? (entry as { restricted?: unknown }).restricted : undefined
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return {}
  return Object.fromEntries(Object.entries(r).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

/** What a restricted field reads "<name> only" with (E-60): a hat (`hat:<ref>`) by its name in the source's tree, else
 *  its raw id; a role (`role:<id>`, an org with no tree) by the tree's name for it, else its id; members "Members". The
 *  source is the house's `useVisibilitySource()`: L5 Task 20 swaps the source, never this mapping (C9's People reuse
 *  it, E-70). */
export function restrictedHat(level: string, source: VisibilitySource): string {
  const named = (hat: string) => source.hats().find(h => h.hat === hat)?.name
  if (level.startsWith('hat:')) { const id = level.slice('hat:'.length); return named(id) ?? id }
  if (level.startsWith('role:')) return named(level) ?? level.slice('role:'.length)
  if (level === 'members') return 'Members'
  return level
}

/** An entry without the gate's marker: what is read into field rows and edited. The marker is the gate's, never a
 *  field of the record, so it is never staged back. */
export function withoutRestricted<T extends Record<string, unknown> | null>(entry: T): T {
  if (entry === null || !Object.hasOwn(entry, 'restricted')) return entry
  const { restricted: _marker, ...rest } = entry
  return rest as T
}

/** A record's name as the viewer may read it: its own when they may, else "<hat> only" (E-70). The value is never
 *  returned when the gate marks it restricted, so a heading, a link's name or an aria-label can never print it. */
export function shownName(r: { name: string }, entry: unknown, source: VisibilitySource): string {
  const level = restrictedOf(entry).name
  return level === undefined ? r.name : `${restrictedHat(level, source)} only`
}
