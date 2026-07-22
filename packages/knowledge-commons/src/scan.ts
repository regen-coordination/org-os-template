import fg from 'fast-glob'
import matter from 'gray-matter'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KmsConfig } from './config.ts'

export interface NoteFile {
  source: string
  slug: string            // '<source>/<slugified relative path, no ext>'
  relPath: string         // path inside the source dir
  title: string
  tags: string[]
  date: string | null     // ISO date from frontmatter, else null (git mtime handled at load)
  frontmatter: Record<string, unknown>
  body: string            // markdown without frontmatter
}

export function slugifySegment(seg: string): string {
  return seg
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip diacritics
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function toSlug(source: string, relPath: string): string {
  // drop the first path segment (content root like docs/ or knowledge/) for cleaner urls
  const noExt = relPath.replace(/\.mdx?$/i, '')
  const segs = noExt.split('/').map(slugifySegment).filter(Boolean)
  const trimmed = segs.length > 1 ? segs.slice(1) : segs
  return `${source}/${trimmed.join('/')}`
}

export async function scanSources(config: KmsConfig, rootDir: string): Promise<NoteFile[]> {
  const notes: NoteFile[] = []
  for (const src of config.sources) {
    const base = path.resolve(rootDir, src.dir)
    const files = await fg(src.content, { cwd: base, ignore: src.exclude, absolute: false })
    for (const relPath of files.sort()) {
      const raw = await fs.readFile(path.join(base, relPath), 'utf8')
      let data: Record<string, unknown>, content: string
      try {
        ;({ data, content } = matter(raw))
      } catch (err) {
        // malformed frontmatter (e.g. duplicate keys, bad YAML): quarantine the
        // page, warn, and keep the build going (spec §8 — nothing content-shaped
        // ever fails the build)
        const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
        console.warn(`[kms] malformed frontmatter, quarantining ${src.id}/${relPath}: ${message}`)
        continue
      }
      const fmTitle = typeof data.title === 'string' ? data.title : null
      const fallback = path.basename(relPath).replace(/\.mdx?$/i, '').replace(/[-_]+/g, ' ')
      notes.push({
        source: src.id,
        slug: toSlug(src.id, relPath),
        relPath,
        title: fmTitle ?? fallback,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        date: data.date ? new Date(data.date as string).toISOString() : null,
        frontmatter: data,
        body: content,
      })
    }
  }
  return notes
}
