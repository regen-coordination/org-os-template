import type { NoteFile } from './scan.ts'
import { slugifySegment } from './scan.ts'

export interface SlugIndex { byKey: Map<string, NoteFile[]> }
export interface Resolution {
  status: 'ok' | 'ambiguous' | 'missing'
  note: NoteFile | null
  candidates: NoteFile[]
}

/** Normalization shared by index + lookup: slugify collapses case/space/diacritics. */
const norm = (s: string) => slugifySegment(s)

export function buildSlugIndex(notes: NoteFile[]): SlugIndex {
  const byKey = new Map<string, NoteFile[]>()
  const add = (key: string, n: NoteFile) => {
    const list = byKey.get(key) ?? []
    if (!list.includes(n)) list.push(n)
    byKey.set(key, list)
  }
  for (const n of notes) {
    add(norm(n.title), n)
    const base = n.slug.split('/').pop()!
    add(base, n)
    add(n.slug, n)               // full slug always unique
  }
  return { byKey }
}

export function resolveLink(target: string, fromSource: string, index: SlugIndex): Resolution {
  const matches = index.byKey.get(norm(target)) ?? []
  if (matches.length === 0) return { status: 'missing', note: null, candidates: [] }
  const local = matches.filter(n => n.source === fromSource)
  if (local.length === 1) return { status: 'ok', note: local[0], candidates: local }
  if (local.length > 1) return { status: 'ambiguous', note: null, candidates: local }
  if (matches.length === 1) return { status: 'ok', note: matches[0], candidates: matches }
  return { status: 'ambiguous', note: null, candidates: matches }
}
