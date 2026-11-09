// packages/admin/server/portal/scan.ts
//
// The portal's scan (DAO-OS L9 spec §3.4 points 2 and 3): the release's refusal, and the only path to a release. Every
// text file of the output is searched for every secret of `PortalInput.secrets` (L8's `checkNoLeak` for JSON, with its
// paths; a line search for the rest, as written and as HTML decodes it). Then the structure: the model embedded in the
// HTML holds no `restricted` key, no `visibility` other than public and no account that is not a public System's
// contract; the HTML holds no form, no button that writes, and asks no host but the portal's own. An HTML file is also read
// as a reader sees it (tags out, references decoded, whitespace collapsed), so markup or a line break inside a secret
// hides nothing. A problem names the file and the path or line, never the value (problems are printed).
import { checkNoLeak, type Problem } from '../../lib/standards/project.mjs'
import { contractIdsOf } from '../../lib/standards/ids.mjs'
import type { PortalInput } from './inputs.ts'

/** `<script type="application/json" id="…">…</script>`: JSON a page embeds (the portal model, L9 spec §3.7). */
const JSON_SCRIPT = /<script\b((?:[^"'>]|"[^"]*"|'[^']*')*?\btype\s*=\s*["']?application\/(?:ld\+)?json["']?(?:[^"'>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi
/** An eip155 account (CAIP-10 with a 20-byte address); a hat ref (32 bytes) or a tree ref is none. */
const ACCOUNT = /eip155:\d+:0x[0-9a-f]{40}(?![0-9a-f])/gi
/** A URL that names a host: `scheme://host…` or `//host…`. */
const ABSOLUTE = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i

const err = (file: string, text: string): Problem => ({ level: 'error', file, text })
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The line (1-based) of offset `at` in `text`. */
const lineAt = (text: string, at: number) => text.slice(0, at).split('\n').length

/** A character reference: named, decimal or hex. */
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi

/** What HTML shows for a text: the five named entities and numeric references decoded, so `&amp;` is `&`. */
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text.replace(ENTITY, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return named[ref.toLowerCase()] ?? m
  })
}

/** One error per secret found in a text (as written, or with HTML's references decoded), naming the line, never the
 *  value. Decoded before lower-casing, so `&#83;` is an `S`. */
function textLeaks(file: string, text: string, secrets: { s: string; lower: string }[], html: boolean, found?: Set<string>): Problem[] {
  const raw = text.split('\n')
  const lines = raw.map(l => l.toLowerCase())
  const decoded = html ? raw.map(l => decodeEntities(l).toLowerCase()) : lines
  const wholeLower = text.toLowerCase()
  const wholeDecoded = html ? decodeEntities(text).toLowerCase() : wholeLower
  const out: Problem[] = []
  for (const { s, lower } of secrets) {
    const n = lines.findIndex((l, i) => l.includes(lower) || decoded[i]!.includes(lower))
    let at = n >= 0 ? n + 1 : 0
    // a secret that spans a line break is found in the whole text, at the line it starts on
    if (at === 0) {
      const w = wholeLower.indexOf(lower)
      if (w >= 0) at = lineAt(text, w)
      else if (html && wholeDecoded.includes(lower)) at = lineAt(text, decodedOffset(text, wholeDecoded.indexOf(lower)))
    }
    if (at > 0) { out.push(err(file, `a withheld value (${s.length} characters) is published at line ${at}; nothing is published while it is`)); found?.add(s) }
  }
  return out
}

/** The offset in `text` of offset `at` of `decodeEntities(text)`: each reference counts as the one character it decodes
 *  to (a reference past the BMP decodes to two). */
function decodedOffset(text: string, at: number): number {
  let src = 0, dst = 0
  for (const m of text.matchAll(ENTITY)) {
    const before = m.index! - src
    if (dst + before > at) return src + (at - dst)
    dst += before
    const len = decodeEntities(m[0]).length
    if (dst + len > at) return m.index!
    dst += len
    src = m.index! + m[0].length
  }
  return src + (at - dst)
}

/** A tag (or comment, doctype) whose quoted attribute values may hold `>`. */
const TAG = /<(?:!--[\s\S]*?-->|[a-zA-Z/!?](?:[^"'>]|"[^"]*"|'[^']*')*>)/g

/** The text of an HTML page as a reader sees it, lower-cased, with the source offset of each of its characters: tags
 *  taken out (`gap` is what stands in their place: nothing, or a space), references decoded, every run of whitespace
 *  one space. */
function rendered(html: string, gap: '' | ' '): { text: string; from: number[] } {
  let text = ''
  const from: number[] = []
  let space = false
  const put = (chunk: string, at: number) => {
    for (const ch of chunk) {
      if (/\s/.test(ch)) { if (!space) { text += ' '; from.push(at); space = true } continue }
      space = false
      const lower = ch.toLowerCase()
      text += lower
      for (let i = 0; i < lower.length; i++) from.push(at)
    }
  }
  /** Plain text: each character from its own offset. */
  const putEach = (chunk: string, base: number) => { let i = 0; for (const ch of chunk) { put(ch, base + i); i += ch.length } }
  const textChunk = (chunk: string, base: number) => {
    let last = 0
    for (const m of chunk.matchAll(ENTITY)) {
      putEach(chunk.slice(last, m.index!), base + last)
      put(decodeEntities(m[0]), base + m.index!)
      last = m.index! + m[0].length
    }
    putEach(chunk.slice(last), base + last)
  }
  let last = 0
  for (const m of html.matchAll(TAG)) {
    textChunk(html.slice(last, m.index!), last)
    put(gap, m.index!)
    last = m.index! + m[0].length
  }
  textChunk(html.slice(last), last)
  return { text, from }
}

/** One error per secret (whitespace collapsed) found in the page as a reader sees it, and not already found in its
 *  text: split by markup, by a line break or by a run of whitespace. Names the line it starts on, never the value. */
function renderedLeaks(file: string, html: string, secrets: { s: string; lower: string }[], found: Set<string>): Problem[] {
  const views = [rendered(html, ''), rendered(html, ' ')]
  const out: Problem[] = []
  for (const { s, lower } of secrets) {
    if (found.has(s)) continue
    const want = lower.replace(/\s+/g, ' ')
    for (const v of views) {
      const at = v.text.indexOf(want)
      if (at < 0) continue
      out.push(err(file, `a withheld value (${s.length} characters) is published at line ${lineAt(html, v.from[at]!)}, split by markup or whitespace; nothing is published while it is`))
      break
    }
  }
  return out
}

/** The JSON scripts of a page, each with its label (`#<id>`, else `#json-<n>`), its parsed value (undefined when it is
 *  not JSON) and its place; and the page with them taken out. */
function jsonScripts(html: string): { scripts: { label: string; value: unknown; raw: string }[]; rest: string } {
  const scripts: { label: string; value: unknown; raw: string }[] = []
  let n = 0
  const rest = html.replace(JSON_SCRIPT, (_m, attrs: string, body: string) => {
    n += 1
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]
    let value: unknown
    try { value = JSON.parse(body) } catch { value = undefined }
    scripts.push({ label: `#${id ?? `json-${n}`}`, value, raw: body })
    return '\n'.repeat(body.split('\n').length - 1) // keeps the lines of what follows where they were
  })
  return { scripts, rest }
}

/** Whether `url` (an attribute's value or a CSS url) asks a host other than the portal's own. */
function otherHost(url: string, portal: string | null): boolean {
  if (!ABSOLUTE.test(url)) return false
  try {
    const u = new URL(url.trim().startsWith('//') ? `https:${url.trim()}` : url.trim())
    if (u.protocol === 'data:') return false
    return portal === null || u.host !== new URL(portal).host
  } catch { return true }
}

/** The structure of an HTML file (§3.4 point 3), outside its JSON scripts. */
function htmlStructure(file: string, html: string, portal: string | null): Problem[] {
  const out: Problem[] = []
  for (const m of html.matchAll(/<form\b/gi)) out.push(err(file, `the HTML holds a form at line ${lineAt(html, m.index!)}; the portal writes nothing`))
  for (const m of html.matchAll(/<button\b((?:[^"'>]|"[^"]*"|'[^']*')*)>/gi)) {
    if (/\bform(?:action|method)\s*=|\btype\s*=\s*["']?submit\b/i.test(m[1]!)) {
      out.push(err(file, `the HTML holds a button that submits at line ${lineAt(html, m.index!)}; the portal writes nothing`))
    }
  }
  const ask = (at: number, what: string) =>
    out.push(err(file, `the HTML asks another host than the portal's own (${what}) at line ${lineAt(html, at)}; the portal makes no third-party request`))
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b((?:[^"'>]|"[^"]*"|'[^']*')*)>/gi)) {
    const tag = m[1]!.toLowerCase()
    for (const a of m[2]!.matchAll(/([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      const name = a[1]!.toLowerCase()
      const value = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '')
      const urls =
        ['src', 'action', 'formaction', 'poster', 'data', 'background', 'manifest'].includes(name) ? [value]
        : (name === 'href' || name === 'xlink:href') && tag !== 'a' && tag !== 'area' ? [value]
        : name === 'srcset' || name === 'imagesrcset' ? value.split(',').map(c => c.trim().split(/\s+/)[0] ?? '')
        : name === 'ping' ? value.split(/\s+/)
        : name === 'style' ? cssUrls(value)
        : name === 'content' && /http-equiv\s*=\s*["']?refresh/i.test(m[2]!) ? [value.replace(/^[^;]*;\s*url\s*=\s*/i, '')]
        : []
      if (urls.some(u => otherHost(u, portal))) ask(m.index!, `<${tag} ${name}>`)
    }
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (cssUrls(m[1]!).some(u => otherHost(u, portal))) ask(m.index!, '<style>')
  }
  return out
}

/** The URLs a CSS text asks: `url(…)` and `@import "…"`. */
function cssUrls(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) out.push((m[1] ?? m[2] ?? m[3] ?? '').trim())
  for (const m of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? '')
  return out
}

/** The model's structure (§3.4 point 3): no `restricted` key, no `visibility` but public, no account but a public
 *  System's contract. Paths as `checkNoLeak` writes them. */
function modelStructure(file: string, model: unknown, contracts: Set<string>): Problem[] {
  const out: Problem[] = []
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      if ([...v.matchAll(ACCOUNT)].some(m => !contracts.has(m[0].toLowerCase()))) {
        out.push(err(file, `an account that is not a public System's contract is published at ${path}; the portal shows the hat, never who wears it`))
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'restricted') out.push(err(file, `the model holds a "restricted" key at ${path}; a restricted thing is never on the portal`))
        if (k === 'visibility' && x !== 'public') out.push(err(file, `the model holds a visibility other than public at ${path}.visibility`))
        walk(x, `${path}.${k}`)
      }
    }
  }
  walk(model, '$')
  return out
}

/**
 * The scan (L9 spec §3.4 points 2 and 3) over a release's text files, by path (`index.html`, `.well-known/dao.json`,
 * `robots.txt`, `portal-manifest.json`…). An empty answer is the only way to a release. A JSON file is scanned as JSON
 * (`checkNoLeak`, with its paths); an HTML file's JSON scripts as JSON (the file named `<page>#<script id>`), the rest of
 * it by line, as written and decoded; any other file by line.
 */
export function scanPortal(files: Record<string, string>, input: PortalInput): Problem[] {
  const secrets = [...input.secrets].filter(s => typeof s === 'string' && s.length >= 6).map(s => ({ s, lower: s.toLowerCase() }))
  const contracts = new Set(input.pub.systems.flatMap(s => contractIdsOf(s).map(c => c.id.toLowerCase())))
  const out: Problem[] = []
  for (const file of Object.keys(files).sort()) {
    const text = files[file]!
    if (/\.json$/i.test(file)) {
      let value: unknown
      try { value = JSON.parse(text) } catch { value = undefined }
      out.push(...(value === undefined ? textLeaks(file, text, secrets, false) : checkNoLeak({ [file]: value }, input.secrets)))
    } else if (/\.html?$/i.test(file)) {
      const { scripts, rest } = jsonScripts(text)
      for (const s of scripts) {
        const name = `${file}${s.label}`
        if (s.value === undefined) {
          out.push(err(name, 'the embedded JSON cannot be read, so it cannot be checked'))
          out.push(...textLeaks(name, s.raw, secrets, false))
          continue
        }
        out.push(...checkNoLeak({ [name]: s.value }, input.secrets), ...modelStructure(name, s.value, contracts))
      }
      const found = new Set<string>()
      out.push(...textLeaks(file, rest, secrets, true, found), ...renderedLeaks(file, rest, secrets, found), ...htmlStructure(file, rest, input.portalOrigin))
    } else {
      out.push(...textLeaks(file, text, secrets, false))
    }
  }
  return out
}
