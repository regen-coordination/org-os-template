// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { undo } from 'prosemirror-history'
import type { Node } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { hubSchema } from './schema.ts'
import { parsePage } from './parse.ts'
import { serializePage } from './serialize.ts'
import { createEditor } from './view.ts'

const CORPUS = join(process.cwd(), 'tests/fixtures/pages') // vitest runs from packages/admin
const files = readdirSync(CORPUS).filter((f) => f.endsWith('.md')).sort()
const read = (name: string) => readFileSync(join(CORPUS, name), 'utf8')

/** The document position just after the first occurrence of `text`. */
function after(doc: Node, text: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + text.length
    return true
  })
  if (found === -1) throw new Error(`not in the document: ${text}`)
  return found
}

const mounts: HTMLElement[] = []
const editors: { destroy(): void }[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  for (const m of mounts.splice(0)) m.remove()
})

function open(body: string, extra: Partial<Parameters<typeof createEditor>[1]> = {}) {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  mounts.push(mount)
  const changes: string[] = []
  const opts = {
    body,
    label: 'Minutes · page body',
    onChange: (md: string) => changes.push(md),
    onSlash: vi.fn(),
    onMention: vi.fn(),
    onSelection: vi.fn(),
    ...extra,
  }
  const editor = createEditor(mount, opts)
  editors.push(editor)
  return { editor, view: editor.view, mount, changes, opts, last: () => changes[changes.length - 1] }
}

function typeAt(view: EditorView, pos: number, text: string) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  view.dispatch(view.state.tr.insertText(text, pos))
}

describe('the corpus', () => {
  it('holds every element the brief names', () => {
    expect(files).toEqual(expect.arrayContaining(['dialect.md', 'table.md', 'lists.md', 'tasks.md', 'alerts.md', 'directives.md', 'raw.md', 'footnote.md', 'crlf.md', 'trailing-spaces.md', 'no-final-newline.md']))
    expect(read('crlf.md')).toContain('\r\n')
    expect(read('no-final-newline.md').endsWith('\n')).toBe(false)
    expect(read('trailing-spaces.md')).toMatch(/ {2}\n/)
  })

  it.each(files)('every corpus file round-trips byte for byte when nothing is edited: %s', (name) => {
    const md = read(name)
    const { doc, sources } = parsePage(md)
    expect(serializePage(doc, sources)).toBe(md)
  })

  it.each(files)('serializing twice equals serializing once: %s', (name) => {
    const md = read(name)
    const once = (() => { const p = parsePage(md); return serializePage(p.doc, p.sources) })()
    const twice = (() => { const p = parsePage(once); return serializePage(p.doc, p.sources) })()
    expect(twice).toBe(once)
    // The dialect's own form (no remembered source) is stable too, and reads back as the same document.
    const first = parsePage(md)
    const canonical = serializePage(first.doc, new WeakMap())
    const again = parsePage(canonical)
    expect(again.doc.eq(first.doc)).toBe(true)
    expect(serializePage(again.doc, new WeakMap())).toBe(canonical)
  })

  it('maps the dialect onto the schema', () => {
    const { doc } = parsePage(read('dialect.md'))
    const types = new Set<string>()
    doc.descendants((n) => { types.add(n.type.name); return true })
    for (const t of ['heading', 'paragraph', 'blockquote', 'alert', 'bullet_list', 'ordered_list', 'list_item', 'code_block', 'horizontal_rule', 'image', 'embed_record', 'embed_view']) expect(types).toContain(t)
    const marks = new Set<string>()
    doc.descendants((n) => { n.marks.forEach((m) => marks.add(m.type.name)); return true })
    for (const m of ['em', 'strong', 'code', 'strike', 'link', 'mention']) expect(marks).toContain(m)
    expect(parsePage(read('tasks.md')).doc.firstChild).toBeTruthy()
    const raw = parsePage(read('raw.md')).doc
    const kept: string[] = []
    raw.forEach((n) => { if (n.type.name === 'raw') kept.push(n.attrs.src) })
    // CommonMark ends an HTML block at a blank line: the paragraph inside <details> stays editable
    expect(kept).toEqual([
      '<details>\n<summary>Kept as written</summary>',
      '</details>',
      'A paragraph with <kbd>inline</kbd> HTML.',
      '<!-- a comment the author left -->',
      '###### A fifth-and-more heading',
      '---\ntitle: looks like front matter\n---',
    ])
  })
})

describe('fidelity under edits', () => {
  it('raw and unmodelled blocks survive an edit elsewhere, byte for byte', () => {
    const md = read('footnote.md')
    const { view, last } = open(md)
    typeAt(view, after(view.state.doc, 'the one an edit touches.'), ' Edited.')
    const before = md.split('\n')
    const now = last().split('\n')
    expect(now).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      if (before[i] === 'The second paragraph is the one an edit touches.') expect(now[i]).toBe('The second paragraph is the one an edit touches. Edited.')
      else expect(now[i]).toBe(before[i])
    }
    // the same for the raw corpus file, edited at its last paragraph
    const raw = read('raw.md')
    const r = open(raw)
    typeAt(r.view, after(r.view.state.doc, 'The last paragraph'), ', edited')
    expect(r.last()).toBe(raw.replace('The last paragraph.', 'The last paragraph, edited.'))
  })

  it('an edit keeps CRLF line ends and a missing final newline', () => {
    const crlf = read('crlf.md')
    const c = open(crlf)
    typeAt(c.view, after(c.view.state.doc, 'The end'), ', really')
    expect(c.last()).toBe(crlf.replace('The end.', 'The end, really.'))
    const nf = read('no-final-newline.md')
    const n = open(nf)
    typeAt(n.view, after(n.view.state.doc, 'No final'), ' (yet)')
    expect(n.last()).toBe(nf.replace('# No final newline', '# No final (yet) newline'))
  })

  it('an undo writes the file back as it was; a new list beside a list keeps apart', () => {
    const md = '- a\n- b\n\nSee [the charter][c].\n\n[c]: https://example.org/c\n'
    const { view, last } = open(md)
    const list = hubSchema.nodes.bullet_list.create({ tight: true, bullet: '-' }, hubSchema.nodes.list_item.create(null, hubSchema.nodes.paragraph.create(null, hubSchema.text('new'))))
    view.dispatch(view.state.tr.insert(view.state.doc.firstChild!.nodeSize, list))
    expect(last()).toBe('- a\n- b\n\n* new\n\nSee [the charter][c].\n\n[c]: https://example.org/c\n')
    undo(view.state, view.dispatch)
    expect(last()).toBe(md)
  })

  it('an edited block keeps the separators it had: no blank line added beside a raw block, no final line end added', () => {
    const a = open('<!-- c -->\nPara one.\n')
    typeAt(a.view, after(a.view.state.doc, 'Para one'), ' X')
    expect(a.last()).toBe('<!-- c -->\nPara one X.\n')
    const b = open('# Head\n<div>kept</div>\n\nLast block')
    typeAt(b.view, after(b.view.state.doc, 'Head'), 'ing')
    expect(b.last()).toBe('# Heading\n<div>kept</div>\n\nLast block')
    typeAt(b.view, after(b.view.state.doc, 'Last block'), ', edited')
    expect(b.last()).toBe('# Heading\n<div>kept</div>\n\nLast block, edited')
    // a block added after the last one: separated by a blank line, and still no final line end
    const c = open('First.\n\nLast block')
    c.view.dispatch(c.view.state.tr.insert(c.view.state.doc.content.size, hubSchema.nodes.paragraph.create(null, hubSchema.text('Added'))))
    expect(c.last()).toBe('First.\n\nLast block\n\nAdded')
  })

  it('a raw block cut and pasted elsewhere comes back as written; a raw block from outside the file is refused', () => {
    const { view, last } = open('Intro.\n\n<div align="center">\n  <img src="./assets/logo.png" alt="logo">\n</div>\n\nOutro.\n')
    let rawPos = -1
    view.state.doc.forEach((n, pos) => { if (n.type.name === 'raw') rawPos = pos })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, rawPos)))
    const { dom } = view.serializeForClipboard(view.state.selection.content())
    const html = dom.innerHTML
    // jsdom has no ClipboardEvent; a plain paste event stands in for it
    const paste = (h: string) => view.pasteHTML(h, new Event('paste') as unknown as ClipboardEvent)
    view.dispatch(view.state.tr.deleteSelection())
    expect(last()).toBe('Intro.\n\nOutro.\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after(view.state.doc, 'Outro.'))))
    expect(paste(html)).toBe(true)
    expect(last()).toBe('Intro.\n\nOutro.\n\n<div align="center">\n  <img src="./assets/logo.png" alt="logo">\n</div>\n')
    const raws: string[] = []
    view.state.doc.forEach((n) => { if (n.type.name === 'raw') raws.push(n.attrs.src) })
    expect(raws).toEqual(['<div align="center">\n  <img src="./assets/logo.png" alt="logo">\n</div>'])

    const before = view.state.doc
    paste('<div class="hub-raw" data-raw="" data-src="&lt;script&gt;forged&lt;/script&gt;"><span>Kept as written</span><pre>x</pre></div>')
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('editing a table cell rewrites that table only', () => {
    const md = read('table.md')
    const { view, last } = open(md)
    const from = after(view.state.doc, 'monthly') - 'monthly'.length
    view.dispatch(view.state.tr.insertText('yearly', from, from + 'monthly'.length))
    expect(last()).toBe(md.replace('| monthly |', '| yearly |'))
    // A table written loosely is rewritten in the dialect's form; the blocks around it are not.
    const loose = 'Before.\n\n|a|b|\n|:-|-:|\n|1|2|\n\nAfter  \nthe table.\n'
    const l = open(loose)
    const at = after(l.view.state.doc, '1')
    l.view.dispatch(l.view.state.tr.insertText('0', at))
    expect(l.last()).toBe('Before.\n\n| a | b |\n| :--- | ---: |\n| 10 | 2 |\n\nAfter  \nthe table.\n')
  })
})

describe('links and mentions', () => {
  it('a mention serializes as [@Label](hub:member/<id>); a link to a stricter page as [↗](./p-…md)', () => {
    const { editor, view, last } = open('Thanks to  for the notes.\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after(view.state.doc, 'Thanks to '))))
    editor.mention({ kind: 'member', ref: 'steward-a', label: 'Steward A' })
    expect(last()).toBe('Thanks to [@Steward A](hub:member/steward-a) for the notes.\n')
    editor.mention({ kind: 'record', ref: 'tasks:t-1a2b', label: 'Task one' })
    expect(last()).toBe('Thanks to [@Steward A](hub:member/steward-a)[@Task one](hub:record/tasks/t-1a2b) for the notes.\n')

    const s = open('See the budget.\n')
    s.view.dispatch(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, after(s.view.state.doc, 'budget'))))
    s.editor.link('./p-4c1f0a2b3c4d.md', '↗')
    expect(s.last()).toBe('See the budget[↗](./p-4c1f0a2b3c4d.md).\n')
    // with a selection, link() marks the selected words
    const w = open('See the budget.\n')
    const end = after(w.view.state.doc, 'the budget')
    w.view.dispatch(w.view.state.tr.setSelection(TextSelection.create(w.view.state.doc, end - 'the budget'.length, end)))
    w.editor.link('./budget-2026-a1b2.md')
    expect(w.last()).toBe('See [the budget](./budget-2026-a1b2.md).\n')
  })
})

describe('the editor', () => {
  it('raw nodes are not editable', () => {
    const { mount, view } = open(read('raw.md'))
    expect(hubSchema.nodes.raw.isAtom).toBe(true)
    const wells = mount.querySelectorAll('[data-raw]')
    expect(wells.length).toBe(6)
    for (const w of wells) {
      expect(w.getAttribute('contenteditable')).toBe('false')
      expect(w.textContent).toContain('Kept as written')
    }
    // a transaction that rewrites a raw node's text is refused
    let rawPos = -1
    view.state.doc.forEach((n, pos) => { if (rawPos === -1 && n.type.name === 'raw') rawPos = pos })
    const before = view.state.doc
    view.dispatch(view.state.tr.setNodeMarkup(rawPos, undefined, { src: 'changed' }))
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('keys: ⌘B toggles strong, ⌘⇧L asks for a link, ⌘K is not handled', () => {
    const onLink = vi.fn()
    const { view, last } = open('Make this bold.\n', { onLink })
    const end = after(view.state.doc, 'this')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 4, end)))
    const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    const key = (k: string, shift = false) => {
      const ev = new KeyboardEvent('keydown', { key: shift ? k.toUpperCase() : k, shiftKey: shift, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
      return view.someProp('handleKeyDown', (f) => f(view, ev)) ?? false
    }
    expect(key('b')).toBe(true)
    expect(last()).toBe('Make **this** bold.\n')
    expect(key('l', true)).toBe(true)
    expect(onLink).toHaveBeenCalledTimes(1)
    expect(key('k')).toBe(false)
  })

  it('the editable region has role="textbox", aria-multiline="true" and the given label', () => {
    const { view } = open('A page.\n')
    expect(view.dom.getAttribute('role')).toBe('textbox')
    expect(view.dom.getAttribute('aria-multiline')).toBe('true')
    expect(view.dom.getAttribute('aria-label')).toBe('Minutes · page body')
  })

  it('/ at the start of an empty paragraph calls onSlash(\'\'); @ calls onMention', () => {
    const { view, opts } = open('First.\n\n\n')
    // an empty paragraph after the first
    const tr = view.state.tr.insert(view.state.doc.content.size, hubSchema.nodes.paragraph.create())
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)))
    const text = (t: string) => {
      const { from, to } = view.state.selection
      const handled = view.someProp('handleTextInput', (f) => f(view, from, to, t, () => view.state.tr.insertText(t, from, to)))
      if (!handled) view.dispatch(view.state.tr.insertText(t, from, to))
    }
    text('/')
    expect(opts.onSlash).toHaveBeenCalledWith('')
    text('t')
    expect(opts.onSlash).toHaveBeenLastCalledWith('t')
    // `/` in the middle of words opens nothing
    const p = open('A and B\n')
    p.view.dispatch(p.view.state.tr.setSelection(TextSelection.create(p.view.state.doc, after(p.view.state.doc, 'A and'))))
    const { from, to } = p.view.state.selection
    p.view.someProp('handleTextInput', (f) => f(p.view, from, to, '/', () => p.view.state.tr.insertText('/', from, to)))
    expect(p.opts.onSlash).not.toHaveBeenCalled()

    text(' ')
    text('@')
    expect(opts.onMention).toHaveBeenCalledWith('', expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }))
    text('s')
    expect(opts.onMention).toHaveBeenLastCalledWith('s', expect.objectContaining({ left: expect.any(Number) }))
  })

  it('inserts the blocks the slash menu offers', () => {
    const { editor, view, last } = open('Intro.\n')
    const end = view.state.doc.content.size
    view.dispatch(view.state.tr.insert(end, hubSchema.nodes.paragraph.create()))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    editor.insert('divider')
    expect(last()).toBe('Intro.\n\n---\n')
    editor.insert('view', { collection: 'tasks', view: 'open', label: 'Open tasks' })
    expect(last()).toContain('::view[Open tasks]{collection="tasks" view="open"}')
    editor.insert('record', { ref: 'tasks:t-1a2b', label: 'Task one' })
    expect(last()).toContain('::record[Task one]{ref="tasks:t-1a2b"}')
    editor.insert('callout', { kind: 'TIP' })
    view.dispatch(view.state.tr.insertText('Say it once.'))
    expect(last()).toContain('> [!TIP]\n> Say it once.')
    editor.insert('task')
    view.dispatch(view.state.tr.insertText('do it'))
    expect(last()).toContain('- [ ] do it')
    editor.insert('table')
    expect(last()).toMatch(/\|  \|  \|  \|\n\| --- \| --- \| --- \|\n\|  \|  \|  \|\n$/)
  })

  it('toggles marks and headings, reports the selection and goes read-only', () => {
    const { editor, view, last, opts } = open('Plain words.\n')
    const end = after(view.state.doc, 'Plain')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 5, end)))
    expect(opts.onSelection).toHaveBeenLastCalledWith({ empty: false, marks: { bold: false, italic: false, heading: false } })
    editor.toggle('italic')
    expect(last()).toBe('_Plain_ words.\n')
    expect(opts.onSelection).toHaveBeenLastCalledWith({ empty: false, marks: { bold: false, italic: true, heading: false } })
    editor.toggle('heading')
    expect(last()).toBe('## _Plain_ words.\n')
    editor.toggle('heading')
    expect(last()).toBe('_Plain_ words.\n')
    editor.setReadOnly(true)
    expect(view.dom.getAttribute('contenteditable')).toBe('false')
    expect(view.editable).toBe(false)
    editor.setReadOnly(false)
    expect(view.editable).toBe(true)
  })
})
