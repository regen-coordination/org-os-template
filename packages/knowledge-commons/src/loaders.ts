import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import fg from 'fast-glob'
import type { Loader } from 'astro/loaders'
import type { KmsConfig } from './config.ts'
import { scanSources, type NoteFile } from './scan.ts'
import { buildSlugIndex } from './resolver.ts'
import { renderNote, type RenderedNote, type Heading } from './markdown.ts'
import { buildBacklinkIndex, buildLinkReport, type Backlink, type LinkReport } from './backlinks.ts'
import { convertNetworkx } from './graph/convert.ts'
import { buildWikilinkGraph, mergeGraphs } from './graph/merge.ts'
import { layoutGraph, serializeArtifact, type GraphArtifact } from './graph/layout.ts'

export interface CommonsNote extends NoteFile {
  html: string; headings: Heading[]; excerpt: string
  backlinks: Backlink[]
}
export interface RegistryEntry { source: string; kind: string; items: unknown[] }
export interface Commons {
  notes: CommonsNote[]
  backlinks: Map<string, Backlink[]>
  registries: RegistryEntry[]
  linkReport: LinkReport
  artifact: GraphArtifact | null
}

/**
 * Guard against slug collisions: `toSlug` (scan.ts) drops only the first path segment, so
 * two notes can collide on the same slug if a source declares multiple content roots (e.g.
 * `docs/x.md` and `notes/x.md` both trim to `<source>/x`). De-collide deterministically by
 * sorting colliding notes by relPath and appending `-2`, `-3`, … to all but the first; warn
 * on every collision so it's visible in build logs.
 */
export function dedupeSlugs(notes: NoteFile[]): NoteFile[] {
  const bySlug = new Map<string, NoteFile[]>()
  for (const n of notes) {
    const list = bySlug.get(n.slug) ?? []
    list.push(n)
    bySlug.set(n.slug, list)
  }
  const renames = new Map<NoteFile, string>()
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => a.relPath.localeCompare(b.relPath))
    const collisionList = sorted.map(n => `${n.source}/${n.relPath}`).join(', ')
    sorted.forEach((n, i) => {
      if (i === 0) return
      const newSlug = `${slug}-${i + 1}`
      console.warn(`[kms] slug collision on "${slug}" (${collisionList}) — renaming ${n.source}/${n.relPath} to "${newSlug}"`)
      renames.set(n, newSlug)
    })
  }
  if (renames.size === 0) return notes
  return notes.map(n => (renames.has(n) ? { ...n, slug: renames.get(n)! } : n))
}

export async function buildCommons(config: KmsConfig, rootDir: string, opts: { base: string }): Promise<Commons> {
  const files = dedupeSlugs(await scanSources(config, rootDir))
  const index = buildSlugIndex(files)
  const rendered = new Map<string, RenderedNote>()
  for (const n of files) rendered.set(n.slug, await renderNote(n, index, opts))
  const backlinks = buildBacklinkIndex(files, rendered)
  const linkReport = buildLinkReport(files, rendered)

  const registries: RegistryEntry[] = []
  for (const src of config.sources) {
    if (!src.data) continue
    const dataDir = path.resolve(rootDir, src.dir, src.data)
    for (const f of await fg('*.yaml', { cwd: dataDir }).catch(() => [] as string[])) {
      try {
        const doc = yaml.load(await fs.readFile(path.join(dataDir, f), 'utf8')) as Record<string, unknown>
        const kind = f.replace(/\.yaml$/, '')
        const items = Array.isArray(doc?.[kind]) ? (doc[kind] as unknown[]) : Array.isArray(doc) ? doc : []
        registries.push({ source: src.id, kind, items })
      } catch { /* invalid yaml: skip entry, never fail the build (spec §8) */ }
    }
  }

  let artifact: GraphArtifact | null = null
  const semanticGraphs = []
  for (const src of config.sources) {
    if (!src.graph) continue
    try {
      const raw = JSON.parse(await fs.readFile(path.resolve(rootDir, src.dir, src.graph), 'utf8'))
      semanticGraphs.push(convertNetworkx(raw, src.id))
    } catch { /* missing graph: site still builds (spec §8) */ }
  }
  const wikilinkGraph = buildWikilinkGraph(files, rendered)
  if (semanticGraphs.length > 0 || wikilinkGraph.order > 0) {
    const merged = mergeGraphs(semanticGraphs, wikilinkGraph, files)
    if (semanticGraphs.length === 0 && merged.order === 0) artifact = null
    else if (semanticGraphs.length === 0) artifact = null   // fixture case: notes only, no semantic sources declared → graph feature limited to note pages later; explorer needs ≥1 declared graph OR notes; keep simple: artifact only when a source declares graph
    else artifact = serializeArtifact(layoutGraph(merged))
  }

  const notes: CommonsNote[] = files.map(n => ({
    ...n, html: rendered.get(n.slug)!.html, headings: rendered.get(n.slug)!.headings,
    excerpt: rendered.get(n.slug)!.excerpt, backlinks: backlinks.get(n.slug) ?? [],
  }))
  return { notes, backlinks, registries, linkReport, artifact }
}

/** Astro loader: one call to buildCommons feeds all three collections via a shared promise. */
let commonsPromise: Promise<Commons> | null = null
export function commonsFor(config: KmsConfig, rootDir: string, base = '/'): Promise<Commons> {
  commonsPromise ??= buildCommons(config, rootDir, { base })
  return commonsPromise
}

export function notesLoader(config: KmsConfig, rootDir: string, base = '/'): Loader {
  return {
    name: 'kms-notes',
    load: async ({ store }) => {
      const c = await commonsFor(config, rootDir, base)
      store.clear()
      for (const n of c.notes) {
        store.set({ id: n.slug, data: { ...n } as Record<string, unknown>, rendered: { html: n.html } })
      }
    },
  }
}

export function registriesLoader(config: KmsConfig, rootDir: string): Loader {
  return {
    name: 'kms-registries',
    load: async ({ store }) => {
      const c = await commonsFor(config, rootDir)
      store.clear()
      for (const r of c.registries) store.set({ id: `${r.source}/${r.kind}`, data: { ...r } as Record<string, unknown> })
    },
  }
}
