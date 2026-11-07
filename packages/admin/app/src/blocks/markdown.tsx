// packages/admin/app/src/blocks/markdown.tsx
import type { ReactNode } from 'react'
import { Callout } from '../elements/workspace/PageBody.tsx'

/** Only these schemes become links (Review Focus 4); anything else stays text. */
export function safeHref(url: string): string | null {
  const u = url.trim()
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null
}

/** Inline: **strong**, *em*, `code`, [text](url). Built as React elements, so HTML in the text is text. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  // Every span is bounded, so an unclosed one cannot make the scan quadratic.
  const re = /(\*\*([^*]{1,500})\*\*|\*([^*]{1,500})\*|`([^`]{1,500})`|\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\))/g
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${n++}`
    if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>)
    else if (m[3] !== undefined) out.push(<em key={k}>{m[3]}</em>)
    else if (m[4] !== undefined) out.push(<code key={k}>{m[4]}</code>)
    else {
      const href = safeHref(m[6]!)
      out.push(href ? <a key={k} href={href} rel="noreferrer noopener" target="_blank">{m[5]}</a> : m[5]!)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The Markdown a note needs (spec §4.3): headings (# to ###, drawn one level under the block's head),
 *  paragraphs, `-`/`*` lists, quoted lines (`> `) as a callout (§14.2, the workspace's), and the inline marks
 *  above. No HTML, no images. */
export function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let list: string[] = []
  let quote: string[] = []
  const flushQuote = () => {
    if (quote.length) { const k = `q${blocks.length}`; blocks.push(<Callout key={k}>{inline(quote.join(' '), k)}</Callout>); quote = [] }
  }
  const flushPara = () => {
    if (para.length) { const k = `p${blocks.length}`; blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>); para = [] }
  }
  const flushList = () => {
    if (list.length) { const k = `l${blocks.length}`; blocks.push(<ul key={k}>{list.map((li, i) => <li key={i}>{inline(li, `${k}-${i}`)}</li>)}</ul>); list = [] }
  }
  const flush = () => { flushPara(); flushList(); flushQuote() }
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      flushPara(); flushList()
      if (q[1]!.trim() !== '') quote.push(q[1]!.trim())
      continue
    }
    flushQuote()
    if (h) {
      flush()
      const k = `h${blocks.length}`
      const body = inline(h[2]!, k)
      blocks.push(h[1]!.length < 3 ? <h3 key={k}>{body}</h3> : <h4 key={k}>{body}</h4>)
    } else if (li) {
      flushPara()
      list.push(li[1]!)
    } else if (line.trim() === '') flush()
    else { flushList(); para.push(line.trim()) }
  }
  flush()
  return blocks
}
