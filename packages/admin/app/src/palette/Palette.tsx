import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { api } from '../api.ts'
import { useActor } from '../actor.ts'
import { useChanges } from '../changes/useChanges.ts'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { canCreate, useCanEdit } from '../editable.ts'
import { recordTarget } from '../record/useRecord.ts'
import { useSystemsRead } from '../queries.ts'
import { boardOfKind } from '../kinds.ts'
import { newRecordHref, selectHref } from '../hrefs.ts'
import { SECTIONS, placeable } from '../sections.ts'
import { toggleTheme } from '../theme.ts'
import { setSkin } from '../skin.ts'
import { useMachine } from '../machines.ts'
import { palette } from '../machines/palette.ts'
import { closeDialog, useSlot } from '../parts/panels.tsx'
import { announce } from '../parts/live.tsx'
import { Icon } from '../design/Icon.tsx'
import { Kbd } from '../design/Kbd.tsx'
import { Note } from '../design/Note.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { useEntryOfResources } from '../blocks/entries.ts'
import { shownName } from '../record/restricted.ts'
import { keyStep, pressOf } from '../keys/keys.ts'
import {
  GROUPS, filterItems, findByAddress, highlight, inScope, paletteItems, places, recordContext, scopeLabel, scopes, type PaletteItem,
} from './palette.ts'

/** The empty state (§5.7): one line, the query quoted. */
export const nothingMatches = (query: string) => `Nothing matches “${query}”. Try a section name, a record id or an address.`

/** What the palette draws (§5.7): the 52px input with its search glyph and scope chip, the results as a listbox
 *  grouped Jump to, Records, Actions, Views — driven by `aria-activedescendant`, so focus stays in the input — the
 *  matched letters in `<mark>`, a section's g-keys as key caps, and the foot. `items` come in group order. A
 *  `specimen` (/parts) draws the same in place: its input is read-only and the page does not follow its row; `foot`
 *  false leaves the foot out (the gallery's empty-line specimen). */
export function PaletteView({ query, onQuery, items, active, scope, failed = null, pending = false, onKeyDown, onPick, inputRef, specimen = false, foot = true }: {
  query: string; onQuery?(q: string): void; items: PaletteItem[]; active: number; scope: string; failed?: string | null; pending?: boolean
  onKeyDown?(e: ReactKeyboardEvent<HTMLInputElement>): void; onPick?(i: number, inspect: boolean): void
  inputRef?: RefObject<HTMLInputElement | null>; specimen?: boolean; foot?: boolean
}) {
  const id = useId()
  const optionId = (i: number) => `${id}-o${i}`
  useEffect(() => { if (!specimen) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' }) }, [active, items.length, specimen])
  const groups = GROUPS.map(g => ({ ...g, rows: items.flatMap((item, i) => (item.group === g.id ? [{ item, i }] : [])) })).filter(g => g.rows.length > 0)
  return (
    <div className="pal">
      <div className="pal-in">
        <Icon name="search" />
        <input ref={inputRef} role="combobox" aria-expanded="true" aria-controls={`${id}-l`} aria-autocomplete="list"
          aria-label="Search records, sections, operations and actions" aria-describedby={`${id}-s`}
          aria-activedescendant={items[active] ? optionId(active) : undefined} placeholder="Search or jump to…" autoComplete="off" spellCheck={false}
          value={query} readOnly={specimen} onChange={e => onQuery?.(e.target.value)} onKeyDown={onKeyDown} />
        <span className="pal-scope" id={`${id}-s`} data-testid="pal-scope"><span className="sr-only">Scope: </span>{scope}</span>
      </div>
      {/* The list scrolls; focus stays in the input (aria-activedescendant), and each option is focusable from script
          only, out of the tab order, so the scrolling region holds focusable content (axe scrollable-region-focusable,
          walk 2026-11-04) while ↑↓ scroll the active one into view. */}
      <div className="pal-list">
        <div id={`${id}-l`} role="listbox" aria-label="Results">
          {groups.map(g => (
            <div key={g.id} role="group" aria-labelledby={`${id}-g-${g.id}`}>
              <div className="pal-g" id={`${id}-g-${g.id}`}>{g.label}</div>
              {g.rows.map(({ item, i }) => (
                <div key={item.key} id={optionId(i)} role="option" aria-selected={i === active} className="pal-o" tabIndex={-1}
                  onMouseDown={e => { e.preventDefault(); onPick?.(i, e.metaKey || e.ctrlKey) }}>
                  <Icon name={item.icon ?? 'file'} />
                  <span className="pal-l" title={item.label}>
                    {highlight(item.label, query).map((r, k) => (r.match ? <mark key={k}>{r.text}</mark> : <Fragment key={k}>{r.text}</Fragment>))}
                  </span>
                  {(item.group === 'records' || item.group === 'views') && <span className="pal-sub">{item.detail}</span>}
                  {item.keys && <span className="pal-end">{item.keys.split(' ').map(k => <Kbd key={k}>{k}</Kbd>)}</span>}
                  {item.hint && <span className="pal-end">{item.hint}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        {failed !== null && <Note state="error">{failed}</Note>}
        {failed === null && items.length === 0 && (pending ? <Note state="loading">Loading…</Note> : <Note state="empty">{nothingMatches(query)}</Note>)}
      </div>
      {foot && <div className="pal-foot">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span><Kbd>↵</Kbd> open</span>
        <span><Kbd>⌘</Kbd><Kbd>↵</Kbd> in inspector</span>
        <span><Kbd>esc</Kbd> close</span>
      </div>}
    </div>
  )
}

/** ⌘K / Ctrl-K (§5.7): a modal `<dialog>` over the scrim, the input focused. Enter goes; ⌘Enter opens a record in
 *  the inspector without navigating; Tab cycles the scope chip. It lists only what the viewer may see (rule 7) —
 *  previewing, nothing that writes — and an address pasted finds the records that hold it. */
export default function Palette() {
  // ⌘K's lifecycle: closed, searching, running. send and can are stable and read the current state,
  // so the key listener registered once below may hold them (ruling 11).
  const p = useMachine(palette, { context: null })
  const open = p.state !== 'closed'
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const [scopeAt, setScopeAt] = useState(0)
  const [path, navigate] = useLocation()
  const inspector = useInspector()
  const changes = useChanges()
  const { known } = useActor()
  const { viewer, setViewer, visible } = useViewer()
  const canWrite = useCanWrite()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  // Where focus was when the palette opened: the overlay slot hands it back on every way of closing.
  const opener = useRef<Element | null>(null)
  const remember = () => { if (p.can('OPEN')) opener.current = document.activeElement }
  const reset = () => { setQuery(''); setAt(0); setScopeAt(0) }
  const close = () => { p.send('CLOSE'); reset() }
  // The palette is the overlay panel: Escape closes it through the slot, which hands focus back.
  useSlot('overlay', 'palette', open, () => close(), () => (opener.current instanceof HTMLElement ? opener.current : null),
    () => closeDialog(dialog.current)) // closed before focus goes back: while modal, the opener is inert
  useEffect(() => {
    // ⌘K / Ctrl-K, as the key map says (keys.ts), heard here first, wherever the palette is mounted — a field included.
    const onKey = (e: KeyboardEvent) => {
      const a = keyStep({ pendingG: null }, pressOf(e), 0).action
      if (a !== null && 'open' in a && a.open === 'palette') { e.preventDefault(); remember(); p.send('TOGGLE') }
    }
    const onAsk = () => { remember(); p.send('OPEN') }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('open-palette', onAsk)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('open-palette', onAsk) }
  }, [])
  useLayoutEffect(() => {
    const d = dialog.current
    if (!open || !d) return
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '') }
    input.current?.focus()
  }, [open])
  const resources = useQuery({ queryKey: ['resources'], queryFn: api.resources, enabled: open })
  const registries = useQuery({ queryKey: ['registries'], queryFn: api.registries, enabled: open })
  const ops = useQuery({ queryKey: ['allOperations'], queryFn: api.allOperations, enabled: open })
  const systemsRead = useSystemsRead()
  // What the viewer may see, and nothing else: not listed, not counted (rule 7).
  const seen = visible(resources.data ?? [])
  // a section listed by a system waits for data/systems.yaml, which places it: none is listed by one before (I-2)
  const placed = placeable(seen, !systemsRead.pending && !systemsRead.error)
  // Each record by the name the viewer may read (D-12, E-70): a name the gate marks restricted is listed, searched and
  // named in its operations as "<hat> only", never by its value. Until the entries answer, no record is listed at all.
  const source = useVisibilitySource()
  const entries = useEntryOfResources(open ? seen : []) // the resources' cache is shared: a closed palette reads no file
  const all = entries.pending ? [] : seen.map(r => { const name = shownName(r, entries.entryOf(r), source); return name === r.name ? r : { ...r, name } })
  const masked = new Map(all.filter(r => !seen.includes(r)).map(r => [r.id, r.name]))
  const opsSeen = (ops.data ?? []).filter(o => !entries.pending || !seen.some(r => r.id === o.resource))
    .map(o => { const name = masked.get(o.resource); return name === undefined ? o : { ...o, resourceName: name } })
  // "Edit this record" is offered where the record page offers Edit (C11): one predicate, useCanEdit.
  const record = recordContext(path)
  const target = record ? recordTarget(record.kind, record.id) : null
  const here = target?.resourceId ? seen.find(r => r.id === target.resourceId) ?? null : null
  const editable = useCanEdit(here ? { resource: here }
    : { registry: target && !target.resourceId ? target.registry : null, id: record?.id })
  const view = changes.view
  // Previewing, nothing that writes is offered (C-23): no operation, no edit, no staged change to apply.
  const staged = canWrite && known && !!view && view.ops.length > 0
  // What the viewer can make (design pass 2026-11-04): New <kind> where a section adds records they may create, then
  // New board, which opens its sheet on Boards. Writes, so none while previewing (C-23).
  const adds = canWrite && known ? [
    ...SECTIONS.filter(d => d.words && d.newRegistry && canCreate(d.newRegistry, registries.data?.find(g => g.name === d.newRegistry)?.kind, known))
      .map(d => ({ label: `New ${d.words!.noun}`, go: newRecordHref(d.newRegistry!) })),
    { label: 'New board', go: '/boards?new=1' },
  ] : []
  const scopeList = scopes(path)
  const scope = scopeList[scopeAt % scopeList.length]!
  const named = new Set(findByAddress(query, all).map(r => `r:${r.id}`))
  const items = !open ? [] : filterItems(paletteItems(all, places(placed, registries.data ?? [], systemsRead.entries), canWrite ? opsSeen : [], {
    hasChanges: staged, canApply: staged && !!view && view.rule.direct && view.stale.length === 0,
    record: canWrite && record && editable ? record : null, // only Edit reads it: offered where the record page offers Edit
    path, viewing: viewer.as === 'you' ? 'you' : viewer.as === 'public' ? 'public' : 'other', adds,
  }).filter(i => inScope(i, scope, path)), query, 30, named)
  const cur = Math.min(at, Math.max(items.length - 1, 0)) // the list may have shrunk under it
  if (!open) return null

  const failed = [resources, registries, ops].find(q => q.error)?.error?.message ?? null
  const pending = [resources, registries, ops].some(q => q.isPending) || entries.pending
  const run = (item: PaletteItem, inspect: boolean) => {
    p.send('RUN'); reset()
    try {
      if (inspect && item.inspect) { inspector.open(item.inspect); return }
      if (item.go) { navigate(item.go); return }
      switch (item.action) {
        case 'theme': toggleTheme(); break
        case 'apply': window.dispatchEvent(new Event('apply-changes')); break
        case 'discard': window.dispatchEvent(new Event('discard-changes')); break
        case 'edit': navigate(`${path}?edit=1`); break
        case 'view-public': setViewer({ as: 'public' }); break
        case 'exit-preview': setViewer({ as: 'you' }); break
        case 'map': {
          const id = target?.resourceId // only a resource sits on a map; any other page goes to the organization map
          if (!record || !id) { navigate('/b/organization'); break }
          navigate(selectHref(seen.find(r => r.id === id)?.board ?? boardOfKind(record.kind), [id]))
          break
        }
        default: if (item.action?.startsWith('skin:')) setSkin(item.action.slice('skin:'.length))
      }
    } finally { p.send('DONE') }
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(cur + 1, Math.max(items.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(cur - 1, 0)) }
    else if (e.key === 'Tab') { // the input is the dialog's one control: Tab cycles the scope instead of leaving it
      e.preventDefault()
      const next = (scopeAt % scopeList.length + (e.shiftKey ? scopeList.length - 1 : 1)) % scopeList.length
      setScopeAt(next)
      setAt(0)
      // the chip changes in silence otherwise: say where Tab moved (L4a final review M-19)
      announce(`Scope: ${scopeLabel(scopeList[next]!, path)}`)
    }
    else if (e.key === 'Enter' && items[cur]) { e.preventDefault(); run(items[cur]!, e.metaKey || e.ctrlKey) }
  }
  // A press on the dialog itself is on the scrim around the panel: the panel fills only its middle.
  const scrim = (e: MouseEvent) => { if (e.target === e.currentTarget) close() }
  return (
    <dialog ref={dialog} className="pal-dialog" aria-label="Command palette" aria-modal="true" onMouseDown={scrim}
      onCancel={e => { e.preventDefault(); close() }}>
      <PaletteView query={query} onQuery={q => { setQuery(q); setAt(0) }} items={items} active={cur} scope={scopeLabel(scope, path)}
        failed={failed} pending={pending} onKeyDown={onKeyDown} onPick={(i, inspect) => run(items[i]!, inspect)} inputRef={input} />
    </dialog>
  )
}
