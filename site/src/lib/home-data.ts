import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { KmsConfig } from '@org-os/knowledge-commons'

export interface NoteLike { slug: string; title: string; source: string; date: string | null; excerpt: string; backlinks: unknown[] }

export const recent = (notes: NoteLike[], n = 5) =>
  [...notes].filter(x => x.date).sort((a, b) => b.date!.localeCompare(a.date!)).slice(0, n)

/** oldest note whose backlink count is above the median → resurfaced deep cut */
export function deepCut(notes: NoteLike[]): NoteLike | null {
  const dated = notes.filter(n => n.date)
  if (dated.length === 0) return null
  const counts = dated.map(n => n.backlinks.length).sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)]
  const eligible = dated.filter(n => n.backlinks.length >= Math.max(1, median))
  return eligible.sort((a, b) => a.date!.localeCompare(b.date!))[0] ?? null
}

export async function loadGaps(config: KmsConfig, rootDir: string, n = 3) {
  if (!config.features.gaps) return { top: [], total: 0 }
  try {
    const doc = yaml.load(await fs.readFile(path.resolve(rootDir, config.features.gaps), 'utf8')) as any
    const gaps: any[] = doc?.gaps ?? doc?.knowledge_gaps ?? []
    return { top: gaps.slice(0, n).map(g => g.title ?? g.name ?? String(g)), total: gaps.length }
  } catch { return { top: [], total: 0 } }
}

export interface Trail { id: string; label: string; emoji: string; stops: { slug: string; title: string }[]; promise: string }
export async function loadTrails(config: KmsConfig, rootDir: string): Promise<Trail[]> {
  const out: Trail[] = []
  for (const src of config.sources) {
    if (!src.trails) continue
    try {
      const mod = await import(/* @vite-ignore */ path.resolve(rootDir, src.dir, src.trails))
      const list = mod.journeyList ?? mod.default ?? []
      for (const j of list) out.push({
        id: j.id, label: j.label, emoji: j.emoji ?? '⟡', promise: j.description ?? '',
        stops: j.chapters.flatMap((c: any) => c.steps.map(([slug, title]: [string, string]) =>
          ({ slug: `${src.id}/${slug}`, title }))),
      })
    } catch { /* trails module unreadable: feature degrades silently */ }
  }
  return out
}
