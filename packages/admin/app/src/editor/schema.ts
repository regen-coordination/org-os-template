// The editor's schema (L6 spec §5.1, §5.2): the Hub's Markdown dialect and the schema are one list. Every node
// and mark here has a reading in parse.ts and a writing in serialize.ts, and the corpus round-trips through
// all of them (tests/fixtures/pages/).
//
// Anything the dialect does not model (raw HTML, footnotes, reference definitions, a fifth-level heading, a
// front-matter-like block in the body) is a `raw` block: its source kept as written, shown in a Mono well
// "Kept as written", not editable, never lost.
import { Schema, type NodeSpec, type MarkSpec, type DOMOutputSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

/** The heading levels the dialect models; a deeper heading is kept as written. */
export const HEADING_LEVELS = [1, 2, 3, 4] as const
/** GFM alert kinds (the same list as lib/workspace/markdown.mjs's ALERT_KINDS). */
export const ALERT_KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]
/** What a raw block says about itself (§5.2). */
export const KEPT_AS_WRITTEN = 'Kept as written'

const alertTitle = (kind: string) => kind.charAt(0) + kind.slice(1).toLowerCase()

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    parseDOM: [{ tag: 'p' }],
    toDOM: (): DOMOutputSpec => ['p', 0],
  },

  heading: {
    attrs: { level: { default: 1, validate: 'number' } },
    content: 'inline*',
    group: 'block',
    defining: true,
    parseDOM: HEADING_LEVELS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
    toDOM: (node): DOMOutputSpec => [`h${node.attrs.level}`, 0],
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: (): DOMOutputSpec => ['blockquote', 0],
  },

  alert: {
    attrs: { kind: { default: 'NOTE', validate: 'string' } },
    content: 'block+',
    group: 'block',
    defining: true,
    parseDOM: [{
      tag: 'div[data-alert]',
      getAttrs: (dom) => {
        const kind = (dom as HTMLElement).getAttribute('data-alert')?.toUpperCase() ?? ''
        return (ALERT_KINDS as readonly string[]).includes(kind) ? { kind } : false
      },
    }],
    toDOM: (node): DOMOutputSpec => [
      'div',
      { class: `markdown-alert markdown-alert-${String(node.attrs.kind).toLowerCase()}`, 'data-alert': node.attrs.kind, 'data-title': alertTitle(node.attrs.kind) },
      0,
    ],
  },

  bullet_list: {
    attrs: { tight: { default: true }, bullet: { default: '-' } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{ tag: 'ul', getAttrs: (dom) => ({ tight: (dom as HTMLElement).hasAttribute('data-tight') }) }],
    toDOM: (node): DOMOutputSpec => ['ul', node.attrs.tight ? { 'data-tight': 'true' } : {}, 0],
  },

  ordered_list: {
    attrs: { order: { default: 1 }, tight: { default: true }, delim: { default: '.' } },
    content: 'list_item+',
    group: 'block',
    parseDOM: [{
      tag: 'ol',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return { order: el.hasAttribute('start') ? Number(el.getAttribute('start')) : 1, tight: el.hasAttribute('data-tight') }
      },
    }],
    toDOM: (node): DOMOutputSpec => ['ol', { ...(node.attrs.order === 1 ? {} : { start: node.attrs.order }), ...(node.attrs.tight ? { 'data-tight': 'true' } : {}) }, 0],
  },

  list_item: {
    // checked: null for a plain item, true/false for a GFM task item
    attrs: { checked: { default: null } },
    content: 'paragraph block*',
    defining: true,
    parseDOM: [{
      tag: 'li',
      getAttrs: (dom) => {
        const v = (dom as HTMLElement).getAttribute('data-checked')
        return { checked: v === 'true' ? true : v === 'false' ? false : null }
      },
    }],
    toDOM: (node): DOMOutputSpec => node.attrs.checked === null
      ? ['li', 0]
      : ['li', { class: 'task-list-item', 'data-checked': String(node.attrs.checked) }, 0],
  },

  code_block: {
    attrs: { params: { default: '' } },
    content: 'text*',
    marks: '',
    group: 'block',
    code: true,
    defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: (dom) => ({ params: (dom as HTMLElement).getAttribute('data-params') ?? '' }) }],
    toDOM: (node): DOMOutputSpec => ['pre', node.attrs.params ? { 'data-params': node.attrs.params } : {}, ['code', 0]],
  },

  horizontal_rule: {
    attrs: { markup: { default: '---' } },
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: (): DOMOutputSpec => ['hr'],
  },

  ...tableNodes({
    tableGroup: 'block',
    cellContent: 'inline*',
    cellAttributes: {
      align: {
        default: null,
        getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || null,
        setDOMAttr: (value, attrs) => { if (value) attrs.style = `${attrs.style ?? ''}text-align: ${value};` },
      },
    },
  }),

  embed_record: {
    attrs: { ref: { validate: 'string' }, label: { default: '', validate: 'string' } },
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    parseDOM: [{
      tag: 'div[data-embed="record"]',
      getAttrs: (dom) => ({ ref: (dom as HTMLElement).getAttribute('data-ref') ?? '', label: dom.textContent ?? '' }),
    }],
    toDOM: (node): DOMOutputSpec => ['div', { class: 'hub-embed', 'data-embed': 'record', 'data-ref': node.attrs.ref, contenteditable: 'false' }, node.attrs.label],
  },

  embed_view: {
    attrs: { collection: { validate: 'string' }, view: { validate: 'string' }, label: { default: '', validate: 'string' } },
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    parseDOM: [{
      tag: 'div[data-embed="view"]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return { collection: el.getAttribute('data-collection') ?? '', view: el.getAttribute('data-view') ?? '', label: el.textContent ?? '' }
      },
    }],
    toDOM: (node): DOMOutputSpec => ['div', { class: 'hub-embed', 'data-embed': 'view', 'data-collection': node.attrs.collection, 'data-view': node.attrs.view, contenteditable: 'false' }, node.attrs.label],
  },

  raw: {
    attrs: { src: { validate: 'string' } },
    group: 'block',
    atom: true,
    selectable: true,
    // Read back from the clipboard (cut and paste is how a block moves by keyboard), its text from data-src.
    // A raw block is only ever made from a file: view.ts's rawGuard refuses one whose text the file did not hold.
    parseDOM: [{
      tag: 'div[data-raw]',
      priority: 60,
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        const src = el.getAttribute('data-src') ?? el.querySelector('pre')?.textContent
        return typeof src === 'string' ? { src } : false
      },
    }],
    toDOM: (node): DOMOutputSpec => [
      'div',
      { class: 'hub-raw', 'data-raw': '', 'data-src': node.attrs.src, contenteditable: 'false' },
      ['span', { class: 'hub-raw-label' }, KEPT_AS_WRITTEN],
      ['pre', node.attrs.src],
    ],
  },

  text: { group: 'inline' },

  image: {
    inline: true,
    attrs: { src: { validate: 'string' }, alt: { default: null }, title: { default: null } },
    group: 'inline',
    draggable: true,
    parseDOM: [{
      tag: 'img[src]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return { src: el.getAttribute('src'), alt: el.getAttribute('alt'), title: el.getAttribute('title') }
      },
    }],
    toDOM: (node): DOMOutputSpec => ['img', { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }],
  },

  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: (): DOMOutputSpec => ['br'],
  },
}

// Mark order is the nesting order when written: links and mentions outside, code innermost.
const marks: Record<string, MarkSpec> = {
  link: {
    // auto: 'autolink' for <https://…>, 'linkify' for a bare URL, null for [text](href)
    attrs: { href: { validate: 'string' }, title: { default: null }, auto: { default: null } },
    inclusive: false,
    parseDOM: [{
      tag: 'a[href]',
      getAttrs: (dom) => {
        const href = (dom as HTMLElement).getAttribute('href') ?? ''
        return href.startsWith('hub:') ? false : { href, title: (dom as HTMLElement).getAttribute('title') }
      },
    }],
    toDOM: (mark): DOMOutputSpec => ['a', { href: mark.attrs.href, title: mark.attrs.title }, 0],
  },

  mention: {
    // kind: member | role | page | record; ref: '<id>', or '<registry>:<id>' for a record (as refsOf reads it)
    attrs: { kind: { validate: 'string' }, ref: { validate: 'string' } },
    inclusive: false,
    excludes: 'link mention',
    parseDOM: [{
      tag: 'a[data-mention]',
      getAttrs: (dom) => ({ kind: (dom as HTMLElement).getAttribute('data-mention'), ref: (dom as HTMLElement).getAttribute('data-ref') }),
    }],
    toDOM: (mark): DOMOutputSpec => ['a', { class: 'hub-mention', 'data-mention': mark.attrs.kind, 'data-ref': mark.attrs.ref }, 0],
  },

  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: (): DOMOutputSpec => ['em', 0],
  },

  strong: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== 'normal' && null }],
    toDOM: (): DOMOutputSpec => ['strong', 0],
  },

  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM: (): DOMOutputSpec => ['s', 0],
  },

  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: (): DOMOutputSpec => ['code', 0],
  },
}

export const hubSchema: Schema = new Schema({ nodes, marks })
