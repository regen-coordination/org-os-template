/** Entries the platform can't address (contract): one with no id, and one whose id other entries in
 *  its file share. Neither can be staged against, so both are read-only and say why. */
type Entry = Record<string, unknown>

export const hasId = (e: Entry): boolean => e.id !== undefined && e.id !== null && e.id !== ''

/** `#3`: the third entry in its file, the only name an entry with no id has. */
export const positionKey = (index: number): string => `#${index + 1}`
export function positionOf(id: string): number | null {
  const m = /^#(\d+)$/.exec(id)
  return m ? Number(m[1]) - 1 : null
}

export function idCounts(entries: Entry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) if (hasId(e)) out.set(String(e.id), (out.get(String(e.id)) ?? 0) + 1)
  return out
}

export function addressProblem(entries: Entry[], index: number, file: string): string | null {
  const e = entries[index]
  if (!e) return null
  if (!hasId(e)) return `This entry has no id, so the platform cannot address it: give it one in ${file}. Until then it is read-only.`
  const n = idCounts(entries).get(String(e.id)) ?? 1
  return n > 1 ? `id ${String(e.id)} appears ${n} times in ${file}; fix it in the file.` : null
}

/** How many entries of a file cannot be addressed: no id, or an id shared. */
export function unaddressable(entries: Entry[]): number {
  const counts = idCounts(entries)
  return entries.filter(e => !hasId(e) || (counts.get(String(e.id)) ?? 1) > 1).length
}
