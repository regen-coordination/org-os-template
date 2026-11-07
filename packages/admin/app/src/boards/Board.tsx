// packages/admin/app/src/boards/Board.tsx
import { Component, useEffect, useMemo, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Redirect, useLocation, useSearch } from 'wouter'
import { BLOCK_TYPES, validateBoard } from '../../../lib/board-query.mjs'
import { useResources, useStatus } from '../queries.ts'
import { sectionById, type SectionDef } from '../sections.ts'
import { opHref } from '../hrefs.ts'
import { BlockFrame, blockType, type BlockCfg, type BlockDef } from '../blocks/index.ts'
import { useBlockCtx } from '../blocks/context.ts'
import { Note } from '../design/Note.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Menu } from '../design/Menu.tsx'
import { useImportSheet } from '../import/ImportSheet.tsx'
import { BrokenPlate } from '../design/Plate.tsx'
import { brokenFileOf, useAddHref } from '../blocks/plate.tsx'
import { SelectInput, TextInput } from '../design/inputs/index.ts'
import NotFound from '../pages/NotFound.tsx'
import { useMachine } from '../machines.ts'
import { arrange, arrangeGuards } from '../machines/arrange.ts'
import { usePanel } from '../parts/panels.tsx'
import { announce } from '../parts/live.tsx'
import { useActor } from '../actor.ts'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { useChanges } from '../changes/useChanges.ts'
import { refusalErrors } from '../record/useEditor.ts'
import { boardDefOf } from '../../../server/boards/types.ts'
import type { BlockEntry, BoardRead, CanvasPlace, GridPlace, Layout as LayoutName } from '../api.ts'
import { useBoard } from './queries.ts'
import { convert, flowOrder } from './layout.ts'
import { useNarrow } from './useNarrow.ts'
import { arrangeStore, useArrangeDraft } from './arrangeStore.ts'
import { addBlock, changeSummary, stageOpFor } from './arrange.ts'
import { ArrangeCell } from './ArrangeCell.tsx'
import { HomeHead } from './HomeHead.tsx'
import { SetupChecklist } from './SetupChecklist.tsx'
import { TreasuryHead } from './TreasuryHead.tsx'
import { PageLoading } from '../frame/PageLoading.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { systemsRead, useNeeds } from '../blocks/needs.tsx'
import type { BlockCtx } from '../blocks/types.ts'

/** What a block's frame is handed (P4b's BlockCfg): the entry less its id, type and place. A section
 *  source takes its title, empty sentence, absent adapter and map from the section, as P4b's ResourceList
 *  did, so the built-in YAML does not copy them; the board's own view wins (ruling R-7). A section with its words
 *  says its plate when empty, so it hands no empty sentence: one the board gives is still drawn (design pass). */
export function blockCfg(e: BlockEntry): BlockCfg {
  const section = typeof e.source === 'object' && e.source !== null ? (e.source as { section?: unknown }).section : undefined
  const def = typeof section === 'string' ? sectionById(section) : undefined
  if (!def) return { title: e.title, source: e.source, view: e.view, text: e.text }
  return { title: e.title ?? def.label, source: e.source, text: e.text,
    view: { ...(def.words ? {} : { empty: def.empty }), ...(def.absentKey ? { absent: def.absentKey } : {}), map: def.board, mapKey: def.id, ...e.view } }
}

/** The section a collection board stands for: its one block a list of a section (a section board, or an instance's
 *  board in its place). Its page head carries the section's about line and its Add (design pass 2026-11-04). */
export function sectionOfBoard(b: Pick<BoardRead, 'blocks'> | null | undefined): SectionDef | undefined {
  const only = b && b.blocks.length === 1 ? b.blocks[0]! : undefined
  const source = only?.type === 'list' && typeof only.source === 'object' && only.source !== null ? (only.source as { section?: unknown }).section : undefined
  return typeof source === 'string' ? sectionById(source) : undefined
}

/** A board's title: "{org}" becomes the org's name (ruling R-5). */
export const boardTitle = (b: BoardRead, org: string | undefined): string => b.name.replaceAll('{org}', org ?? '…')

const BLOCK_KEYS = ['id', 'type', 'title', 'source', 'view', 'text', 'place']

/** What makes a block's entry unreadable, as clauses: a key a block lacks (a misspelt `sorce:` would
 *  otherwise read every record), and what validateBoard says of its source and view on a one-block flow
 *  board. Field names stay validate:data's (fieldsOf: () => null): the client does not have the schemas. */
export function entryProblems(entry: BlockEntry): string[] {
  const keys = Object.keys(entry).filter(k => !BLOCK_KEYS.includes(k)).map(k => `"${k}" is not part of a block (${BLOCK_KEYS.join(', ')})`)
  const { place: _place, ...unplaced } = entry
  const shape = validateBoard({ layout: 'flow', blocks: [unplaced] }, { blockTypes: [entry.type], fieldsOf: () => null })
    .map(p => p.replace(/^block (?:"[^"]*"|#\d+): /, ''))
  return [...keys, ...shape]
}

/** One block, or why it cannot be drawn: a hand-edited file may name a type this platform lacks, or a
 *  source it cannot read; either says so in the block's own frame (Review Focus 1). */
export function BlockSlot({ entry, bare = false }: { entry: BlockEntry; bare?: boolean }) {
  const def = blockType(entry.type)
  const problems = useMemo(() => (def ? entryProblems(entry) : []), [entry, def])
  if (!def) {
    return (
      <section className="bf" role="region" aria-label={entry.title ?? entry.id} data-block={entry.id}>
        <Note state="error">Block “{entry.id}” has type “{entry.type}”, which this platform does not have. Arrange can remove it, or npm run validate:data names the fix.</Note>
      </section>
    )
  }
  if (problems.length > 0) {
    return (
      <section className="bf" role="region" aria-label={entry.title ?? entry.id} data-block={entry.id} data-type={def.type}>
        <Note state="error">Block “{entry.id}” cannot be read: {problems.join('; ')}; Arrange can change its settings, or npm run validate:data names the fix.</Note>
      </section>
    )
  }
  return <BlockFrame def={def} id={entry.id} cfg={blockCfg(entry)} bare={bare} />
}

/** A block that throws while drawing is named in an error note, so it cannot blank the board (spec §8).
 *  A new entry (its settings changed in Arrange) tries it again. */
class CellBoundary extends Component<{ name: string; entry: BlockEntry; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(prev: { entry: BlockEntry }) { if (this.state.error && prev.entry !== this.props.entry) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="bf" role="region" aria-label={this.props.name}>
        <Note state="error">Block “{this.props.name}” could not be drawn ({this.state.error.message}); Arrange can remove it.</Note>
      </section>
    )
  }
}

/** A bare block's foot (its actions), drawn by the page: bare means the page heads the block and owns its
 *  actions (P4b), so they sit under the page head, outside the block. A type that needs a later track is
 *  not yet, and has none. */
function BareFoot({ def, cfg }: { def: BlockDef; cfg: BlockCfg }) {
  const ctx = useBlockCtx()
  if (!def.Foot || def.needs) return null
  return <div className="bf-foot"><def.Foot cfg={cfg} ctx={ctx} /></div>
}

/** A block's key: its id and its type, so a type change on the same id mounts it afresh and never changes
 *  the hooks a mounted block calls. */
const keyOf = (b: BlockEntry) => `${b.id}:${b.type}`

const gridStyle = (p: unknown): CSSProperties => {
  const g = p as Partial<GridPlace> | undefined
  return g && Number.isInteger(g.col) && Number.isInteger(g.span) && Number.isInteger(g.row)
    ? { gridColumn: `${g.col} / span ${g.span}`, gridRow: String(g.row) } : { gridColumn: '1 / -1' }
}
const canvasStyle = (p: unknown): CSSProperties => {
  const c = p as Partial<CanvasPlace> | undefined
  return { left: `${c?.x ?? 0}px`, top: `${c?.y ?? 0}px`, width: `${c?.w ?? 480}px`, height: `${c?.h ?? 320}px` }
}
const canvasHeight = (blocks: BlockEntry[]) => Math.max(320, ...blocks.map(b => { const c = b.place as Partial<CanvasPlace> | undefined; return (c?.y ?? 0) + (c?.h ?? 320) + 16 }))

/** The blocks in their layout. `cell` wraps each block (Arrange, Task 9, puts its controls there). A lone
 *  block is drawn bare, its foot above it: the page head names it (ruling R-7). */
export function Layout({ layout, blocks, cell }: { layout: LayoutName; blocks: BlockEntry[]; cell?: (b: BlockEntry, i: number, slot: JSX.Element) => JSX.Element }) {
  const lone = blocks.length === 1 && !cell ? blocks[0]! : undefined
  const loneDef = lone ? blockType(lone.type) : undefined
  const slot = (b: BlockEntry, bare = false) => <CellBoundary name={b.title ?? b.id} entry={b}><BlockSlot entry={b} bare={bare} /></CellBoundary>
  const wrap = (b: BlockEntry, i: number) => (cell ? cell(b, i, slot(b)) : slot(b, lone !== undefined))
  // The page draws a lone block's foot, in the same boundary as the block: a foot that throws is named too (M-2).
  const foot = lone && loneDef?.Foot
    ? <CellBoundary key={keyOf(lone)} name={lone.title ?? lone.id} entry={lone}><BareFoot def={loneDef} cfg={blockCfg(lone)} /></CellBoundary> : null
  if (layout === 'grid') {
    return <>{foot}<div className="board grid">{blocks.map((b, i) => <div key={keyOf(b)} className="cell" style={gridStyle(b.place)}>{wrap(b, i)}</div>)}</div></>
  }
  if (layout === 'canvas') {
    return (
      <>
        {foot}
        <div className="board canvas" style={{ height: `${canvasHeight(blocks)}px` }}>
          {blocks.map((b, i) => <div key={keyOf(b)} className="cell" style={canvasStyle(b.place)}>{wrap(b, i)}</div>)}
        </div>
      </>
    )
  }
  return <>{foot}<div className="board flow">{blocks.map((b, i) => <div key={keyOf(b)} className="cell">{wrap(b, i)}</div>)}</div></>
}

const SETTINGS = 'block-settings:'
const LAYOUTS: LayoutName[] = ['grid', 'canvas', 'flow']

/** Home's head, live: what waits on the viewer (Needs you's items) and how the Systems they may see were read, with
 *  the instance as the from mark (its records' read age, E-47). */
function LiveHomeHead({ org, ctx, children }: { org: string; ctx: BlockCtx; children?: ReactNode }) {
  const needs = useNeeds(ctx.now)
  const resources = useResources()
  const readAt = resources.dataUpdatedAt > 0 ? new Date(resources.dataUpdatedAt).toISOString() : null
  return (
    // the line counts what waits on you; what you have done and waits on others is listed, not counted (§9.4)
    <HomeHead needs={needs.items ? needs.items.filter(i => !i.youActed).length : null} failed={needs.error !== undefined} systems={systemsRead(needs.systems)} now={ctx.now} from={{ repo: org, readAt }}>{children}</HomeHead>
  )
}

/** A board (spec §4.4, §5): its head and its blocks in its layout; a flow on a phone (§5.4). Arrange (§5.3)
 *  edits a draft of it, never below 760px; Done stages the whole board as one op (contract "P4c produces"). */
export function BoardPage({ id }: { id: string }) {
  const { board, staged, restores, isPending, error } = useBoard(id)
  const status = useStatus()
  const resources = useResources()
  const narrow = useNarrow()
  const ctx = useBlockCtx()
  const canWrite = useCanWrite()
  const { known } = useActor()
  const ch = useChanges()
  const panel = usePanel('right')
  const draft = useArrangeDraft()
  const mine = draft !== null && draft.base.id === id ? draft : null
  const changed = mine !== null && changeSummary(mine.base, mine.board).length > 0
  const m = useMachine(arrange, { guards: arrangeGuards, context: { changed } })
  const stands = sectionOfBoard(board)
  const addHref = useAddHref(stands)
  // the head's menu offers Import from a sheet where it offers Add (spec 2026-11-04 §1c)
  const importer = useImportSheet(addHref !== undefined ? stands?.newRegistry : undefined, stands?.words?.nouns ?? '')
  const params = new URLSearchParams(useSearch())
  const [, navigate] = useLocation()
  const [said, setSaid] = useState('')
  const say = (text: string) => { setSaid(text); announce(text) }   // seen here, and said through P4b's live region
  const [refused, setRefused] = useState<string[]>([])
  const d = m.state !== 'off' ? mine : null   // the draft, while this board is being arranged
  const settingsOf = panel.openId?.startsWith(SETTINGS) ? panel.openId.slice(SETTINGS.length) : null
  // Block settings close with Arrange; another panel in the right slot (the inspector) is not Arrange's to close.
  const closeSettings = () => { if (settingsOf !== null) panel.close() }

  const start = () => {
    if (!board) return
    if (m.state !== 'off') m.send('CANCEL')
    arrangeStore.start(board, boardDefOf(board))
    setRefused([])
    setSaid('')
    m.send('START')
  }
  const finish = (text: string) => { arrangeStore.end(); closeSettings(); say(text) }
  const cancel = () => { m.send('CANCEL'); finish('Arrange cancelled; the board is as it was.') }
  // The machine's changed guard: Done with nothing changed goes straight back to the board, staging nothing.
  // A block still picked up is dropped where it is: the review locks the cells.
  const done = () => { arrangeStore.pick(null); m.send('DONE'); if (!changed) finish('Nothing changed; the board is as it was.') }
  // A new board arrives with ?arrange=1 (New board, Task 10): start once it is here, then drop it from the
  // address, so a breakpoint crossing, an actor change or a reload does not start it again (final review M-4).
  useEffect(() => {
    if (!(board && params.get('arrange') === '1' && m.state === 'off' && known && !narrow)) return
    start()
    const rest = new URLSearchParams(params)
    rest.delete('arrange')
    const query = rest.toString()
    navigate(`/b/${encodeURIComponent(id)}${query ? `?${query}` : ''}`, { replace: true })
  }, [board?.id, known, narrow])
  // Leaving the board, or the page unmounting, ends a draft that belongs to it.
  useEffect(() => () => { if (arrangeStore.get()?.base.id === id) arrangeStore.end() }, [id])

  // An operation asked for on a map (⌘K's old address) runs on the record page, as P4b's MapPage did.
  const select = params.get('select')
  const op = params.get('op')
  if (select && op) return <Redirect to={opHref(select, { id: op, label: params.get('opLabel') ?? '' })} replace />
  if (error && !board) {
    // an unreadable data/boards.yaml (ruling R-6): its file, line and reason as a plate, not one line on a blank page
    const broken = brokenFileOf(error.message)
    return <><PageHead title="Board" />{broken
      ? <BrokenPlate title="Boards" file={broken.file} line={broken.line} reason={broken.reason} level={2} />
      : <Note state="error">{error.message}</Note>}</>
  }
  // The first frame (§6.2, walk 2026-11-04): the head as the board will draw it, as far as the address knows it —
  // Home's own line while it is read, the Treasury's head, else the board's name in the path — and skeleton sections.
  if (!board && isPending) {
    if (id === 'home') return <><HomeHead needs={null} systems={{ count: 0, failing: 0, readAt: null }} now={ctx.now} /><Skeleton rows={4} shape="needs" label="Home" /></>
    if (id === 'treasury') return <><TreasuryHead title="Treasury" now={ctx.now} meta={[]} /><Skeleton rows={4} shape="row" label="Treasury" /></>
    return <PageLoading shape="row" />
  }
  if (!board) return <NotFound />
  const s = status.data
  const shown: BoardRead = d ? { ...board, ...d.board } : board
  const meta = [...[board.audience !== 'members' ? board.audience : null, staged ? 'staged' : null],
    // A staged delete of an override previews the built-in that returns (final review M-3).
    restores ? 'Your change deletes this board; after Apply the built-in returns.' : null]
  const layout: LayoutName = narrow ? 'flow' : shown.layout
  const blocks = narrow ? flowOrder(shown.blocks, shown.layout) : shown.blocks
  const reviewing = d !== null && (m.state === 'review' || m.state === 'staging')
  const problems = reviewing ? validateBoard(d.board, { blockTypes: BLOCK_TYPES, fieldsOf: () => null }) : []
  const summary = reviewing ? changeSummary(d.base, d.board) : []

  const stage = async () => {
    if (!d) return
    // One op for the board: an update when the file or your change holds it, else a create (Review Focus 5).
    const op = stageOpFor(board, d.board, ch.view)
    if (!m.send('CONFIRM')) return
    setRefused([])
    try {
      await ch.stage([op])
      m.send('STAGED')
      finish('The board is in your changes. Apply it from the tray.')
    } catch (err) {
      setRefused(refusalErrors(err, op.record).map(e => e.message))
      m.send('REFUSED')
    }
  }
  const makeOurs = async () => {
    const op = stageOpFor(board, boardDefOf(board), ch.view)   // a built-in not in your change: a create of its copy
    setRefused([])
    try { await ch.stage([op]); say('A copy of this board is in your changes. Apply it to make it yours.') }
    catch (err) { setRefused(refusalErrors(err, op.record).map(e => e.message)) }
  }
  const add = (type: string) => {
    if (!type) return
    let made = ''
    arrangeStore.update(b => { const r = addBlock(b, type); made = r.id; return r.board })
    say(`Added ${made}.`)
  }

  // Arrange and Copy to yours (0.6's Make this board ours; walk 2026-11-04) are writes: not drawn while previewing (C-23, Review Focus 1)
  const canArrange = !d && !narrow && known && canWrite
  const canOwn = !d && known && canWrite && board.origin === 'builtin' && !staged
  // a collection's Add is the page's one primary, there once records exist too (design pass 2026-11-04)
  const words = stands?.words
  const canAdd = !d && addHref !== undefined && words !== undefined
  const acts = canArrange || canOwn || canAdd ? (
    <>
      {canArrange && <Button onClick={start}>Arrange</Button>}
      {canOwn && <Button onClick={() => void makeOurs()}>Copy to yours</Button>}
      {canAdd && <ButtonLink primary icon="plus" href={addHref}>Add {words.noun}</ButtonLink>}
      {canAdd && <Menu label={`More for ${boardTitle(shown, s?.org)}`} items={[{ type: 'item', label: 'Import from a sheet', icon: 'table', onSelect: importer.start }]} />}
    </>
  ) : undefined
  const title = boardTitle(shown, s?.org)
  // Where the page was read from (E-77, Q70): the instance and its records' read; a collection (one list) says its own
  // file in its view header instead, so the page names it once.
  const collection = shown.blocks.length === 1 && shown.blocks[0]!.type === 'list'
  const from = !collection && s?.org ? { repo: s.org, readAt: resources.dataUpdatedAt > 0 ? new Date(resources.dataUpdatedAt).toISOString() : null } : undefined
  // Home is the house's own head (§14.1); Treasury the main Safe's System header; every other board its page head.
  // The board's state (staged, restores) stays said under the head.
  const notes = meta.filter((m): m is string => typeof m === 'string' && m !== '')
  return (
    <>
      {board.id === 'home'
        ? <LiveHomeHead org={s?.org ?? title} ctx={ctx}>{acts}</LiveHomeHead>
        : board.id === 'treasury'
          ? <TreasuryHead title={title} now={ctx.now} meta={notes}>{acts}</TreasuryHead>
          : <PageHead title={title} about={words?.about} meta={meta} from={from} now={ctx.now}>{acts}</PageHead>}
      {importer.sheet}
      {board.id === 'home' && notes.length > 0 && <p className="board-note">{notes.join(' · ')}</p>}
      {/* setting up the org, from the same emptiness the sidebar's dots show (design pass 2026-11-04); not while arranging */}
      {board.id === 'home' && !d && <SetupChecklist />}
      {d && !reviewing && !narrow && (
        <div className="arr-tools" role="toolbar" aria-label="Arrange">
          <label className="arr-f" htmlFor="arr-add"><span className="arr-l">Add block</span>
            <SelectInput common={{ id: 'arr-add' }} options={BLOCK_TYPES} value="" onChange={v => { if (typeof v === 'string') add(v) }} />
          </label>
          <label className="arr-f" htmlFor="arr-layout"><span className="arr-l">Layout</span>
            <SelectInput common={{ id: 'arr-layout' }} options={LAYOUTS} value={d.board.layout} onChange={v => {
              if (typeof v !== 'string' || !(LAYOUTS as string[]).includes(v)) return
              const to = v as LayoutName
              arrangeStore.update(b => ({ ...b, layout: to, blocks: convert(b.blocks, b.layout, to) }))
            }} />
          </label>
          <label className="arr-f arr-name-f" htmlFor="arr-name"><span className="arr-l">Name</span>
            <TextInput common={{ id: 'arr-name' }} prose={false} readOnly={false} value={d.board.name}
              onChange={v => { const name = typeof v === 'string' ? v : ''; arrangeStore.update(b => ({ ...b, name })) }} />
          </label>
          <span className="arr-acts">
            <Button onClick={cancel}>Cancel</Button>
            <Button primary onClick={done}>Done</Button>
          </span>
        </div>
      )}
      {reviewing && (
        <section className="arr-review" aria-label="Review the board">
          <p className="arr-review-t">These go into your changes as one change to boards:{board.id}:</p>
          <ul className="arr-review-l">{summary.map(l => <li key={l}>{l}</li>)}</ul>
          {[...problems, ...refused].map(p => <Note key={p} state="error">{p}</Note>)}
          <span className="arr-acts">
            <Button onClick={() => { setRefused([]); m.send('BACK') }}>Back</Button>
            <Button primary disabled={problems.length > 0 || m.state === 'staging'} onClick={() => void stage()}>Stage</Button>
          </span>
        </section>
      )}
      {/* A refused stage returns to arranging (P4-C7), so its sentences stay up under the toolbar. */}
      {!reviewing && refused.map(p => <Note key={p} state="error">{p}</Note>)}
      {d && <p id="arrange-help" className="sr-only">Space picks a block up and drops it. Arrows move it, Shift and arrows resize it, Escape puts it back.</p>}
      {said && <p className="arr-said">{said}</p>}
      {blocks.length === 0
        ? <Note state="empty">{d ? 'This board has no blocks yet; Add block adds one.' : 'This board has no blocks yet. Arrange adds them.'}</Note>
        : <Layout layout={layout} blocks={blocks} cell={d && !narrow ? (b, i, slot) => (
            <ArrangeCell entry={b} index={i} total={blocks.length} board={d.board} picked={d.picked === b.id} locked={m.state !== 'arranging'}
              label={b.title ?? blockType(b.type)?.title(blockCfg(b) as never) ?? b.id}
              onSettings={opener => panel.open(`${SETTINGS}${b.id}`, opener)} say={say}>{slot}</ArrangeCell>
          ) : undefined} />}
    </>
  )
}
