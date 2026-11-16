// A comment's body as the Hub draws it (DAO-OS L6 Task 18, spec §8.2): the dialect's inline subset — mentions, links,
// emphasis and code — as L4c's Mention atoms and plain links; nothing else is read as Markdown. A mention is drawn from
// its own text and target only: the server has already labelled a stricter page or record `↗` (§4.5, R-9b), so no title
// is looked up here (rule 7).
import { Fragment, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Mention } from '../elements/atoms/Mention.tsx'
import { entryHref } from '../hrefs.ts'
import { pageHref } from './share.ts'

const HUB = /^hub:(member|role|page)\/([^/\s]+)$/
const HUB_RECORD = /^hub:record\/([^/\s]+)\/([^/\s]+)$/
const PAGE_LINK = /^\.\/([^/\s]+)\.md$/
/** One inline piece: a code span, a link `[text](target)`, strong `**…**`, or emphasis `*…*` / `_…_`. */
const PIECE = /`([^`\n]+)`|\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|(?<![\p{L}\p{N}])[*_]([^*_\n]+)[*_](?![\p{L}\p{N}])/gu

/** A link's target as the Hub follows it: a mention's record or page, a page link, or an outside address (http/https/
 *  mailto only). Null when it is none of these: then the text is drawn alone. */
function linkOf(text: string, target: string, me: string | undefined, key: number): ReactNode {
  const label = text.replace(/^@/, '')
  let m: RegExpExecArray | null
  if ((m = HUB.exec(target))) {
    const [, kind, id] = m as unknown as [string, 'member' | 'role' | 'page', string]
    if (kind === 'member') return <Mention key={key} kind={id === me ? 'you' : 'person'} text={label} href={entryHref('members', id)} />
    if (kind === 'role') return <Mention key={key} kind="record" recordKind="hat" text={label} href="/roles" />
    return <Mention key={key} kind="page" text={label} href={pageHref(id)} />
  }
  if ((m = HUB_RECORD.exec(target))) return <Mention key={key} kind="record" recordKind={m[1]!.replace(/s$/, '')} text={label} href={entryHref(m[1]!, m[2]!)} />
  if ((m = PAGE_LINK.exec(target))) return text.startsWith('@') ? <Mention key={key} kind="page" text={label} href={pageHref(m[1]!)} /> : <Link key={key} href={pageHref(m[1]!)}>{text}</Link>
  if (/^(https?:|mailto:)/i.test(target)) return <a key={key} href={target} rel="noopener noreferrer" target="_blank">{text}</a>
  return null
}

/** The body's lines, each its inline pieces; a new line is a line break. */
export function commentBody(body: string, me?: string): ReactNode {
  return body.split('\n').map((line, i) => (
    <Fragment key={i}>{i > 0 && <br />}{inline(line, me)}</Fragment>
  ))
}

function inline(line: string, me: string | undefined): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  let k = 0
  for (const m of line.matchAll(PIECE)) {
    if (m.index > at) out.push(line.slice(at, m.index))
    const [all, code, text, target, strong, em] = m
    if (code !== undefined) out.push(<code key={k++}>{code}</code>)
    else if (target !== undefined) out.push(linkOf(text ?? '', target, me, k++) ?? (text || all))
    else if (strong !== undefined) out.push(<strong key={k++}>{strong}</strong>)
    else if (em !== undefined) out.push(<em key={k++}>{em}</em>)
    at = m.index + all.length
  }
  if (at < line.length) out.push(line.slice(at))
  return out
}
