import type { NoteFile } from './scan.ts'
import type { RenderedNote } from './markdown.ts'

export interface Backlink { fromSlug: string; fromTitle: string; fromSource: string }
export interface LinkReport {
  missing: { from: string; target: string }[]
  ambiguous: { from: string; target: string; candidates: string[] }[]
}

export function buildBacklinkIndex(notes: NoteFile[], rendered: Map<string, RenderedNote>): Map<string, Backlink[]> {
  const out = new Map<string, Backlink[]>()
  for (const n of notes) {
    for (const link of rendered.get(n.slug)?.links ?? []) {
      if (link.status !== 'ok' || !link.to || link.to === n.slug) continue
      const list = out.get(link.to) ?? []
      if (!list.some(b => b.fromSlug === n.slug)) list.push({ fromSlug: n.slug, fromTitle: n.title, fromSource: n.source })
      out.set(link.to, list)
    }
  }
  return out
}

export function buildLinkReport(notes: NoteFile[], rendered: Map<string, RenderedNote>): LinkReport {
  const report: LinkReport = { missing: [], ambiguous: [] }
  for (const n of notes) {
    for (const link of rendered.get(n.slug)?.links ?? []) {
      if (link.status === 'missing') report.missing.push({ from: n.slug, target: link.target })
      if (link.status === 'ambiguous') report.ambiguous.push({ from: n.slug, target: link.target, candidates: link.candidates })
    }
  }
  return report
}
