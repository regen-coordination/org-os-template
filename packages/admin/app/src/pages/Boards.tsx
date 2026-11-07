import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'
import type { BoardRead, Resource } from '../api.ts'
import { useActor } from '../actor.ts'
import { useRegistries, useResources, useStatus, useSystemsRead } from '../queries.ts'
import { useChanges } from '../changes/useChanges.ts'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { refusalErrors } from '../record/useEditor.ts'
import { closeDialog, useSlot } from '../parts/panels.tsx'
import { announce } from '../parts/live.tsx'
import { useBoards } from '../boards/queries.ts'
import { boardTitle, sectionOfBoard } from '../boards/Board.tsx'
import { stageOpFor } from '../boards/arrange.ts'
import { BoardThumb, LAYOUT_WORDS, thumbBoxes } from '../boards/BoardThumb.tsx'
import { NewBoardSheet } from '../boards/NewBoardSheet.tsx'
import { OPEN_NEW_BOARD } from '../keys/useHouseKeys.ts'
import { boardDefOf } from '../../../server/boards/types.ts'
import { SECTIONS, sectionById, sectionCount, sectionRows, type SectionDef } from '../sections.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Note, NoteBlock } from '../design/Note.tsx'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Kbd } from '../design/Kbd.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { Skeleton } from '../design/Skeleton.tsx'

export { slug } from '../slug.ts'

/** What a built-in board is, in the library's words (server/library/read.ts `builtinSummary`): a section's list, a
 *  map, or its blocks and layout. */
export function boardSummary(b: BoardRead): string {
  const only = b.blocks.length === 1 ? b.blocks[0] : undefined
  const source = (typeof only?.source === 'object' && only.source !== null ? only.source : {}) as Record<string, unknown>
  if (only?.type === 'list' && typeof source.section === 'string') return `The ${source.section} section: its list, with a switch to its map.`
  if (only?.type === 'map' && typeof source.map === 'string') return `The ${source.map} map: how its records connect.`
  return `${b.blocks.length === 1 ? 'One block' : `${b.blocks.length} blocks`}, laid out as ${b.layout}.`
}

/** "<Layout> · n blocks": who last changed a board and when are not served to the client (DP-17), so not said. */
export function boardLine(b: BoardRead): string {
  const n = b.blocks.length
  return [LAYOUT_WORDS[b.layout].name, `${n} ${n === 1 ? 'block' : 'blocks'}`, b.overrides ? 'in place of the built-in' : null].filter(Boolean).join(' · ')
}

/** What a map or money board shows (spec §2 "Maps and money"), read from what it holds, never from its id. */
const MONEY = new Set(['balances', 'prepared', 'fundflow'])
const mapOf = (b: BoardRead): string | undefined => {
  const only = b.blocks.length === 1 ? b.blocks[0]! : undefined
  const map = only?.type === 'map' && typeof only.source === 'object' && only.source !== null ? (only.source as { map?: unknown }).map : undefined
  return typeof map === 'string' ? map : undefined
}
const MAP_WORDS: Record<string, string> = { organization: 'Who’s in what', systems: 'Safes, hats, spaces' }

type Shelf = 'section' | 'system' | 'map' | 'page'
function shelfOf(b: BoardRead): { shelf: Shelf; def?: SectionDef; map?: string } {
  const def = sectionOfBoard(b)
  if (def) return { shelf: def.group === 'systems' ? 'system' : 'section', def }
  const map = mapOf(b)
  if (map !== undefined || b.blocks.some(x => MONEY.has(x.type))) return { shelf: 'map', map }
  return { shelf: 'page' }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const matches = (title: string, q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every(w => title.toLowerCase().includes(w))

/** Boards (spec 2026-11-04 §2): the about line, Search boards and the primary *New board* (`n`, DP-18) in the head;
 *  *Yours* as data rows, each with a drawing of its layout and blocks; then the built-ins grouped by what they show —
 *  *Sections* (each with what it holds, its live count and *Copy to yours*, or "empty" and *Set up*; the system
 *  sections folded under "show all") and *Maps and money* — and what is left (Home) under *Pages*. On a phone a row
 *  keeps its name and its count. New board is a sheet; it and Copy to yours are writes, not drawn while previewing
 *  (C-23). */
export default function Boards() {
  const boards = useBoards()
  const org = useStatus().data?.org
  const resources = useResources()
  const registries = useRegistries()
  const systemsRead = useSystemsRead()
  const systems = systemsRead.entries
  const ch = useChanges()
  const { known } = useActor()
  const canWrite = useCanWrite()
  const { visible, sees } = useViewer()
  const [, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [said, setSaid] = useState('')
  const [refused, setRefused] = useState<string[]>([])
  const newButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const searchId = useId()
  const canNew = known && canWrite
  const openSheet = () => { if (canNew) setSheet(true) }
  // the sheet is the overlay panel: Escape closes it, and focus goes back to New board
  useSlot('overlay', 'new-board', sheet, () => setSheet(false), () => newButton.current, () => closeDialog(dialog.current))
  // `n` (useHouseKeys) and ⌘K's *New board* (/boards?new=1) open the sheet; the address drops ?new=1 once it has
  useEffect(() => {
    window.addEventListener(OPEN_NEW_BOARD, openSheet)
    return () => window.removeEventListener(OPEN_NEW_BOARD, openSheet)
  }, [canNew])
  useEffect(() => {
    if (params.get('new') !== '1' || !canNew || !boards.data) return
    openSheet()
    navigate('/boards', { replace: true })
  }, [canNew, boards.data])

  const list = boards.data ?? []
  const ours = list.filter(b => b.origin !== 'builtin')
  // the sections in the house's order (SECTIONS), the rest as served
  const at = (r: { def?: SectionDef }) => (r.def ? SECTIONS.indexOf(r.def) : SECTIONS.length)
  const builtin = list.filter(b => b.origin === 'builtin').map(b => ({ b, ...shelfOf(b) })).sort((x, y) => at(x) - at(y))
  const staged = (id: string) => (ch.view?.ops ?? []).some(o => o.record === `boards:${id}`)
  const found = <T extends { b: BoardRead }>(rows: T[]) => rows.filter(r => matches(boardTitle(r.b, org), query))
  // a count is said once the records are read: "empty" is never said before the first answer
  const read = resources.data !== undefined && registries.data !== undefined
  const countOf = (def: SectionDef): number | null => {
    if (!read) return null
    // a section that sorts systems by their data/systems.yaml entry is not counted before it answers, nor when it failed (I-2)
    if (def.systems && (systemsRead.pending || systemsRead.error)) return null
    // a registry-only section (Meetings) is its file's count, which a Public preview does not read: no count, not "empty" (M-1)
    if (def.registry) return sees({}) ? sectionCount(def, resources.data!, registries.data!, systems) : null
    return visible(sectionRows(def, resources.data!, systems)).length
  }
  const onMap = (map: string): number | null => (read ? visible(resources.data!.filter((r: Resource) => r.board === map && r.kind !== 'absent')).length : null)

  const copy = async (b: BoardRead) => {
    const op = stageOpFor(b, boardDefOf(b), ch.view) // a built-in not in your change: a create of its copy, as the board page's own
    setRefused([])
    try {
      await ch.stage([op])
      const text = `A copy of ${boardTitle(b, org)} is in your changes. Apply it to make it yours.`
      setSaid(text)
      announce(text)
    } catch (err) { setRefused(refusalErrors(err, op.record).map(e => e.message)) }
  }

  const sectionRow = ({ b, def }: { b: BoardRead; def?: SectionDef }) => {
    const title = boardTitle(b, org)
    const n = def ? countOf(def) : null
    // empty: Set up opens the section, where its plate is (a section with words); else Copy to yours. Both are for a
    // member who can write, never while previewing (C-23); Copy once per change
    const action = !canNew ? undefined : n === 0 && def
      ? def.words && <ButtonLink small href={def.route}><span aria-hidden="true">Set up</span><span className="sr-only">Set up {title}</span></ButtonLink>
      : !staged(b.id) ? <Button small variant="ghost" label={`Copy to yours: ${title}`} onClick={() => void copy(b)}>Copy to yours</Button> : undefined
    return (
      <DataRow key={b.id} kind={def?.kinds[0] ?? 'board'} title={title} href={`/b/${encodeURIComponent(b.id)}`} marks={[]} className="brow"
        second={def?.words?.about ?? boardSummary(b)}
        trailing={n === null ? undefined : n === 0
          ? <span className="brow-empty"><span className="brow-dot" aria-hidden="true" />empty</span>
          : <span className="brow-n">{n}</span>}
        action={action} />
    )
  }
  const mapRow = ({ b, map }: { b: BoardRead; map?: string }) => {
    const treasury = sectionById('treasury')
    const n = map !== undefined ? onMap(map) : treasury ? countOf(treasury) : null
    const what = map !== undefined ? MAP_WORDS[map] ?? boardSummary(b) : 'Balances and waiting transactions'
    return (
      <DataRow key={b.id} kind={map !== undefined ? 'map' : 'safe'} title={boardTitle(b, org)} href={`/b/${encodeURIComponent(b.id)}`} marks={[]}
        className="brow" second={what}
        trailing={n === null ? undefined : <span className="brow-n">{map !== undefined ? plural(n, 'record') : plural(n, 'system')}</span>} />
    )
  }

  const sections = found(builtin.filter(r => r.shelf === 'section'))
  const folded = found(builtin.filter(r => r.shelf === 'system'))
  const maps = found(builtin.filter(r => r.shelf === 'map'))
  const pages = found(builtin.filter(r => r.shelf === 'page'))
  const yours = ours.filter(b => matches(boardTitle(b, org), query))
  const searching = query.trim() !== ''
  const unfolded = all || searching // a search looks through the folded ones too
  const nothing = boards.data !== undefined && searching && yours.length + sections.length + folded.length + maps.length + pages.length === 0

  return (
    <>
      <PageHead title="Boards" about={<>Ways of looking at the org’s records. Built-in boards come with the framework; yours are kept in <code>data/boards.yaml</code>.</>}>
        <label className="boards-find" htmlFor={searchId}><span className="sr-only">Search boards</span>
          <input id={searchId} className="input" type="search" placeholder="Search boards" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        {canNew && <>
          <Button ref={newButton} primary icon="plus" haspopup="dialog" expanded={sheet} onClick={openSheet} describedby={`${searchId}-n`}>
            New board<span className="btn-kbd" aria-hidden="true"><Kbd>n</Kbd></span>
          </Button>
          <span id={`${searchId}-n`} className="sr-only">Key: n</span>
        </>}
      </PageHead>
      {boards.error && <Note state="error">{boards.error.message}</Note>}
      {boards.isPending && <Skeleton rows={4} shape="row" label="Boards" />}
      {boards.data && list.length === 0 && <NoteBlock title="No boards." line="A board is a page of blocks: New board makes one." />}
      {said && <p className="boards-said">{said}</p>}
      {refused.map(r => <Note key={r} state="error">{r}</Note>)}
      {nothing && <Note state="empty">No board is called “{query.trim()}”.</Note>}
      {yours.length > 0 && (
        <Section label="Yours" count={yours.length}>
          <DataList label="Your boards">
            {yours.map(b => (
              <DataRow key={b.id} kind="board" title={boardTitle(b, org)} href={`/b/${encodeURIComponent(b.id)}`} marks={[]} className="brow brow-thumb"
                lead={<BoardThumb boxes={thumbBoxes(b.layout, b.blocks)} />} second={boardLine(b)} />
            ))}
          </DataList>
        </Section>
      )}
      {sections.length + folded.length > 0 && (
        <Section label="Sections" count={sections.length + folded.length} note="one list each, with a map">
          <DataList label="Section boards">
            {sections.map(sectionRow)}
            {unfolded && folded.map(sectionRow)}
          </DataList>
          {folded.length > 0 && !searching && (
            <div className="boards-fold">
              <Button variant="ghost" small expanded={all} onClick={() => setAll(a => !a)}>
                {all ? 'Show fewer' : `+ ${folded.map(r => r.def!.label).join(', ')} · show all`}
              </Button>
            </div>
          )}
        </Section>
      )}
      {maps.length > 0 && (
        <Section label="Maps and money" count={maps.length} note="how things connect">
          <DataList label="Maps and money">{maps.map(mapRow)}</DataList>
        </Section>
      )}
      {pages.length > 0 && (
        <Section label="Pages" count={pages.length}>
          <DataList label="Pages">
            {pages.map(({ b }) => <DataRow key={b.id} kind="home" title={boardTitle(b, org)} href={`/b/${encodeURIComponent(b.id)}`} marks={[]} className="brow" second={boardSummary(b)} />)}
          </DataList>
        </Section>
      )}
      {sheet && canNew && boards.data && <NewBoardSheet boards={list} org={org} dialogRef={dialog} onDone={() => setSheet(false)} />}
    </>
  )
}
