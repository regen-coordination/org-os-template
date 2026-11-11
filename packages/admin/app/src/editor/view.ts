// The editor engine, with no chrome (L6 spec §5, §15): a ProseMirror view on the Hub's Markdown. L4c's
// elements draw the selection toolbar, slash menu and mention picker; they hear from it through the
// callbacks and drive it through the returned handle.
//
//   onChange(markdown)    every change to the document, as the page body (untouched blocks byte for byte)
//   onSlash(q)            `/` typed at the start of an empty paragraph, then each change to what follows it
//   onMention(q, at)      `@` typed at the start of a word, then each change to what follows it; `at` is
//                         where the picker goes (below the `@`, in viewport pixels; 0,0 where it cannot be
//                         measured)
//   onSelection(s)        the selection changed: empty or not, and which of bold/italic/heading it holds
//   onLink()              ⌘⇧L: the chrome opens its link field, then calls link(href)
import { EditorState, Plugin, PluginKey, TextSelection, type Transaction } from 'prosemirror-state'
import { EditorView, type NodeView } from 'prosemirror-view'
import { AttrStep, ReplaceAroundStep, ReplaceStep } from 'prosemirror-transform'
import { setBlockType, toggleMark, baseKeymap } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { history } from 'prosemirror-history'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { tableEditing } from 'prosemirror-tables'
import type { MarkType, Node } from 'prosemirror-model'
import { hubSchema } from './schema.ts'
import { parsePage } from './parse.ts'
import { serializePage } from './serialize.ts'
import { hubKeymap, hubInputRules } from './keys.ts'

export type InsertKind = 'view' | 'record' | 'callout' | 'task' | 'table' | 'divider'

/** What an embedded view's block names (`::view[label]{collection view}`). */
export interface EmbedViewAttrs { collection: string; view: string; label: string }
/** Draws an embedded view's rows into its block (walk I8): given the block's own element, empty, which carries nothing
 *  that names the collection, and what the block names; told when that changes and when the block goes. */
export type EmbedDrawer = (dom: HTMLElement, attrs: EmbedViewAttrs) => { update(attrs: EmbedViewAttrs): void; destroy(): void }

export interface EditorOptions {
  body: string
  /** The editable region's accessible name: "<title> · page body". */
  label: string
  onChange(markdown: string): void
  onSlash(q: string): void
  onMention(q: string, at: { left: number; top: number }): void
  onSelection(s: { empty: boolean; marks: { bold: boolean; italic: boolean; heading: boolean } }): void
  onLink?(): void
  readOnly?: boolean
  /** Walk I8: who draws an embedded view's rows. Without it, the block is its label (the schema's toDOM). */
  embedView?: EmbedDrawer
}

export interface HubEditor {
  view: EditorView
  insert(kind: InsertKind, attrs?: object): void
  toggle(mark: 'bold' | 'italic' | 'heading'): void
  /** Links the selection to `href`; with nothing selected, inserts `label` (else the href) linked. An empty
   * href removes the link. The caller passes `↗` as the label for a page stricter than this one (§4.5). */
  link(href: string, label?: string): void
  mention(m: { kind: string; ref: string; label: string }): void
  setReadOnly(b: boolean): void
  destroy(): void
}

type Trigger = { kind: 'slash' | 'mention'; from: number } | null
const triggerKey = new PluginKey<Trigger>('hub-trigger')
const TRIGGER_CHAR = { slash: '/', mention: '@' } as const

/** `/` and `@` open the chrome's menus; the trigger follows the text typed after them until it stops. */
const triggerPlugin = new Plugin<Trigger>({
  key: triggerKey,
  state: {
    init: () => null,
    apply(tr, value, _old, state) {
      const meta = tr.getMeta(triggerKey) as Trigger | undefined
      if (meta !== undefined) return meta
      if (!value) return null
      const from = tr.mapping.map(value.from, -1)
      const { selection } = state
      if (!selection.empty || selection.from <= from || selection.$from.start() > from) return null
      const text = state.doc.textBetween(from, selection.from, '\n', '\n')
      if (text[0] !== TRIGGER_CHAR[value.kind] || /\s/.test(text.slice(1))) return null
      return { kind: value.kind, from }
    },
  },
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== '/' && text !== '@') return false
      const $from = view.state.doc.resolve(from)
      const parent = $from.parent
      if (!parent.inlineContent || parent.type.spec.code) return false
      if (text === '/') {
        if (parent.type !== hubSchema.nodes.paragraph || parent.content.size !== 0 || from !== to) return false
      } else {
        const before = parent.textBetween(0, $from.parentOffset, '\n', '\n')
        if (before !== '' && !/\s$/.test(before)) return false // an `@` inside a word (an address) opens nothing
      }
      const kind = text === '/' ? 'slash' : 'mention'
      view.dispatch(view.state.tr.insertText(text, from, to).setMeta(triggerKey, { kind, from }))
      return true
    },
  },
})

const RAW = hubSchema.nodes.raw

const attrsOf = (n: Node): EmbedViewAttrs => ({ collection: String(n.attrs.collection), view: String(n.attrs.view), label: String(n.attrs.label) })

/** Walk I8: an embedded view's block, drawn by `draw` and read-only inside the editor. Its element names nothing of the
 *  collection (no label, no attribute): what it shows is the drawer's, judged as the viewer. A press on a link or control
 *  inside it is the control's, not the editor's; anywhere else selects the block, which moves and goes as an atom. The
 *  node, and so the Markdown, is never changed by what is drawn. */
function embedNodeView(node: Node, draw: EmbedDrawer): NodeView {
  const dom = document.createElement('div')
  dom.className = 'hub-embed hub-embed-v'
  dom.setAttribute('data-embed', 'view')
  dom.setAttribute('contenteditable', 'false')
  const drawn = draw(dom, attrsOf(node))
  const type = node.type
  return {
    dom,
    update(next) {
      if (next.type !== type) return false
      drawn.update(attrsOf(next))
      return true
    },
    ignoreMutation: () => true,
    stopEvent(e) {
      const at = e.target instanceof Element ? e.target.closest('a, button, input, select, textarea, [tabindex]') : null
      return at !== null && at !== dom && dom.contains(at)
    },
    destroy: () => drawn.destroy(),
  }
}

/** Raw blocks are kept as written: a transaction may move or delete one, never make one with other text. */
function rawGuard(known: Set<string>): Plugin {
  const foreign = (content: { descendants(f: (n: Node) => boolean | void): void }) => {
    let bad = false
    content.descendants((n) => {
      if (n.type === RAW && !known.has(n.attrs.src)) bad = true
      return !bad
    })
    return bad
  }
  return new Plugin({
    filterTransaction(tr) {
      return tr.steps.every((step, i) => {
        if (step instanceof AttrStep) return tr.docs[i].nodeAt(step.pos)?.type !== RAW
        if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) return !foreign(step.slice.content)
        return true
      })
    },
  })
}

function markActive(state: EditorState, type: MarkType): boolean {
  const { from, to, empty, $from } = state.selection
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()))
  return state.doc.rangeHasMark(from, to, type)
}

function selectionReport(state: EditorState) {
  return {
    empty: state.selection.empty,
    marks: {
      bold: markActive(state, hubSchema.marks.strong),
      italic: markActive(state, hubSchema.marks.em),
      heading: state.selection.$from.parent.type === hubSchema.nodes.heading,
    },
  }
}

function blockFor(kind: InsertKind, attrs: Record<string, unknown>): Node {
  const n = hubSchema.nodes
  const str = (k: string, d = '') => (typeof attrs[k] === 'string' ? (attrs[k] as string) : d)
  switch (kind) {
    case 'divider':
      return n.horizontal_rule.create()
    case 'view':
      return n.embed_view.create({ collection: str('collection'), view: str('view'), label: str('label') })
    case 'record':
      return n.embed_record.create({ ref: str('ref'), label: str('label') })
    case 'callout':
      return n.alert.create({ kind: str('kind', 'NOTE').toUpperCase() }, n.paragraph.create())
    case 'task':
      return n.bullet_list.create({ tight: true, bullet: '-' }, n.list_item.create({ checked: false }, n.paragraph.create()))
    case 'table': {
      const cols = Number(attrs.cols) > 0 ? Number(attrs.cols) : 3
      const rows = Number(attrs.rows) > 1 ? Number(attrs.rows) : 2
      const row = (cell: typeof n.table_cell) => n.table_row.create(null, Array.from({ length: cols }, () => cell.createAndFill()!))
      return n.table.create(null, [row(n.table_header), ...Array.from({ length: rows - 1 }, () => row(n.table_cell))])
    }
  }
}

/** Mount the editor on `mount`. */
export function createEditor(mount: HTMLElement, opts: EditorOptions): HubEditor {
  const { doc, sources } = parsePage(opts.body)
  const known = new Set<string>()
  doc.descendants((n) => {
    if (n.type === RAW) known.add(n.attrs.src)
    return n.isBlock && !n.isTextblock
  })
  let readOnly = Boolean(opts.readOnly)
  let lastQuery: string | null = null
  let lastSelection = ''

  const state = EditorState.create({
    doc,
    plugins: [
      triggerPlugin,
      rawGuard(known),
      hubInputRules(hubSchema),
      tableEditing(),
      keymap(hubKeymap(hubSchema, { onLink: () => opts.onLink?.() })),
      keymap(baseKeymap),
      history(),
      dropCursor(),
      gapCursor(),
    ],
  })

  const coords = (pos: number) => {
    try {
      const c = view.coordsAtPos(pos)
      return { left: c.left, top: c.bottom }
    } catch {
      return { left: 0, top: 0 } // not measurable (no layout)
    }
  }

  const draw = opts.embedView
  const view: EditorView = new EditorView(mount, {
    state,
    ...(draw ? { nodeViews: { embed_view: (node: Node) => embedNodeView(node, draw) } } : {}),
    attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': opts.label },
    editable: () => !readOnly,
    dispatchTransaction(tr: Transaction) {
      const before = view.state
      const next = before.apply(tr)
      view.updateState(next)
      if (next.doc !== before.doc) opts.onChange(serializePage(next.doc, sources))

      const trigger = triggerKey.getState(next)
      if (trigger) {
        const q = next.doc.textBetween(trigger.from + 1, next.selection.from, '\n', '\n')
        const was = triggerKey.getState(before)
        if (!was || was.from !== trigger.from || was.kind !== trigger.kind || q !== lastQuery) {
          lastQuery = q
          if (trigger.kind === 'slash') opts.onSlash(q)
          else opts.onMention(q, coords(trigger.from))
        }
      } else lastQuery = null

      const report = selectionReport(next)
      const key = JSON.stringify(report)
      if (key !== lastSelection) {
        lastSelection = key
        opts.onSelection(report)
      }
    },
  })
  lastSelection = JSON.stringify(selectionReport(view.state))

  const run = (tr: Transaction) => {
    view.dispatch(tr)
    view.focus()
  }

  return {
    view,

    insert(kind, attrs = {}) {
      const tr = view.state.tr
      const trigger = triggerKey.getState(view.state)
      if (trigger?.kind === 'slash') tr.delete(trigger.from, tr.selection.from)
      tr.setMeta(triggerKey, null)
      const node = blockFor(kind, attrs as Record<string, unknown>)
      const $from = tr.selection.$from
      let at: number
      if ($from.depth === 1 && $from.parent.type === hubSchema.nodes.paragraph && $from.parent.content.size === 0) {
        at = $from.before()
        tr.replaceWith(at, $from.after(), node)
      } else {
        at = $from.depth === 0 ? $from.pos : $from.after(1)
        tr.insert(at, node)
      }
      if (node.inlineContent || node.content.size > 0) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
      } else {
        // an atom: the cursor goes to the block after it, a new empty paragraph when there is none
        const after = at + node.nodeSize
        if (after >= tr.doc.content.size) tr.insert(after, hubSchema.nodes.paragraph.create())
        tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
      }
      run(tr.scrollIntoView())
    },

    toggle(mark) {
      const s = view.state
      if (mark === 'heading') {
        const inHeading = s.selection.$from.parent.type === hubSchema.nodes.heading
        const cmd = inHeading ? setBlockType(hubSchema.nodes.paragraph) : setBlockType(hubSchema.nodes.heading, { level: 2 })
        cmd(s, view.dispatch)
      } else {
        toggleMark(mark === 'bold' ? hubSchema.marks.strong : hubSchema.marks.em)(s, view.dispatch)
      }
    },

    link(href, label) {
      const s = view.state
      const type = hubSchema.marks.link
      const { from, to, empty } = s.selection
      const tr = s.tr
      if (!href) tr.removeMark(from, to, type)
      else if (empty) {
        const text = label || href
        tr.insertText(text, from).addMark(from, from + text.length, type.create({ href }))
      } else tr.removeMark(from, to, type).addMark(from, to, type.create({ href }))
      run(tr)
    },

    mention(m) {
      const s = view.state
      const trigger = triggerKey.getState(s)
      const from = trigger?.kind === 'mention' ? trigger.from : s.selection.from
      const to = s.selection.to
      const text = m.label.startsWith('@') ? m.label : `@${m.label}`
      const mark = hubSchema.marks.mention.create({ kind: m.kind, ref: m.ref })
      const tr = s.tr.replaceWith(from, to, hubSchema.text(text, [mark])).setMeta(triggerKey, null)
      tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks([])
      run(tr)
    },

    setReadOnly(b) {
      readOnly = b
      view.setProps({ editable: () => !readOnly })
    },

    destroy() {
      view.destroy()
    },
  }
}
