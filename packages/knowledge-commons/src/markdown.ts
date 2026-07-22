import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import { toString } from 'mdast-util-to-string'
import GithubSlugger from 'github-slugger'
import { extractWikilinks, type Wikilink } from './wikilinks.ts'
import { resolveLink, type SlugIndex, type Resolution } from './resolver.ts'
import type { NoteFile } from './scan.ts'

export interface RenderedLink extends Wikilink { status: Resolution['status']; to: string | null; candidates: string[] }
export interface Heading { depth: number; text: string; id: string }
export interface RenderedNote { html: string; links: RenderedLink[]; headings: Heading[]; excerpt: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function wikilinkHtml(link: Wikilink, res: Resolution, base: string): string {
  const text = esc(link.alias ?? link.target)
  if (res.status === 'ok') {
    // Fresh slugger: cross-document anchor to the first occurrence of the heading in the
    // target note (no dedup state available). Matches rehype-slug's github-slugger algorithm.
    const anchor = link.heading ? `#${new GithubSlugger().slug(link.heading)}` : ''
    const slug = res.note!.slug
    return `<a href="${base}${slug}${anchor}" class="kc-wikilink" data-slug="${slug}">${text}</a>`
  }
  if (res.status === 'ambiguous') {
    const c = res.candidates.map(n => n.slug).join(',')
    return `<span class="kc-ambiguous" data-candidates="${esc(c)}" title="ambiguous — multiple matches">${text}</span>`
  }
  return `<span class="kc-deadlink" title="not in the commons (yet)">${text}</span>`
}

/** remark plugin: replace wikilinks inside text nodes with raw HTML nodes. */
function remarkWikilinks(note: NoteFile, index: SlugIndex, base: string, out: RenderedLink[]) {
  return () => (tree: any) => {
    visit(tree, 'text', (node: any, i: number | undefined, parent: any) => {
      if (!parent || i === undefined) return
      const links = extractWikilinks(node.value as string)
      if (links.length === 0) return
      const parts: any[] = []
      let rest: string = node.value
      for (const link of links) {
        const at = rest.indexOf(link.raw)
        if (at > 0) parts.push({ type: 'text', value: rest.slice(0, at) })
        const res = resolveLink(link.target, note.source, index)
        out.push({ ...link, status: res.status, to: res.note?.slug ?? null, candidates: res.candidates.map(n => n.slug) })
        parts.push({ type: 'html', value: wikilinkHtml(link, res, base) })
        rest = rest.slice(at + link.raw.length)
      }
      if (rest) parts.push({ type: 'text', value: rest })
      parent.children.splice(i, 1, ...parts)
      return i + parts.length
    })
  }
}

function collectHeadings(tree: any): Heading[] {
  const out: Heading[] = []
  // One slugger per document so repeated headings dedupe (`foo`, `foo-1`) exactly like
  // rehype-slug does within the same doc. visit walks headings in document order.
  const slugger = new GithubSlugger()
  visit(tree, 'heading', (node: any) => {
    const text = toString(node)
    out.push({ depth: node.depth, text, id: slugger.slug(text) })
  })
  return out.filter(h => h.depth >= 2)
}

function firstParagraph(tree: any): string {
  let text = ''
  visit(tree, 'paragraph', (node: any) => {
    if (!text) text = toString(node).replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, t, a) => a ?? t)
    return false
  })
  return text
}

export async function renderNote(note: NoteFile, index: SlugIndex, opts: { base: string }): Promise<RenderedNote> {
  const links: RenderedLink[] = []
  const parsed = unified().use(remarkParse).use(remarkGfm).parse(note.body)
  const headings = collectHeadings(parsed)
  const excerpt = firstParagraph(parsed).slice(0, 280)
  const file = await unified()
    .use(remarkParse).use(remarkGfm)
    .use(remarkWikilinks(note, index, opts.base, links))
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(note.body)
  return { html: String(file), links, headings, excerpt }
}
