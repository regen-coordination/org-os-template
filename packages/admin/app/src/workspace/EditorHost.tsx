// The engine (Task 6's createEditor) mounted inside L4c's PageBody. The engine has no "menu closed" signal (Task 6 carry):
// a plugin of this host's watches every state the view takes and says whether the `/` or `@` the chrome opened a menu for
// is still where the caret is, and where the selection sits, so the chrome closes its own menus and floats its toolbar.
// Walk I8: each embedded view's block is drawn here, through a portal into the block's element, so its rows are read
// inside the house (its query client, its router, View as) as the collection page reads them.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { createEditor, type EmbedDrawer, type EmbedViewAttrs, type HubEditor } from '../editor/view.ts'
import { hubSchema } from '../editor/schema.ts'
import { EmbeddedView } from './EmbeddedView.tsx'

/** Where the caret is, after every state the view takes. `slash`/`mention`: the text before the caret still reads as an
 *  open `/` (an empty paragraph's) or `@` (a word's start). `at`: below the selection's start, in viewport pixels (0,0
 *  where it cannot be measured). */
export interface Caret { empty: boolean; slash: boolean; mention: boolean; docChanged: boolean; at: { left: number; top: number } }

const EDITORS = new WeakMap<Element, HubEditor>()
/** The editor mounted on a page body's editable region (tests drive the engine through it). */
export const editorOf = (dom: Element): HubEditor | undefined => EDITORS.get(dom)

function caretOf(view: EditorView, docChanged: boolean): Caret {
  const { selection } = view.state
  const $from = selection.$from
  const before = $from.parent.inlineContent ? $from.parent.textBetween(0, $from.parentOffset, '\n', '\n') : ''
  let at = { left: 0, top: 0 }
  try { const c = view.coordsAtPos(selection.from); at = { left: c.left, top: c.top } } catch { /* no layout */ }
  return {
    empty: selection.empty,
    slash: selection.empty && $from.parent.type === hubSchema.nodes.paragraph && /^\/\S*$/.test(before) && $from.parentOffset === $from.parent.content.size,
    mention: selection.empty && /(^|\s)@\S*$/.test(before),
    docChanged,
    at,
  }
}

export interface EditorHostProps {
  body: string
  label: string
  readOnly: boolean
  onChange(markdown: string): void
  onSlash(q: string): void
  onMention(q: string, at: { left: number; top: number }): void
  onSelection(s: { empty: boolean; marks: { bold: boolean; italic: boolean; heading: boolean } }): void
  onLink(): void
  onCaret(c: Caret): void
  /** The mounted editor, for the chrome's commands; null once it is gone. */
  onReady(e: HubEditor | null): void
}

/** Mounts the engine once per `body` (the caller keys it by the session's version); read-only follows `readOnly`. */
export function EditorHost(p: EditorHostProps) {
  const mount = useRef<HTMLDivElement>(null)
  const props = useRef(p)
  props.current = p
  const editor = useRef<HubEditor | null>(null)
  // The embedded views' blocks now in the document: each one's element, a key of its own, and what it names.
  const [embeds, setEmbeds] = useState<ReadonlyMap<HTMLElement, { key: number; attrs: EmbedViewAttrs }>>(new Map())
  const embedKey = useRef(0)
  const embedView: EmbedDrawer = (dom, attrs) => {
    const key = ++embedKey.current
    setEmbeds(m => new Map(m).set(dom, { key, attrs }))
    return {
      update: next => setEmbeds(m => {
        const was = m.get(dom)
        if (!was || (was.attrs.collection === next.collection && was.attrs.view === next.view && was.attrs.label === next.label)) return m
        return new Map(m).set(dom, { key: was.key, attrs: next })
      }),
      destroy: () => setEmbeds(m => { if (!m.has(dom)) return m; const out = new Map(m); out.delete(dom); return out }),
    }
  }

  useEffect(() => {
    const el = mount.current!
    const e = createEditor(el, {
      body: p.body,
      label: p.label,
      readOnly: p.readOnly,
      onChange: md => props.current.onChange(md),
      onSlash: q => props.current.onSlash(q),
      onMention: (q, at) => props.current.onMention(q, at),
      onSelection: s => props.current.onSelection(s),
      onLink: () => props.current.onLink(),
      embedView,
    })
    const watcher = new Plugin({
      view: () => ({ update: (view, prev) => props.current.onCaret(caretOf(view, view.state.doc !== prev.doc)) }),
    })
    e.view.updateState(e.view.state.reconfigure({ plugins: [...e.view.state.plugins, watcher] }))
    EDITORS.set(e.view.dom, e)
    editor.current = e
    props.current.onReady(e)
    return () => {
      EDITORS.delete(e.view.dom)
      e.destroy()
      editor.current = null
      props.current.onReady(null)
    }
  }, [])

  useEffect(() => { editor.current?.setReadOnly(p.readOnly) }, [p.readOnly])
  // A renamed page renames its body's region: "<title> · page body" (§5.4).
  useEffect(() => {
    editor.current?.view.setProps({ attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': p.label } })
  }, [p.label])

  return (
    <>
      <div ref={mount} className="pg-editor" />
      {[...embeds].map(([dom, e]) => createPortal(<EmbeddedView collection={e.attrs.collection} view={e.attrs.view} />, dom, String(e.key)))}
    </>
  )
}
