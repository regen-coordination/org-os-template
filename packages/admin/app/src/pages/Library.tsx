import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type ChangeView, type ListedEntry, type Shelf } from '../api.ts'
import { RECEIPTS } from '../../../lib/receipts.mjs'
import { useMachine } from '../machines.ts'
import { ADD_WHY, libraryEntry, libraryEntryGuards } from '../machines/libraryEntry.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Seg } from '../design/Seg.tsx'
import { Empty, EmptyWhen } from '../design/Empty.tsx'
import { Section } from '../design/Section.tsx'
import { Note } from '../design/Note.tsx'
import { announce } from '../parts/live.tsx'
import { EntryCard, shelfName, type ShelfName } from '../library/EntryCard.tsx'
import { EntryPreview, PreviewFrame } from '../library/EntryPreview.tsx'
import { Removal } from '../library/Removal.tsx'
import { Skeleton } from '../design/Skeleton.tsx'

type ShelfChoice = 'all' | Shelf
const haystack = (e: ListedEntry): string =>
  [e.title, e.summary, e.id, ...Object.values(e.tags).flat()].join(' ').toLowerCase()

/** What the person's own change holds for the library (E-22): the entries whose add is staged (a receipt created
 *  for them), and the receipts whose removal is staged (an update that sets `status: removed`). */
function stagedInChange(change: ChangeView | undefined): { adds: Set<string>; removals: string[] } {
  const prefix = `${RECEIPTS}:`
  const adds = new Set<string>(), removals: string[] = []
  for (const op of change?.ops ?? []) {
    if (!op.record.startsWith(prefix)) continue
    if (op.op === 'create' && typeof op.value.entry === 'string') adds.add(op.value.entry)
    else if (op.op === 'update' && op.set.status === 'removed') removals.push(op.record.slice(prefix.length))
  }
  return { adds, removals }
}

/** The library (design 2026-10-18, section 4; §11, §14.1): what the organization builds itself from. It reads every
 *  shelf the instance serves — a segmented control of shelves, a search field, a grid of entry cards — and previews
 *  the entry in view above the grid. Add — stage a change stages the entry in the person's change (the tray's), and
 *  the rule in force decides it there; Remove opens what removing an add would do, in the same frame. What the
 *  person's change already holds is said: an entry staged is "Staged in your changes", a removal staged is
 *  "Removal staged" (E-22). The entry in view is the address (`/library/<id>`), so a preview can be linked and the
 *  back button closes it. */
export default function Library({ id }: { id?: string }) {
  const list = useQuery({ queryKey: ['library'], queryFn: api.library })
  const [shelf, setShelf] = useState<ShelfChoice>('all')
  const [query, setQuery] = useState('')
  const entries = list.data?.entries ?? []
  const open = id !== undefined ? entries.find(e => e.id === id) : undefined
  const prev = useQuery({ queryKey: ['library', 'preview', id], queryFn: () => api.libraryPreview(id!), enabled: open !== undefined })
  const change = useQuery({ queryKey: ['changes'], queryFn: api.changes })
  // Who decided each add and what it created (data/library.yaml), read once a preview has a receipt to say.
  const receipts = useQuery({ queryKey: ['library', 'receipts'], queryFn: api.libraryReceipts, enabled: (prev.data?.receipts.length ?? 0) > 0 })

  const qc = useQueryClient()
  // What an Add was refused with (409 NOT_ADDABLE or TAKEN), said as the machine's refusal; the receipt whose removal
  // is in view, in place of the preview. Both belong to the entry in view.
  const [addRefusal, setAddRefusal] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // When an add went through here: until the change is read again after it, the add is staged on the page's word;
  // from then on the change says (E-22), so a change discarded in the tray un-stages the preview.
  const [addedAt, setAddedAt] = useState<number | null>(null)
  useEffect(() => { setAddRefusal(null); setRemoving(null); setAddedAt(null) }, [id])

  const inChange = stagedInChange(change.data)
  const justAdded = addedAt !== null && change.dataUpdatedAt <= addedAt
  const staged = open !== undefined && (justAdded || inChange.adds.has(open.id))
  // An entry staged in the person's change reads its own ids as taken: that is not a refusal, it is staged.
  const reason = addRefusal ?? (staged ? null : prev.data?.refusal?.sentence ?? null)
  const machine = useMachine(libraryEntry, {
    guards: libraryEntryGuards,
    context: { title: open?.title ?? '', reason: reason ?? '', addable: staged || prev.data?.cannotAdd === null, whyNot: prev.data?.cannotAdd ?? ADD_WHY },
    initial: id !== undefined ? 'previewing' : 'browsing',
  })
  const adds = open?.installable
  useEffect(() => {
    if (id === undefined) { if (machine.can('CLOSE')) machine.send('CLOSE') }
    else if (adds !== undefined) machine.send(adds ? 'PREVIEW' : 'VIEW')
  }, [id, adds])
  useEffect(() => { if (id !== undefined && reason) machine.send('REFUSE') }, [id, reason])
  // Reopened while its add is staged: the machine says so, as it did when the add went through.
  useEffect(() => { if (staged && prev.data !== undefined && machine.state !== 'staged' && machine.can('ADD')) machine.send('ADD') }, [staged, prev.data, machine.state])
  // No longer staged (the change was discarded or applied elsewhere): preview it again, read afresh, since what its
  // ids collide with has changed.
  const wasStaged = useRef(false)
  useEffect(() => {
    if (wasStaged.current && !staged && open !== undefined) {
      setAddedAt(null)
      if (machine.can('PREVIEW')) machine.send('PREVIEW')
      void qc.invalidateQueries({ queryKey: ['library', 'preview', open.id] })
    }
    wasStaged.current = staged
  }, [staged])
  // A refusal that no longer holds (the preview read again without it) leaves the refused state.
  useEffect(() => { if (id !== undefined && !reason && machine.state === 'refused' && adds) machine.send('PREVIEW') }, [reason, machine.state])

  // Add: the server stages the entry's records and its receipt, or refuses. A 409 is the machine's refusal, and a 409
  // TAKEN hands the form the next free id (E-22); a 422 (config) and anything else go back to the form, which says
  // them beside their fields. Once staged, the tray, the list and the preview are read again (['library'] holds both).
  const add = async (config: Record<string, unknown>): Promise<void | { nextFreeId: string }> => {
    if (!open) return
    setAddRefusal(null)
    try {
      await api.libraryAdd(open.id, config)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAddRefusal(err.message)
        return err.code === 'TAKEN' && typeof err.body.nextFreeId === 'string' ? { nextFreeId: err.body.nextFreeId } : undefined
      }
      throw err
    }
    setAddedAt(Date.now())
    if (!machine.can('ADD')) machine.send('PREVIEW') // from refused: an add that went through is no longer refused
    machine.send('ADD')
    for (const queryKey of [['changes'], ['library'], ['library', 'preview', open.id]]) void qc.invalidateQueries({ queryKey })
  }

  // A preview is new content a person may not see (the list is hidden behind it on a phone): say it through the
  // app's live region, once the preview has arrived and the machine has settled on what it shows, and move focus
  // to its heading. Closing says nothing and clears the region, so the same entry opened again is heard again;
  // focus goes back to the card that opened it.
  const root = useRef<HTMLDivElement>(null)
  const opener = useRef<string | null>(null)
  const settled = open !== undefined && prev.data !== undefined &&
    (machine.state === 'staged' || (reason ? machine.state === 'refused' : machine.state === 'previewing' || machine.state === 'viewing'))
  const said = settled ? machine.shows.text : null
  useEffect(() => {
    if (said === null) return
    announce(said)
  }, [said, open?.id])
  const loaded = prev.data !== undefined // the frame is drawn again when the preview arrives, and the heading with it
  useEffect(() => {
    if (open !== undefined) { opener.current = open.id; root.current?.querySelector<HTMLElement>('.lib-prev h2')?.focus() }
  }, [open?.id, loaded])
  useEffect(() => {
    if (id !== undefined) return
    announce('')
    const was = opener.current
    opener.current = null
    if (was !== null) [...(root.current?.querySelectorAll<HTMLElement>('a[data-entry]') ?? [])].find(a => a.dataset.entry === was)?.focus()
  }, [id])
  // Back from a removal, or a removal staged: the preview is drawn again, and the keyboard goes back to the Remove
  // that opened it, or to the preview's heading when that receipt is gone.
  const wasRemoving = useRef<string | null>(null)
  useEffect(() => {
    const was = wasRemoving.current
    wasRemoving.current = removing
    if (was === null || removing !== null) return
    const prev = [...(root.current?.querySelectorAll<HTMLElement>('.lib-prev button[aria-describedby]') ?? [])].find(b => b.getAttribute('aria-describedby') === `lib-rcpt-${was}`)
    ;(prev ?? root.current?.querySelector<HTMLElement>('.lib-prev h2'))?.focus()
  }, [removing])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter(e => (shelf === 'all' || e.shelf === shelf) && (needle === '' || haystack(e).includes(needle)))
  }, [entries, shelf, query])
  // What the framework adds comes first; the boards every instance has come after, under their own heading.
  const added = shown.filter(e => !e.builtin), builtin = shown.filter(e => e.builtin)
  const card = (e: ListedEntry) => <EntryCard key={e.id} entry={e} selected={e.id === id} />
  const options = [{ value: 'all' as ShelfChoice, label: `All ${entries.length}` },
    ...(list.data?.shelves ?? []).map(s => ({ value: s.shelf as ShelfChoice, label: `${shelfName(s.shelf as ShelfName)} ${s.count}` }))]
  const preview = open && (prev.data
    ? removing !== null
      ? <PreviewFrame entry={open}><Removal receipt={removing} onClose={said => { setRemoving(null); if (said) announce(said) }} /></PreviewFrame>
      : <EntryPreview key={open.id} entry={open} preview={prev.data} machine={{ state: machine.state, text: machine.shows.text }} onAdd={add} onRemove={setRemoving}
          staged={staged} removals={inChange.removals} receipts={receipts.data} />
    : <PreviewFrame entry={open}>{prev.error ? <Note state="error">{prev.error.message}</Note> : <Skeleton rows={4} shape="row-1" label={open.title ?? 'the preview'} />}</PreviewFrame>)

  return (
    <>
      <PageHead title="Library" meta={list.data ? [`from: ${list.data.sources.join(', ')}`, entries.length === 1 ? '1 entry' : `${entries.length} entries`] : []} />
      <p className="lede">What this organization builds itself from. Previewing an entry shows what adding it would change; Add stages it in your changes, decided by your rules.</p>
      {list.error && <Note state="error">{list.error.message}</Note>}
      <div ref={root} className="lib">
        {preview}
        <section className="lib-list" aria-label="Entries">
          {list.data && (
            <div className="lib-tools">
              <Seg label="Shelf" options={options} value={shelf} onChange={setShelf} />
              <input type="search" className="input lib-search" aria-label="Search the library" placeholder="Search the library" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
          )}
          {list.isPending || list.error ? <EmptyWhen query={list}>No entries.</EmptyWhen> : shown.length === 0
            ? <Empty>{entries.length === 0 ? 'The library holds no entries.' : `Nothing in the library matches “${query.trim()}”. Clear the search to see ${entries.length === 1 ? 'the one entry' : `all ${entries.length} entries`}.`}</Empty>
            : <>
                {added.length > 0 && <div className="lib-grid">{added.map(card)}</div>}
                {builtin.length > 0 && (added.length > 0
                  ? <Section label="Built in" note={builtin.length}><div className="lib-grid">{builtin.map(card)}</div></Section>
                  : <div className="lib-grid">{builtin.map(card)}</div>)}
              </>}
          {id !== undefined && list.data && !open && <Note state="error">{`No library entry “${id}”. Choose one from the list.`}</Note>}
        </section>
      </div>
    </>
  )
}
